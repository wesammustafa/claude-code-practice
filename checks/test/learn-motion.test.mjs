// The learn app's motion plumbing: the gate and the calm switch, the frame
// clock, the in-memory stamps, the pure timing module, and the screen writer.
// Nothing moves yet, so every frame is the rest frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { capabilities } from '../../learn/lib/caps.mjs';
import { beatOf, DEFER_MS, IDLE_MS } from '../../learn/lib/flow.mjs';
import { ambientAllowed, nextChange, oneShot, phases, REST, TIMING } from '../../learn/lib/motion.mjs';
import { render } from '../../learn/lib/render.mjs';
import { FORMAT, saveState, snapshot, storePath } from '../../learn/lib/store.mjs';
import { openScreen } from '../../learn/lib/screen.mjs';
import { theme } from '../../learn/lib/theme.mjs';
import { repo, withRepo } from './helpers.mjs';
import { allScreens, b1Item, course, driver, lessonScreens, playUntil, root } from './learn-drive.mjs';
import { fakeClock, fakeOut, screenModel } from './learn-term.mjs';

// A terminal that can show everything: a TTY with 256 colors.
const tty = (depth = 8) => ({ isTTY: true, getColorDepth: () => depth });
const ENV = { TERM: 'xterm-256color' };

test('motion is on in a full terminal, and off under NO_COLOR, LEARN_PLAIN, LEARN_CALM, --calm, --plain, TERM=dumb, no TTY or no Unicode', () => {
  const on = capabilities(tty(), ENV, 'linux', []);
  assert.equal(on.motion, true);
  assert.equal(on.calm, false);
  const off = {
    NO_COLOR: capabilities(tty(), { ...ENV, NO_COLOR: '1' }, 'linux', []),
    LEARN_PLAIN: capabilities(tty(), { ...ENV, LEARN_PLAIN: '1' }, 'linux', []),
    LEARN_CALM: capabilities(tty(), { ...ENV, LEARN_CALM: '1' }, 'linux', []),
    '--calm': capabilities(tty(), ENV, 'linux', ['--calm']),
    '--plain': capabilities(tty(), ENV, 'linux', ['--plain']),
    'TERM=dumb': capabilities(tty(), { TERM: 'dumb' }, 'linux', []),
    'no TTY': capabilities({ isTTY: false }, ENV, 'linux', []),
    'no Unicode': capabilities(tty(), { TERM: 'linux' }, 'linux', []),
  };
  for (const [why, caps] of Object.entries(off)) assert.equal(caps.motion, false, why);
  assert.equal(capabilities(tty(4), ENV, 'linux', []).motion, true, '16 colors keeps motion');
  assert.equal(off.LEARN_CALM.calm, true);
  assert.equal(off['--calm'].calm, true);
  // --plain is LEARN_PLAIN: ASCII with no color.
  assert.equal(off['--plain'].unicode, false);
  assert.equal(off['--plain'].depth, 1);
  // Calm changes nothing else.
  assert.deepEqual({ ...off['--calm'], motion: true, calm: false }, on);
});

// The app as a learner starts it, with no terminal: the plain list, or a
// usage error.
const app = (args) => {
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  return spawnSync(process.execPath, [join(root, 'learn', 'app.mjs'), ...args], { input: '', encoding: 'utf8', env });
};

test('--calm and --plain are known flags; anything else, --lesson too until it is built, prints one usage line and exits 2', () => {
  for (const flag of ['--calm', '--plain']) {
    const r = app([flag]);
    assert.equal(r.status, 0, `${flag}: ${r.stderr}`);
    assert.equal(r.stderr, '', flag);
    assert.match(r.stdout, /Install, sign in and look around/, `${flag} still prints the path`);
  }
  for (const args of [['--nope'], ['calm'], ['--lesson', 'b-1'], ['--calm', '-x']]) {
    const r = app(args);
    assert.equal(r.status, 2, args.join(' '));
    assert.equal(r.stdout, '', `${args.join(' ')}: nothing on stdout`);
    assert.equal(r.stderr.trimEnd().split('\n').length, 1, `${args.join(' ')}: one line, got ${r.stderr}`);
    assert.match(r.stderr, /^Usage: npm run learn /);
    assert.match(r.stderr, /--calm\b.*--plain\b/);
  }
});

// Every screen of lesson 1, and every step screen of each lesson in the app.
const screens = [...allScreens(), ...course.filter((l) => l.content).flatMap((l) => lessonScreens(l.id))];
const SIZES = [[60, 20], [80, 24]];
const MOTION = { full: { tty: true, depth: 8, unicode: true, links: true, win32: false }, sixteen: { tty: true, depth: 4, unicode: true, links: false, win32: false } };

test('rest equals calm: with motion caps, the rest frame is the motion-off frame, byte for byte', () => {
  assert.deepEqual(REST, { at: Infinity });
  for (const [name, caps] of Object.entries(MOTION)) {
    const moving = theme({ ...caps, motion: true, calm: false });
    const calm = theme({ ...caps, motion: false, calm: true });
    for (const [cols, rows] of SIZES) {
      for (const [label, state] of screens) {
        const size = { cols, rows };
        assert.deepEqual(render(state, size, moving, REST), render(state, size, calm), `${label} at ${cols}x${rows} (${name})`);
      }
    }
  }
});

