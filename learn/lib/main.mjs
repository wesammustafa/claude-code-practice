// Wiring: the terminal, the state, the checks and the watcher. All decisions
// are in flow.mjs; this file only carries events in and effects out.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capabilities } from './caps.mjs';
import { loadCourse } from './content.mjs';
import { C } from './copy.mjs';
import { contentOf, initialState, reduce, watching } from './flow.mjs';
import { keyParser } from './keys.mjs';
import { plainProgress } from './plain.mjs';
import { lessonLabel, render } from './render.mjs';
import { openScreen } from './screen.mjs';
import { loadState, saveState, snapshot } from './store.mjs';
import { theme } from './theme.mjs';
import { evidence, gitFirstName, gitReady, gitStatus, runCheck, singleFlight, stopChildren } from './verify.mjs';
import { watchDirs } from './watch.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const POLL_CHECK_MS = 2_000;
const POLL_GIT_MS = 2_000;

export async function main({ stdin = process.stdin, stdout = process.stdout, env = process.env, platform = process.platform, root = ROOT, now = () => Date.now(), exit = (code) => process.exit(code) } = {}) {
  const course = loadCourse(root);
  const saved = loadState(root);
  if (!stdin.isTTY || !stdout.isTTY) {
    const results = {};
    for (const l of course) results[l.id] = await runCheck(root, l.id, null);
    stdout.write(plainProgress(course, results, saved));
    return 0;
  }

  const caps = capabilities(stdout, env, platform);
  const t = theme(caps);
  const [gitError, name] = await Promise.all([gitReady(root), gitFirstName(root)]);
  const facts = { root, name, gitError, practiceDir: existsSync(join(root, '.practice')), codespace: caps.codespace, win32: caps.win32 };
  let state = initialState({ course, saved, facts, now: now() });
  const screen = openScreen(stdout);
  let closed = false;
  let lastSave = 0;
  const timers = [];

  const draw = () => screen.draw(render(state, { cols: stdout.columns || 80, rows: stdout.rows || 24 }, t));

  const check = singleFlight(async (lesson, items, ev, slow) => {
    const r = await runCheck(root, lesson, items, { slow });
    if (closed) return;
    if (r.error) dispatch({ type: 'check-error', lesson, message: r.error });
    else dispatch({ type: 'check', lesson, items: r.items, evidence: ev ? evidence(root, ev) : null });
  });
  const git = singleFlight(async () => {
    const r = await gitStatus(root);
    if (closed) return;
    dispatch(r.error ? { type: 'git-error', message: r.error } : { type: 'git', paths: r.paths });
  });

  function run(effects) {
    for (const e of effects) {
      if (e.type === 'check') check(e.lesson, e.items, e.evidence, e.slow);
      else if (e.type === 'git') git();
      else if (e.type === 'save') save();
      else if (e.type === 'later') setTimeout(() => !closed && dispatch({ type: 'flush' }), e.ms);
      else if (e.type === 'quit') quit(0);
    }
  }

  // A failed save (a read-only folder, a full disk, a file another program
  // holds) never stops the lesson: the learner sees a note and goes on.
  let saveError = null;
  function save() {
    lastSave = now();
    try {
      saveState(root, snapshot(state));
      saveError = null;
    } catch (error) {
      if (saveError === error.code) return;
      saveError = error.code;
      queueMicrotask(() => !closed && dispatch({ type: 'notice', kind: 'save', message: error.code ?? error.message }));
    }
  }

  function dispatch(ev) {
    const r = reduce(state, { now: now(), ...ev });
    state = r.state;
    run(r.effects);
    if (!closed) draw();
  }

  // Ask again for whatever the screen waits on.
  function poke() {
    const w = watching(state);
    if (w?.check) check(w.check.lesson, w.check.items, state.view === 'step' ? contentOf(state).steps[state.pos.step].beats[state.pos.beat].evidence : null);
    if (w?.git) git();
  }

  const watcher = watchDirs(root, () => {
    if (closed || now() - lastSave < 400) return;
    const practiceDir = existsSync(join(root, '.practice'));
    if (practiceDir !== state.facts.practiceDir) dispatch({ type: 'facts', facts: { practiceDir } });
    dispatch({ type: 'activity' });
    poke();
  });

  function quit(code) {
    if (closed) return;
    closed = true;
    for (const id of timers) clearInterval(id);
    stopChildren();
    watcher.close();
    stdin.removeListener('data', onData);
    if (stdin.isTTY) stdin.setRawMode(false);
    stdin.pause();
    screen.leave();
    stdout.write(`${goodbye()}\n`);
    exit(code);
  }

  function goodbye() {
    const content = contentOf(state);
    const p = state.progress[state.lesson];
    if (!content || !p.step) return '';
    if (!existsSync(join(root, '.practice'))) return C.savedLater;
    const n = content.steps.findIndex((s) => s.id === p.step) + 1;
    return C.savedAt(lessonLabel(state.lesson), n, content.steps.length);
  }

  const parse = keyParser();
  function onData(chunk) {
    for (const ev of parse(chunk.toString('utf8'))) dispatch(ev);
    // A lone Escape, or the start of a sequence that never completes.
    if (parse.pending()) setTimeout(() => { for (const ev of parse.flush()) dispatch(ev); }, 50);
  }

  stdin.setRawMode(true);
  stdin.on('data', onData);
  stdin.resume();
  stdout.on('resize', () => {
    screen.clear();
    draw();
  });
  if (stdin === process.stdin) {
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => quit(0));
    process.once('exit', () => screen.leave());
    process.once('uncaughtException', (error) => {
      screen.leave();
      console.error(error);
      exit(1);
    });
  }

  timers.push(setInterval(() => dispatch({ type: 'tick' }), 1_000));
  let lastPoll = 0;
  timers.push(setInterval(() => {
    const w = watching(state);
    if (!w || now() - lastPoll < (w.git ? POLL_GIT_MS : POLL_CHECK_MS)) return;
    lastPoll = now();
    poke();
  }, 500));

  // The first look: the current lesson's check, for "welcome back" and the map.
  draw();
  if (state.view === 'resume' || state.view === 'intro') check(state.lesson, null, null, false);
  return new Promise(() => {});
}
