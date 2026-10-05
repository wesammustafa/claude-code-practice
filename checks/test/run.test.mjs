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