test('with motion off, a frame at any time is the rest frame', () => {
  const calm = theme({ ...MOTION.full, motion: false, calm: true });
  for (const [label, state] of screens) {
    const size = { cols: 80, rows: 24 };
    const rest = render(state, size, calm, REST);
    for (const ms of [0, 40, 150, 600, 5_000]) assert.deepEqual(render(state, size, calm, { at: state.now + ms }), rest, `${label} at +${ms} ms`);
  }
});

// Until the frames are drawn (158 and 159), a clock changes nothing even
// with motion on. Those tickets replace this test with tests 1 and 2.
test('nothing moves yet: with motion on, a frame at any time is the rest frame', () => {
  const moving = theme({ ...MOTION.full, motion: true, calm: false });
  for (const [label, state] of screens) {
    const size = { cols: 80, rows: 24 };
    const rest = render(state, size, moving, REST);
    for (const ms of [0, 80, 400]) assert.deepEqual(render(state, size, moving, { at: state.now + ms }), rest, `${label} at +${ms} ms`);
  }
});

const beatOfKind = (s) => beatOf(s).kind;

// One event at a known time: the stamp it leaves is that time.
const at = (d, ev) => {
  const effects = d.send({ wait: 7, ...ev });
  return { now: d.now, effects };
};

test('stamps: a view change and a beat opening are stamped from the event\'s own now', () => {
  const d = driver();
  const enter = at(d, { type: 'key', name: 'enter' });
  assert.equal(d.state.view, 'intro');
  assert.equal(d.state.fx.view, enter.now);
  const start = at(d, { type: 'key', name: 'enter' });
  assert.equal(d.state.view, 'step');
  assert.equal(d.state.fx.view, start.now);
  assert.equal(d.state.fx.open, start.now);
  // The next beat opens on the same view: a new beat, no new view.
  const next = at(d, { type: 'key', name: 'space' });
  assert.equal(d.state.pos.step, 1);
  assert.equal(d.state.fx.open, next.now);
  assert.equal(d.state.fx.view, start.now);
});

test('stamps: every key and paste is stamped as it arrives, a held letter too', () => {
  const d = driver();
  d.key('enter');
  d.key('enter');
  const h = at(d, { type: 'key', name: 'b', ch: 'b' });
  assert.equal(d.state.fx.key, h.now, 'stamped before the wrong-window hold');
  at(d, { type: 'flush', wait: DEFER_MS + 50 });
  assert.equal(d.state.fx.key, h.now, 'the hold acting later is not a new key');
  const paste = at(d, { type: 'paste', text: 'claude --version' });
  assert.equal(d.state.fx.key, paste.now);
  const tick = at(d, { type: 'tick' });
  assert.notEqual(d.state.fx.key, tick.now);
});

test('stamps: new text on the same card, a pass and a step\'s last pass', () => {
  const d = driver();
  d.key('enter');
  d.key('enter');
  d.key('space');
  // W2: one beat with a question. "It went wrong" is feedback: new text.
  const stuck = at(d, { type: 'key', name: '2', ch: '2' });
  assert.equal(d.state.beat.feedback.kind, 'stuck');
  assert.equal(d.state.fx.text, stuck.now);
  assert.equal(d.state.fx.pass, undefined);
  const right = at(d, { type: 'key', name: '1', ch: '1' });
  assert.equal(d.state.fx.text, right.now);
  assert.equal(d.state.fx.pass, right.now);
  assert.equal(d.state.fx.passLast, right.now, 'W2 has one beat: its pass ends the step');
  // W3 opens on a check: the status becomes opening.
  const open = at(d, { type: 'key', name: 'enter' });
  assert.equal(d.state.beat.status, 'opening');
  assert.equal(d.state.fx.check, open.now);
  assert.equal(d.state.fx.open, open.now);
  at(d, { type: 'check', lesson: 'b-1', items: [b1Item(null)] });
  const fail = at(d, { type: 'check', lesson: 'b-1', items: [b1Item('')] });
  assert.equal(d.state.beat.status, 'fail');
  assert.equal(d.state.fx.text, fail.now, 'a "Not yet" line');
  at(d, { type: 'key', name: 'h', ch: 'h' });
  const rung = at(d, { type: 'flush', wait: DEFER_MS + 50 });
  assert.equal(d.state.beat.rung, 0);
  assert.equal(d.state.fx.text, rung.now, 'a rung, when the held h acts');
  const done = at(d, { type: 'check', lesson: 'b-1', items: [b1Item('2.1.285 (Claude Code)\n')], evidence: '2.1.285 (Claude Code)' });
  assert.equal(d.state.beat.status, 'done');
  assert.equal(d.state.fx.pass, done.now);
  assert.equal(d.state.fx.passLast, done.now);
});

