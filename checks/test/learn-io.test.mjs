// The learn app's edges: keys, the check child, git, the watcher, the saved
// state, the plain fallback, full runs on a fake terminal with the frames and
// timers they leave, and the promise that it reads the practice copy and
// changes nothing but its own file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { PATH, SLOW } from '../../learn/lib/content.mjs';
import { DEFER_MS, IDLE_MS } from '../../learn/lib/flow.mjs';
import { keyParser } from '../../learn/lib/keys.mjs';
import { main } from '../../learn/lib/main.mjs';
import { SHOTS } from '../../learn/lib/motion.mjs';
import { ENTER, LEAVE } from '../../learn/lib/screen.mjs';
import { loadState, sanitize, saveState, storePath } from '../../learn/lib/store.mjs';
import { strip, width } from '../../learn/lib/text.mjs';
import { childEnv, runCheck, singleFlight } from '../../learn/lib/verify.mjs';
import { watchDirs } from '../../learn/lib/watch.mjs';
import { lessons } from '../lessons/index.mjs';
import { statusPaths } from '../paths.mjs';
import { check, exportHead, repo, withRepo, write } from './helpers.mjs';
import { root } from './learn-drive.mjs';
import { fakeClock, fakeOut, screenModel, turn } from './learn-term.mjs';

// Every lesson on the course, in its order.
const EVERY = PATH.map((p) => p.id);
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

