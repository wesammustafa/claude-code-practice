// The learn app's edges: keys, the check child, git, the watcher, the saved
// state, the plain fallback, a full run on a fake terminal, and the promise
// that it reads the practice copy and changes nothing but its own file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { keyParser } from '../../learn/lib/keys.mjs';
import { main } from '../../learn/lib/main.mjs';
import { loadState, sanitize, saveState, storePath } from '../../learn/lib/store.mjs';
import { strip } from '../../learn/lib/text.mjs';
import { childEnv, runCheck, singleFlight, SLOW } from '../../learn/lib/verify.mjs';
import { watchDirs } from '../../learn/lib/watch.mjs';
import { lessons } from '../lessons/index.mjs';
import { statusPaths } from '../paths.mjs';
import { check, exportHead, repo, withRepo, write } from './helpers.mjs';
import { root } from './learn-drive.mjs';

const BEGINNER = ['b-1', 'b-2', 'b-3', 'b-4', 'b-5', 'b-capstone'];
const RUN_CHECK = join(root, 'learn', 'run-check.mjs');
const child = (args) => {
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const r = spawnSync(process.execPath, [RUN_CHECK, ...args], { encoding: 'utf8', env });
  return { code: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout.trim()) : null };
};

test('keys: arrows, enter, Ctrl+C, a lone Escape, and a paste as one event', () => {
  const parse = keyParser();
  assert.deepEqual(parse('\x1b[A\x1bOB\r'), [{ type: 'key', name: 'up', ch: undefined }, { type: 'key', name: 'down', ch: undefined }, { type: 'key', name: 'enter', ch: undefined }]);
  assert.deepEqual(parse('\x03'), [{ type: 'key', name: 'ctrl-c', ch: undefined }]);
  assert.deepEqual(parse('\x1b'), [], 'a lone Escape waits: it may start a sequence');
  assert.deepEqual(parse.flush(), [{ type: 'key', name: 'escape' }]);
  // An arrow split across two reads is still an arrow, not the letter B.
  assert.deepEqual(parse('\x1b['), []);
  assert.deepEqual(parse('B'), [{ type: 'key', name: 'down', ch: undefined }]);
  assert.deepEqual(parse('Q'), [{ type: 'key', name: 'q', ch: 'Q' }]);
  assert.deepEqual(parse('\x1b[200~claude --vers'), []);
  assert.deepEqual(parse('ion\r\x1b[201~'), [{ type: 'paste', text: 'claude --version\r' }]);
  assert.deepEqual(parse('git status'), [{ type: 'paste', text: 'git status' }], 'typed fast with no paste markers');
  assert.deepEqual(parse('\x1b[Z'), [], 'an unused sequence is skipped whole');
  // A paste whose end marker arrives split across reads still ends.
  assert.deepEqual(parse('\x1b[200~ls -la\x1b[20'), []);
  assert.deepEqual(parse('1~q'), [{ type: 'paste', text: 'ls -la' }, { type: 'key', name: 'q', ch: 'q' }]);
  // Ctrl+C works even inside a paste that never ends.
  assert.deepEqual(parse('\x1b[200~endless'), []);
  assert.deepEqual(parse('more\x03'), [{ type: 'key', name: 'ctrl-c' }]);
  // Typed or pasted with no markers and ending in Enter: one paste, not keys.
  assert.deepEqual(parse('bash\r'), [{ type: 'paste', text: 'bash' }]);
});