test('stamps: a guess and a shown answer are no pass, but a step they end is done all the same', () => {
  const d = driver({ saved: { format: 1, welcomed: true, lessons: { 'b-1': { step: 'W4', beat: 0 } } } });
  d.key('enter');
  at(d, { type: 'key', name: '2', ch: '2' });
  assert.equal(d.state.beat.status, 'done');
  assert.equal(d.state.fx.pass, undefined, 'a predict guess');
  assert.equal(d.state.fx.passLast, undefined, 'W4 goes on after its guess');
  const w5 = driver({ saved: { format: 1, welcomed: true, lessons: { 'b-1': { step: 'W5', beat: 0 } } } });
  w5.key('enter');
  at(w5, { type: 'key', name: '1', ch: '1' });
  const shown = at(w5, { type: 'key', name: 's', ch: 's' });
  const reveal = at(w5, { type: 'flush', wait: DEFER_MS + 50 });
  assert.equal(w5.state.beat.feedback.kind, 'revealed');
  assert.equal(w5.state.fx.pass, undefined, 'a shown answer');
  assert.ok(w5.state.fx.text > shown.now, 'the reveal is new text');
  assert.equal(w5.state.fx.passLast, reveal.now, 'W5 has one beat: the shown answer ends the step');
  // b-2 W1 ends on a guess: every guess ends the step, and the step cheers.
  for (const pick of ['1', '2']) {
    const g = driver({ course, saved: { format: 1, welcomed: true, lessons: { 'b-2': { step: 'W1', beat: 1, warm: [] } } } });
    g.key('enter');
    assert.equal(beatOfKind(g.state), 'predict');
    const guess = at(g, { type: 'key', name: pick, ch: pick });
    assert.equal(g.state.beat.status, 'done', pick);
    assert.equal(g.state.fx.pass, undefined, pick);
    assert.equal(g.state.fx.passLast, guess.now, pick);
    const p = phases(g.state, guess.now + 180, { motion: true });
    assert.deepEqual([p.cheer, p.stepDone, p.hop], [0.5, 180 / 560, 1], pick);
  }
  const p = phases(w5.state, reveal.now + 180, { motion: true });
  assert.deepEqual([p.cheer, p.stepDone, p.hop], [0.5, 180 / 560, 1], 'the same cheer after a shown answer');
});

test('stamps: a look at what the screen watches, and whether it changed; activity only while something is watched', () => {
  const d = driver({ saved: { format: 1, welcomed: true, lessons: { 'b-1': { step: 'W3', beat: 0 } } } });
  d.key('enter');
  const first = at(d, { type: 'check', lesson: 'b-1', items: [b1Item(null)] });
  assert.equal(d.state.fx.look, first.now);
  assert.equal(d.state.fx.changed, false, 'a first look has nothing to differ from');
  const same = at(d, { type: 'check', lesson: 'b-1', items: [b1Item(null)] });
  assert.equal(d.state.fx.look, same.now);
  assert.equal(d.state.fx.changed, false);
  const other = at(d, { type: 'check', lesson: 'b-1', items: [b1Item('')] });
  assert.equal(d.state.fx.look, other.now);
  assert.equal(d.state.fx.changed, true);
  at(d, { type: 'check', lesson: 'b-2', items: [] });
  assert.equal(d.state.fx.look, other.now, 'another lesson\'s result is not a look');
  const act = at(d, { type: 'activity' });
  assert.equal(d.state.fx.activity, act.now);
  // The look that passes ends the watch, and it differs from the last.
  const pass = at(d, { type: 'check', lesson: 'b-1', items: [b1Item('2.1.285 (Claude Code)\n')], evidence: '2.1.285 (Claude Code)' });
  assert.equal(d.state.beat.status, 'done');
  assert.equal(d.state.fx.look, pass.now);
  assert.equal(d.state.fx.changed, true, 'not yet, then done');
  assert.equal(d.state.fx.seen, undefined, 'nothing is watched now');

  const git = driver({ saved: { format: 1, welcomed: true, lessons: { 'b-1': { step: 'Y4', beat: 0 } } } });
  git.key('enter');
  at(git, { type: 'git', paths: ['notes.md'] });
  assert.equal(git.state.fx.changed, false);
  const clean = at(git, { type: 'git', paths: [] });
  assert.equal(git.state.fx.look, clean.now);
  assert.equal(git.state.fx.changed, true);
  // A new thing to watch: its first result has nothing to differ from.
  git.key('space');
  at(git, { type: 'git', paths: [] });
  git.key('enter');
  assert.equal(git.state.fx.check, git.state.fx.open, 'the Check opens on its check');
  at(git, { type: 'check', lesson: 'b-1', items: [b1Item(null)] });
  assert.equal(git.state.fx.changed, false, 'a check after a git look');

  const still = driver();
  still.key('enter');
  still.key('enter');
  at(still, { type: 'activity' });
  assert.equal(still.state.fx.activity, undefined, 'W1 watches nothing');
  at(still, { type: 'check', lesson: 'b-1', items: [b1Item(null)] });
  assert.equal(still.state.fx.look, undefined, 'a result for a screen that watches nothing');
});

test('stamps: run-start records the real child start and asks for nothing', () => {
  const d = driver({ saved: { format: 1, welcomed: true, lessons: { 'b-1': { step: 'W3', beat: 0 } } } });
  d.key('enter');
  const before = d.state;
  const run = at(d, { type: 'run-start' });
  assert.deepEqual(run.effects, []);
  assert.equal(d.state.fx.run, run.now);
  assert.deepEqual({ ...d.state, fx: null, now: null }, { ...before, fx: null, now: null }, 'nothing else changes');
});

