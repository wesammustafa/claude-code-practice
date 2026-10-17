// When the screen moves: one-shot progress, the gates for ambient loops, and
// the time until the next frame. Pure: it reads no clock and picks nothing at
// random. The time comes in as `at`, the stamps as `s.fx` (flow.mjs).
import { GIT } from './content.mjs';
import { C } from './copy.mjs';
import { beatOf, checkOnlyWords, GRACE_MAX_MS, hidesRuns, IDLE_MS, isDone, lessonOf, stepOf, watching } from './flow.mjs';

// The frame at rest: what every screen draws when nothing moves.
export const REST = { at: Infinity };

// Every timing of the motion layer, in milliseconds (design 4.3). Frames land
// on the 40 ms grid; loops tick every 80 ms, and every 240 ms after 10 s.
// The moments inside each one-shot are its SHOTS entry, below.
export const TIMING = {
  grid: 40, tick: 80, slowTick: 240, slowAfter: 10_000,
  // One-shots: none lasts over 1.2 s but Pip's greeting on the welcome and
  // resume, and its look around on the complete screen once the rest is
  // still (176).
  entrance: 160, notYet: 360, hop: 240, cheer: 360, stepDone: 560, levelUp: 800, complete: 1_200, welcome: 480, itemPass: 160, greet: 5_000, lookAround: 2_400,
  // A check or git child: the spinner from 150 ms, its seconds from 3 s.
  spinnerFrom: 150, elapsedFrom: 3_000,
  // A file change: the sweep and Pip's glance. Pip's blink, every 6 s.
  sweep: 400, glance: 1_200, blink: 160, blinkEvery: 6_000,
  // The reading grace: 400 ms a word of the newest text, 3 s to 20 s; and
  // the quiet after a key.
  perWord: 400, graceMin: 3_000, graceMax: GRACE_MAX_MS, keyQuiet: 4_000,
};

// The look marker's notches across the pulse line.
export const NOTCHES = 12;

