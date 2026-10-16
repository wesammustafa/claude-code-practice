// Wiring: the terminal, the state, the checks and the watcher. All decisions
// are in flow.mjs; this file only carries events in and effects out.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capabilities } from './caps.mjs';
import { loadCourse } from './content.mjs';
import { C } from './copy.mjs';
import { contentOf, initialState, reduce, stepsOf, watching } from './flow.mjs';
import { keyParser } from './keys.mjs';
import { BOOT_FROM, bootChange, nextChange, REST, TIMING } from './motion.mjs';
import { plainProgress } from './plain.mjs';
import { bootFrame, itemsMax, lessonLabel, render } from './render.mjs';
import { openScreen } from './screen.mjs';
import { loadState, saveState, snapshot } from './store.mjs';
import { theme } from './theme.mjs';
import { evidence, gitFirstName, gitReady, gitStatus, lineCount, runCheck, singleFlight, stampOf, stopChildren } from './verify.mjs';
import { watchDirs } from './watch.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const POLL_CHECK_MS = 2_000;
const POLL_GIT_MS = 2_000;
const FLAGS = ['--calm', '--plain'];
const TIMERS = { setTimeout, clearTimeout, setInterval, clearInterval };
// What git says first: whether this folder is a repository, and a name to
// greet.
const ASK_GIT = (root) => Promise.all([gitReady(root), gitFirstName(root)]);