test('stamps are never saved: learn.json after a run with stamps keeps its keys and FORMAT 1', () => {
  const d = driver({ course });
  playUntil(d, (s) => s.progress['b-2'].done.length >= 2);
  at(d, { type: 'run-start' });
  at(d, { type: 'activity' });
  assert.ok(Object.keys(d.state.fx).length > 3, 'the run left stamps');
  const data = snapshot(d.state);
  assert.doesNotMatch(JSON.stringify(data), /"fx"|"seen"|"passLast"/);
  // Every key of a saved file, nested keys too, as paths.
  const keys = (v, at = '') => (v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v).flatMap(([k, x]) => [`${at}${k}`, ...keys(x, `${at}${k}.`)]) : []);
  const saved = (state) => withRepo(() => repo(), (dir) => {
    mkdirSync(join(dir, '.practice'));
    saveState(dir, snapshot(state));
    return JSON.parse(readFileSync(storePath(dir), 'utf8'));
  });
  // The same place with no stamps at all: what the file held before motion.
  const before = saved({ ...d.state, fx: undefined });
  const after = saved(d.state);
  assert.deepEqual(keys(after), keys(before));
  assert.deepEqual(after, before);
  assert.equal(FORMAT, 1);
  assert.equal(after.format, 1);
});

test('the timing table is design 4.3\'s, and no one-shot lasts over 1.2 s', () => {
  const ms = {
    grid: 40, tick: 80, slowTick: 240, slowAfter: 10_000,
    entrance: 160, notYet: 360, hop: 240, cheer: 360, stepDone: 560, levelUp: 800, complete: 1_200, welcome: 480,
    spinnerFrom: 150, elapsedFrom: 3_000, sweep: 400, glance: 1_200, blink: 160, blinkEvery: 6_000,
    perWord: 400, graceMin: 3_000, graceMax: 20_000, keyQuiet: 4_000,
  };
  assert.deepEqual(TIMING, ms);
  for (const k of ['entrance', 'notYet', 'hop', 'cheer', 'stepDone', 'levelUp', 'complete', 'welcome', 'sweep', 'glance']) assert.ok(TIMING[k] <= 1_200, k);
});

test('a one-shot runs 0 to 1 over its time, and a later key ends it, but not the key that started it', () => {
  const s = { fx: {} };
  assert.equal(oneShot(s, 1_000, 1_000, 160), 0);
  assert.equal(oneShot(s, 1_080, 1_000, 160), 0.5);
  assert.equal(oneShot(s, 1_160, 1_000, 160), 1);
  assert.equal(oneShot(s, 5_000, 1_000, 160), 1);
  assert.equal(oneShot(s, Infinity, 1_000, 160), 1, 'the rest frame');
  assert.equal(oneShot(s, 1_080, undefined, 160), 1, 'nothing started');
  assert.equal(oneShot({ fx: { key: 1_000 } }, 1_080, 1_000, 160), 0.5, 'the key that started it');
  assert.equal(oneShot({ fx: { key: 900 } }, 1_080, 1_000, 160), 0.5, 'a key before it');
  assert.equal(oneShot({ fx: { key: 1_040 } }, 1_080, 1_000, 160), 1, 'a key after it');
});

// A beat of lesson 1 opened from a saved place, by an enter at a known time.
const opened = (step, beat = 0) => {
  const d = driver({ saved: { format: 1, welcomed: true, lessons: { 'b-1': { step, beat } } } });
  const { now } = at(d, { type: 'key', name: 'enter' });
  return { d, t: now };
};

test('ambient loops wait for the reading grace and the quiet after a key, and stop at idle and under an overlay', () => {
  const { d, t } = opened('W1');
  const s = d.state;
  assert.equal(ambientAllowed(s, t + TIMING.keyQuiet - 1), false, 'within 4 s of the enter');
  assert.equal(ambientAllowed(s, t + TIMING.graceMin - 1), false, 'the grace is at least 3 s');
  assert.equal(ambientAllowed(s, t + TIMING.graceMax), true, 'the grace is at most 20 s');
  assert.equal(ambientAllowed(s, t + IDLE_MS), false, 'idle');
  d.key('?');
  assert.equal(ambientAllowed(d.state, t + TIMING.graceMax), false, 'an overlay');
});

test('a file change ends the reading grace; a look does not', () => {
  const { d, t } = opened('W3');
  // W3's card holds far more than 12 words, so its grace outlasts the key quiet.
  at(d, { type: 'check', lesson: 'b-1', items: [b1Item(null)], wait: TIMING.keyQuiet });
  const later = t + TIMING.keyQuiet + 500;
  assert.equal(ambientAllowed(d.state, later), false, 'still reading');
  at(d, { type: 'activity', wait: 1 });
  assert.equal(ambientAllowed(d.state, later), true);
});

test('no ambient loop beside a question, a typed answer or the hint box', () => {
  const late = (s) => s.now + TIMING.graceMax + TIMING.keyQuiet;
  const q = opened('W2');
  assert.equal(ambientAllowed(q.d.state, late(q.d.state)), false, 'a question');
  q.d.key('1');
  assert.equal(ambientAllowed(q.d.state, late(q.d.state)), true, 'answered');
  const typed = driver({ saved: { format: 1, welcomed: true, lessons: { 'b-1': { step: 'C', beat: 1 } } } });
  typed.key('enter');
  assert.equal(typed.state.pos.beat, 1);
  assert.equal(ambientAllowed(typed.state, late(typed.state)), false, 'a typed answer');
  const hint = opened('W3');
  hint.d.send({ type: 'check', lesson: 'b-1', items: [b1Item(null)] });
  hint.d.send({ type: 'check', lesson: 'b-1', items: [b1Item('')] });
  assert.equal(ambientAllowed(hint.d.state, late(hint.d.state)), true, '"Not yet", no hint box');
  hint.d.key('h');
  assert.equal(hint.d.state.beat.rung, 0);
  assert.equal(ambientAllowed(hint.d.state, late(hint.d.state)), false, 'the hint box');
});