test('the check child gives the check\'s own words, with npm run check\'s pass rule', () => {
  withRepo(() => repo(), (dir) => {
    const none = child(['b-1', dir]);
    assert.equal(none.code, 0);
    assert.equal(none.out.items[0].pass, false);
    assert.equal(none.out.items[0].hint, lessons['b-1'].items[0].check({ dir, read: () => null }));
    write(dir, { '.practice/version.txt': '' });
    assert.match(child(['b-1', dir, '0']).out.items[0].hint, /is empty/);
    // Windows PowerShell 5.1 writes UTF-16 with a byte-order mark.
    writeFileSync(join(dir, '.practice', 'version.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('2.1.285 (Claude Code)\r\n', 'utf16le')]));
    assert.equal(child(['b-1', dir]).out.items[0].pass, true);
    assert.equal(child(['b-9', dir]).code, 2);
    assert.equal(child(['b-1', dir, '7']).code, 2);
  });
});

test('for every Beginner lesson the child and npm run check agree, item by item', () => {
  const dir = exportHead(root);
  try {
    for (const id of BEGINNER) {
      const ran = child([id, dir]).out.items;
      const { out } = check([id, '--dir', dir]);
      const lines = out.split('\n');
      for (const r of ran) {
        const at = lines.findIndex((l) => l.trim() === `${r.pass ? 'PASS' : 'FAIL'}  ${r.text}`);
        assert.ok(at > 0, `${id}: npm run check doesn't print ${r.pass ? 'PASS' : 'FAIL'} for ${r.text}`);
        if (!r.pass) assert.equal(lines[at + 1].trim(), r.hint.trim(), `${id}: ${r.text}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('slow items are exactly the Beginner items that start a process', () => {
  for (const id of BEGINNER) {
    const spawning = lessons[id].items.map((it, i) => [i, it.check.toString()]).filter(([, src]) => /spawnSync|execFileSync\('npm'|spawn\(/.test(src)).map(([i]) => i);
    assert.deepEqual(SLOW[id] ?? [], spawning, id);
  }
});

test('children never take git\'s index lock or print color, and run one at a time', async () => {
  const env = childEnv({ NODE_TEST_CONTEXT: 'child', PATH: '/bin' });
  assert.equal(env.GIT_OPTIONAL_LOCKS, '0');
  assert.equal(env.NO_COLOR, '1');
  assert.equal(env.NODE_TEST_CONTEXT, undefined);
  let runs = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const go = singleFlight(async () => {
    runs += 1;
    await gate;
  });
  go();
  go();
  go();
  go();
  release();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(runs, 2, 'a run, then exactly one more');
  const r = await runCheck(root, 'b-3', null);
  assert.equal(r.items.find((i) => i.index === 1).slow, true, 'the test run is left for r');
});

test('the watcher arms a .practice folder made after it started', async () => {
  // Events only speed things up: they can lag or never come (WSL on
  // /mnt/c, network folders), so main.mjs also polls. What must hold is that
  // a change re-arms the watcher on the new folder.
  const dir = repo();
  const w = watchDirs(dir, () => {}, { debounceMs: 20 });
  try {
    assert.ok(!w.dirs().some((d) => d.endsWith('.practice')));
    mkdirSync(join(dir, '.practice'));
    w.arm();
    assert.ok(w.dirs().some((d) => d.endsWith('.practice')), 'the new folder is watched');
  } finally {
    w.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('saved state: round trip, nothing written before .practice/ exists, junk ignored', () => {
  withRepo(() => repo(), (dir) => {
    const data = sanitize({ welcomed: true, eased: ['status'], lessons: { 'b-1': { step: 'W3', beat: 0, done: ['W1'], answers: { 'W4.0': 'x' } } } });
    assert.equal(saveState(dir, data), false);
    assert.equal(existsSync(join(dir, '.practice')), false, 'the app never creates .practice/');
    mkdirSync(join(dir, '.practice'));
    assert.equal(saveState(dir, data), true);
    assert.deepEqual(loadState(dir), data);
    assert.deepEqual(readdirSync(join(dir, '.practice')), ['learn.json'], 'no temp file left');
    writeFileSync(storePath(dir), '{nope');
    assert.equal(loadState(dir), null);
    writeFileSync(storePath(dir), JSON.stringify({ format: 99 }));
    assert.equal(loadState(dir), null, 'a newer format starts fresh');
    const clean = sanitize({ welcomed: 'yes', lessons: { 'b-1': { step: 3, done: [1, 'W1'], evil: true }, '../x': {} }, extra: 1 });
    assert.deepEqual(Object.keys(clean.lessons), ['b-1']);
    assert.equal(clean.welcomed, false);
    assert.equal(clean.lessons['b-1'].step, null);
    assert.deepEqual(clean.lessons['b-1'].done, ['W1']);
    assert.equal(clean.lessons['b-1'].evil, undefined);
  });
});

test('without a terminal it prints the path as plain text and exits 0', () => {
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const r = spawnSync(process.execPath, [join(root, 'learn', 'app.mjs')], { input: '', encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /\x1b/);
  for (const id of BEGINNER) assert.match(r.stdout, new RegExp(lessons[id].title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

// A terminal the test can type into and read from.
function fakeTerminal() {
  const stdin = new PassThrough();
  Object.assign(stdin, { isTTY: true, setRawMode: () => stdin });
  let screen = '';
  const stdout = new Writable({ write(chunk, _enc, cb) { screen += chunk.toString(); cb(); } });
  Object.assign(stdout, { isTTY: true, columns: 90, rows: 30, getColorDepth: () => 8 });
  const lastFrame = () => strip(screen.split('\x1b[H').at(-1) ?? '');
  return { stdin, stdout, lastFrame, type: (s) => stdin.write(s) };
}
const until = async (fn, ms = 8_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};

test('a full run on a fake terminal: writing version.txt turns step 3 done, and only learn.json is added', async () => {
  const dir = exportHead(root);
  // The solutions branch commits its .practice/ files; start from none.
  rmSync(join(dir, '.practice'), { recursive: true, force: true });
  const outside = () => statusPaths(execFileSync('git', ['status', '--porcelain', '--ignored', '--untracked-files=all'], { cwd: dir, encoding: 'utf8' }));
  const before = outside();
  const term = fakeTerminal();
  let exited = null;
  main({ stdin: term.stdin, stdout: term.stdout, env: { ...process.env, CODESPACES: '' }, platform: 'linux', root: dir, exit: (code) => { exited = code; } });
  try {
    assert.ok(await until(() => term.lastFrame().includes("Let's learn Claude Code")), term.lastFrame());
    term.type('\r');
    assert.ok(await until(() => term.lastFrame().includes("You'll be able to")));
    term.type('\r');
    assert.ok(await until(() => term.lastFrame().includes('step 1 of 12')));
    term.type(' ');
    assert.ok(await until(() => term.lastFrame().includes('step 2 of 12')));
    term.type('1');
    term.type('\r');
    assert.ok(await until(() => term.lastFrame().includes('Watching .practice/version.txt')), term.lastFrame());
    mkdirSync(join(dir, '.practice'));
    writeFileSync(join(dir, '.practice', 'version.txt'), '2.1.285 (Claude Code)\n');
    assert.ok(await until(() => term.lastFrame().includes('Step 3 done!')), term.lastFrame());
    assert.match(term.lastFrame(), /DONE/);
    term.type('q');
    assert.ok(await until(() => exited === 0));
    assert.ok(existsSync(join(dir, '.practice', 'learn.json')));
    assert.deepEqual(outside(), before, 'the app changed something outside .practice/');
    assert.deepEqual(readdirSync(join(dir, '.practice')).sort(), ['learn.json', 'version.txt']);
  } finally {
    if (exited === null) term.type('\x03');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a save that fails shows a note and the app keeps going', async () => {
  const dir = exportHead(root);
  rmSync(join(dir, '.practice'), { recursive: true, force: true });
  // A file where the folder should be: every save fails.
  writeFileSync(join(dir, '.practice'), 'not a folder');
  const term = fakeTerminal();
  let exited = null;
  main({ stdin: term.stdin, stdout: term.stdout, env: { ...process.env, CODESPACES: '' }, platform: 'linux', root: dir, exit: (code) => { exited = code; } });
  try {
    assert.ok(await until(() => term.lastFrame().includes("Let's learn Claude Code")));
    term.type('\r');
    assert.ok(await until(() => term.lastFrame().includes("Couldn't save your place")), term.lastFrame());
    term.type('\r');
    assert.ok(await until(() => term.lastFrame().includes('step 1 of 12')), 'the lesson goes on');
    assert.equal(exited, null);
    term.type('\x03');
    assert.ok(await until(() => exited === 0));
  } finally {
    if (exited === null) term.type('\x03');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('read-only: the app starts only the check and git status, and writes only its own file', () => {
  const files = readdirSync(join(root, 'learn'), { recursive: true }).filter((f) => f.endsWith('.mjs')).map((f) => f.split('\\').join('/'));
  for (const f of files) {
    const src = readFileSync(join(root, 'learn', f), 'utf8');
    assert.doesNotMatch(src, /from 'node:(http|https|net|tls|dgram)'|\bfetch\(/, `${f} uses the network`);
    assert.doesNotMatch(src, /\b(spawn|spawnSync|exec|execSync|execFileSync|fork)\(/, `${f} starts a process another way`);
    for (const m of src.matchAll(/execFile\(([^,]+),\s*(\[[^\]]*)/g)) {
      const [, cmd, args] = m;
      const ok = (cmd.trim() === 'process.execPath' && args.includes('RUN_CHECK')) || (cmd.trim() === "'git'" && /^\['(status|rev-parse|config)'/.test(args.trim()));
      assert.ok(ok, `${f} runs ${cmd} ${args}`);
    }
    if (f !== 'lib/store.mjs') assert.doesNotMatch(src, /\b(writeFileSync|appendFileSync|renameSync|rmSync|unlinkSync|mkdirSync|writeFile|copyFileSync)\b/, `${f} writes a file`);
    if (f !== 'lib/screen.mjs') assert.doesNotMatch(src, /\bwriteSync\b/, `${f} writes with writeSync`);
  }
});

test('adding learn/ and its state file changes no check result', () => {
  const withApp = exportHead(root);
  const without = exportHead(root, 'learn');
  try {
    const a = check(['all', '--dir', withApp]).out.replaceAll(withApp, '<dir>');
    const b = check(['all', '--dir', without]).out.replaceAll(without, '<dir>');
    assert.equal(a, b);
    mkdirSync(join(withApp, '.practice'), { recursive: true });
    saveState(withApp, sanitize({ welcomed: true, lessons: { 'b-1': { step: 'W3' } } }));
    assert.equal(check(['all', '--dir', withApp]).out.replaceAll(withApp, '<dir>'), b);
  } finally {
    for (const d of [withApp, without]) rmSync(d, { recursive: true, force: true });
  }
});

test('package.json: one new script, no dependencies', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.learn, 'node learn/app.mjs');
  assert.equal(pkg.scripts.check, 'node checks/run.mjs');
  assert.equal(pkg.scripts.test, 'node --test "test/**/*.test.js"');
  assert.equal(pkg.scripts['test:checks'], 'node --test "checks/test/*.test.mjs"');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.engines.node, '>=22');
  const src = readdirSync(join(root, 'learn'), { recursive: true }).filter((f) => f.endsWith('.mjs')).map((f) => readFileSync(join(root, 'learn', f), 'utf8')).join('\n');
  assert.doesNotMatch(src, /import\.meta\.main|styleText|from '(?!node:|\.)/, 'needs a newer Node or a package');
});
