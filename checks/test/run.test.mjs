// The check command, run the way a Learner runs it, against a separate git
// repository created in a temporary directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const runner = join(dirname(fileURLToPath(import.meta.url)), '..', 'run.mjs');

function repo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'practice-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

function check(args, env = {}) {
  const { GITHUB_ACTIONS, ...rest } = process.env;
  const result = spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8', env: { ...rest, ...env } });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

test('b-1 passes in another repo, given with --dir, once the version is recorded', () => {
  const dir = repo({ '.practice/version.txt': '2.1.285 (Claude Code)\n' });
  try {
    const { code, out } = check(['b-1', '--dir', dir]);
    assert.equal(code, 0, out);
    assert.match(out, /PASS .*claude --version/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-1 fails, with a hint, when nothing is recorded', () => {
  const dir = repo();
  try {
    const { code, out } = check(['b-1', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /FAIL .*claude --version/);
    assert.match(out, /claude --version > \.practice\/version\.txt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-1 fails when the recorded text is not a Claude Code version', () => {
  const dir = repo({ '.practice/version.txt': 'command not found: claude\n' });
  try {
    assert.equal(check(['b-1', '--dir', dir]).code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the progress summary never fails and marks saved-state items as checked locally', () => {
  const dir = repo();
  try {
    const { code, out } = check(['all', '--summary', '--dir', dir], { GITHUB_ACTIONS: 'true' });
    assert.equal(code, 0, out);
    assert.match(out, /\| b-1 \|.*\| checked locally \|/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the assertion mode requires every lesson to fail on an unsolved repo', () => {
  const dir = repo();
  try {
    assert.equal(check(['all', '--assert', 'fail', '--dir', dir]).code, 0);
    assert.equal(check(['all', '--assert', 'pass', '--dir', dir]).code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unknown lesson id is a usage error that lists the known ones', () => {
  const { code, out } = check(['z-9']);
  assert.equal(code, 2);
  assert.match(out, /b-1/);
});

test('b-1 accepts a version file that Windows PowerShell wrote as UTF-16', () => {
  const dir = repo();
  try {
    mkdirSync(join(dir, '.practice'));
    const text = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('2.1.285 (Claude Code)\r\n', 'utf16le')]);
    writeFileSync(join(dir, '.practice', 'version.txt'), text);
    const { code, out } = check(['b-1', '--dir', dir]);
    assert.equal(code, 0, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const planned = {
  '.practice/b-2-before.txt': '',
  '.practice/b-2-plan.txt': 'src/config.js\ntest/config.test.js\n',
  '.practice/b-2-after.txt': ' M src/config.js\n M test/config.test.js\n',
};

test('b-2 passes when nothing changed before approval and only planned files changed after', () => {
  const dir = repo(planned);
  try {
    const { code, out } = check(['b-2', '--dir', dir]);
    assert.equal(code, 0, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-2 fails when files had changed before the plan was approved', () => {
  const dir = repo({ ...planned, '.practice/b-2-before.txt': ' M src/config.js\n' });
  try {
    const { code, out } = check(['b-2', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /before you approved/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-2 fails when a changed file was not in the plan', () => {
  const dir = repo({ ...planned, '.practice/b-2-after.txt': ' M src/config.js\n?? test/new.test.js\n' });
  try {
    const { code, out } = check(['b-2', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /test\/new\.test\.js/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-2 fails when nothing was recorded after approving', () => {
  const dir = repo({ ...planned, '.practice/b-2-after.txt': '' });
  try {
    assert.equal(check(['b-2', '--dir', dir]).code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A repository with one commit that changes code and its test, like the one
// the Learner makes in lesson b-3, and the commit's sha saved for the check.
function committedRepo({ testScript = 'node -e "process.exit(0)"', files = { 'src/links.js': 'export {}\n', 'test/links.test.js': '// test\n' } } = {}) {
  const dir = repo({ 'package.json': JSON.stringify({ scripts: { test: testScript } }) });
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'start');
  git('add', 'package.json');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'package');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'Check links that have a title');
  mkdirSync(join(dir, '.practice'), { recursive: true });
  writeFileSync(join(dir, '.practice', 'b-3-commit.txt'), `${git('rev-parse', 'HEAD')}\n`);
  writeFileSync(join(dir, '.git', 'info', 'exclude'), '.practice/\n');
  return dir;
}

test('b-3 passes for a commit that changes code and a test, with the tests passing and the tree clean', () => {
  const dir = committedRepo();
  try {
    const { code, out } = check(['b-3', '--dir', dir]);
    assert.equal(code, 0, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-3 fails when the commit changes no test file', () => {
  const dir = committedRepo({ files: { 'src/links.js': 'export {}\n' } });
  try {
    const { code, out } = check(['b-3', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /no test file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-3 fails when the tests fail', () => {
  const dir = committedRepo({ testScript: 'node -e "process.exit(1)"' });
  try {
    const { code, out } = check(['b-3', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /npm test/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-3 fails when changes are left uncommitted', () => {
  const dir = committedRepo();
  try {
    writeFileSync(join(dir, 'src', 'links.js'), 'export const x = 1\n');
    const { code, out } = check(['b-3', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /uncommitted/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const rewound = {
  '.practice/b-4-before-rewind.txt': ' M src/cli.js\n',
  '.practice/b-4-after-rewind.txt': '',
};

test('b-4 passes when a change was there before rewinding and gone after', () => {
  const dir = repo(rewound);
  try {
    const { code, out } = check(['b-4', '--dir', dir]);
    assert.equal(code, 0, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-4 fails when no change was saved before rewinding', () => {
  const dir = repo({ ...rewound, '.practice/b-4-before-rewind.txt': '' });
  try {
    assert.equal(check(['b-4', '--dir', dir]).code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-4 fails when the change is still there after rewinding', () => {
  const dir = repo({ ...rewound, '.practice/b-4-after-rewind.txt': ' M src/cli.js\n' });
  try {
    const { code, out } = check(['b-4', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /Restore code/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A repository whose committed CLAUDE.md holds a rule, followed by a commit a
// new session made, as in lesson b-5.
function memoryRepo({ claudeMd = '# Project\n\n- Every new source file starts with the line `// Part of linkcheck.`\n', commitClaudeMd = true, header = '// Part of linkcheck.' } = {}) {
  const dir = repo({ 'CLAUDE.md': claudeMd, '.practice/b-5-rule.txt': '// Part of linkcheck.\n' });
  writeFileSync(join(dir, '.git', 'info', 'exclude'), '.practice/\n');
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  if (commitClaudeMd) git('add', 'CLAUDE.md');
  git('commit', '-q', '--allow-empty', '-m', 'Add project instructions');
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'test'), { recursive: true });
  writeFileSync(join(dir, 'src', 'stats.js'), `${header}\nexport function countLinks() { return 0; }\n`);
  writeFileSync(join(dir, 'test', 'stats.test.js'), "import { test } from 'node:test';\n");
  git('add', 'src', 'test');
  git('commit', '-q', '-m', 'Add countLinks');
  writeFileSync(join(dir, '.practice', 'b-5-commit.txt'), `${git('rev-parse', 'HEAD')}\n`);
  return dir;
}

test('b-5 passes when CLAUDE.md is committed with the rule and the new session followed it', () => {
  const dir = memoryRepo();
  try {
    const { code, out } = check(['b-5', '--dir', dir]);
    assert.equal(code, 0, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-5 fails when CLAUDE.md is not committed', () => {
  const dir = memoryRepo({ commitClaudeMd: false });
  try {
    const { code, out } = check(['b-5', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /not committed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-5 fails when a new file does not start with the rule', () => {
  const dir = memoryRepo({ header: '// stats' });
  try {
    const { code, out } = check(['b-5', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /src\/stats\.js/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