test('the reading grace is 400 ms a word of the newest text, at least 3 s and at most 20 s', () => {
  // A "Not yet" line from the check, with no key: its words size the grace.
  const notYet = (hint) => {
    const { d } = opened('W3');
    at(d, { type: 'check', lesson: 'b-1', items: [b1Item(null)], wait: 30_000 });
    const item = { ...b1Item(null), hint };
    const t = at(d, { type: 'check', lesson: 'b-1', items: [item], wait: 30_000 }).now;
    return { s: d.state, t };
  };
  const two = notYet('Not there.');
  assert.equal(two.s.fx.text, two.t);
  assert.equal(ambientAllowed(two.s, two.t + 2_999), false, '2 words still wait 3 s');
  assert.equal(ambientAllowed(two.s, two.t + 3_000), true);
  const ten = notYet('one two three four five six seven eight nine ten');
  assert.equal(ambientAllowed(ten.s, ten.t + 3_999), false, '10 words wait 4 s');
  assert.equal(ambientAllowed(ten.s, ten.t + 4_000), true);
  const long = notYet('word '.repeat(80).trim());
  assert.equal(ambientAllowed(long.s, long.t + 19_999), false);
  assert.equal(ambientAllowed(long.s, long.t + 20_000), true, '80 words wait 20 s, not 32');
  // Y2's "Yes, it asked again" answers with its 14-word because line.
  const y2 = opened('Y2');
  const pick = at(y2.d, { type: 'key', name: '1', ch: '1' });
  assert.equal(y2.d.state.beat.feedback.kind, 'option');
  assert.equal(ambientAllowed(y2.d.state, pick.now + 5_599), false);
  assert.equal(ambientAllowed(y2.d.state, pick.now + 5_600), true);
});

test('the welcome and the check-only card size their grace by their own words', () => {
  const d = driver();
  assert.equal(d.state.view, 'welcome');
  const t = d.state.fx.view;
  assert.equal(ambientAllowed(d.state, t + TIMING.graceMin), false, 'the welcome holds far more than 8 words');
  assert.equal(ambientAllowed(d.state, t + TIMING.graceMax), true);
  const map = driver();
  map.key('enter');
  map.key('m');
  map.key('down');
  const only = at(map, { type: 'key', name: 'enter' }).now;
  assert.equal(map.state.view, 'checkonly');
  assert.equal(ambientAllowed(map.state, only + TIMING.keyQuiet), false, 'its sentence and items take longer than the key quiet');
  assert.equal(ambientAllowed(map.state, only + TIMING.graceMax), true);
});

test('screens with no ambient part never allow one, and ask for no frame once their one-shots end', () => {
  const d = driver();
  d.key('enter');
  assert.equal(d.state.view, 'intro');
  const views = { intro: d.state };
  d.key('m');
  views.map = d.state;
  const up = driver();
  playUntil(up, (s) => s.view === 'levelup');
  views.levelup = up.state;
  playUntil(up, (s) => s.view === 'complete');
  views.complete = up.state;
  for (const [view, s] of Object.entries(views)) {
    assert.equal(s.view, view);
    const from = Math.max(s.fx.view, s.fx.key ?? -Infinity);
    for (const ms of [TIMING.complete, TIMING.graceMax + TIMING.keyQuiet]) {
      assert.equal(ambientAllowed(s, from + ms), false, `${view} at +${ms} ms`);
      assert.equal(nextChange(s, from + ms, { motion: true }), null, `${view} at +${ms} ms`);
    }
  }
});

const ON = { motion: true };
const OFF = { motion: false, calm: true };
const RESTING = { entrance: 1, notYet: 1, hop: 1, cheer: 1, stepDone: 1, levelUp: 1, complete: 1, welcome: 1, spinner: null, elapsed: null, ambient: false };

test('phases: the rest phases with motion off, at rest and under an overlay', () => {
  const { d, t } = opened('W3');
  for (const ms of [0, 80, 400, 30_000]) assert.deepEqual(phases(d.state, t + ms, OFF), RESTING, `+${ms} ms, motion off`);
  assert.deepEqual(phases(d.state, Infinity, ON), RESTING, 'the rest frame');
  d.send({ type: 'key', name: '?', wait: 7 });
  assert.deepEqual(phases(d.state, d.now + 40, ON), RESTING, 'an overlay freezes everything');
});

test('phases: a card enters over 160 ms, and a key after it ends the entrance', () => {
  const { d, t } = opened('W3');
  assert.equal(phases(d.state, t, ON).entrance, 0, 'the key that opened it does not end it');
  assert.equal(phases(d.state, t + 80, ON).entrance, 0.5);
  assert.equal(phases(d.state, t + 160, ON).entrance, 1);
  at(d, { type: 'key', name: 'x', ch: 'x', wait: 40 });
  assert.equal(phases(d.state, t + 80, ON).entrance, 1);
  // The check-only card enters too.
  const map = driver();
  map.key('enter');
  map.key('m');
  map.key('down');
  const only = at(map, { type: 'key', name: 'enter' }).now;
  assert.equal(map.state.view, 'checkonly');
  assert.equal(phases(map.state, only + 80, ON).entrance, 0.5);
});

