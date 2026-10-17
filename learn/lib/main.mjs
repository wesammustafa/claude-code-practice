// Wiring: the terminal, the state, the checks and the watcher. The lesson's
// decisions are in flow.mjs; this file carries events in and effects out.
// It owns the app's one clock, its one frame timer and the detailed Pip's
// controller: Pip's state changes, the restart of its lively window as the
// ambient gate opens, and its eases where its pose jumps.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipShown } from './art.mjs';
import { capabilities, osc52 } from './caps.mjs';
import { loadCourse } from './content.mjs';
import { C } from './copy.mjs';
import { contentOf, folderKey, folderOf, initialState, introAsks, levelKey, reduce, stepsOf, watching } from './flow.mjs';
import { keyParser } from './keys.mjs';
import { ambientOpened, BOOT_FROM, bootChange, greetFrameIn, greetStart, nextChange, pipGates, pipJump, REST, TIMING } from './motion.mjs';
import { createPip } from './pip/pip.mjs';
import { plainProgress } from './plain.mjs';
import { bootFrame, cardMax, itemsMax, lessonLabel, pipSlot, pipTarget, render } from './render.mjs';
import { openScreen } from './screen.mjs';
import { loadState, saveState, snapshot } from './store.mjs';
import { theme } from './theme.mjs';
import { bytesOf, gitFirstName, gitReady, gitStatus, onPath, owing, probeFolder, runCheck, singleFlight, stampOf, stopChildren } from './verify.mjs';
import { watchDirs } from './watch.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const POLL_CHECK_MS = 2_000;
const POLL_GIT_MS = 2_000;
const FLAGS = ['--calm', '--plain'];
// Pip's states with no reaction of their own: no hop, no spark.
const NO_REACTION = ['ready', 'waiting', 'working'];
const TIMERS = { setTimeout, clearTimeout, setInterval, clearInterval };
// main's one clock: monotonic, and on a 1/1024 ms grid so sums and
// differences of its times are exact (a deadline on the 40 ms grid lands on
// it, not a hair under). A whole-ms clock passes through unchanged.
const PERF = () => Math.round(performance.now() * 1024) / 1024;
// What git says first: whether this folder is a repository, and a name to
// greet.
const ASK_GIT = (root) => Promise.all([gitReady(root), gitFirstName(root)]);
// Two of Pip's poses the same to within rounding.
const samePose = (a, b) => Object.keys(a).every((k) => (typeof a[k] === 'number' ? Math.abs(a[k] - b[k]) < 1e-6 : a[k] === b[k]));

