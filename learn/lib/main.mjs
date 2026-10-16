// Wiring: the terminal, the state, the checks and the watcher. All decisions
// are in flow.mjs; this file only carries events in and effects out.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capabilities } from './caps.mjs';
import { loadCourse } from './content.mjs';
import { C } from './copy.mjs';
import { contentOf, folderKey, folderOf, initialState, introAsks, levelKey, reduce, stepsOf, watching } from './flow.mjs';
import { keyParser } from './keys.mjs';
import { BOOT_FROM, bootChange, nextChange, pipGates, REST, TIMING } from './motion.mjs';
import { createPip } from './pip/pip.mjs';
import { plainProgress } from './plain.mjs';
import { bootFrame, itemsMax, lessonLabel, pipSlot, pipTarget, render } from './render.mjs';
import { openScreen } from './screen.mjs';
import { loadState, saveState, snapshot } from './store.mjs';
import { theme } from './theme.mjs';
import { bytesOf, gitFirstName, gitReady, gitStatus, onPath, owing, probeFolder, runCheck, singleFlight, stampOf, stopChildren } from './verify.mjs';
import { watchDirs } from './watch.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const POLL_CHECK_MS = 2_000;
const POLL_GIT_MS = 2_000;
const FLAGS = ['--calm', '--plain'];
const TIMERS = { setTimeout, clearTimeout, setInterval, clearInterval };
// What git says first: whether this folder is a repository, and a name to
// greet.
const ASK_GIT = (root) => Promise.all([gitReady(root), gitFirstName(root)]);

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

export async function main({ argv = [], stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, env = process.env, platform = process.platform, root = ROOT, now = () => Date.now(), perf = () => performance.now(), timers = TIMERS, watch = watchDirs, askGit = ASK_GIT, runCheck: checkChild = runCheck, signals = stdin === process.stdin ? process : null, exit = (code) => process.exit(code) } = {}) {
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
    // i-capstone's too, though i-capstone itself stays in the copy.
    const opening = initialState({ course, saved, facts: { root } });
    const key = folderKey(opening) ?? levelKey(opening);
    if (!key) {
      stderr.write(`${C.dirBeginner}\n`);
      return 2;
    }
    // A new copy is another folder than this practice copy.
    if (key !== levelKey(opening) && ahead.path === root) {
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
  let lastSave = 0;
  const intervals = [];
  let watcher = null;
  // The lesson's work folder and its watcher, where it is not the copy.
  let work = { dir: root, watcher: null };

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
    // The detailed Pip, where the screen has room for it: its pose, and
    // when it next moves, one more deadline for the one timer. Both with
    // the same gates, even if this frame's write turns motion off.
    const slot = pipSlot(state, size, t, nextScreen);
    const gates = slot && pipGates(state, at, { motion: screen.motion, truecolor: t.depth >= 24, remote: caps.remote });
    const raster = slot ? { size: slot, pose: pipPose(at, gates) } : null;
    screen.draw(state ? render(state, size, t, clock, raster) : bootFrame(askedAt, size, t, clock, raster));
    const waits = [state ? nextChange(state, at, { motion: screen.motion }) : bootChange(askedAt, at, { motion: screen.motion }),
      slot ? pip.nextFrameIn(pipAt, { ...gates, size: slot }) : null].filter((w) => w !== null);
    if (waits.length) drawIn(Math.max(Math.min(...waits), floor()));
  }

  // The detailed Pip's one controller. Its gates read the app's stamps on
  // the app's clock (`at`); its own time (`pipAt`) runs with that clock but
  // never back: when the wall clock steps back, `skew` takes up the step, so
  // Pip goes on from where it was. A change is set no earlier than the last
  // (`pipChanged`), and no later than now.
  let pip = null;
  let pipAt = -Infinity;
  let pipChanged = -Infinity;
  let skew = 0;
  // Pip set to what this screen shows, then its pose at `at`.
  function pipPose(at, gates) {
    if (at + skew < pipAt) skew = pipAt - at;
    pipAt = at + skew;
    const { state: next, since, ...event } = pipTarget(state, at);
    const from = Math.min(pipAt, Math.max(since === undefined ? pipAt : since + skew, pipChanged));
    if (pip.setState(next, { at: from, ...event })) pipChanged = from;
    return pip.pose(pipAt, gates);
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
  const facts = { root, name, gitError, practiceDir: existsSync(join(root, '.practice')), codespace: caps.codespace, win32: caps.win32, linux: platform === 'linux' };
  state = initialState({ course, saved, facts, now: now() });
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
    if (closed || now() - lastSave < 400) return;
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
  let lastProbe = 0;
  function reprobe() {
    const dir = folderOf(state);
    const found = dir && dir !== root ? state.probes[dir] : null;
    if (closed || probing || !found || (!found.missing && found.git && found.practice)) return;
    probing = true;
    lastProbe = now();
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
  let lastPoll = 0;
  intervals.push(timers.setInterval(() => {
    if (now() - lastProbe >= POLL_CHECK_MS) reprobe();
    const w = watching(state);
    if (!w || now() - lastPoll < (w.git ? POLL_GIT_MS : POLL_CHECK_MS)) return;
    lastPoll = now();
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