test('phases: "Not yet" over 360 ms; a pass that ends its step cheers, any other pass hops', () => {
  const { d } = opened('W3');
  at(d, { type: 'check', lesson: 'b-1', items: [b1Item(null)] });
  const fail = at(d, { type: 'check', lesson: 'b-1', items: [b1Item('')] });
  assert.equal(phases(d.state, fail.now + 180, ON).notYet, 0.5);
  // A rung is new text too, but it plays no "Not yet".
  at(d, { type: 'key', name: 'h', ch: 'h' });
  const rung = at(d, { type: 'flush', wait: DEFER_MS + 50 }).now;
  assert.equal(d.state.fx.text, rung);
  assert.equal(phases(d.state, rung + 180, ON).notYet, 1);
  const pass = at(d, { type: 'check', lesson: 'b-1', items: [b1Item('2.1.285 (Claude Code)\n')], evidence: '2.1.285 (Claude Code)' });
  const done = phases(d.state, pass.now + 180, ON);
  assert.equal(done.cheer, 0.5);
  assert.equal(done.stepDone, 180 / 560);
  assert.equal(done.hop, 1);
  // The Check's first beat: its check passes, and two beats follow.
  const c = opened('C');
  const already = at(c.d, { type: 'check', lesson: 'b-1', items: [b1Item('2.1.285 (Claude Code)\n')] });
  assert.equal(c.d.state.beat.status, 'already');
  const hop = phases(c.d.state, already.now + 120, ON);
  assert.equal(hop.hop, 0.5);
  assert.equal(hop.cheer, 1);
});

test('phases: the welcome, a level-up and a lesson complete play from the view stamp', () => {
  const d = driver();
  assert.equal(phases(d.state, d.now + 240, ON).welcome, 0.5, 'the first screen, from the start');
  playUntil(d, (s) => s.view === 'levelup');
  assert.equal(phases(d.state, d.state.fx.view + 400, ON).levelUp, 0.5);
  playUntil(d, (s) => s.view === 'complete');
  assert.equal(phases(d.state, d.state.fx.view + 600, ON).complete, 0.5);
});

test('phases: the spinner turns from 150 ms after the child started while opening, slower after 10 s, with seconds from 3 s', () => {
  const { d, t } = opened('W3');
  assert.equal(phases(d.state, t + 1_000, ON).spinner, null, 'no child yet');
  const run = at(d, { type: 'run-start', wait: 500 }).now;
  const p = (ms) => phases(d.state, run + ms, ON);
  assert.equal(p(149).spinner, null);
  assert.equal(p(150).spinner, 0);
  assert.equal(p(230).spinner, 1);
  assert.equal(p(10_000).spinner, 123);
  assert.equal(p(10_240).spinner, 124);
  assert.equal(p(2_999).elapsed, null);
  assert.equal(p(3_000).elapsed, 3);
  assert.equal(p(4_500).elapsed, 4);
  at(d, { type: 'check', lesson: 'b-1', items: [b1Item(null)], wait: 200 });
  assert.equal(d.state.beat.status, 'waiting');
  assert.equal(p(400).spinner, null, 'the result landed');
  // A child from before the beat opened (the first look, on the resume
  // screen) says nothing about it.
  const early = driver({ saved: { format: 1, welcomed: true, lessons: { 'b-1': { step: 'W3', beat: 0 } } } });
  at(early, { type: 'run-start' });
  const open = at(early, { type: 'key', name: 'enter' }).now;
  assert.equal(early.state.beat.status, 'opening');
  assert.equal(phases(early.state, open + 1_000, ON).spinner, null);
});

test('phases: ambient follows ambientAllowed, and only with motion', () => {
  const { d, t } = opened('W1');
  assert.equal(phases(d.state, t + TIMING.graceMax, ON).ambient, true);
  assert.equal(phases(d.state, t + 1_000, ON).ambient, false);
  assert.equal(phases(d.state, t + TIMING.graceMax, OFF).ambient, false);
});

test('nextChange: null under calm, with an overlay, at idle, and when nothing moves and no deadline waits', () => {
  const { d, t } = opened('W3');
  at(d, { type: 'run-start', wait: 500 });
  for (const ms of [0, 10, 700, 20_000]) assert.equal(nextChange(d.state, t + ms, OFF), null, `calm, +${ms} ms`);
  assert.equal(nextChange(d.state, t + IDLE_MS, ON), null, 'idle, even with a child still running');
  assert.deepEqual(phases(d.state, t + IDLE_MS, ON), RESTING, 'and what idle draws is the rest frame, so no frame is owed');
  d.send({ type: 'tick', wait: IDLE_MS });
  assert.equal(d.state.beat.idle, true);
  assert.equal(nextChange(d.state, d.now, ON), null);
  const q = opened('W2');
  assert.equal(nextChange(q.d.state, q.t + 200, ON), null, 'a question: the entrance is over, and no loop may start');
  const w1 = opened('W1');
  assert.equal(nextChange(w1.d.state, w1.t + IDLE_MS, ON), null, 'idle');
  w1.d.send({ type: 'key', name: '?', wait: 7 });
  assert.equal(nextChange(w1.d.state, w1.d.now + 10, ON), null, 'an overlay');
});