export async function main({ argv = [], stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, env = process.env, platform = process.platform, root = ROOT, now = () => Date.now(), perf = () => performance.now(), timers = TIMERS, watch = watchDirs, askGit = ASK_GIT, runCheck: checkChild = runCheck, signals = stdin === process.stdin ? process : null, exit = (code) => process.exit(code) } = {}) {
  if (argv.some((a) => !FLAGS.includes(a))) {
    stderr.write(`${C.usage}\n`);
    return 2;
  }
  const course = loadCourse(root);
  const saved = loadState(root);
  if (!stdin.isTTY || !stdout.isTTY) {
    const results = {};
    for (const l of course) if (!l.newCopy) results[l.id] = await checkChild(root, l.id, null);
    stdout.write(plainProgress(course, results, saved));
    return 0;
  }

  const caps = capabilities(stdout, env, platform, argv);
  const t = theme(caps);
  // No state until git answers. The screen opens then, or as the boot frame
  // goes up if git takes over 150 ms (162).
  let state = null;
  let screen = null;
  // When the write budget stops motion, the rest frame goes up on time.
  const openIt = () => { screen ??= openScreen(stdout, { clock: perf, motion: caps.motion, onMotionOff: () => requestDraw() }); };
  let closed = false;
  let lastSave = 0;
  const intervals = [];
  let watcher = null;

  // Drawing. Every dispatch asks for a frame, and one goes out per turn of the
  // event loop, so the events of one turn (a watcher's burst, keys in one
  // read) make one frame. After each draw, nextChange sets the one frame
  // timer, or none. No two frames go out less than 40 ms apart: the floor
  // counts from the screen's last write, a drain's included, on the
  // monotonic clock. Each effect's frames keep to the 40 ms grid from its
  // own start (motion.mjs); a key's frame is not held back to a grid.
  let drawAsked = false;
  let frameTimer = null;
  const floor = () => TIMING.grid - (perf() - screen.wroteAt);
  function requestDraw() {
    if (drawAsked || closed) return;
    drawAsked = true;
    setImmediate(() => {
      drawAsked = false;
      draw();
    });
  }
  const sizeNow = () => ({ cols: stdout.columns || 80, rows: stdout.rows || 24 });
  const drawIn = (ms) => { frameTimer = timers.setTimeout(draw, ms); };
  function draw() {
    if (closed) return;
    timers.clearTimeout(frameTimer);
    frameTimer = null;
    if (floor() > 0) return drawIn(floor());
    const at = now();
    const size = sizeNow();
    const clock = screen.motion ? { at } : REST;
    screen.draw(state ? render(state, size, t, clock) : bootFrame(askedAt, size, t, clock));
    const wait = state ? nextChange(state, at, { motion: screen.motion }) : bootChange(askedAt, at, { motion: screen.motion });
    if (wait !== null) drawIn(Math.max(wait, floor()));
  }

  // Git's first answers. If they take over 150 ms, the boot frame goes up on
  // the spinner's first tick and runs until they land. Till then no key
  // works: raw mode keeps the terminal from echoing keys onto the screen, a
  // key typed is dropped rather than kept for a screen not yet seen, and
  // Ctrl+C, no longer a signal, quits.
  if (signals) onSignals();
  const onBootKey = (chunk) => {
    if (String(chunk).includes('\x03')) quit(0);
  };
  stdin.setRawMode(true);
  stdin.on('data', onBootKey);
  stdin.resume();
  // A resize wipes the screen and draws again, the boot frame included.
  stdout.on('resize', () => {
    if (!screen) return;
    screen.clear();
    requestDraw();
  });
  const askedAt = now();
  const boot = timers.setTimeout(() => {
    if (closed) return;
    openIt();
    draw();
  }, BOOT_FROM);
  const [gitError, name] = await askGit(root);
  timers.clearTimeout(boot);
  if (closed) return 0;
  const facts = { root, name, gitError, practiceDir: existsSync(join(root, '.practice')), codespace: caps.codespace, win32: caps.win32 };
  state = initialState({ course, saved, facts, now: now() });
  openIt();

  // When a check or git child really starts. Like every dispatch an effect
  // causes, it waits for the dispatch that asked for the run to finish.
  const runStart = () => queueMicrotask(() => !closed && dispatch({ type: 'run-start' }));

  // A run asked for during another waits in line, and a later ask takes its
  // place (singleFlight). What r asked for stays owed until a run starts:
  // its slow items, and `asked`, the latest r's number, which goes back on
  // the result so the card knows that r's run ended.
  function owing(fn) {
    let owed = { slow: false, asked: 0 };
    const go = singleFlight((...args) => {
      const flags = owed;
      owed = { slow: false, asked: 0 };
      return fn(flags, ...args);
    });
    return ({ slow, asked } = {}, ...args) => {
      owed = { slow: owed.slow || Boolean(slow), asked: Math.max(owed.asked, asked ?? 0) };
      return go(...args);
    };
  }

  const check = owing(async ({ slow, asked }, lesson, items, ev) => {
    // The evidence file's state before and after the run: if it changed while
    // the check ran, the result may be about the old file, so ask again.
    const before = ev ? stampOf(root, ev) : null;
    // The child starts now, not when the run was asked for: a run asked for
    // during another waits in line.
    runStart();
    // Each item the child starts, for the checking label to count, with the
    // items this run was asked for.
    const onRunning = (n, m) => !closed && dispatch({ type: 'running', lesson, items, n, m, asked });
    const r = await checkChild(root, lesson, items, { slow, onRunning });
    if (closed) return;
    if (r.error) return dispatch({ type: 'check-error', lesson, message: r.error, asked });
    if (ev && stampOf(root, ev) !== before) return queueMicrotask(() => !closed && check({ slow, asked }, lesson, items, ev));
    dispatch({ type: 'check', lesson, items: r.items, evidence: ev ? evidence(root, ev) : null, path: ev ?? null, stamp: before, asked });
  });
  const git = owing(async ({ asked }) => {
    runStart();
    const r = await gitStatus(root);
    if (closed) return;
    dispatch(r.error ? { type: 'git-error', message: r.error, asked } : { type: 'git', paths: r.paths, asked });
  });

  // A file's first line and its state, read now: small, local and quick.
  const file = (path, asked = 0) => queueMicrotask(() => !closed && dispatch({ type: 'file', path, line: evidence(root, path), lines: lineCount(root, path), stamp: stampOf(root, path), asked }));

  function run(effects) {
    for (const e of effects) {
      if (e.type === 'check') check(e, e.lesson, e.items, e.evidence);
      else if (e.type === 'file') file(e.path, e.asked);
      else if (e.type === 'stamp') queueMicrotask(() => !closed && dispatch({ type: 'stamp', key: e.key, stamp: stampOf(root, e.path) }));
      else if (e.type === 'git') git(e);
      else if (e.type === 'save') save();
      else if (e.type === 'later') timers.setTimeout(() => !closed && dispatch({ type: 'flush' }), e.ms);
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
    // A key carries how far the check-only card's items scroll in the window
    // as it is now drawn, so the arrows move only what it shows.
    if (ev.type === 'key') ev = { ...ev, itemsMax: itemsMax(state, sizeNow(), t) };
    const r = reduce(state, { now: now(), ...ev });
    state = r.state;
    run(r.effects);
    requestDraw();
  }

  // Ask again for whatever the screen waits on.
  function poke() {
    const w = watching(state);
    if (w?.check) check({}, w.check.lesson, w.check.items, state.view === 'step' ? stepsOf(state)[state.pos.step].beats[state.pos.beat].evidence : null);
    if (w?.file) file(w.file);
    if (w?.git) git();
  }

  watcher = watch(root, () => {
    if (closed || now() - lastSave < 400) return;
    const practiceDir = existsSync(join(root, '.practice'));
    if (practiceDir !== state.facts.practiceDir) dispatch({ type: 'facts', facts: { practiceDir } });
    dispatch({ type: 'activity' });
    poke();
  });

  function quit(code) {
    if (closed) return;
    closed = true;
    for (const id of intervals) timers.clearInterval(id);
    timers.clearTimeout(frameTimer);
    stopChildren();
    watcher?.close();
    stdin.removeListener('data', onBootKey);
    stdin.removeListener('data', onData);
    if (stdin.isTTY) stdin.setRawMode(false);
    stdin.pause();
    screen?.leave();
    stdout.write(`${goodbye()}\n`);
    exit(code);
  }

  function goodbye() {
    if (!state) return '';
    const content = contentOf(state);
    const p = state.progress[state.lesson];
    if (!content || !p.step) return '';
    if (!existsSync(join(root, '.practice'))) return C.savedLater;
    const steps = stepsOf(state);
    const n = steps.findIndex((s) => s.id === p.step) + 1;
    return C.savedAt(lessonLabel(state.lesson), n, steps.length);
  }

  const parse = keyParser();
  function onData(chunk) {
    for (const ev of parse(chunk.toString('utf8'))) dispatch(ev);
    // A lone Escape, or the start of a sequence that never completes.
    if (parse.pending()) timers.setTimeout(() => { for (const ev of parse.flush()) dispatch(ev); }, 50);
  }

  stdin.removeListener('data', onBootKey);
  stdin.on('data', onData);
  // Set before git is asked: the boot frame opens the screen, and a signal
  // then must close it.
  function onSignals() {
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) signals.once(sig, () => quit(0));
    signals.once('exit', () => screen?.leave());
    signals.once('uncaughtException', (error) => {
      screen?.leave();
      console.error(error);
      exit(1);
    });
  }

  intervals.push(timers.setInterval(() => dispatch({ type: 'tick' }), 1_000));
  let lastPoll = 0;
  intervals.push(timers.setInterval(() => {
    const w = watching(state);
    if (!w || now() - lastPoll < (w.git ? POLL_GIT_MS : POLL_CHECK_MS)) return;
    lastPoll = now();
    poke();
  }, 500));

  // The first look: the current lesson's check, for "welcome back" and the map.
  draw();
  if (state.view === 'resume' || state.view === 'intro') check({}, state.lesson, null, null);
  return new Promise(() => {});
}