// The moments inside each one-shot (design 2.3 and 4.3), under the same names
// as its TIMING entry, which it rests at: `every`, how often its frame may
// change, where the tests sample it, and the moments it changes at, in ms
// from its start.
export const SHOTS = {
  // The top rule grows from the pill, a third a frame, until Pip lands at
  // `land`; the trail's new stop is hollow until then, then a ring.
  entrance: { every: 40, land: 80 },
  // The line's mark is hollow until `pop`; Pip opens both eyes at the
  // learner from `nod` to the end, then wears its worried face again.
  notYet: { every: 80, pop: 80, nod: 160 },
  hop: { every: 240 },
  cheer: { every: 360 },
  // The stop is a spark until `pop`, when its link half fills; by `fill`
  // the link and the progress rule are whole. Each command without a tick
  // gets one, a `tick` apart. From `strokes` the check mark draws a stroke
  // every `stroke`, then the sparks.
  stepDone: { every: 40, pop: 120, fill: 240, tick: 120, strokes: 320, stroke: 80 },
  // Pip's eyes are shut until `open`, and the banner wipes in until `whole`,
  // when Pip wears its focus face. Then the arrow fills a third every `fill`
  // and its head and the new star land at `head`.
  levelUp: { every: 40, open: 240, whole: 480, fill: 80, head: 720 },
  // The confetti changes every `fall`: from 24 rows it falls across its row
  // and the blank under it, below 24 it appears `first` glyphs, then `more`
  // at a time. Pip cheers with sparks, and COMPLETE stamps in, until `whole`.
  // The ticks appear in turn from `ticks` to `ticksBy`, each on the 40 ms
  // grid, so with five the gaps are 80 and 40 ms in turn. From `light` one
  // light runs the whole trail by the last frame before the end.
  complete: { every: 40, fall: 400, first: 2, more: 3, whole: 480, ticks: 560, ticksBy: 800, light: 840 },
  // The fuse lights more of the path every `fuse`, a link at a time on
  // Beginner's five, and reaches the cup at `cup`; from `pulse` one pulse
  // crosses the arrow, a cell every `cell`. Pip wakes in its greeting.
  welcome: { every: 80, fuse: 80, cup: 320, pulse: 320, cell: 80 },
  // Pip's greeting on the welcome and resume (176). On the welcome the 9x4
  // Pip's eyes open at `waking` and are awake at `awake` (the boot frame's
  // wake-up too); on resume it starts awake. It looks left at `left`, right
  // at `right` and up at `up`; from `wave` its eyes are happy and its
  // antenna row sparks every other `swing`, until `back`; it blinks from
  // `blink` to `open`, and is awake to the end. It plays once per opening
  // of the app (flow.mjs stamps fx.greet).
  // The detailed Pip's, `raster`, a frame every `every`: its eyes are wide
  // and its antenna flicks once until `wide`; then its eyes ease happy by
  // `glad`, and its antenna waves, a swing every `swing`, whole by `waved`.
  // It hops at each of `hops`, for `hop`, with a spark. Its eyes ease open
  // from `open` to `look`, look left then right until `up`, up until
  // `again`, and ease happy again by the second hop. From `back` all of it
  // eases back to the pose, which it reaches at the end.
  greet: {
    every: 80, waking: 80, awake: 160, left: 640, right: 1_040, up: 1_440, wave: 1_840, swing: 320, back: 3_760, blink: 4_240, open: 4_560,
    raster: { every: 40, wide: 300, glad: 700, waved: 800, swing: 1_100, hops: [700, 3_300], hop: 450, open: 1_200, look: 1_500, up: 2_500, again: 3_000, back: 4_500 },
  },
  // On the complete screen, after the cheer and once the rest is still,
  // Pip looks left from `left`, back from `back` and right from `right`,
  // with its happy eyes between and at the end (176).
  lookAround: { every: 400, left: 1_200, back: 1_600, right: 2_000 },
  // On the check-only card, the mark of an item that starts passing is
  // hollow until `pop`, then a ring, then the check mark.
  itemPass: { every: 80, pop: 80 },
  // One segment crosses the pulse line, a fifth of the way each frame.
  sweep: { every: 80 },
  // Pip looks toward the other window, then back: one change each way.
  glance: { every: 1_200 },
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

// An overlay, or idle: no one-shot and no ambient loop moves. Only an
// overlay stops the spinner, its seconds and the bounce: they show a child
// that is still running (for at most 150 s an item).
const idle = (s, at) => Boolean(s.beat?.idle || at - s.lastActivity >= IDLE_MS);
export const frozen = (s, at) => Boolean(s.overlay) || idle(s, at);

// The words of the newest text: on a step card a "Not yet" line or feedback
// that came after the card opened, else the card itself; on the welcome and
// the check-only card, their own words. A rung needs no count: the hint box
// holds ambient loops anyway.
function newestWords(s) {
  if (s.view === 'welcome') {
    return words([C.hi(s.facts.name), C.pip1, C.pip2, C.twoWindows, C.thisWindow, ...C.thisWindowLines, C.otherWindow, ...C.otherWindowLines, C.openSecond, C.comeBack].join(' '));
  }
  if (s.view === 'checkonly') return words([...checkOnlyWords(s, lessonOf(s)), ...lessonOf(s).items].join(' '));
  const st = s.beat;
  if (s.view !== 'step' || !st) return 0;
  const fx = s.fx;
  if (fx.text > Math.max(fx.open ?? NEVER, fx.view ?? NEVER)) {
    if (st.status === 'fail') return words(st.fail.hint ?? st.fail.paths.join(' '));
    return words(st.feedback?.because ?? '');
  }
  const beat = beatOf(s);
  // A code block counts the lines the card shows: its window, the Windows
  // line in its place, or nothing where it waits behind h.
  const shown = (l) => (l.key !== 'code' ? l.text : hidesRuns(s) ? '' : (s.facts.win32 && l.win) || l.lines.slice(l.from - 1, l.to).join(' '));
  return words([stepOf(s).title, ...beat.lines.map(shown), beat.ask ?? '', ...beat.options.map((o) => o.text)].join(' '));
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

// The detailed Pip's three gates for its controller at `at` (s null on the
// boot frame), the same for its pose and its next frame in one draw. No
// motion with the screen's motion off (calm, NO_COLOR, plain, TERM=dumb, a
// tripped write budget), with an overlay or at idle; its ambient life
// (blinks, glances, twitches) only where ambientAllowed says; breathing, a
// redraw every 120 ms, only on a local truecolor terminal.
export function pipGates(s, at, { motion, truecolor, remote }) {
  const moving = motion && !(s && frozen(s, at));
  const ambient = moving && Boolean(s) && ambientAllowed(s, at);
  return { motion: moving, ambient, breathing: ambient && truecolor && !remote };
}

// Where the look marker stands: from the left, one notch on for each look
// that landed once it may show, round again after the last; null before the
// first. flow.mjs counts the looks since the newest stamp that holds it back
// or starts it again (a sweep's among them), with the times of those the
// gates can still hold back: a look before the gates opened moves nothing.
function lookNotch(s) {
  const looks = s.fx.looks;
  if (!looks || !watching(s)) return null;
  const from = quietFrom(s);
  const n = looks.n - looks.early.filter((x) => x < from).length;
  return n > 0 ? (n - 1) % NOTCHES : null;
}

// Where Pip blinks: the welcome, and a step card that watches nothing and
// is not its step's done (Pip wears its done face there). ambientAllowed
// keeps it from a card with something to answer.
function blinks(s) {
  if (s.view === 'welcome') return true;
  if (s.view !== 'step' || !s.beat || watching(s)) return false;
  return !(isDone(s.beat) && s.pos.beat === stepOf(s).beats.length - 1);
}

// When the reading grace and the quiet after the last key are both over.
// flow.mjs counts the marker's looks from the newest stamp this reads, and
// keeps 20 s of them: the key quiet is shorter than the longest grace.
function quietFrom(s) {
  const fx = s.fx;
  const newest = Math.max(fx.view ?? NEVER, fx.open ?? NEVER, fx.text ?? NEVER);
  const grace = fx.activity > newest ? NEVER : newest + Math.min(TIMING.graceMax, Math.max(TIMING.graceMin, newestWords(s) * TIMING.perWord));
  return Math.max(grace, (fx.key ?? NEVER) + TIMING.keyQuiet);
}

// When a screen's ambient gates last opened, or will: the end of the
// reading grace or of the quiet after a key. (A file change that ends idle
// opens them too, at no new moment of these.)
export const ambientOpened = (s) => quietFrom(s);

// How far into the blink cycle `at` is: shut for the first 160 ms of every
// 6 s from the moment the gates opened.
const blinkInto = (s, at) => (at - quietFrom(s)) % TIMING.blinkEvery;

// What every moving part draws at rest, and while frozen: each one-shot at
// its end (1), no spinner, no seconds, no ambient loop: no look marker
// (`look`, its notch) and no blink, so nothing in `ms`. `checking`: Pip
// wears its checking face whenever the card says "Checking"; with motion,
// only once the spinner turns.
export const REST_PHASES = Object.freeze({ entrance: 1, notYet: 1, hop: 1, cheer: 1, stepDone: 1, levelUp: 1, complete: 1, welcome: 1, itemPass: 1, greet: 1, lookAround: 1, sweep: 1, glance: 1, spinner: null, elapsed: null, checking: true, ambient: false, look: null, blink: false, ms: Object.freeze({}) });

// Since when a check or git child has run for the beat on screen while it is
// `opening`, or for r on the check-only card: a child that started before
// the status became `opening`, or before r, is not this run, and a file read
// starts none. Its first tick is the first 40 ms boundary from its start
// once it has run 150 ms, then one every 80 ms.
const CHILD = ['check', ...GIT];
const FIRST_TICK = Math.ceil(TIMING.spinnerFrom / TIMING.grid) * TIMING.grid;
const checkingChild = (s) => (s.view === 'step' && s.beat?.status === 'opening' && CHILD.includes(beatOf(s).verify.kind))
  || (s.view === 'checkonly' && s.checkOnlyRun?.lesson === s.lesson);
const childSince = (s) => (checkingChild(s) && s.fx.run >= s.fx.check ? s.fx.run : undefined);

// When the latest sweep started: the watcher saw a file change, or a look's
// result differed from the last. Only while the screen watches something,
// and not beside the hint box.
function sweepFrom(s) {
  if (!watching(s) || answering(s)) return undefined;
  const start = Math.max(s.fx.activity ?? NEVER, s.fx.changedAt ?? NEVER);
  return start === NEVER ? undefined : start;
}

// When each one-shot on this screen started, or undefined where it does not
// play. Each lasts its own TIMING entry.
export function shotStarts(s) {
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
    // Pip's greeting, once per opening: on the arrival flow.mjs stamped
    // for it, not on a later return to the welcome or resume.
    greet: fx.greet === fx.view ? on(['welcome', 'resume'], fx.greet) : undefined,
    lookAround: on(['complete'], fx.view),
    itemPass: on(['checkonly'], fx.itemPass),
    sweep: sweepFrom(s),
    // A file change: Pip glances toward the other window, until a newer
    // "Not yet", hop or cheer turns Pip back to the card.
    glance: watching(s) && !answering(s) && fx.activity > Math.max(fx.text ?? NEVER, fx.pass ?? NEVER, fx.passLast ?? NEVER) ? fx.activity : undefined,
  };
}

// Milliseconds until the detailed Pip's greeting next moves (176): its next
// frame or its end; null where it does not play or is over, with motion
// off, an overlay or at idle. main adds it to the one timer where it draws
// the detailed Pip.
export function greetFrameIn(s, at, caps) {
  if (!caps?.motion || s.overlay || idle(s, at)) return null;
  return shotFrameIn(s, at, 'greet', shotStarts(s).greet, SHOTS.greet.raster.every);
}

// The spinner's frame and the seconds, for a child that has run `ran` ms:
// null for each until it shows.
function spun(ran) {
  const spinner = ran < FIRST_TICK ? null
    : Math.floor((Math.min(ran, TIMING.slowAfter) - FIRST_TICK) / TIMING.tick) + Math.floor(Math.max(0, ran - TIMING.slowAfter) / TIMING.slowTick);
  return { spinner, elapsed: spinner !== null && ran >= TIMING.elapsedFrom ? Math.floor(ran / 1_000) : null };
}

// Milliseconds until that child's spinner next turns, and until its seconds next change.
function spinsIn(ran) {
  let tick = ran < FIRST_TICK ? FIRST_TICK : FIRST_TICK + TIMING.tick * (Math.floor((ran - FIRST_TICK) / TIMING.tick) + 1);
  // Past 10 s the 80 ms ticks stop moving it: every 240 ms does.
  if (tick > TIMING.slowAfter) tick = TIMING.slowAfter + TIMING.slowTick * (Math.floor(Math.max(0, ran - TIMING.slowAfter) / TIMING.slowTick) + 1);
  const second = ran < TIMING.elapsedFrom ? TIMING.elapsedFrom : 1_000 * (Math.floor(ran / 1_000) + 1);
  return [tick - ran, second - ran];
}

// The boot frame (162): git's first questions at start, asked at `since`.
// It goes up on the spinner's first tick, once they have run 150 ms, with
// Pip's eyes shut, and Pip wakes as on the welcome. Without motion it is the
// rest frame: Pip awake, no spinner.
export const BOOT_FROM = FIRST_TICK;
export function bootPhases(since, at, caps) {
  if (!caps?.motion || at === Infinity) return REST_PHASES;
  const woke = at - since - BOOT_FROM;
  const eyes = woke < SHOTS.greet.waking ? 'shut' : woke < SHOTS.greet.awake ? 'waking' : undefined;
  return { ...REST_PHASES, ...spun(at - since), eyes };
}
// Milliseconds until the boot frame next differs, or null without motion.
export function bootChange(since, at, caps) {
  if (!caps?.motion) return null;
  const woke = at - since - BOOT_FROM;
  return Math.min(...spinsIn(at - since), ...[SHOTS.greet.waking, SHOTS.greet.awake].filter((ms) => ms > woke).map((ms) => ms - woke));
}

// What each moving part draws at `at`; the rest phases when motion is off.
// `ms`: how far into each one-shot still playing `at` is, and into a blink
// while one is on, in the clock's own milliseconds, unrounded.
export function phases(s, at, caps) {
  if (!caps?.motion || at === Infinity || s.overlay) return REST_PHASES;
  const since = childSince(s);
  const { spinner, elapsed } = spun(since === undefined ? NEVER : at - since);
  const still = idle(s, at);
  const starts = Object.entries(shotStarts(s));
  const shots = Object.fromEntries(starts.map(([part, start]) => [part, still ? 1 : oneShot(s, at, start, TIMING[part])]));
  const ms = Object.fromEntries(starts.filter(([part]) => shots[part] < 1).map(([part, start]) => [part, Math.max(0, at - start)]));
  // While a child runs, its bounce holds the pulse line: no ambient loop.
  const ambient = !still && spinner === null && ambientAllowed(s, at);
  // A blink as the gates open, then every 6 s.
  const blink = ambient && blinks(s) && blinkInto(s, at) < TIMING.blink;
  if (blink) ms.blink = blinkInto(s, at);
  return {
    ...shots,
    spinner,
    elapsed,
    checking: spinner !== null,
    ambient,
    look: ambient && shots.sweep === 1 ? lookNotch(s) : null,
    blink,
    ms,
  };
}

// A one-shot still playing from `start`: milliseconds until its next frame,
// every `every` from its start (on the 40 ms grid), or its end; null once
// it is over or a key ended it.
function shotFrameIn(s, at, part, start, every) {
  if (oneShot(s, at, start, TIMING[part]) >= 1) return null;
  return Math.min(every - ((at - start) % every), start + TIMING[part] - at);
}

// Milliseconds until the screen next differs, or null. Null under calm,
// with an overlay, at idle unless a child runs, and when nothing moves and
// no deadline waits.
export function nextChange(s, at, caps) {
  if (!caps?.motion || s.overlay) return null;
  const still = idle(s, at);
  const times = [];
  // A one-shot still playing: its next frame, or its end.
  if (!still) {
    for (const [part, start] of Object.entries(shotStarts(s))) {
      const next = shotFrameIn(s, at, part, start, SHOTS[part].every);
      if (next !== null) times.push(next);
    }
  }
  const since = childSince(s);
  if (since !== undefined) times.push(...spinsIn(at - since));
  // The moment ambient loops may start, on a screen that has one: the grace
  // and the key quiet both over. Once they run, each blink's start and end.
  // The look marker moves only on a look, and the app's 1 s tick draws the
  // first idle frame, where it stops.
  const quiet = quietFrom(s);
  if (!still && AMBIENT.includes(s.view) && !answering(s) && quiet > at) times.push(quiet - at);
  if (!still && ambientAllowed(s, at) && blinks(s)) {
    const e = blinkInto(s, at);
    times.push(e < TIMING.blink ? TIMING.blink - e : TIMING.blinkEvery - e);
  }
  return times.length ? Math.min(...times) : null;
}
