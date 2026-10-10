// Asking the lesson's own check, and git, without blocking the screen. Both
// run in child processes; the app writes nothing to the practice copy.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lessons } from '../../checks/lessons/index.mjs';
import { statusPaths } from '../../checks/paths.mjs';

const RUN_CHECK = join(dirname(fileURLToPath(import.meta.url)), '..', 'run-check.mjs');

// Items whose check starts another process, such as a test run. They run
// only when the learner presses r, never on every file change.
export const SLOW = { 'b-3': [1], 'b-capstone': [3, 4] };

// The environment for every child: git must not hold .git/index.lock while
// the learner or Claude Code commits, and no color codes in what we parse.
export function childEnv(env = process.env) {
  const { NODE_TEST_CONTEXT, ...rest } = env;
  return { ...rest, GIT_OPTIONAL_LOCKS: '0', NO_COLOR: '1' };
}

// Runs `items` of a lesson's check (all when null). Slow items are left out
// unless `slow` is set, and come back marked `slow` so the screen can say
// "press r".
export function runCheck(dir, lesson, items, { slow = false } = {}) {
  const all = lessons[lesson].items.map((_, i) => i);
  const skipped = slow ? [] : (SLOW[lesson] ?? []).filter((i) => (items ?? all).includes(i));
  const wanted = (items ?? all).filter((i) => !skipped.includes(i));
  const placeholders = skipped.map((index) => ({ index, text: lessons[lesson].items[index].text, pass: false, slow: true, hint: '' }));
  if (!wanted.length) return Promise.resolve({ items: placeholders });
  return new Promise((resolve) => {
    track(execFile(process.execPath, [RUN_CHECK, lesson, dir, ...wanted.map(String)], { env: childEnv(), timeout: 150_000, windowsHide: true, maxBuffer: 4 << 20 }, (error, stdout) => {
      try {
        const out = JSON.parse(stdout.trim().split('\n').pop());
        if (out.error) return resolve({ error: out.error });
        resolve({ items: [...out.items, ...placeholders].sort((a, b) => a.index - b.index) });
      } catch {
        resolve({ error: error ? (error.killed ? 'it took too long' : error.message.split('\n')[0]) : 'it printed something unexpected' });
      }
    }));
  });
}

export function gitStatus(dir) {
  return new Promise((resolve) => {
    track(execFile('git', ['status', '--porcelain'], { cwd: dir, env: childEnv(), windowsHide: true, timeout: 30_000 }, (error, stdout) => {
      if (error) resolve({ error: error.message.split('\n')[0] });
      else resolve({ paths: statusPaths(stdout) });
    }));
  });
}

export function gitReady(dir) {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, env: childEnv(), windowsHide: true, timeout: 30_000 }, (error) => {
      resolve(error ? (error.code === 'ENOENT' ? 'git is not installed' : 'this folder is not a git repository') : null);
    });
  });
}

// The first word of git's user.name, to say hello. Read, never stored.
export function gitFirstName(dir) {
  return new Promise((resolve) => {
    execFile('git', ['config', 'user.name'], { cwd: dir, env: childEnv(), windowsHide: true, timeout: 30_000 }, (error, stdout) => {
      resolve(error ? '' : (stdout.trim().split(/\s+/)[0] ?? '').slice(0, 20));
    });
  });
}

// The first line of a file a check verified, to show what the learner made.
export function evidence(dir, path) {
  try {
    const buf = readFileSync(join(dir, path));
    const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString('utf16le') : buf.toString('utf8').replace(/^﻿/, '');
    return text.split(/\r?\n/).find((l) => l.trim())?.trim().slice(0, 60) ?? null;
  } catch {
    return null;
  }
}

// Children still running, so quitting can stop them.
const children = new Set();
const track = (child) => {
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
};
export function stopChildren() {
  for (const child of children) child.kill();
  children.clear();
}

// One run at a time; a request during a run schedules exactly one more.
export function singleFlight(fn) {
  let running = null;
  let again = null;
  const go = (...args) => {
    if (running) {
      again = args;
      return running;
    }
    running = Promise.resolve(fn(...args)).finally(() => {
      running = null;
      if (again) {
        const next = again;
        again = null;
        go(...next);
      }
    });
    return running;
  };
  return go;
}