test('nextChange: the next 40 ms frame of a one-shot, the spinner\'s start and ticks, and the seconds', () => {
  const { d, t } = opened('W3');
  assert.equal(nextChange(d.state, t, ON), 40, 'the entrance');
  assert.equal(nextChange(d.state, t + 10, ON), 30);
  const run = at(d, { type: 'run-start', wait: 500 }).now;
  const n = (ms) => nextChange(d.state, run + ms, ON);
  assert.equal(n(100), 50, 'the spinner starts at 150 ms');
  assert.equal(n(150), 80);
  assert.equal(n(190), 40);
  assert.equal(n(2_990), 10, 'the seconds appear at 3 s');
  assert.equal(n(9_995), 5, 'the seconds turn 10');
  assert.equal(n(10_000), 240, 'after 10 s the spinner turns every 240 ms');
  assert.equal(n(10_010), 230);
});

test('nextChange: the moment ambient loops may start is a deadline', () => {
  const { d, t } = opened('W1');
  const wait = nextChange(d.state, t + 200, ON);
  assert.ok(wait >= TIMING.keyQuiet - 200 && wait <= TIMING.graceMax - 200, String(wait));
  assert.equal(ambientAllowed(d.state, t + 200 + wait - 1), false);
  assert.equal(ambientAllowed(d.state, t + 200 + wait), true);
});

test('render, motion, art and flow read no clock and pick nothing at random', () => {
  for (const f of ['render.mjs', 'motion.mjs', 'art.mjs', 'flow.mjs']) {
    const src = readFileSync(join(root, 'learn', 'lib', f), 'utf8');
    for (const bad of [/Math\.random/, /Date\.now/, /performance\.now/, /new Date\b/]) assert.doesNotMatch(src, bad, `${f}: ${bad}`);
  }
});

// The screen writer (design 4.5), on an output stream and a clock the test
// holds. A frame is 24 rows of plain text here.
const page = (mark = '', at = -1) => Array.from({ length: 24 }, (_, i) => `row ${i + 1}${i === at ? mark : ''}`);
// `offs` counts the calls to onMotionOff.
const writer = (motion) => {
  const out = fakeOut();
  const clock = fakeClock();
  const w = { out, clock, offs: 0, bytes: () => out.writes.join('') };
  w.screen = openScreen(out, { motion, clock: clock.now, onMotionOff: () => { w.offs += 1; } });
  out.writes.length = 0;
  return w;
};

test('screen writer: an identical frame writes nothing, with motion on or off', () => {
  for (const motion of [true, false]) {
    const { out, screen } = writer(motion);
    screen.draw(page());
    assert.equal(out.writes.length, 1, 'the first frame');
    screen.draw(page());
    screen.draw(page());
    assert.equal(out.writes.length, 1, `motion ${motion}: the same frame again writes nothing`);
  }
});

test('screen writer: a still screen still gets one full frame every 10 s, so stray output is repaired', async () => {
  for (const motion of [true, false]) {
    const { out, clock, screen, bytes } = writer(motion);
    screen.draw(page());
    out.writes.length = 0;
    await clock.advance(9_999);
    screen.draw(page());
    assert.equal(out.writes.length, 0, 'before 10 s, nothing');
    await clock.advance(1);
    screen.draw(page());
    assert.equal(out.writes.length, 1, `motion ${motion}: at 10 s, a frame`);
    assert.ok(bytes().includes('\x1b[H'), 'a full frame, from home');
    const model = screenModel(80, 24);
    model.feed(bytes());
    assert.deepEqual(model.lines(), page());
    out.writes.length = 0;
    await clock.advance(5_000);
    screen.draw(page());
    assert.equal(out.writes.length, 0, 'the 10 s count starts again from that frame');
  }
});

