// When the screen moves: one-shot progress, the gates for ambient loops, and
// the time until the next frame. Pure: it reads no clock and picks nothing at
// random. The time comes in as `at`, the stamps as `s.fx` (flow.mjs).
import { C } from './copy.mjs';
import { beatOf, IDLE_MS, isDone, lessonOf, stepOf } from './flow.mjs';

// The frame at rest: what every screen draws when nothing moves.
export const REST = { at: Infinity };

// Every timing of the motion layer, in milliseconds (design 4.3). Frames land
// on the 40 ms grid; loops tick every 80 ms, and every 240 ms after 10 s.
export const TIMING = {
  grid: 40, tick: 80, slowTick: 240, slowAfter: 10_000,
  // One-shots: none lasts over 1.2 s.
  entrance: 160, notYet: 360, hop: 240, cheer: 360, stepDone: 560, levelUp: 800, complete: 1_200, welcome: 480,
  // A check or git child: the spinner from 150 ms, its seconds from 3 s.
  spinnerFrom: 150, elapsedFrom: 3_000,
  // A file change: the sweep and Pip's glance. Pip's blink, every 6 s.
  sweep: 400, glance: 1_200, blink: 160, blinkEvery: 6_000,
  // The reading grace: 400 ms a word of the newest text, 3 s to 20 s; and
  // the quiet after a key.
  perWord: 400, graceMin: 3_000, graceMax: 20_000, keyQuiet: 4_000,
};

// One-shot progress 0..1; 1 once a later key arrived.
export function oneShot(s, at, start, ms) {
  if (start === undefined || s.fx?.key > start) return 1;
  return Math.min(1, Math.max(0, (at - start) / ms));
}

const NEVER = -Infinity;
const words = (text) => (text.match(/\S+/g) ?? []).length;

// The screens with an ambient part: Pip's blink on the welcome and on a card
// with nothing to answer or watch, the look marker while a card watches.
const AMBIENT = ['welcome', 'step', 'checkonly'];

// An overlay, or idle: nothing moves, and no frame is asked for.
const frozen = (s, at) => Boolean(s.overlay || s.beat?.idle || at - s.lastActivity >= IDLE_MS);

// The words of the newest text: on a step card a "Not yet" line or feedback
// that came after the card opened, else the card itself; on the welcome and
// the check-only card, their own words. A rung needs no count: the hint box
// holds ambient loops anyway.
function newestWords(s) {
  if (s.view === 'welcome') {
    return words([C.hi(s.facts.name), C.pip1, C.pip2, C.twoWindows, C.thisWindow, ...C.thisWindowLines, C.otherWindow, ...C.otherWindowLines, C.openSecond, C.comeBack].join(' '));
  }
  if (s.view === 'checkonly') return words([...C.checkOnly, ...lessonOf(s).items].join(' '));
  const st = s.beat;
  if (s.view !== 'step' || !st) return 0;
  const fx = s.fx;
  if (fx.text > Math.max(fx.open ?? NEVER, fx.view ?? NEVER)) {
    if (st.status === 'fail') return words(st.fail.hint ?? st.fail.paths.join(' '));
    return words(st.feedback?.because ?? '');
  }
  const beat = beatOf(s);
  return words([stepOf(s).title, ...beat.lines.map((l) => l.text), beat.ask ?? '', ...beat.options.map((o) => o.text)].join(' '));
}

// Reading that needs an answer: a question with its options, a typed
// answer, the y/n before the exact command, or the hint box.
const answering = (s) => s.view === 'step' && Boolean(s.beat) && !isDone(s.beat) && (Boolean(beatOf(s).ask) || s.beat.rung >= 0 || s.beat.confirm);

// Whether ambient loops (look marker, blink) may draw: not during the reading
// grace (400 ms a word of the newest text, 3 s to 20 s, ended by an activity
// stamp), not within 4 s of a key, not at idle, not with an overlay, not
// beside a question, options, a typed answer or the hint box. The spinner and
// bounce never ask it: they follow the running child, and stop for an overlay.
export function ambientAllowed(s, at) {
  if (!AMBIENT.includes(s.view) || frozen(s, at)) return false;
  return at >= quietFrom(s) && !answering(s);
}

// When the reading grace and the quiet after the last key are both over.
function quietFrom(s) {
  const fx = s.fx;
  const newest = Math.max(fx.view ?? NEVER, fx.open ?? NEVER, fx.text ?? NEVER);
  const grace = fx.activity > newest ? NEVER : newest + Math.min(TIMING.graceMax, Math.max(TIMING.graceMin, newestWords(s) * TIMING.perWord));
  return Math.max(grace, (fx.key ?? NEVER) + TIMING.keyQuiet);
}