// A folder path as the learner typed or pasted it, in full: quotes around
// it and the shell's `\ ` for a space (a folder dragged onto the terminal)
// come off, `~` is the home folder, and a relative path is from the copy,
// as npm run check reads one.
function folderPath(text, root, home, win32) {
  let path = text.trim().replace(/^(['"])(.*)\1$/, '$2');
  if (!win32) path = path.replace(/\\ /g, ' ');
  if (path === '~' || /^~[\\/]/.test(path)) path = join(home, path.slice(1));
  return resolve(root, path);
}

// The flags, and `--dir <folder>` (or `--dir=<folder>`): null when
// something else is there, or --dir has no folder after it.
function parseArgs(argv) {
  let dir;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (FLAGS.includes(a)) continue;
    if (a.startsWith('--dir=') && dir === undefined) dir = a.slice(6);
    else if (a === '--dir' && dir === undefined && argv[i + 1] !== undefined) dir = argv[++i];
    else return null;
  }
  return dir === '' ? null : { dir };
}

export async function main({ argv = [], stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, env = process.env, platform = process.platform, root = ROOT, perf = PERF, pipSlot: slotFor = pipSlot, timers = TIMERS, watch = watchDirs, askGit = ASK_GIT, runCheck: checkChild = runCheck, signals = stdin === process.stdin ? process : null, exit = (code) => process.exit(code) } = {}) {
  const args = parseArgs(argv);
  if (!args) {
    stderr.write(`${C.usage}\n`);
    return 2;
  }
  const course = loadCourse(root);
  let saved = loadState(root);
  // --dir answers the folder question ahead of time, for the level the app
  // opens on, as the intro would: a folder relative to the copy, as npm run
  // check takes one, or in full.
  let ahead = null;
  if (args.dir !== undefined) {
    ahead = await probeFolder(resolve(root, args.dir));
    if (ahead.missing) {
      stderr.write(`${C.noFolder(ahead.path)}\n`);
      return 2;
    }
    // The lesson's own key for one that runs in a new copy; else its level's,
    // i-capstone's too, though i-capstone itself stays in the copy. A saved
    // new copy makes its lesson the next one (172), but not the one --dir
    // answers for: that is the lesson the app opens on with none saved, so
    // while other Advanced lessons are left --dir is still the level's. Nor
    // does --dir replace a new copy already saved (173): opening on its
    // lesson, it is the level's too.
    const opening = initialState({ course, saved: { ...saved, folders: {} }, facts: { root } });
    const level = levelKey(opening);
    const own = folderKey(opening);
    const savedCopy = Boolean(own && own !== level && saved?.folders?.[own]);
    const key = savedCopy ? level : own ?? level;
    if (!key) {
      stderr.write(`${C.dirBeginner}\n`);
      return 2;
    }
    // A new copy is another folder than this practice copy.
    if (key !== level && ahead.path === root) {
      stderr.write(`${C.newCopyIsCopy}\n`);
      return 2;
    }
    saved = { ...(saved ?? {}), folders: { ...(saved?.folders ?? {}), [key]: ahead.path } };
  }
  if (!stdin.isTTY || !stdout.isTTY) {
    const s = initialState({ course, saved, facts: { root } });
    const results = {};
    const dirs = {};
    for (const l of course) {
      dirs[l.id] = folderOf(s, l.id);
      if (dirs[l.id]) results[l.id] = await checkChild(dirs[l.id], l.id, null);
    }
    stdout.write(plainProgress(course, results, saved, { root, dirs }));
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
  let lastSave = -Infinity;
  const intervals = [];
  let watcher = null;
  // The lesson's work folder and its watcher, where it is not the copy.
  let work = { dir: root, watcher: null };

  // Drawing. Every dispatch asks for a frame, and one goes out per turn of the
  // event loop, so the events of one turn (a watcher's burst, keys in one
  // read) make one frame. No two frames go out less than 40 ms apart: the
  // floor counts from the screen's last write, a drain's included. An
  // event's frame inside the floor waits for it, or joins a frame already
  // due by then. After each draw, nextChange and the rest set the one frame
  // timer, or none, as a deadline: the frame's own time plus the wait, so
  // render and write time do not stretch the next. Each effect's frames keep
  // to the 40 ms grid from its own start (motion.mjs), Pip's from its last
  // change; a key's frame is not held back to a grid. A deadline's frame is
  // drawn for its time, or the time it is if later, and its write waits out
  // the floor. Every time here is on `perf`, main's one clock: the event
  // stamps, the frames, the screen's writes and Pip.
  let drawAsked = false;
  let frameTimer = null;
  let dueAt = null;
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
  const later = (fn, ms) => { frameTimer = timers.setTimeout(fn, ms); };
  // Pip's slot, measured once per state and size: the theme and the next
  // screen are the run's, and no state changes once made.
  let slotWas = null;
  const slotOf = (s, size) => {
    if (slotWas?.s !== s || slotWas.cols !== size.cols || slotWas.rows !== size.rows) slotWas = { s, ...size, slot: slotFor(s, size, t, nextScreen) };
    return slotWas.slot;
  };
  // Pip's wait from `at` (the package's are all over 0), on the 40 ms grid
  // from `from` and counted from the grid's last step at or before `at`: a
  // timer that fires late, or an event's frame between steps, does not push
  // Pip's next tick a step on. A moment of its own between steps (a glance's
  // start) may get a frame one step before it; the next step shows it.
  const onGrid = (at, wait, from) => (wait === null ? null : from + TIMING.grid * (Math.floor((at - from) / TIMING.grid) + Math.ceil(wait / TIMING.grid)) - at);
  function draw(deadline) {
    if (closed) return;
    const wait = floor();
    if (deadline === undefined && wait > 0) {
      if (dueAt === null || dueAt > perf() + wait) {
        timers.clearTimeout(frameTimer);
        dueAt = null;
        later(() => draw(), wait);
      }
      return;
    }
    timers.clearTimeout(frameTimer);
    frameTimer = null;
    dueAt = null;
    const at = deadline === undefined ? perf() : Math.max(perf(), deadline);
    const size = sizeNow();
    const clock = screen.motion ? { at } : REST;
    // The detailed Pip, where the screen has room for it: its pose and any
    // ease from where it jumped, and when it, its greeting or the ease next
    // moves, more deadlines for the one timer. All with the same gates, even
    // if this frame's write turns motion off.
    const slot = slotOf(state, size);
    const gates = slot && pipGates(state, at, { motion: screen.motion, truecolor: t.truecolor, remote: caps.remote });
    const pose = slot && pipPose(at, gates);
    if (!slot) shown = fade = null;
    const raster = slot ? { size: slot, pose, fade } : null;
    const lines = state ? render(state, size, t, clock, raster) : bootFrame(askedAt, size, t, clock, raster);
    const waits = [state ? nextChange(state, at, { motion: screen.motion }) : bootChange(askedAt, at, { motion: screen.motion }),
      slot ? onGrid(at, pip.nextFrameIn(at, { ...gates, size: slot }), pipChanged) : null,
      slot && state ? greetFrameIn(state, at, { motion: screen.motion }) : null,
      fade ? Math.min(TIMING.grid - ((at - fade.at) % TIMING.grid), fade.at + fade.ms - at) : null].filter((w) => w !== null);
    put(lines, waits.length ? at + Math.min(...waits) : null);
  }
  // A frame's write, once the floor is out, then the timer for the next
  // deadline. An event while it waits draws afresh.
  function put(lines, next) {
    if (closed) return;
    frameTimer = null;
    if (floor() > 0) return later(() => put(lines, next), floor());
    screen.draw(lines);
    if (next === null) return;
    dueAt = next;
    later(() => draw(next), Math.max(0, next - perf()));
  }

  // The detailed Pip's one controller, on the app's clock: its gates read
  // the app's stamps, and its pose is at the frame's time (`at`). Frame times
  // never go back, so neither does Pip. `pipAt` is the last frame drawn with
  // Pip, and `pipChanged` its last change (setState throws on a time before
  // it).
  let pip = null;
  let pipAt = -Infinity;
  let pipChanged = -Infinity;
  // The moment of the last ambient gate opening Pip's lively window started
  // again at, so each opening starts it once, even one first seen after
  // frames with no room for Pip.
  let pipOpened = null;
  // A change from `since` (or now), seen on the frame at `at`: no earlier
  // than the last change, nor than a frame already shown, and no later than
  // this frame.
  const pipFrom = (at, since) => Math.min(at, Math.max(since ?? at, pipChanged, pipAt));
  // What the last frame with Pip showed: its gates, its greeting's start
  // and the screen's arrival. Where its pose jumps from there (a key ends
  // its greeting or shuts its ambient gate, or the gate opens), `fade`
  // eases it from the pose shown at that moment, on the 40 ms grid from it
  // (181): a function of time alone, not of which frames happened to draw.
  let shown = null;
  let fade = null;
  // Pip set to what this screen shows, then its pose at `at`.
  function pipPose(at, gates) {
    const { state: next, since, ...event } = pipTarget(state, at);
    // The pose shown at the jump, with the last frame's gates and any ease
    // still running: before any change below, which retargets from it.
    const jump = pipJump(state, at, shown, gates);
    const jumped = jump && pipFrom(at, jump.at);
    const eased = jump && { at: jumped, ms: jump.ms, from: pipShown({ pose: pip.pose(jumped, shown.gates), fade }, shown.greet === undefined ? Infinity : jumped - shown.greet, jumped) };
    const changed = pipFrom(at, since);
    if (pip.setState(next, { at: changed, ...event })) pipChanged = changed;
    // The package's lively window (blinks, glances, breathing) is its 30 s
    // from Pip's last change. On a state with no reaction of its own, it
    // starts again as the ambient gate opens: from that moment, under that
    // moment's id, at once, so the pose holds and nothing replays. (No
    // ambient screen's target carries an event id today; one that did would
    // replay its reaction after the restart, so it is left alone.)
    if (gates.ambient && NO_REACTION.includes(next) && event.eventId === undefined) {
      const opened = ambientOpened(state);
      const restart = pipFrom(at, opened);
      if (opened !== pipOpened && pip.setState(next, { at: restart, eventId: `ambient:${opened}`, immediate: true })) pipChanged = restart;
      pipOpened = opened;
    }
    // An ease with nothing to ease is none: an opening with no breathing
    // asks for no frames.
    const greet = state ? greetStart(state, at, gates) : undefined;
    if (eased && !samePose(eased.from, pipShown({ pose: pip.pose(jumped, gates) }, greet === undefined ? Infinity : jumped - greet, jumped))) fade = eased;
    if (!gates.motion || (fade && at >= fade.at + fade.ms)) fade = null;
    shown = gates.motion ? { gates, greet, view: state?.fx.view } : null;
    pipAt = at;
    return pip.pose(at, gates);
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
  const askedAt = perf();
  // Pip starts working, as git is asked. The screen git's answers will open,
  // as far as the app knows before them: the boot frame's Pip is no bigger
  // than its own.
  pip = createPip({ state: 'working', at: askedAt });
  const nextScreen = initialState({ course, saved, facts: { root, name: '', gitError: null, practiceDir: existsSync(join(root, '.practice')), codespace: caps.codespace, win32: caps.win32 }, now: askedAt });
  pipAt = askedAt;
  pipChanged = askedAt;
  const boot = timers.setTimeout(() => {
    if (closed) return;
    openIt();
    draw();
  }, BOOT_FROM);
  const [gitError, name] = await askGit(root);
  timers.clearTimeout(boot);
  if (closed) return 0;
  const facts = { root, name, gitError, practiceDir: existsSync(join(root, '.practice')), codespace: caps.codespace, clipboard: caps.clipboard, win32: caps.win32, linux: platform === 'linux' };
  state = initialState({ course, saved, facts, now: perf() });
  openIt();

  // When a check or git child really starts. Like every dispatch an effect
  // causes, it waits for the dispatch that asked for the run to finish.
  const runStart = () => queueMicrotask(() => !closed && dispatch({ type: 'run-start' }));

  // Each run is in `dir`, the lesson's work folder, and its result says so:
  // the reducer drops a result about a folder the lesson no longer uses.
  const check = owing(async ({ slow, asked }, lesson, items, ev, dir) => {
    // The evidence file's state before and after the run: if it changed while
    // the check ran, the result may be about the old file, so ask again.
    const before = ev ? stampOf(dir, ev) : null;
    // The child starts now, not when the run was asked for: a run asked for
    // during another waits in line.
    runStart();
    // Each item the child starts, for the checking label to count, with the
    // items this run was asked for.
    const onRunning = (n, m) => !closed && dispatch({ type: 'running', lesson, items, n, m, asked });
    const r = await checkChild(dir, lesson, items, { slow, onRunning });
    if (closed) return;
    if (r.error) return dispatch({ type: 'check-error', lesson, message: r.error, asked, dir });
    if (ev && stampOf(dir, ev) !== before) return queueMicrotask(() => !closed && check({ slow, asked }, lesson, items, ev, dir));
    dispatch({ type: 'check', lesson, items: r.items, read: ev ? bytesOf(dir, ev) : null, path: ev ?? null, stamp: before, asked, dir });
  });
  // `files`: git lists each untracked file, for a beat on part of the tree.
  const git = owing(async ({ asked }, dir, files) => {
    runStart();
    const r = await gitStatus(dir, { files });
    if (closed) return;
    dispatch(r.error ? { type: 'git-error', message: r.error, asked, dir } : { type: 'git', paths: r.paths, staged: r.staged, files: Boolean(files), asked, dir });
  });

  // A file's bytes and its state, read now in the lesson's folder: local and
  // quick, with no process. The reducer decides what they mean.
  const file = (path, asked, dir) => queueMicrotask(() => !closed && dispatch({ type: 'file', path, read: bytesOf(dir, path), stamp: stampOf(dir, path), asked: asked ?? 0, dir }));

  function run(effects) {
    for (const e of effects) {
      if (e.type === 'check') check(e, e.lesson, e.items, e.evidence, e.dir);
      else if (e.type === 'file') file(e.path, e.asked, e.dir);
      else if (e.type === 'stamp') queueMicrotask(() => !closed && dispatch({ type: 'stamp', key: e.key, stamp: stampOf(e.dir, e.path), dir: e.dir }));
      else if (e.type === 'git') git(e, e.dir, e.files);
      else if (e.type === 'folder') look(e);
      else if (e.type === 'prereqs') prereqs(e);
      else if (e.type === 'commands') queueMicrotask(() => !closed && dispatch({ type: 'commands', found: Object.fromEntries(e.names.map((n) => [n, onPath(n, env, platform)])) }));
      // OSC 52: the reducer asks for a copy only where caps found a terminal
      // that takes it.
      else if (e.type === 'copy') stdout.write(osc52(e.text));
      else if (e.type === 'save') save();
      else if (e.type === 'later') timers.setTimeout(() => !closed && dispatch({ type: 'flush' }), e.ms);
      else if (e.type === 'quit') quit(0);
    }
  }

  // A lesson's prerequisites, in its work folder, in turn: a check item
  // through the check child, a file read as it is now, with no process. One
  // ask at a time; a later ask waits in line and takes the place of one
  // already waiting (singleFlight), and each answer carries its ask's number.
  const prereqs = singleFlight(async (e) => {
    for (const [at, req] of e.requires.entries()) {
      const found = await (req.path ? { read: bytesOf(e.dir, req.path) } : checkChild(e.dir, req.lesson, [req.item]).then((r) => {
        const item = r.items?.find((it) => it.index === req.item);
        return { pass: item ? item.pass : null };
      }));
      if (closed) return;
      dispatch({ type: 'prereq', lesson: e.lesson, dir: e.dir, at, asked: e.asked, ...found });
    }
  });

  // The path prompt's ask: what is at that path, for the reducer to take or
  // turn down.
  const home = env.HOME || env.USERPROFILE || homedir();
  async function look(e) {
    const found = await probeFolder(folderPath(e.text, root, home, caps.win32));
    if (!closed) dispatch({ type: 'probed', key: e.key, asked: e.asked, ...found });
  }

  // A failed save (a read-only folder, a full disk, a file another program
  // holds) never stops the lesson: the learner sees a note and goes on.
  let saveError = null;
  function save() {
    lastSave = perf();
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
    // A key carries how far the check-only card's items, and your card,
    // scroll in the window as it is now drawn, so the arrows move only what
    // it shows.
    if (ev.type === 'key') ev = { ...ev, itemsMax: itemsMax(state, sizeNow(), t), cardMax: cardMax(state, sizeNow(), t) };
    const r = reduce(state, { now: perf(), ...ev });
    state = r.state;
    run(r.effects);
    watchWork();
    requestDraw();
  }

  // Ask again for whatever the screen waits on.
  function poke() {
    const w = watching(state);
    if (w?.check) check({}, w.check.lesson, w.check.items, state.view === 'step' ? stepsOf(state)[state.pos.step].beats[state.pos.beat].evidence : null, w.dir);
    if (w?.file) file(w.file, 0, w.dir);
    if (w?.git) git({}, w.dir, w.files);
  }

  // The copy is always watched: its .practice/ decides whether progress
  // saves. The lesson's work folder, where it is another, is watched too,
  // armed again whenever the lesson on screen moves to another folder.
  const changed = () => {
    if (closed || perf() - lastSave < 400) return;
    const practiceDir = existsSync(join(root, '.practice'));
    if (practiceDir !== state.facts.practiceDir) dispatch({ type: 'facts', facts: { practiceDir } });
    dispatch({ type: 'activity' });
    poke();
    reprobe();
  };
  // A work folder whose look found something wrong is looked at again when
  // something changes, and on the poll, so its note goes once the learner
  // sets it right. One look at a time; a folder that was fine is left alone.
  let probing = false;
  let lastProbe = -Infinity;
  function reprobe() {
    const dir = folderOf(state);
    const found = dir && dir !== root ? state.probes[dir] : null;
    if (closed || probing || !found || (!found.missing && found.git && found.practice)) return;
    probing = true;
    lastProbe = perf();
    probeFolder(dir).then((f) => {
      probing = false;
      if (!closed) dispatch({ type: 'probed', ...f });
    });
  }
  watcher = watch(root, changed);
  function watchWork() {
    const dir = folderOf(state) ?? root;
    if (closed || dir === work.dir) return;
    work.watcher?.close();
    work = { dir, watcher: dir === root ? null : watch(dir, changed) };
  }
  watchWork();

  function quit(code) {
    if (closed) return;
    closed = true;
    for (const id of intervals) timers.clearInterval(id);
    timers.clearTimeout(frameTimer);
    stopChildren();
    watcher?.close();
    work.watcher?.close();
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
    // Progress stays in the copy: from a work folder elsewhere, say where.
    if (folderOf(state) !== root) return C.savedAtCopy(lessonLabel(state.lesson), n, steps.length, root);
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
  let lastPoll = -Infinity;
  intervals.push(timers.setInterval(() => {
    if (perf() - lastProbe >= POLL_CHECK_MS) reprobe();
    const w = watching(state);
    if (!w || perf() - lastPoll < (w.git ? POLL_GIT_MS : POLL_CHECK_MS)) return;
    lastPoll = perf();
    poke();
  }, 500));

  // A folder --dir gave is an answer: saved like one.
  if (ahead) save();
  // What each work folder is, for the notes (the copy needs none): the ones
  // learn.json names, and --dir's.
  for (const dir of new Set(Object.values(state.folders))) {
    if (dir === root) continue;
    if (dir === ahead?.path) dispatch({ type: 'probed', ...ahead });
    else probeFolder(dir).then((found) => !closed && dispatch({ type: 'probed', ...found }));
  }
  // The first look: the current lesson's check, for "welcome back" and the map.
  draw();
  if ((state.view === 'resume' || state.view === 'intro') && folderOf(state)) check({}, state.lesson, null, null, folderOf(state));
  run(introAsks(state));
  return new Promise(() => {});
}