// The rows a write moves the cursor to, 1-based, and whether it starts from home.
const rowsWritten = (bytes) => [...bytes.matchAll(/\x1b\[(\d+);1H/g)].map((m) => Number(m[1]));
const fromHome = (bytes) => bytes.includes('\x1b[H');

test('screen writer: with motion on, a one-row change writes that row alone, in one synchronized write', () => {
  const { out, screen, bytes } = writer(true);
  const model = screenModel(80, 24);
  screen.draw(page());
  model.feed(bytes());
  out.writes.length = 0;
  screen.draw(page(' changed', 6));
  assert.equal(out.writes.length, 1);
  const w = bytes();
  assert.deepEqual(rowsWritten(w), [7]);
  assert.equal(fromHome(w), false, 'no full frame');
  assert.ok(w.startsWith('\x1b[?2026h') && w.endsWith('\x1b[?2026l'), 'inside synchronized output');
  model.feed(w);
  assert.deepEqual(model.lines(), page(' changed', 6), 'the terminal shows the new frame');
});

test('screen writer: with motion off, a one-row change is a full frame, as today', () => {
  const { out, screen, bytes } = writer(false);
  screen.draw(page());
  out.writes.length = 0;
  screen.draw(page(' changed', 6));
  assert.equal(fromHome(bytes()), true);
  assert.deepEqual(rowsWritten(bytes()), []);
});

test('screen writer: when more than half the rows changed, a full frame goes out', () => {
  const { out, screen, bytes } = writer(true);
  const model = screenModel(80, 24);
  screen.draw(page());
  model.feed(bytes());
  const half = page().map((l, i) => (i < 12 ? `${l} x` : l));
  out.writes.length = 0;
  screen.draw(half);
  assert.equal(rowsWritten(bytes()).length, 12, 'half the rows: a row-diff');
  model.feed(bytes());
  const more = half.map((l, i) => (i < 13 ? `${l} y` : l));
  out.writes.length = 0;
  screen.draw(more);
  assert.equal(fromHome(bytes()), true, '13 of 24: a full frame');
  model.feed(bytes());
  assert.deepEqual(model.lines(), more);
});

test('screen writer: after clear(), the next frame is a full one, even the same frame', () => {
  for (const motion of [true, false]) {
    const { out, screen, bytes } = writer(motion);
    const model = screenModel(80, 24);
    screen.draw(page());
    model.feed(bytes());
    out.writes.length = 0;
    screen.clear();
    assert.equal(out.writes.length, 0, 'clear() itself writes nothing');
    screen.draw(page());
    assert.equal(fromHome(out.writes.at(-1) ?? ''), true, `motion ${motion}: the same frame, whole`);
    assert.ok(bytes().startsWith('\x1b[?2026h\x1b[2J\x1b[H'), 'and it clears the screen first, inside the synchronized write');
    model.feed(bytes());
    assert.deepEqual(model.lines(), page());
    out.writes.length = 0;
    screen.draw(page(' changed', 3));
    assert.doesNotMatch(bytes(), /\x1b\[2J/, 'the frame after it clears nothing');
    out.writes.length = 0;
    screen.clear();
    screen.draw(page(' changed', 6));
    assert.equal(fromHome(out.writes.at(-1) ?? ''), true, `motion ${motion}: a one-row change after clear(), whole`);
  }
});

test('screen writer: while a write is pending, only the newest frame is kept, and it goes out on drain', () => {
  for (const motion of [true, false]) {
    const { out, clock, screen, bytes } = writer(motion);
    const model = screenModel(80, 24);
    out.full = true;
    screen.draw(page());
    assert.equal(out.writes.length, 1, 'the write that came back false');
    assert.equal(screen.wroteAt, clock.now(), 'wroteAt: when the last write began');
    screen.draw(page(' a', 3));
    screen.draw(page(' b', 3));
    screen.draw(page(' c', 5));
    assert.equal(out.writes.length, 1, `motion ${motion}: nothing more while it is pending`);
    clock.spend(30);
    out.drain();
    assert.equal(out.writes.length, 2, 'one frame on drain');
    assert.equal(screen.wroteAt, clock.now(), 'the drain write is the last write now');
    model.feed(bytes());
    assert.deepEqual(model.lines(), page(' c', 5), 'the newest');
    out.drain();
    assert.equal(out.writes.length, 2, 'a second drain writes nothing');
  }
});

// A writer whose writes take `cost(n)` ms on the fake clock, n counting from 1.
const slowWriter = (cost) => {
  const w = writer(true);
  const write = w.out.write;
  let n = 0;
  w.out.write = (chunk) => {
    n += 1;
    w.clock.spend(cost(n));
    return write(chunk);
  };
  return w;
};

test('screen writer: when 3 of the last 10 motion frames took over 12 ms, motion stops for the sitting', () => {
  // Frame n is page(n): each a one-row change from the one before.
  const frames = (screen, from, to) => { for (let n = from; n <= to; n++) screen.draw(page(` ${n}`, n % 24)); };
  const two = slowWriter((n) => (n === 1 || n === 5 ? 13 : 12));
  frames(two.screen, 1, 20);
  assert.equal(two.screen.motion, true, 'two slow frames, and 12 ms is not over 12');
  const apart = slowWriter((n) => ([1, 5, 12].includes(n) ? 13 : 1));
  frames(apart.screen, 1, 20);
  assert.equal(apart.screen.motion, true, 'frames 1 and 12 are 11 apart: never 3 in 10');
  const three = slowWriter((n) => ([2, 6, 11].includes(n) ? 20 : 1));
  frames(three.screen, 1, 10);
  assert.equal(three.screen.motion, true, 'two so far');
  assert.equal(three.offs, 0);
  frames(three.screen, 11, 11);
  assert.equal(three.screen.motion, false, 'frames 2, 6 and 11 are in the last 10');
  assert.equal(three.offs, 1, 'onMotionOff, so the rest frame can go up');
  three.out.writes.length = 0;
  frames(three.screen, 12, 12);
  assert.equal(fromHome(three.bytes()), true, 'after that, every frame is full');
  frames(three.screen, 13, 40);
  assert.equal(three.screen.motion, false, 'for the sitting');
  assert.equal(three.offs, 1, 'and only once');
});

test('screen writer: a drain over 100 ms twice in 10 s stops motion; one false write does not', async () => {
  // A frame whose write comes back false, then a drain `ms` later.
  const backlog = async (w, n, ms) => {
    w.out.full = true;
    w.screen.draw(page(` ${n}`, n));
    await w.clock.advance(ms);
    w.out.drain();
  };
  const once = writer(true);
  await backlog(once, 1, 400);
  assert.equal(once.screen.motion, true, 'one slow drain is a sample, not a trend');
  await once.clock.advance(4_000);
  await backlog(once, 2, 90);
  assert.equal(once.screen.motion, true, 'a drain of 90 ms is not slow');
  await once.clock.advance(6_000);
  await backlog(once, 3, 150);
  assert.equal(once.screen.motion, true, 'the slow drains are over 10 s apart');
  await once.clock.advance(3_000);
  assert.equal(once.offs, 0);
  await backlog(once, 4, 101);
  assert.equal(once.screen.motion, false, 'two slow drains within 10 s');
  assert.equal(once.offs, 1, 'onMotionOff, so the rest frame can go up');
  once.out.writes.length = 0;
  once.screen.draw(page(' 5', 5));
  assert.equal(fromHome(once.bytes()), true, 'after that, every frame is full');
});