// What every moving part draws at rest, and while frozen: each one-shot at
// its end (1), no spinner, no seconds, no ambient loop.
export const REST_PHASES = Object.freeze({ entrance: 1, notYet: 1, hop: 1, cheer: 1, stepDone: 1, levelUp: 1, complete: 1, welcome: 1, spinner: null, elapsed: null, ambient: false });

// Since when a check or git child has run for the beat on screen while it is
// `opening`: a child that started before the status became `opening` is not
// this beat's.
const childSince = (s) => (s.beat?.status === 'opening' && s.fx.run >= s.fx.check ? s.fx.run : undefined);

// When each one-shot on this screen started, or undefined where it does not
// play. Each lasts its own TIMING entry.
function shotStarts(s) {
  const fx = s.fx;
  const on = (views, start) => (views.includes(s.view) ? start : undefined);
  const entered = Math.max(fx.view ?? NEVER, fx.open ?? NEVER);
  const st = s.view === 'step' ? s.beat : null;
  const opened = fx.open ?? NEVER;
  // The step's last beat done on this card cheers; any other pass hops.
  const last = isDone(st) && fx.passLast > opened;
  return {
    entrance: on(['step', 'checkonly'], entered === NEVER ? undefined : entered),
    // A rung is new text too, but no "Not yet".
    notYet: st?.status === 'fail' && st.rung < 0 ? fx.text : undefined,
    hop: isDone(st) && !last && fx.pass > opened ? fx.pass : undefined,
    cheer: last ? fx.passLast : undefined,
    stepDone: last ? fx.passLast : undefined,
    levelUp: on(['levelup'], fx.view),
    complete: on(['complete'], fx.view),
    welcome: on(['welcome'], fx.view),
  };
}

// What each moving part draws at `at`; the rest phases when motion is off.
export function phases(s, at, caps) {
  if (!caps?.motion || at === Infinity || frozen(s, at)) return REST_PHASES;
  const since = childSince(s);
  const ran = since === undefined ? NEVER : at - since;
  const spinner = ran < TIMING.spinnerFrom ? null
    : Math.floor((Math.min(ran, TIMING.slowAfter) - TIMING.spinnerFrom) / TIMING.tick) + Math.floor(Math.max(0, ran - TIMING.slowAfter) / TIMING.slowTick);
  const shots = Object.fromEntries(Object.entries(shotStarts(s)).map(([part, start]) => [part, oneShot(s, at, start, TIMING[part])]));
  return {
    ...shots,
    spinner,
    elapsed: spinner !== null && ran >= TIMING.elapsedFrom ? Math.floor(ran / 1_000) : null,
    ambient: ambientAllowed(s, at),
  };
}

// Milliseconds until the screen next differs, or null. Null under calm,
// with an overlay, at idle, and when nothing moves and no deadline waits.
export function nextChange(s, at, caps) {
  if (!caps?.motion || frozen(s, at)) return null;
  const times = [];
  // A one-shot still playing: its next frame on the 40 ms grid from its start.
  for (const [part, start] of Object.entries(shotStarts(s))) {
    if (oneShot(s, at, start, TIMING[part]) < 1) times.push(TIMING.grid - ((at - start) % TIMING.grid));
  }
  const since = childSince(s);
  if (since !== undefined) {
    const ran = at - since;
    let tick = ran < TIMING.spinnerFrom ? TIMING.spinnerFrom : TIMING.spinnerFrom + TIMING.tick * (Math.floor((ran - TIMING.spinnerFrom) / TIMING.tick) + 1);
    // Past 10 s the 80 ms ticks stop moving it: every 240 ms does.
    if (tick > TIMING.slowAfter) tick = TIMING.slowAfter + TIMING.slowTick * (Math.floor(Math.max(0, ran - TIMING.slowAfter) / TIMING.slowTick) + 1);
    const second = ran < TIMING.elapsedFrom ? TIMING.elapsedFrom : 1_000 * (Math.floor(ran / 1_000) + 1);
    times.push(tick - ran, second - ran);
  }
  // The moment ambient loops may start, on a screen that has one: the grace
  // and the key quiet both over.
  const quiet = quietFrom(s);
  if (AMBIENT.includes(s.view) && !answering(s) && quiet > at) times.push(quiet - at);
  return times.length ? Math.min(...times) : null;
}