test('for every lesson the child and npm run check agree, item by item', () => {
  const dir = exportHead(root);
  try {
    for (const id of EVERY) {
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

test('the check child writes {"running": n} to stderr before each item it runs, and stdout stays one line of JSON', () => {
  withRepo(() => repo(), (dir) => {
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    const run = (args) => spawnSync(process.execPath, [RUN_CHECK, ...args], { encoding: 'utf8', env });
    const two = run(['b-3', dir, '0', '2']);
    assert.equal(two.status, 0);
    assert.equal(two.stderr, '{"running":1}\n{"running":2}\n', 'the first and the second of the items asked for');
    assert.equal(two.stdout.split('\n').filter(Boolean).length, 1);
    assert.deepEqual(JSON.parse(two.stdout).items.map((i) => i.index), [0, 2]);
    assert.equal(run(['b-1', dir]).stderr, '{"running":1}\n', 'every item when none is named');
    const bad = run(['b-9', dir]);
    assert.equal(bad.status, 2);
    assert.equal(bad.stderr, '', 'no item runs, so none is reported');
    assert.equal(bad.stdout.split('\n').filter(Boolean).length, 1);
  });
});

test('runCheck passes on each report as item n of the m items the child runs, before its result', async () => {
  const dir = repo();
  try {
    const seen = [];
    const r = await runCheck(dir, 'b-3', [0, 2], { onRunning: (n, m) => seen.push([n, m]) });
    assert.deepEqual(seen, [[1, 2], [2, 2]]);
    assert.deepEqual(r.items.map((i) => i.index), [0, 2]);
    // The slow item is left out, so the child runs two of the three.
    seen.length = 0;
    await runCheck(dir, 'b-3', null, { onRunning: (n, m) => seen.push([n, m]) });
    assert.deepEqual(seen, [[1, 2], [2, 2]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every item whose own code starts a process is slow, in every lesson', () => {
  // An item can start one through a helper, too: SLOW holds those as measured.
  for (const id of EVERY) {
    const spawning = lessons[id].items.map((it, i) => [i, it.check.toString()]).filter(([, src]) => /spawnSync|execFileSync\('npm'|spawn\(/.test(src)).map(([i]) => i);
    for (const i of spawning) assert.ok((SLOW[id] ?? []).includes(i), `${id} item ${i}`);
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

test('saved state: recalled keeps only warm-up ids, and an old file loads with none', () => {
  const data = sanitize({ lessons: { 'b-3': { recalled: ['R1', 'W1', 'R', 3, 'R12', '../R2', null] } } });
  assert.deepEqual(data.lessons['b-3'].recalled, ['R1', 'R12']);
  assert.deepEqual(sanitize({ lessons: { 'b-3': { recalled: 'R1' } } }).lessons['b-3'].recalled, []);
  withRepo(() => repo(), (dir) => {
    mkdirSync(join(dir, '.practice'));
    // Written before `recalled` existed.
    writeFileSync(storePath(dir), JSON.stringify({ format: 1, welcomed: true, lessons: { 'b-3': { step: 'R1', beat: 0, warm: ['R1', 'R2'], done: [] } } }));
    assert.deepEqual(loadState(dir).lessons['b-3'].recalled, []);
    const saved = sanitize({ lessons: { 'b-3': { warm: ['R1', 'R2'], recalled: ['R1'] } } });
    assert.equal(saveState(dir, saved), true);
    assert.deepEqual(loadState(dir).lessons['b-3'].recalled, ['R1'], 'it survives a save and a load');
  });
});

test('saved state: moreHelpAt keeps a step id, an old keepGuided maps to the saved step, anything else drops', () => {
  const one = (p) => sanitize({ lessons: { 'b-1': p } }).lessons['b-1'];
  assert.equal(one({ keepGuided: true, step: 'Y1' }).moreHelpAt, 'Y1');
  assert.equal(one({ keepGuided: true, step: 'Y1' }).keepGuided, undefined, 'keepGuided is not saved again');
  assert.equal(one({ moreHelpAt: 'Y3', step: 'Y4' }).moreHelpAt, 'Y3');
  assert.equal(one({ moreHelpAt: 'C' }).moreHelpAt, 'C');
  for (const bad of [true, 3, 'y1', '../Y1', 'Y1 ', '', null]) assert.equal(one({ moreHelpAt: bad }).moreHelpAt, null, String(bad));
  assert.equal(one({ keepGuided: true }).moreHelpAt, null, 'no saved step, nothing to map to');
  assert.equal(one({ keepGuided: true, step: '../x' }).moreHelpAt, null);
  assert.equal(one({ keepGuided: 'yes', step: 'Y1' }).moreHelpAt, null);
  assert.equal(one({ keepGuided: false, step: 'Y1' }).moreHelpAt, null);
  assert.equal(one({}).moreHelpAt, null);
});

test('without a terminal it prints the path as plain text and exits 0', () => {
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const r = spawnSync(process.execPath, [join(root, 'learn', 'app.mjs')], { input: '', encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /\x1b/);
  // A title's code spans print as plain text: a-4's "with `claude -p`".
  for (const id of EVERY) assert.ok(r.stdout.includes(lessons[id].title.replaceAll('`', '')), id);
});

// The full runs keep calm full frames whatever CI's environment holds, so
// lastFrame() can split on a bare CSI H.
const CALM_ENV = { ...process.env, CODESPACES: '', LEARN_CALM: '1', NO_COLOR: '', LEARN_PLAIN: '', TERM: 'xterm-256color' };

// A terminal the test can type into and read from. Its stdout keeps every
// write in `writes`, replays it into a 90x30 screen model, and can be made to
// back up (fakeOut's `full` and `drain()`).
function fakeTerminal() {
  const stdin = new PassThrough();
  Object.assign(stdin, { isTTY: true, isRaw: false });
  stdin.setRawMode = (on) => Object.assign(stdin, { isRaw: on });
  const model = screenModel(90, 30);
  const stdout = fakeOut({ columns: 90, rows: 30 });
  const write = stdout.write;
  stdout.write = (chunk) => {
    model.feed(String(chunk));
    return write(chunk);
  };
  stdout.getColorDepth = () => 8;
  const lastFrame = () => strip(stdout.writes.join('').split('\x1b[H').at(-1) ?? '');
  // What the terminal shows, whatever kind of frames drew it.
  const shows = () => model.lines().join('\n');
  return { stdin, stdout, model, lastFrame, shows, writes: stdout.writes, type: (s) => stdin.write(s) };
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
  main({ argv: [], stdin: term.stdin, stdout: term.stdout, env: CALM_ENV, platform: 'linux', root: dir, exit: (code) => { exited = code; } });
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

test('main sends each key with how far the check-only card scrolls in the window, so up moves the card at once after down went past the end', async () => {
  const dir = exportHead(root);
  const term = fakeTerminal();
  let exited = null;
  main({ argv: [], stdin: term.stdin, stdout: term.stdout, env: CALM_ENV, platform: 'linux', root: dir, exit: (code) => { exited = code; } });
  const shown = () => term.lastFrame().match(/Items (\d+) to (\d+) of 11/);
  try {
    assert.ok(await until(() => term.lastFrame().includes("Let's learn Claude Code")), term.lastFrame());
    term.type('\r');
    assert.ok(await until(() => term.lastFrame().includes("You'll be able to")));
    term.type('m');
    assert.ok(await until(() => term.lastFrame().includes('Beginner path')), term.lastFrame());
    // Right to Intermediate, up round to its capstone, and open it.
    term.type('\x1b[C');
    term.type('\x1b[A');
    term.type('\r');
    assert.ok(await until(() => shown()?.[1] === '1'), term.lastFrame());
    for (let i = 0; i < 20; i++) term.type('\x1b[B');
    assert.ok(await until(() => shown()?.[2] === '11'), term.lastFrame());
    const end = Number(shown()[1]);
    term.type('\x1b[A');
    assert.ok(await until(() => Number(shown()?.[1]) === end - 1), term.lastFrame());
    term.type('q');
    assert.ok(await until(() => exited === 0));
  } finally {
    if (exited === null) term.type('\x03');
    rmSync(dir, { recursive: true, force: true });
  }
});

// With motion, whatever CI's environment holds.
const MOTION_ENV = { ...CALM_ENV, LEARN_CALM: '' };

// main() on a fake terminal and a fake clock: every timer main sets waits for
// the test to move the clock. The check and git children are real, and so is
// the watcher unless `watch` replaces it. Each write's time is in `times`;
// with `writeMs` set, every write takes that long on the clock. `askGit`
// replaces git's first answers at start: [git's error or null, a first name].
// `signals` stands in for the process's signals, and `runCheck` for the
// check child.
function clockedRun(env, { watch, askGit, signals, runCheck } = {}) {
  const dir = exportHead(root);
  rmSync(join(dir, '.practice'), { recursive: true, force: true });
  const term = fakeTerminal();
  const clock = fakeClock();
  const app = { dir, term, clock, exited: null, times: [], writeMs: 0 };
  const write = term.stdout.write;
  term.stdout.write = (chunk) => {
    app.times.push(clock.now());
    clock.spend(app.writeMs);
    return write(chunk);
  };
  // When each frame from write `from` on went out.
  app.frameTimes = (from = 0) => app.times.slice(from).filter((_, i) => term.writes[from + i].startsWith('\x1b[?2026h'));
  main({ argv: [], stdin: term.stdin, stdout: term.stdout, env, platform: 'linux', root: dir, now: clock.now, perf: clock.now, timers: clock, watch, askGit, signals, runCheck, exit: (code) => { app.exited = code; } });
  // Until fn() holds, moving the clock 40 ms at a time while the children run.
  app.settle = async (fn, ms = 8_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (fn()) return true;
      await clock.advance(40);
      await new Promise((r) => setTimeout(r, 10));
    }
    return false;
  };
  // The frame timers waiting: main's only timeouts in these runs (no letter
  // is waiting for its 300 ms, no Escape for its 50 ms).
  app.frameTimers = () => clock.pending().filter((x) => x.every === null);
  // Type, then let the clock run until the screen shows `text`.
  app.press = async (keys, text) => {
    term.type(keys);
    assert.ok(await app.settle(() => term.shows().includes(text)), `after ${JSON.stringify(keys)}, no ${text}:\n${term.shows()}`);
  };
  // From the welcome to step 3, which waits for .practice/version.txt.
  app.toWaiting = async () => {
    await app.press('\r', "You'll be able to");
    await app.press('\r', 'step 1 of 12');
    await app.press(' ', 'step 2 of 12');
    await app.press('1', 'step 2 of 12');
    await app.press('\r', 'Watching .practice/version.txt');
  };
  app.close = () => {
    if (app.exited === null) term.type('\x03');
    rmSync(dir, { recursive: true, force: true });
  };
  return app;
}
// Git's first answers at start, given when the test says.
const slowGit = () => {
  const git = { asked: 0 };
  git.ask = () => {
    git.asked += 1;
    return new Promise((resolve) => { git.answer = resolve; });
  };
  return git;
};
const ENTERS = (writes) => writes.join('').split('\x1b[?1049h').length - 1;

test('boot: when git takes over 150 ms at start, the screen opens with Pip waking, "Asking git about this folder…" and the spinner, until the welcome replaces it', async () => {
  const git = slowGit();
  const app = clockedRun(MOTION_ENV, { askGit: git.ask });
  const { term, clock } = app;
  try {
    assert.equal(git.asked, 1);
    await clock.advance(159);
    assert.deepEqual(term.writes, [], 'nothing is drawn, and the screen is not opened, before git has run 160 ms');
    await clock.advance(1);
    assert.equal(ENTERS(term.writes), 1);
    assert.match(term.shows(), /│ ─ {3}─ │ {3}Asking git about this folder… ⠋/, '+160 ms: Pip\'s eyes shut, the spinner starts');
    await clock.advance(80);
    assert.match(term.shows(), /│ ◡ {3}◡ │ {3}Asking git about this folder… ⠙/, '+240 ms: waking');
    await clock.advance(80);
    assert.match(term.shows(), /│ ● {3}● │ {3}Asking git about this folder… ⠹/, '+320 ms: awake');
    git.answer([null, 'Sam']);
    await turn();
    await clock.advance(40);
    assert.match(term.shows(), /Hi Sam! Let's learn Claude Code/);
    assert.doesNotMatch(term.shows(), /Asking git/);
    assert.equal(ENTERS(term.writes), 1, 'the same screen goes on');
    // The boot's frame timer is gone with it: the welcome draws alone.
    const n = term.writes.length;
    await clock.advance(2_000);
    assert.ok(term.writes.slice(n).every((w) => !w.includes('Asking git')));
  } finally {
    app.close();
  }
});

test('boot: when git answers within 150 ms, nothing extra is drawn: the first frame is the welcome', async () => {
  const git = slowGit();
  const app = clockedRun(MOTION_ENV, { askGit: git.ask });
  const { term, clock } = app;
  try {
    await clock.advance(140);
    git.answer([null, 'Sam']);
    await turn();
    assert.equal(ENTERS(term.writes), 1);
    const frames = term.writes.filter((w) => w.startsWith('\x1b[?2026h'));
    assert.match(strip(frames[0]), /Hi Sam! Let's learn Claude Code/, 'the first frame');
    await clock.advance(2_000);
    assert.ok(term.writes.every((w) => !w.includes('Asking git')), 'no boot frame, then or later');
  } finally {
    app.close();
  }
});

test('boot: with motion off, the boot frame shows its words still, with Pip awake and no spinner, and asks for no other frame', async () => {
  const git = slowGit();
  const app = clockedRun(CALM_ENV, { askGit: git.ask });
  const { term, clock } = app;
  try {
    await clock.advance(160);
    assert.match(term.shows(), /│ ● {3}● │ {3}Asking git about this folder…\n/);
    const n = term.writes.length;
    assert.deepEqual(app.frameTimers(), []);
    await clock.advance(5_000);
    assert.equal(term.writes.length, n, 'nothing moves while git works');
    git.answer([null, 'Sam']);
    await turn();
    assert.match(term.shows(), /Hi Sam! Let's learn Claude Code/);
  } finally {
    app.close();
  }
});

test('boot: keys typed while git answers are not echoed and are dropped, so an Enter does not skip the welcome; q does not quit', async () => {
  const git = slowGit();
  const app = clockedRun(CALM_ENV, { askGit: git.ask });
  const { term, clock } = app;
  try {
    assert.equal(term.stdin.isRaw, true, 'raw before any frame: the terminal echoes nothing');
    await clock.advance(100);
    term.type('\r');
    await clock.advance(60);
    assert.match(term.shows(), /Asking git about this folder…/);
    term.type('q\r');
    await turn();
    assert.equal(app.exited, null);
    git.answer([null, 'Sam']);
    await turn();
    await clock.advance(1_000);
    assert.equal(term.stdin.isRaw, true);
    assert.match(term.shows(), /Hi Sam! Let's learn Claude Code/, 'the welcome stays up');
    await app.press('\r', "You'll be able to");
  } finally {
    app.close();
  }
});

test('boot: Ctrl+C during the boot frame leaves the screen once and exits 0, and git\'s answer then draws nothing', async () => {
  const git = slowGit();
  const app = clockedRun(MOTION_ENV, { askGit: git.ask });
  const { term, clock } = app;
  try {
    await clock.advance(200);
    assert.match(term.shows(), /Asking git about this folder…/);
    term.type('\x03');
    await turn();
    assert.equal(app.exited, 0);
    assert.equal(term.stdin.isRaw, false);
    const all = term.writes.join('');
    assert.equal(all.split(LEAVE).length, 2, 'left once');
    assert.ok(all.endsWith(`${LEAVE}\n`), 'no goodbye line: nothing was saved');
    const n = term.writes.length;
    git.answer([null, 'Sam']);
    await turn();
    await clock.advance(1_000);
    assert.equal(term.writes.length, n, 'no welcome, no frame');
    assert.deepEqual(clock.pending(), [], 'no timer left');
  } finally {
    app.close();
  }
});

test('boot: a signal before any screen writes only a newline and exits 0; one during the boot frame leaves the screen', async () => {
  for (const [ms, shown] of [[100, false], [200, true]]) {
    const git = slowGit();
    const signals = new EventEmitter();
    const app = clockedRun(CALM_ENV, { askGit: git.ask, signals });
    const { term, clock } = app;
    try {
      await clock.advance(ms);
      signals.emit('SIGINT');
      assert.equal(app.exited, 0);
      assert.deepEqual(term.writes.join('').split(ENTER).length - 1, shown ? 1 : 0);
      assert.equal(term.writes.join(''), shown ? `${term.writes.join('').split(LEAVE)[0]}${LEAVE}\n` : '\n');
      git.answer([null, 'Sam']);
      await turn();
      await clock.advance(1_000);
      assert.doesNotMatch(term.writes.join(''), /Hi Sam/);
    } finally {
      app.close();
    }
  }
});

test('boot: a resize during the boot frame clears the screen and draws it again at the new size, with motion off too', async () => {
  const git = slowGit();
  const app = clockedRun(CALM_ENV, { askGit: git.ask });
  const { term, clock } = app;
  try {
    Object.assign(term.stdout, { columns: 70, rows: 22 });
    term.stdout.emit('resize');
    await turn();
    assert.deepEqual(term.writes, [], 'no screen yet: nothing to wipe');
    await clock.advance(160);
    for (const [cols, rows] of [[60, 20], [80, 24]]) {
      await clock.advance(1_000);
      const n = term.writes.length;
      Object.assign(term.stdout, { columns: cols, rows });
      term.stdout.emit('resize');
      await turn();
      assert.equal(term.writes.length - n, 1, `${cols}x${rows}: one write`);
      assert.ok(term.writes.at(-1).startsWith('\x1b[?2026h\x1b[2J\x1b[H'), 'cleared and drawn whole');
      const shown = term.model.lines();
      assert.ok(shown.slice(0, rows).every((l) => width(l) <= cols - 1), shown.join('\n'));
      assert.deepEqual(shown.slice(rows), Array(30 - rows).fill(''), 'nothing left below the frame');
      assert.match(shown.join('\n'), /Asking git about this folder…/);
    }
    git.answer([null, 'Sam']);
    await turn();
    await clock.advance(40);
    assert.match(term.shows(), /Hi Sam! Let's learn Claude Code/);
  } finally {
    app.close();
  }
});

test('draws: one frame for the events of one turn, a key within one frame, and never two frames under 40 ms apart', async () => {
  const app = clockedRun(MOTION_ENV);
  const { term, clock } = app;
  try {
    assert.ok(await app.settle(() => term.shows().includes("Let's learn Claude Code")), term.shows());
    await clock.advance(1_000);
    let n = term.writes.length;
    term.type('\r\r');
    await turn();
    assert.equal(term.writes.length - n, 1, 'two keys in one read, the intro and then step 1: one frame');
    assert.match(term.shows(), /step 1 of 12/);
    n = term.writes.length;
    term.type(' ');
    await turn();
    assert.equal(term.writes.length - n, 0, 'the frame before went out 0 ms ago');
    await clock.advance(39);
    assert.equal(term.writes.length - n, 0, '39 ms after it');
    await clock.advance(1);
    assert.ok(term.writes.length - n >= 1, '40 ms after it');
    assert.match(term.shows(), /step 2 of 12/);
  } finally {
    app.close();
  }
});

// Every gap between frames, in ms.
const gaps = (times) => times.slice(1).map((t, i) => t - times[i]);

test('draws: a frame that goes out on drain counts for the 40 ms floor', async () => {
  const app = clockedRun(CALM_ENV);
  const { term, clock } = app;
  try {
    assert.ok(await until(() => term.shows().includes("Let's learn Claude Code")), term.shows());
    await clock.advance(1_000);
    const from = term.writes.length;
    term.stdout.full = true;
    term.type('\r');
    await turn();
    assert.equal(term.writes.length - from, 1, 'the intro, and its write comes back false');
    await clock.advance(45);
    term.type('\r');
    await turn();
    assert.equal(term.writes.length - from, 1, 'step 1 is kept for the drain');
    await clock.advance(10);
    term.stdout.drain();
    assert.equal(term.writes.length - from, 2, 'step 1 goes out on the drain');
    term.type(' ');
    await turn();
    assert.equal(term.writes.length - from, 2, 'the drain wrote 0 ms ago');
    await clock.advance(200);
    assert.match(term.shows(), /step 2 of 12/);
    const times = app.frameTimes(from);
    assert.ok(gaps(times).every((g) => g >= 40), `frames at ${times.map((t) => t - times[0])} ms`);
  } finally {
    app.close();
  }
});

test('draws: a watcher burst and the dispatch it queues from a microtask make one frame', async () => {
  let changed = null;
  const watch = (_root, onChange) => {
    changed = onChange;
    return { close() {} };
  };
  const app = clockedRun(CALM_ENV, { watch });
  const { dir, term, clock } = app;
  try {
    assert.ok(await until(() => term.shows().includes("Let's learn Claude Code")), term.shows());
    await app.toWaiting();
    await clock.advance(1_000);
    // Any check the polls started is over.
    await new Promise((r) => setTimeout(r, 500));
    mkdirSync(join(dir, '.practice'));
    writeFileSync(join(dir, '.practice', 'version.txt'), '2.1.285 (Claude Code)\n');
    const n = term.writes.length;
    // The new folder, the activity, and the check it asks for again, whose
    // start is dispatched from a microtask, the way a file read is.
    changed();
    await turn();
    assert.equal(term.writes.length - n, 1, 'one frame');
    assert.deepEqual(app.frameTimers(), [], 'and no second one waiting for the floor');
    assert.match(term.shows(), /mkdir -p \.practice +✔/, 'it shows the new folder');
    assert.ok(await app.settle(() => term.shows().includes('Step 3 done!')), term.shows());
  } finally {
    app.close();
  }
});

test('r: the card says what it checks until r\'s own result lands, even when polls ask again while r\'s run waits', async () => {
  let changed = null;
  const watch = (_root, onChange) => {
    changed = onChange;
    return { close() {} };
  };
  const app = clockedRun(CALM_ENV, { watch });
  const { term, clock } = app;
  try {
    assert.ok(await until(() => term.shows().includes("Let's learn Claude Code")), term.shows());
    await app.toWaiting();
    await clock.advance(1_000);
    await new Promise((r) => setTimeout(r, 500));
    // A poll's run starts; r's run waits behind it, and a second poll asks
    // again before r's run starts.
    changed();
    term.type('r');
    await clock.advance(DEFER_MS + 30);
    assert.match(term.shows(), /Checking \.practice\/version\.txt…/);
    changed();
    assert.ok(await app.settle(() => term.shows().includes('Not yet')), `r's result never ended the wait:\n${term.shows()}`);
    assert.doesNotMatch(term.shows(), /Checking/);
  } finally {
    app.close();
  }
});

// A check child the test answers: it holds a run while `held` is set, so the
// test can send the run's reports, then its result.
const heldCheck = () => {
  const fake = { held: false, runs: [] };
  const missing = (lesson, items) => ({ items: (items ?? lessons[lesson].items.map((_, i) => i)).map((index) => ({ index, text: lessons[lesson].items[index].text, pass: false, hint: 'not there yet' })) });
  fake.run = (_root, lesson, items, opts) => {
    if (!fake.held) return Promise.resolve(missing(lesson, items));
    return new Promise((resolve) => fake.runs.push({ lesson, ...opts, end: () => resolve(missing(lesson, items)) }));
  };
  return fake;
};
const FRAMES = (writes) => writes.filter((w) => w.startsWith('\x1b[?2026h'));

// Plain mode draws ASCII, so its ellipsis is three dots.
for (const [mode, env, dots] of [['calm', CALM_ENV, '…'], ['plain', { ...CALM_ENV, LEARN_CALM: '', LEARN_PLAIN: '1' }, '...']]) {
  test(`check item progress, ${mode}: each report from r's run rewrites the checking row once, as "Checking item n of m…"`, async () => {
    const fake = heldCheck();
    const app = clockedRun(env, { runCheck: fake.run });
    const { term, clock } = app;
    try {
      assert.ok(await until(() => term.shows().includes("Let's learn Claude Code")), term.shows());
      await app.toWaiting();
      fake.held = true;
      await app.press('r', 'Checking .practice/version.txt');
      const [run] = fake.runs;
      assert.equal(run.slow, true, 'r\'s own run');
      for (const n of [1, 2]) {
        const from = term.writes.length;
        run.onRunning(n, 2);
        assert.ok(await app.settle(() => term.shows().includes(`Checking item ${n} of 2${dots}`)), term.shows());
        await clock.advance(3_000);
        await new Promise((r) => setTimeout(r, 20));
        const frames = FRAMES(term.writes.slice(from));
        assert.equal(frames.length, 1, `report ${n}: one frame, then nothing for 3 s`);
        assert.ok(strip(frames[0]).includes(`Checking item ${n} of 2${dots}`), `report ${n}: that frame has the row`);
        assert.deepEqual(app.frameTimers(), [], 'no frame timer');
      }
      run.end();
      assert.ok(await app.settle(() => !term.shows().includes('Checking')), term.shows());
    } finally {
      app.close();
    }
  });
}

test('check item progress: a beat\'s opening run reports through main() as well, as the run of the items it was asked for', async () => {
  const fake = heldCheck();
  const app = clockedRun(CALM_ENV, { runCheck: fake.run });
  const { term } = app;
  try {
    assert.ok(await until(() => term.shows().includes("Let's learn Claude Code")), term.shows());
    await app.press('\r', "You'll be able to");
    await app.press('\r', 'step 1 of 12');
    await app.press(' ', 'step 2 of 12');
    await app.press('1', 'step 2 of 12');
    fake.held = true;
    await app.press('\r', 'Checking .practice/version.txt');
    assert.ok(await app.settle(() => fake.runs.length > 0));
    const [run] = fake.runs;
    assert.equal(run.slow, false, 'the opening run, not r\'s');
    // Step 3 checks one item; this fake child says it runs two, so the
    // count shows.
    run.onRunning(1, 2);
    assert.ok(await app.settle(() => term.shows().includes('Checking item 1 of 2…')), term.shows());
    run.end();
    assert.ok(await app.settle(() => term.shows().includes('Watching .practice/version.txt')), term.shows());
  } finally {
    app.close();
  }
});

test('resize: one full frame that clears the screen, at the new size', async () => {
  const app = clockedRun(CALM_ENV);
  const { term, clock } = app;
  try {
    assert.ok(await until(() => term.shows().includes("Let's learn Claude Code")), term.shows());
    await clock.advance(1_000);
    for (const [cols, rows] of [[60, 20], [60, 20], [80, 24]]) {
      const n = term.writes.length;
      Object.assign(term.stdout, { columns: cols, rows });
      term.stdout.emit('resize');
      await turn();
      assert.equal(term.writes.length - n, 1, `${cols}x${rows}: one write, even at the same size`);
      const w = term.writes.at(-1);
      assert.ok(w.startsWith('\x1b[?2026h\x1b[2J\x1b[H'), 'cleared and drawn whole, in one synchronized write');
      assert.equal(w.split('\x1b[2J').length, 2, 'cleared once');
      const shown = term.model.lines();
      assert.ok(shown.slice(0, rows).every((l) => width(l) <= cols - 1), shown.join('\n'));
      assert.deepEqual(shown.slice(rows), Array(30 - rows).fill(''), 'nothing left below the frame');
      assert.match(shown.join('\n'), /Let's learn Claude Code/);
      await clock.advance(1_000);
    }
    term.type('\r');
    await turn();
    assert.doesNotMatch(term.writes.at(-1), /\x1b\[2J/, 'the next frame clears nothing');
  } finally {
    app.close();
  }
});

test('draws: when slow writes stop motion, the rest frame is asked for at once', async () => {
  const app = clockedRun(MOTION_ENV);
  const { term, clock } = app;
  try {
    assert.ok(await until(() => term.shows().includes("Let's learn Claude Code")), term.shows());
    await clock.advance(1_000);
    app.writeMs = 13;
    const n = term.writes.length;
    for (const [i, key] of ['\r', '\r', ' '].entries()) {
      if (i) await clock.advance(40);
      term.type(key);
      await turn();
      assert.equal(term.writes.length - n, i + 1, `slow frame ${i + 1}`);
    }
    // The third slow frame turned motion off; nothing moves under calm, so
    // only the rest frame waits.
    const rest = app.frameTimers();
    assert.equal(rest.length, 1, 'the rest frame');
    assert.ok(rest[0].ms <= 40, String(rest[0].ms));
    await clock.advance(40);
    assert.deepEqual(app.frameTimers(), [], 'and after it, none');
  } finally {
    app.close();
  }
});

test('no leaking timers: a frame timer only while something will change; none in calm, with an overlay, at idle, after one-shots end, or after q', async () => {
  const app = clockedRun(MOTION_ENV);
  const { term, clock } = app;
  try {
    assert.ok(await until(() => term.shows().includes("Let's learn Claude Code")), term.shows());
    const first = app.frameTimers();
    assert.equal(first.length, 1, 'the welcome plays: one frame timer');
    // The welcome's frames change every 80 ms: the timer is due at the next.
    assert.ok(first[0].ms > 0 && first[0].ms <= SHOTS.welcome.every, `due at the welcome's next frame, not in ${first[0].ms} ms`);
    term.type('?');
    await clock.advance(400);
    assert.match(term.shows(), /Keys/, 'the ? overlay');
    assert.deepEqual(app.frameTimers(), [], 'an overlay');
    await clock.advance(1_000);
    assert.deepEqual(app.frameTimers(), [], 'an overlay, a second later');
    await app.press('?', "Let's learn Claude Code");
    await app.toWaiting();
    assert.equal(app.frameTimers().length, 1, 'the card enters: one frame timer');
    await clock.advance(200);
    const grace = app.frameTimers();
    assert.equal(grace.length, 1, 'the entrance is over, and the reading grace still runs: its end is a deadline');
    assert.ok(grace[0].ms > 1_000, `on its own timer, not the next 1 s tick (${grace[0].ms} ms)`);
    // W3 watches its file: from here its look marker moves only when a poll's
    // result lands, so no frame timer waits, before a look or after one.
    await clock.advance(21_000);
    assert.deepEqual(app.frameTimers(), [], 'the entrance and the reading grace are over');
    const pulse = () => term.shows().split('\n').at(-2) ?? '';
    assert.ok(await app.settle(() => pulse().includes('━━━')), `the marker:\n${term.shows()}`);
    assert.deepEqual(app.frameTimers(), [], 'the marker shows, and waits for the next look');
    await clock.advance(IDLE_MS);
    assert.deepEqual(app.frameTimers(), [], 'idle');
    await afterQ(app);
  } finally {
    app.close();
  }
});

test('a still card blinks on one frame timer once the gates open, and has none at idle', async () => {
  const app = clockedRun(MOTION_ENV);
  const { term, clock } = app;
  try {
    assert.ok(await until(() => term.shows().includes("Let's learn Claude Code")), term.shows());
    await app.press('\r', "You'll be able to");
    await app.press('\r', 'step 1 of 12');
    assert.doesNotMatch(term.shows(), /Watching/, 'step 1 watches nothing');
    await clock.advance(21_000);
    const blink = app.frameTimers();
    assert.equal(blink.length, 1, 'the next blink, or its end');
    assert.ok(blink[0].ms > 0 && blink[0].ms <= 6_000, String(blink[0].ms));
    // Its frames come and go, one timer at a time.
    await clock.advance(6_000);
    assert.equal(app.frameTimers().length, 1);
    await clock.advance(IDLE_MS);
    assert.deepEqual(app.frameTimers(), [], 'idle');
    await afterQ(app);
  } finally {
    app.close();
  }
});

// q while a frame timer runs (after a key, the end of the 4 s key quiet is
// one): the app quits, and no timer of any kind is left.
async function afterQ(app) {
  const { term, clock } = app;
  term.type('\x1b[A');
  await turn();
  assert.equal(app.frameTimers().length, 1, 'a frame timer runs when q comes');
  term.type('q');
  await clock.advance(400);
  assert.equal(app.exited, 0);
  assert.deepEqual(clock.pending(), [], 'after q, no timer of any kind');
}

test('calm: no frame timer, and nothing is written for 3 s on a waiting card', async () => {
  const app = clockedRun(CALM_ENV);
  const { term, clock } = app;
  try {
    assert.ok(await until(() => term.shows().includes("Let's learn Claude Code")), term.shows());
    assert.deepEqual(app.frameTimers(), [], 'the welcome, still');
    await app.toWaiting();
    await clock.advance(40);
    assert.deepEqual(app.frameTimers(), [], 'the card, still');
    const n = term.writes.length;
    await clock.advance(3_000);
    assert.equal(term.writes.length, n, 'nothing written');
  } finally {
    app.close();
  }
});

test('a motion run on a fake terminal: step 3 done, a key gives the rest frame, a still intro writes nothing, and nothing after q', async () => {
  const app = clockedRun(MOTION_ENV);
  const { dir, term, clock } = app;
  try {
    assert.ok(await until(() => term.shows().includes("Let's learn Claude Code")), term.shows());
    await app.press('\r', "You'll be able to");
    await clock.advance(40);
    let n = term.writes.length;
    await clock.advance(1_500);
    assert.equal(term.writes.length, n, 'the intro writes nothing for 1.5 s');
    await app.press('\r', 'step 1 of 12');
    await app.press(' ', 'step 2 of 12');
    await app.press('1', 'step 2 of 12');
    await app.press('\r', 'Watching .practice/version.txt');
    mkdirSync(join(dir, '.practice'));
    writeFileSync(join(dir, '.practice', 'version.txt'), '2.1.285 (Claude Code)\n');
    assert.ok(await app.settle(() => term.shows().includes('Step 3 done!')), term.shows());
    assert.match(term.shows(), /DONE/);
    assert.ok(term.writes.some((w) => /\x1b\[\d+;1H/.test(w)), 'some frames rewrote only their changed rows');
    // A key while the step-done burst plays (158): the next frame is the rest
    // frame. The key comes a frame after the pass, as a person's would: a
    // key in the same millisecond as the pass is taken for the one that
    // started it.
    await clock.advance(40);
    const playing = term.shows();
    assert.doesNotMatch(playing, /✦ {10}▄█▀/, 'the burst has not drawn its sparks yet');
    term.type('\x1b[A');
    await clock.advance(40);
    const next = term.shows();
    assert.match(next, /✦ {10}▄█▀ {3}· {3}Step 3 done!/, 'the rest frame: the burst whole');
    await clock.advance(2_000);
    assert.equal(term.shows(), next, 'the frame after the key is the one the screen rests on');
    await afterQ(app);
    n = term.writes.length;
    await clock.advance(15_000);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(term.writes.length, n, 'nothing is written after q');
  } finally {
    app.close();
  }
});

test('a save that fails shows a note and the app keeps going', async () => {
  const dir = exportHead(root);
  rmSync(join(dir, '.practice'), { recursive: true, force: true });
  // A file where the folder should be: every save fails.
  writeFileSync(join(dir, '.practice'), 'not a folder');
  const term = fakeTerminal();
  let exited = null;
  main({ argv: [], stdin: term.stdin, stdout: term.stdout, env: CALM_ENV, platform: 'linux', root: dir, exit: (code) => { exited = code; } });
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

// Two check outputs are the same, or the first lines where they differ.
function sameOutput(a, b, what) {
  if (a === b) return;
  const x = a.split('\n');
  const y = b.split('\n');
  const i = x.findIndex((line, k) => line !== y[k]);
  const near = (lines) => lines.slice(Math.max(0, i - 2), i + 4).join('\n');
  assert.fail(`${what}: the outputs differ at line ${i + 1} of ${x.length} and ${y.length}.\nWith:\n${near(x)}\nWithout:\n${near(y)}`);
}

test('adding learn/ and its state file changes no check result', () => {
  const withApp = exportHead(root);
  const without = exportHead(root, 'learn');
  try {
    const a = check(['all', '--dir', withApp]).out.replaceAll(withApp, '<dir>');
    const b = check(['all', '--dir', without]).out.replaceAll(without, '<dir>');
    sameOutput(a, b, 'with learn/');
    mkdirSync(join(withApp, '.practice'), { recursive: true });
    saveState(withApp, sanitize({ welcomed: true, lessons: { 'b-1': { step: 'W3' } } }));
    sameOutput(check(['all', '--dir', withApp]).out.replaceAll(withApp, '<dir>'), b, 'with its state file');
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
