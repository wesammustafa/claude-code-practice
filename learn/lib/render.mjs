// Draws a state as exactly `rows` lines, none wider than `cols - 1`. Four
// regions: the header (where am I), the body (what to do now, with how it's
// going at the bottom of the card), and the key bar pinned to the bottom.
import { banner, bannerWidth, burst, confetti, pip, PIP_FACE, pipFace } from './art.mjs';
import { C } from './copy.mjs';
import { bootPhases, NOTCHES, phases, REST, SHOTS, TIMING } from './motion.mjs';
import {
  answerKey, asStarted, authoredTier, beatOf, cardOf, checkOnlyWords, contentOf, doneBefore, hintAvailable, hintStatus, isDone, lessonNumber, lessonOf, levelLessons, levelOf, levelsOf, moreHelpGives, nextLessonOf, pickWarmups, recallOf, rungsOf, stepNote, stepOf, stepsOf, tierOf, tiersOf, toFinish, tryFirst, WARMUPS,
} from './flow.mjs';
import { cut, graphemes, inline, pad, plainText, width, wrapRuns } from './text.mjs';
import { tierLabel, tierPill, TIER_STYLE } from './theme.mjs';
import { mix, ruleTiers, scaleMix, TIERS } from './tiers.mjs';
import { COMMANDS_URL, OWN_PARTS } from './content.mjs';

export const MIN = { cols: 60, rows: 20 };
// Each body row says how it gives way when the body is taller than its room
// (spec 3.1, the drop order). A plain string is teaching: it is cut last.
// A blank line the layout may drop. Inside a card it keeps the card's rail;
// spacers in one group drop together.
const spacer = (text = '', group) => ({ spacer: true, text, group });
const SPACER = spacer();
// Rows that never drop: the question and its options (with a safety
// choice's line and a typed answer's input row), feedback, the hint box, the
// eased line, a Windows note, the capstone's handover line, a card's top and
// bottom borders, the welcome's git error and the resume screen's restart
// question.
const kept = (rows) => rows.map((text) => ({ keep: true, text }));
// Optional rows: the level's first warm-up explainer, the intro's Why line
// and a GUIDED card's, the next screen's recall and Go further lines and
// the ? overlay's calm line, each with its blank, teaching the learner can
// also reach another way, such as behind a key, repeats with no compact
// form, a done beat's satisfied "Done when" line, and the capstone's
// invitation to ask. The rows of one call are one sentence: they drop whole.
const optional = (rows) => {
  const whole = {};
  return rows.map((text) => ({ optional: true, text, whole }));
};
// A block that gives way whole, below 24 rows only: a repeat compacts to
// `alt`, decoration leaves `alt` behind.
const repeat = (rows, alt) => ({ block: 'repeat', rows, alt });
const decor = (rows, alt = []) => ({ block: 'decor', rows, alt });

// A lesson's title on one row, its code spans as plain text: a-4's is
// "Script Claude Code with `claude -p`".
export const titleOf = (l) => plainText(l.title);

// B1 to B5, then BC for the Beginner capstone; I1 and IC, A1 and AC alike.
export const lessonLabel = (id) => id.replace(/^([a-z])-(\d+|capstone)$/, (_, l, n) => `${l.toUpperCase()}${n === 'capstone' ? 'C' : n}`);
// A lesson's level by its guide name: 'Beginner' for b-2.
const levelName = (s, id = s.lesson) => C.levels[levelOf(s, id)];

// The lesson page a quote's relative links point into: set for each frame.
let pageUrl = '';

// `clock.at` is the time the frame shows; the rest frame by default.
export function render(s, size, t, clock = REST) {
  const { cols, rows } = size;
  const step = s.view === 'step' && s.beat ? stepOf(s) : null;
  pageUrl = (step?.part === 'Warm-up' ? lessonOf(s, step.from) : lessonOf(s))?.url ?? '';
  if (cols < MIN.cols || rows < MIN.rows) return small(cols, rows);
  const f = frameCtx(s, size, t, clock);
  const { ctx, W, M, top } = f;
  const view = VIEWS[s.view](ctx);
  const room = () => ctx.roomUnder(view.head.length);
  // The rows an overlay has under the view's header and its blank.
  ctx.room = room() - 1;
  const overlay = s.overlay ? OVERLAYS[s.overlay](ctx) : null;
  const body = overlay?.body ?? view.body;
  const keys = overlay?.keys ?? view.keys;
  // The blank under the header is the body's first spacer, so it goes last.
  const more = t.fg('muted', t.glyph.ellipsis);
  let lines = fit([SPACER, ...body], room(), rows < 24, more);
  // When the kept rows alone overflow, a toast gives up the blank under it,
  // then goes: it is a passing note, and kept rows never drop.
  if (lines.length > room() && f.toast.length) {
    f.gap = [];
    lines = fit([SPACER, ...body], room(), rows < 24, more);
    if (lines.length > room()) {
      [f.toast, f.gap] = [[], ['']];
      lines = fit([SPACER, ...body], room(), rows < 24, more);
    }
  }
  // No screen has kept rows taller than its room without a toast; if one
  // ever does, its last rows give way rather than the key bar.
  if (lines.length > room()) lines = [...lines.slice(0, room() - 1), more];
  const out = [...top, ...view.head, ...lines];
  while (out.length < rows - 2 - f.gap.length - f.toast.length) out.push('');
  out.push(...f.toast, ...f.gap, pulseLine(ctx), keybar(t, keys, W, s.held?.name));
  return out.map(placed(t, M, cols));
}

// A frame's width, margin and top, its toast and the blank above the pulse
// line, and the context its views draw with. `roomUnder(head)` is the rows
// a view's body has under `head` header rows, the blank under them
// included: it reads the toast and the blank as render leaves them.
function frameCtx(s, size, t, clock) {
  const { cols, rows } = size;
  const { W, M, top } = frameOf(size);
  const f = { W, M, top, gap: [''], toast: s.toast ? para(t, `${t.lead(TOASTS[s.toast.kind].emoji)}${TOASTS[s.toast.kind].text(s.toast)}`, W, TOASTS[s.toast.kind].color) : [] };
  const roomUnder = (head) => rows - top.length - head - 2 - f.gap.length - f.toast.length;
  f.ctx = { s, t, W, inner: W - 3, cols, rows, clock, ph: phases(s, clock.at, t.caps), roomUnder };
  return f;
}

// How far the check-only card's items can scroll in this window: the first
// item of the window that ends on the last item, 0 where every item fits
// or no check-only card is up. main sends it with each key, so the arrows
// move only what the card shows.
export function itemsMax(s, size, t) {
  if (s.view !== 'checkonly' || s.overlay || size.cols < MIN.cols || size.rows < MIN.rows) return 0;
  return VIEWS.checkonly(frameCtx(s, size, t, REST).ctx).itemsMax;
}

// Every frame's card width, its left margin, and the blank above it on a
// tall window.
function frameOf({ cols, rows }) {
  const W = Math.min(cols - 4, 80);
  return { W, M: Math.floor((cols - W) / 2), top: rows >= 28 ? [''] : [] };
}
const appTitle = (t) => `${t.pill('LEARN', 'accentBg')}  ${t.bold(t.fg('white', C.appName))}`;

// A frame's line in the window: the margin, ASCII where there is no
// Unicode, and cut to `cols - 1`.
const placed = (t, M, cols) => (l) => (l ? cut(' '.repeat(M) + (t.unicode ? l : ascii(l)), cols - 1, t.unicode ? '…' : '.') : '');

// The boot frame (162): before any state, while git answers the first
// questions at start, asked at `since`, if that takes over 150 ms. Pip sits
// where the welcome has it (its three head rows, then the blank), at every
// size, beside the app's line. No key works yet, so the key bar is blank.
export function bootFrame(since, size, t, clock = REST) {
  const { cols, rows } = size;
  if (cols < MIN.cols || rows < MIN.rows) return small(cols, rows);
  const { W, M, top } = frameOf(size);
  const ctx = { t, W, ph: bootPhases(since, clock.at, t.caps) };
  const out = [...top, appTitle(t), '', rule(t, W), '',
    ...withPip(ctx, pip(t, 'happy', ctx.ph.eyes), [() => spinning(ctx, [t.fg('text', C.askingGit)])]).rows];
  while (out.length < rows - 2) out.push('');
  out.push(pulseLine(ctx), '');
  return out.map(placed(t, M, cols));
}

// The body in `room` rows. What gives way, in order: below 24 rows repeats
// compact; spacers drop one at a time from the bottom; below 24 rows
// decoration gives way, from the top; optional teaching drops from the
// bottom, a sentence at a time; then teaching rows are cut from the bottom,
// each run of cut rows under one `…`. Kept rows stay, so the list can
// still be taller than `room`.
export function fit(body, room, short, more) {
  let list = body;
  const size = (l = list) => l.reduce((n, r) => n + (r?.block ? r.rows.length : 1), 0);
  if (short && size() > room) list = list.flatMap((r) => (r?.block === 'repeat' ? r.alt : [r]));
  const gone = new Set();
  const live = () => list.filter((_, k) => !gone.has(k));
  while (size(live()) > room) {
    const i = list.findLastIndex((r, k) => r?.spacer && !gone.has(k));
    if (i < 0) break;
    const { group } = list[i];
    list.forEach((r, k) => {
      if (k === i || (group && r?.spacer && r.group === group)) gone.add(k);
    });
    // A group can free more rows than were needed: the single spacers it
    // passed over come back, from the top, while they fit.
    if (group) {
      for (const k of [...gone].sort((a, b) => a - b)) if (!list[k].group && size(live()) < room) gone.delete(k);
    }
  }
  list = live();
  while (short && size() > room) {
    const i = list.findIndex((r) => r?.block === 'decor');
    if (i < 0) break;
    list = [...list.slice(0, i), ...list[i].alt, ...list.slice(i + 1)];
  }
  list = list.flatMap((r) => (r?.block ? r.rows : [r]));
  const dropped = new Set();
  while (list.length > room) {
    const i = list.findLastIndex((r) => r?.optional);
    if (i < 0) break;
    const { whole } = list[i];
    for (const [k, r] of list.entries()) if (k === i || (whole && r?.whole === whole)) dropped.add(r);
    list = list.filter((r) => !dropped.has(r));
  }
  // A sentence can free more rows than were needed: fit again without it,
  // so the spacers and decoration that gave way first come back while they fit.
  if (dropped.size && list.length < room) return fit(body.filter((r) => !dropped.has(r)), room, short, more);
  if (list.length > room) {
    const teaching = list.flatMap((r, i) => (typeof r === 'string' || !(r.keep || r.optional || r.spacer) ? [i] : []));
    // Inside a card the `…` keeps the card's rail. A lone row stays: a `…`
    // in its place would hide it and free nothing.
    const mark = (r) => (r.rail ? `${r.rail}  ${more}` : more);
    let cut = list;
    for (let n = 1; n <= teaching.length && cut.length > room; n++) {
      const drop = new Set(teaching.slice(-n));
      cut = list.flatMap((r, i) => (!drop.has(i) ? [r] : drop.has(i - 1) ? [] : drop.has(i + 1) ? [mark(r)] : [r]));
    }
    list = cut;
  }
  return list.map((r) => (typeof r === 'string' ? r : r.text));
}

const TOASTS = {
  stray: { emoji: 'wave', color: 'accent', text: () => C.stray },
  hintsLater: { emoji: 'hint', color: 'accent', text: (x) => C.hintsLater(x.try) },
  pickFirst: { emoji: 'guess', color: 'accent', text: () => C.pickFirst },
  save: { emoji: 'broken', color: 'warn', text: (x) => C.saveFailed(x.message) },
};

// ASCII mode: the few symbols in the app's own words and in quotes, spelled
// out; anything else outside ASCII becomes '?'.
const ASCII = { '·': '|', '…': '...', '↑': '^', '↓': 'v', '←': '<-', '→': '->', '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '›': '>' };
const ascii = (line) => line.replace(/[^\x00-\x7f]/g, (ch) => ASCII[ch] ?? '?');

function small(cols, rows) {
  const out = Array.from({ length: rows }, () => '');
  const lines = wrapRuns([{ text: C.small }], Math.max(1, cols - 2)).map((l) => l.map((r) => r.text).join(''));
  lines.slice(0, rows).forEach((l, i) => {
    out[Math.max(0, Math.floor((rows - lines.length) / 2)) + i] = cut(` ${l}`, cols - 1);
  });
  return out.slice(0, rows);
}

// ---- pieces ------------------------------------------------------------------
// The rule above the key bar, the pulse line. While a check or git child
// runs, the bounce: a 10-cell segment 4 cells a tick, back and forth, on the
// spinner's clock, turning where the next step would leave the rule. Else
// a sweep when something changed, or the look marker, where ambient loops
// may draw.
function pulseLine(ctx) {
  const { t, W, ph } = ctx;
  const segment = (from, n) => `${rule(t, from)}${t.fg('key', t.glyph.bold.repeat(n))}${rule(t, W - from - n)}`;
  if (ph.spinner !== null) {
    const span = 4 * Math.floor((W - 10) / 4);
    const x = (4 * ph.spinner) % (2 * span);
    return segment(x <= span ? x : 2 * span - x, 10);
  }
  // A sweep: 8 cells across the rule, a fifth of the way a frame.
  const e = into(ctx, 'sweep');
  if (e < Infinity) return segment(Math.round(((W - 8) * Math.floor(e / SHOTS.sweep.every)) / 5), 8);
  // The look marker: 3 cells, a notch on for each real look.
  if (ph.look !== null) return segment(Math.round((ph.look * (W - 3)) / (NOTCHES - 1)), 3);
  return rule(t, W);
}

// How far into a one-shot this frame is, in ms, or Infinity once it rests
// (and in every frame without motion).
const into = (ctx, part) => (ctx.ph[part] >= 1 ? Infinity : Math.round(ctx.ph[part] * TIMING[part]));
const spread = (left, right, w) => left + ' '.repeat(Math.max(1, w - width(left) - width(right))) + right;
const rule = (t, W) => t.fg('faint', t.glyph.rule.repeat(W));
// `n` of `total` as heavy green cells over the plain rule, `w` wide.
const fill = (t, n, total, w) => {
  const filled = Math.round((n / total) * w);
  return `${t.fg('ok', t.glyph.bold.repeat(filled))}${rule(t, w - filled)}`;
};

// Inline Markdown in the given color, wrapped to `w` columns, after a
// `label` in its own color when there is one.
function para(t, text, w, color = 'text', { quote = false, label } = {}) {
  const runs = [...(label ? [{ text: `${label.text} `, color: label.color }] : []), ...inline(quote ? `"${text}"` : text)];
  return wrapRuns(runs, w).map((line) => line.map((r) => {
    let s = t.fg(r.code ? 'code' : r.color ?? color, r.text);
    if (r.bold) s = t.bold(s);
    if (r.url) s = t.link(s, absolute(r.url));
    return s;
  }).join(''));
}

// A link in a lesson's words, such as `#watch-out` or `05-project-memory.md`,
// resolved against its page.
function absolute(url) {
  if (/^[a-z][a-z+.-]*:/i.test(url) || !pageUrl) return url;
  try {
    return new URL(url, pageUrl).href;
  } catch {
    return url;
  }
}

// The keys that fit in `w` columns: a low key (c card) gives way first, then
// a key's long label to its short one (none, for the map's arrows), then the
// optional keys go from the right; q always stays.
// The `held` letter, waiting DEFER_MS to act, draws pressed: inverse.
function keybar(t, keys, w = Infinity, held = null) {
  const draw = (list, short) => list.map((k) => {
    const label = short && k.short != null ? k.short : k.label;
    const pressed = k.key === held;
    if (k.main) return `${t.pill(k.key, k.bg ?? 'okBg', k.fg ?? 'white', { pressed })} ${t.bold(t.fg('white', label))}`;
    const letter = t.fg('key', t.bold(k.key));
    return `${pressed ? t.inverse(letter) : letter}${label ? ` ${t.fg('muted', label)}` : ''}`;
  }).join('    ');
  let list = keys.filter(Boolean);
  if (width(draw(list, false)) <= w) return draw(list, false);
  const high = list.filter((k) => !k.low);
  if (width(draw(high, false)) <= w) return draw(high, false);
  while (width(draw(list, true)) > w) {
    const drop = list.findLastIndex((k) => !k.main && k.key !== 'q' && k.key !== 'ctrl+c');
    if (drop < 0) break;
    list = list.filter((_, i) => i !== drop);
  }
  return draw(list, true);
}
const key = (k, label) => ({ key: k, label });
const mainKey = (k, label, bg, fg, short) => ({ key: k, label, main: true, bg, fg, short });

// The practice copy's folder in a command, quoted when the shell needs it.
export function quotePath(path, win32) {
  if (/^[\w@%+=:,./~\\-]+$/.test(path)) return path;
  return win32 ? `"${path}"` : `'${path.replace(/'/g, "'\\''")}'`;
}
const withRoot = (text, root, win32) => text.replace('<your practice copy>', quotePath(root, win32));

// A command on a dark block, one line per `w - 4` columns of the command,
// so a long path is never cut.
function chip(t, cmd, where, w) {
  const prompt = where === 'claude' ? '›' : t.caps.win32 ? '>' : '$';
  const room = Math.max(10, w - 4);
  // Lines break at spaces, so a prompt keeps its words whole; only a word
  // longer than the line, such as a long path, is split.
  const parts = [];
  let part = '';
  for (const word of cmd.split(/(?<= )/)) {
    if (part && width(part + word.trimEnd()) > room) {
      parts.push(part.trimEnd());
      part = '';
    }
    for (const g of graphemes(word)) {
      if (width(part + g) > room && g !== ' ') {
        parts.push(part);
        part = '';
      }
      part += g;
    }
  }
  if (part.trimEnd() || !parts.length) parts.push(part.trimEnd());
  return parts.map((part, i) => {
    const text = ` ${t.fg('prompt', i ? ' ' : prompt)} ${t.fg('code', part)}`;
    const padded = text + ' '.repeat(Math.max(1, w - width(text)));
    return t.depth > 1 ? t.bg('codeBg', padded) : padded;
  });
}

// The steps a lesson will play and their tiers. Before a lesson starts, the
// warm-ups it would pick stand in for the ones it picks on enter, and the
// tiers are the ones the play will start with.
function planned(state) {
  const s = state.view === 'intro' ? asStarted(state) : state;
  const content = contentOf(s);
  if (s.view !== 'intro' || !content.warmup.length) return { steps: stepsOf(s), tiers: tiersOf(s) };
  const own = tiersOf(s).filter((_, i) => stepsOf(s)[i].part !== 'Warm-up');
  const warm = pickWarmups(s).map((id) => content.warmup.find((w) => w.id === id));
  return { steps: [...warm, ...content.steps], tiers: [...warm.map(() => 'challenge'), ...own] };
}

// The step on screen has its last beat done: it is passed before enter adds
// it to `done`.
const passedNow = (s) => s.view === 'step' && isDone(s.beat) && s.pos.beat === stepOf(s).beats.length - 1;

// The step on screen is passed and was not done before: a first pass, which
// counts toward the session and grows the progress rule.
const firstPass = (s) => passedNow(s) && !s.progress[s.lesson].done.includes(stepOf(s).id);

// The steps in `done`, and the step on screen once it is passed.
function passed(s) {
  const done = new Set(s.progress[s.lesson].done);
  if (passedNow(s)) done.add(stepOf(s).id);
  return done;
}

// One mark per step, joined within a tier and spaced between tiers. When the
// row has no room for that, the marks close up.
function trail(ctx, room) {
  const { s, t } = ctx;
  const { steps, tiers } = planned(s);
  const done = passed(s);
  const current = s.view === 'step' || s.view === 'levelup' ? s.pos.step : -1;
  const now = passedNow(s);
  const entering = into(ctx, 'entrance');
  const passing = into(ctx, 'stepDone');
  // On a lesson complete, one light runs along the finished trail: on its
  // first stop at the first frame from `light`, on its last at the last
  // frame before the screen rests, whatever the trail's length.
  const run = into(ctx, 'complete');
  const frames = (TIMING.complete - SHOTS.complete.light) / TIMING.grid - 1;
  const light = run < SHOTS.complete.light ? -1 : Math.round((Math.floor((run - SHOTS.complete.light) / TIMING.grid) * (steps.length - 1)) / frames);
  const draw = (join, gap) => {
    let out = '';
    steps.forEach((step, i) => {
      const style = TIER_STYLE[tiers[i]];
      // The step on screen is drawn done, and its link fills, only once it
      // is passed: on a revisit or a replay it keeps the "current" glyph.
      const isPassed = i === current ? now : done.has(step.id);
      if (i === light) out += t.bold(t.fg('gold', t.glyph.ring));
      // As its step passes, the stop is a spark for a moment.
      else if (isPassed && i === current && passing < SHOTS.stepDone.pop) out += t.bold(t.fg('gold', t.glyph.spark));
      else if (isPassed) out += t.fg('ok', t.glyph[style.on]);
      // As the card enters, its stop pops: hollow, then a ring.
      else if (i === current && entering < SHOTS.entrance.land) out += t.fg(style.tint, t.glyph[style.off]);
      else if (i === current && entering < Infinity) out += t.bold(t.fg('accent', t.glyph.ring));
      else if (i === current) out += t.bold(t.fg('accent', t.glyph[style.on]));
      else out += t.fg(style.tint, t.glyph[style.off]);
      if (i + 1 < steps.length) {
        if (tiers[i + 1] !== tiers[i]) out += gap;
        // A passing stop's link fills from it: half, then whole.
        else if (isPassed && i === current && passing < SHOTS.stepDone.fill) {
          const half = passing < SHOTS.stepDone.pop ? 0 : Math.ceil(join / 2);
          out += `${t.fg('ok', t.glyph.bold.repeat(half))}${t.fg('faint', t.glyph.rule.repeat(join - half))}`;
        } else if (isPassed && (i === current || done.has(steps[i + 1].id) || i + 1 === current)) out += t.fg('ok', t.glyph.bold.repeat(join));
        else out += t.fg('faint', t.glyph.rule.repeat(join));
      }
    });
    return out;
  };
  const full = draw(2, '   ');
  return width(full) <= room ? full : draw(0, ' ');
}

// Row 3 on a lesson screen: the share of its steps passed, as a heavy rule
// over the plain one. As a step passes for the first time, it grows.
function progressRule(ctx) {
  const { s, t, W } = ctx;
  const { steps } = planned(s);
  const done = passed(s);
  const n = steps.filter((x) => done.has(x.id)).length;
  const e = into(ctx, 'stepDone');
  const growing = e < SHOTS.stepDone.fill && firstPass(s);
  return fill(t, growing ? n - 1 + e / SHOTS.stepDone.fill : n, steps.length, W);
}

function lessonHead(ctx, right, rightText) {
  const { s, t, W } = ctx;
  const l = lessonOf(s);
  // The check's short title, as on the map, cut to the room the pill leaves;
  // the content file keeps the page's heading.
  const label = t.pill(lessonLabel(l.id), 'accentBg');
  const title = cut(titleOf(l), Math.max(8, W - width(label) - 2 - width(right) - 1), t.unicode ? '…' : '.');
  return [
    spread(`${label}  ${t.bold(t.fg('white', title))}`, right, W),
    spread(l.content ? trail(ctx, W - width(rightText) - 1) : '', t.fg('muted', rightText), W),
    l.content ? progressRule(ctx) : rule(t, W),
  ];
}

// Pip, at the end of a card's top border, needs the face and the two rule
// cells after it, and leaves at least one rule cell before it.
const PIP_ROOM = PIP_FACE + 3;

// Pip's face in this frame, over the `mood` it rests in: arms up for a hop
// or a cheer; away while the card enters, then landing with its eyes shut;
// on a new "Not yet", a nod; on a file change, a glance; and its blink.
function pipNow(ctx, shown) {
  // Checking, with motion: Pip looks up once a child has run 150 ms, and
  // holds still.
  const mood = shown === 'checking' && !ctx.ph.checking ? 'rest' : shown;
  const e = into(ctx, 'entrance');
  const n = into(ctx, 'notYet');
  if (into(ctx, 'hop') < Infinity || into(ctx, 'cheer') < Infinity) return { mood, frame: 'up' };
  if (n < Infinity) return { mood: n >= SHOTS.notYet.nod ? 'rest' : mood };
  if (e < SHOTS.entrance.land) return null;
  if (e < Infinity) return { mood, frame: 'shut' };
  // A file change: a glance toward the other window, unless a check runs.
  if (into(ctx, 'glance') < Infinity && mood !== 'checking') return { mood, frame: 'glance' };
  return { mood, frame: ctx.ph.blink ? 'shut' : undefined };
}

function card(ctx, { tint, where, done, rows, mood }) {
  const { t, W } = ctx;
  const rail = t.fg(tint, t.glyph.rail);
  const left = `${t.fg(tint, `${t.glyph.tl}${t.glyph.rule}`)} ${t.pill(where, 'chipBg')}${done ? ` ${t.pill(`${t.glyph.check} ${C.done}`, 'okBg')}` : ''} `;
  const fill = Math.max(0, W - width(left));
  const face = pipNow(ctx, mood);
  // As the card enters, the top rule grows from the pill a third a frame.
  const grown = Math.round((fill * (1 + Math.floor(into(ctx, 'entrance') / SHOTS.entrance.every))) / 3);
  const top = !face ? left + t.fg(tint, t.glyph.rule.repeat(grown))
    : fill >= PIP_ROOM
      ? `${left}${t.fg(tint, t.glyph.rule.repeat(fill - PIP_FACE - 2))}${pipFace(t, face.mood, face.frame)}${t.fg(tint, t.glyph.rule.repeat(2))}`
      : left + t.fg(tint, t.glyph.rule.repeat(fill));
  // Each row carries the rail, so a `…` cut inside the card keeps it.
  // A blank row that is part of a sentence, such as the Why line's, is the
  // rail alone too.
  const row = (r) => (r === '' || r?.spacer ? spacer(rail, r?.group) : typeof r === 'string' ? { text: `${rail}  ${r}`, rail }
    : r.text === '' ? { ...r, text: rail, blank: true } : { ...r, text: `${rail}  ${r.text}`, rail });
  // A spacer next to another, where a line between them shows nothing, is
  // one; a sentence's blank row above a spacer leaves the blank to it.
  const body = [spacer(rail), ...rows.map(row)].filter((r, i, all) => !((r.spacer || r.blank) && all[i + 1]?.spacer));
  return [...kept([top]), ...body, ...kept([t.fg(tint, `${t.glyph.bl}${t.glyph.rule.repeat(W - 1)}`)])];
}

const lead = (t, name, s) => `${t.lead(name)}${s}`;
// A `can` line's mark, three columns in; on the payoff's line 🏁 takes its
// place, ending where the mark ends (an ASCII `[win]` wider than the mark
// starts at the margin and ends past it).
const canMark = (t, payoff, mark) => {
  const m = payoff ? t.emoji('payoff') : mark;
  return `${' '.repeat(Math.max(0, 3 + width(mark) - width(m)))}${m}`;
};
// Lines after a prefix, the rest indented under the first.
const hang = (prefix, rows) => rows.map((x, i) => `${i ? ' '.repeat(width(prefix)) : prefix}${x}`);
// A `can` line wrapped to `w` after its mark, the rest under its first word;
// `blank`, with no mark yet.
const canLine = (t, text, payoff, mark, w, blank = false) => {
  const prefix = `${canMark(t, payoff, mark)} `;
  return hang(blank ? ' '.repeat(width(prefix)) : prefix, para(t, text, w));
};
// Text after a lead, wrapped to the room the lead leaves and indented under it.
const led = (t, name, text, w, color, opts) => hang(t.lead(name), para(t, text, w - width(t.lead(name)), color, opts));
// A Why line: the lead in `color`, the quote wrapped under its first word,
// and a blank row, as one optional sentence.
const whyLine = (t, text, w, color) => {
  const why = `${C.whyLead} `;
  return optional([...hang(t.fg(color, why), para(t, text, w - width(why), 'text', { quote: true })), '']);
};
// The lesson's Go further line: 📖, its label, then the quote, wrapped under
// the label, and with `url` its address spelled out under it.
const goFurther = (t, read, w, url) => {
  const rows = led(t, 'read', read, w, 'text', { quote: true, label: { text: C.goFurther, color: 'muted' } });
  if (!url) return rows;
  const under = ' '.repeat(width(t.lead('read')));
  return [...rows, ...hang(under, para(t, url, w - width(under), 'key').map((x) => t.link(x, url)))];
};
// One sentence written as rows: those rows where each fits in `w`, or else
// the sentence wrapped whole.
const sentence = (t, parts, w, color) => (parts.every((x) => width(x) <= w) ? parts : [parts.join(' ')]).flatMap((x) => para(t, x, w, color));
const hintBox = (t, lines) => lines.map((l) => `${t.fg('warn', t.glyph.bar)} ${l}`);

// ---- views -------------------------------------------------------------------
const VIEWS = {
  welcome(ctx) {
    const { s, t, W } = ctx;
    // The current level's path: its lessons, then one cup for its capstone.
    const lessons = levelLessons(s, levelOf(s));
    const done = lessons.filter((l) => s.progress[l.id].complete).length;
    const heat = ['guided', 'guided', 'hinted', 'heat4', 'challenge'];
    const ids = lessons.filter((l) => !l.id.endsWith('capstone'));
    const cap = lessons.find((l) => l.id.endsWith('capstone'));
    // Once on entry: Pip wakes, and a fuse lights the path's links in turn,
    // reaching the cup at `cup` however many lessons the level has.
    const e = into(ctx, 'welcome');
    const at = SHOTS.welcome;
    const frames = at.cup / at.fuse;
    const lit = e === Infinity ? 0 : 1 + Math.floor((Math.min(frames, Math.floor(e / at.fuse)) * (ids.length - 1)) / frames);
    const link = (i) => (i < lit ? ` ${t.bold(t.fg('gold', t.glyph.bold.repeat(2)))} ` : t.fg('faint', ` ${t.glyph.rule.repeat(2)} `));
    // The heat runs cool to hot across the level, however long.
    const path = `${ids.map((l, i) => `${t.fg(heat[Math.floor((i * heat.length) / ids.length)], t.bold(lessonLabel(l.id)))}${link(i)}`).join('')}${t.emoji('cup') || lessonLabel(cap.id)}`;
    const hint = t.fg('muted', `   ${C.pathHint}`);
    const eyes = e < at.waking || ctx.ph.blink ? 'shut' : e < at.awake ? 'waking' : undefined;
    const body = [
      withPip(ctx, pip(t, 'happy', eyes), [
        (w) => led(t, 'wave', C.hi(s.facts.name), w, 'white').map((x) => t.bold(x)),
        (w) => sentence(t, [C.pip1, C.pip2], w, 'text'),
      ]),
      SPACER,
      t.bold(t.fg('white', C.twoWindows)),
      ...windows(ctx),
      SPACER,
      t.bold(t.fg('white', C.openSecond)),
      ...chip(t, `cd ${quotePath(s.facts.root, t.caps.win32)}`, 'terminal', Math.min(W, width(s.facts.root) + 10)),
      t.fg('muted', C.comeBack),
    ];
    if (s.facts.gitError) body.push(SPACER, ...kept(led(t, 'broken', C.gitBroken(s.facts.gitError), W, 'bad')));
    // The app's name gives way where it and the level's count don't both
    // fit uncut, as with Intermediate's at 60 columns.
    const count = t.fg('muted', C.pathLabel(levelName(s), done, lessons.length));
    const title = width(appTitle(t)) + 1 + width(count) <= ctx.cols - 1 - frameOf(ctx).M ? appTitle(t) : t.pill('LEARN', 'accentBg');
    return {
      head: [spread(title, count, W),
        // The hint is left off when it doesn't fit: the map's footer says the same.
        `${path}${width(path + hint) <= W ? hint : ''}`, rule(t, W)],
      body,
      keys: [mainKey('enter', C.k.itsOpen), key('q', C.k.quit)],
    };
  },

  resume(ctx) {
    const { s, t } = ctx;
    const steps = stepsOf(s);
    const p = s.progress[s.lesson];
    const index = Math.max(0, steps.findIndex((x) => x.id === p.step));
    const mark = `${t.fg('warn', t.glyph.warnMark)} `;
    return {
      head: lessonHead(ctx, '', C.stepOf(index + 1, steps.length)),
      body: [
        withPip(ctx, pip(t, 'happy'), [
          () => [lead(t, 'wave', t.bold(t.fg('white', C.welcomeBack)))],
          (w) => para(t, C.youreOn(lessonLabel(s.lesson), index + 1, steps.length, steps[index].title), w, 'text'),
        ]),
        ...(s.confirmRestart ? [SPACER, ...kept(hang(mark, para(t, C.restartAsk, ctx.W - width(mark), 'white').map((x) => t.bold(x))))] : []),
      ],
      keys: s.confirmRestart
        ? [mainKey('y', C.k.yesStartOver, 'warn', 'black'), key('n', C.k.keep)]
        : [mainKey('enter', C.k.continue), key('x', C.k.startOver), key('m', C.k.map), key('q', C.k.quit)],
    };
  },

  intro(ctx) {
    const { s, t, W } = ctx;
    const content = contentOf(s);
    const warmups = Math.min(WARMUPS, content.warmup.length);
    // The climb is the lesson's own steps: warm-ups are recall, not new help.
    const steps = stepsOf(s);
    const m = mix(tiersOf(asStarted(s)).filter((_, i) => steps[i].part !== 'Warm-up'));
    const label = s.lesson.endsWith('capstone') ? C.startCapstone : C.startLesson(lessonNumber(s));
    const option = (i, text) => (s.cursor === i
      ? `${t.fg('key', t.bold(t.glyph.pointer))} ${t.inverse(t.fg('key', t.bold(` ${text} `)))}`
      : `  ${t.fg('text', ` ${text}`)}`);
    // Why the lesson matters, in the page's words, with its blank: an
    // optional row, so below 24 rows the staircase compacts first.
    return {
      head: lessonHead(ctx, t.fg('muted', content.intro.minutes ?? ''), C.steps(content.steps.length + warmups)),
      body: [
        ...(content.intro.why ? whyLine(t, content.intro.why, W, 'muted') : []),
        lead(t, 'goal', t.bold(t.fg('white', C.youllBeAble))),
        ...content.intro.can.flatMap((c) => canLine(t, c, c === content.intro.payoff, t.fg('faint', t.glyph.dotOff), W - 6)),
        SPACER,
        t.bold(t.fg('white', C.helpShrinks)),
        SPACER,
        ...staircase(ctx, m, false),
        ...(warmups ? [t.fg('muted', C.warmups(warmups))] : []),
        SPACER,
        option(0, label),
        option(1, C.lessHelp),
      ],
      keys: [key(t.glyph.up, C.k.choose), key('enter', C.k.start), key('m', C.k.map), key('q', C.k.quit)],
    };
  },

  step: stepView,

  levelup(ctx) {
    const { s, t, W } = ctx;
    const tiers = tiersOf(s);
    const rest = tiers.slice(s.pos.step);
    const counts = (k) => rest.filter((x) => x === k).length;
    const toChallenge = s.levelTo === 'challenge';
    // Pip opens its eyes as the banner wipes in, then the arrow fills and
    // the new star lands.
    const e = into(ctx, 'levelUp');
    const at = SHOTS.levelUp;
    const art = pip(t, 'focus', e < at.open ? 'shut' : e < at.whole ? 'awake' : undefined);
    const word = banner(t, C.levelUp, e < at.whole ? { cells: Math.round((bannerWidth(C.levelUp) * e) / at.whole) } : {});
    const fits = t.unicode && W >= 14 + bannerWidth(C.levelUp);
    const plain = t.bold(t.fg('accent', C.levelUp));
    // Pip and the banner: decoration, leaving the word.
    const top = decor(fits
      ? [` ${art[0]}`, ` ${art[1]}    ${word[0]}`, ` ${art[2]}    ${word[1]}`, ` ${art[3]}    ${word[2]}`]
      : [` ${art[0]}`, ` ${art[1]}    ${plain}`, ` ${art[2]}`, ` ${art[3]}`], [` ${plain}`]);
    const lines = toChallenge ? C.toChallenge : C.toHinted;
    const tint = TIER_STYLE[s.levelTo].tint;
    // The arrow's 8 cells fill a third at a time, rounded up.
    const thirds = e < at.whole ? 0 : Math.floor((e - at.whole) / at.fill);
    const filled = Math.min(8, Math.ceil((8 * thirds) / 3));
    const arrow = e < at.head
      ? `${t.fg(tint, t.glyph.bold.repeat(filled))}${t.fg('faint', t.glyph.rule.repeat(8 - filled))} `
      : t.fg(tint, `${t.glyph.bold.repeat(8)}${t.glyph.right}`);
    return {
      head: lessonHead(ctx, tierPill(t, s.levelTo), C.stepOf(s.pos.step + 1, tiers.length)),
      body: [
        top,
        SPACER,
        ` ${tierPill(t, s.levelFrom)}   ${arrow}   ${tierPill(t, s.levelTo, e < Infinity ? { from: s.levelFrom, glyph: e < at.head ? ' ' : t.glyph.spark } : undefined)}`,
        SPACER,
        ...para(t, lines[0], W - 1, 'white').map((x) => ` ${t.bold(x)}`),
        ...para(t, lines[1], W - 1, 'text').map((x) => ` ${x}`),
        SPACER,
        ...led(t, 'level', C.nextCounts(toChallenge ? 0 : counts('hinted'), counts('challenge')), W - 1, tint).map((x) => ` ${t.bold(x)}`),
      ],
      keys: [mainKey('enter', toChallenge ? C.k.bringIt : C.k.letsGo, TIER_STYLE[s.levelTo].bg, TIER_STYLE[s.levelTo].fgOnBg), moreHelpGives(s) ? key('g', C.k.moreHelp) : null, key('q', C.k.quit)],
    };
  },

  complete(ctx) {
    const { s, t, W } = ctx;
    const content = contentOf(s);
    const total = stepsOf(s).length;
    const e = into(ctx, 'complete');
    const at = SHOTS.complete;
    const cheer = e < at.whole;
    const art = pip(t, 'party', cheer ? 'cheer' : undefined);
    const word = banner(t, C.complete, cheer ? { letters: Math.floor((C.complete.length * e) / at.whole) } : {});
    const fits = t.unicode && W >= 14 + bannerWidth(C.complete);
    const label = s.lesson.endsWith('capstone') ? 'Capstone' : `Lesson ${lessonNumber(s)}`;
    // The confetti falls into its row: from 24 rows across it and the blank
    // under it, turn about; below 24 rows, where that blank can give way,
    // glyph by glyph.
    const k = Math.floor(e / at.fall);
    let confettiRows = [confetti(t, W)];
    let under = SPACER;
    if (e < Infinity && ctx.rows < 24) confettiRows = [confetti(t, W, { shown: at.first + at.more * k })];
    else if (e < Infinity) {
      confettiRows = [confetti(t, W, { turn: k, row: 0 })];
      under = spacer(confetti(t, W, { turn: k, row: 1 }));
    }
    // Arms up: past the first row's sides, where its margin was.
    const top = `${cheer ? '' : ' '}${art[0]}`;
    // The ticks appear in turn from blank, the payoff's mark last.
    const order = [...content.intro.can.filter((c) => c !== content.intro.payoff), ...content.intro.can.filter((c) => c === content.intro.payoff)];
    // Each lands on the 40 ms grid, where a frame is drawn.
    const lands = (c) => at.ticks + (order.length > 1 ? TIMING.grid * Math.round((at.ticksBy - at.ticks) * order.indexOf(c) / (order.length - 1) / TIMING.grid) : 0);
    return {
      head: lessonHead(ctx, t.pill(`${C.complete} ${t.glyph.check}`, 'okBg'), `${total} of ${total}`),
      body: [
        decor(confettiRows),
        under,
        decor(fits
          ? [top, ` ${art[1]}    ${word[0]}`, ` ${art[2]}    ${word[1]}`, ` ${art[3]}    ${word[2]}`]
          : [top, ` ${art[1]}    ${t.bold(t.fg('ok', C.complete))}`, ` ${art[2]}`, ` ${art[3]}`], [` ${t.bold(t.fg('ok', C.complete))}`]),
        SPACER,
        lead(t, 'party', t.bold(t.fg('white', C.lessonDone(label)))),
        ...content.intro.can.flatMap((c) => canLine(t, c, c === content.intro.payoff, t.fg('ok', t.glyph.check), W - 8, e < lands(c))),
        ...(content.badge ? [SPACER, lead(t, 'badge', t.bold(t.fg('gold', C.badge(content.badge))))] : []),
      ],
      keys: [mainKey('enter', C.k.whatsNext), key('q', C.k.quit)],
    };
  },

  next(ctx) {
    const { s, t, W } = ctx;
    const content = contentOf(s);
    const results = s.checks[s.lesson]?.items;
    const total = stepsOf(s).length;
    // Only the questions in steps this learner finished: the app saw those.
    const answered = stepsOf(s).filter((st) => s.progress[s.lesson].done.includes(st.id)).flatMap((st) => st.beats)
      .filter((b) => b.ask && b.kind !== 'predict').length;
    const nextLesson = nextLessonOf(s);
    const body = [];
    if (results) body.push(lead(t, 'verified', t.fg('ok', C.checkedSummary(results.filter((r) => r.pass).length, results.length))));
    if (s.lesson.endsWith('capstone')) {
      const indent = ' '.repeat(width(t.lead('verified')));
      // The capstone's handover: plain text, shown only when no exact command
      // was shown in this play. A short window never drops it.
      if (s.progress[s.lesson].bottomAt === null) body.push(...kept([`${indent}${t.fg('text', C.handover)}`]));
      // Each level's capstone invites questions, under the handover line: an
      // optional sentence, so a long toast cuts no teaching line.
      body.push(...optional(hang(indent, para(t, C.invitation, W - width(indent), 'muted'))));
    }
    // The count repeats what the learner did, so it goes before a teaching line.
    body.push(...optional([lead(t, 'claude', t.fg('text', C.answeredSummary(answered)))]), SPACER, t.bold(t.fg('white', C.yourClimb)), SPACER,
      // The climb as it was played: an eased step counts at its easier tier.
      ...staircase(ctx, mix(tiersOf(s).filter((_, i) => stepsOf(s)[i].part !== 'Warm-up')), true));
    // Recall, then compare: the lesson's card entries from memory first. An
    // optional sentence, so a long toast cuts no teaching line: where it
    // drops, c still shows the same entries. Go further, under it, gives way
    // first.
    if (recallOf(s).length) body.push(...optional(['', ...para(t, C.recallAsk(lessonLabel(s.lesson)), W, 'text')]));
    // A source to read next, one optional sentence: p shows it too. A
    // capstone has none.
    if (content.intro.read) body.push(...optional(['', ...goFurther(t, content.intro.read, W)]));
    if (nextLesson) {
      const up = `${t.fg('accent', t.glyph.right)} ${t.fg('muted', C.nextUp)}  ${t.pill(lessonLabel(nextLesson.id), 'accentBg')}  `;
      const mixed = `   ${mixBar(ctx, nextLesson, BAR)}  `;
      body.push(SPACER, ...hang(up, para(t, nextLesson.title, W - width(up), 'white').map((x) => t.bold(x))));
      // Its climb, where it has a lesson file to climb.
      if (nextLesson.content) body.push(...hang(mixed, para(t, C.notchHarder, W - width(mixed), 'muted')));
    }
    body.push(SPACER, ...para(t, C.savedBreak, W, 'muted'));
    return {
      head: lessonHead(ctx, t.pill(`${C.complete} ${t.glyph.check}`, 'okBg'), `${total} of ${total}`),
      body,
      keys: [nextKey(s), key('p', C.k.page), key('m', C.k.map), cardKey(s), key('q', C.k.quit)],
    };
  },

  // One level a page: the level of the lesson under the cursor.
  map(ctx) {
    const { s, t, W } = ctx;
    const cursor = s.course[s.mapCursor];
    const lessons = levelLessons(s, levelOf(s, cursor.id));
    const done = lessons.filter((l) => s.progress[l.id].complete).length;
    const total = lessons.length;
    const pct = Math.round((done / total) * 100);
    const barW = W - 6;
    const head = [spread(`${t.lead('map')}${t.pill(C.map, 'accentBg')}  ${t.bold(t.fg('white', C.levelPath(levelName(s, cursor.id))))}`, t.fg('muted', C.ofDone(done, total)), W),
      `${fill(t, done, total, barW)} ${t.fg('ok', `${pct}%`)}`, rule(t, W)];
    const next = s.course.find((l) => toFinish(s.progress, l));
    // The legend's items run on under "Help:" when one row can't hold them.
    // It and the footer explain the tier bars: a page with none has neither.
    const bars = lessons.some((l) => l.content);
    const legend = [];
    for (const item of TIERS.map((k) => `${t.fg(TIER_STYLE[k].tint, t.glyph[TIER_STYLE[k].on])} ${t.fg('text', C.tierHelp[k])}`)) {
      const last = legend.at(-1);
      if (last !== undefined && width(`${last}   ${item}`) <= W - 7) legend[legend.length - 1] = `${last}   ${item}`;
      else legend.push(item);
    }
    // The titles give way to the marks, which are wider in ASCII, and to the
    // bars and their gap, on a page that has them.
    const titleW = Math.min(Math.max(...lessons.map((l) => width(titleOf(l)))), W - 30 + (bars ? 0 : BAR + 2) - width(t.glyph.check) - Math.max(width(t.emoji('cup')), width(t.emoji('badge'))));
    // Where the level's rows don't fit even closed up, with the footer gone,
    // the list scrolls: the rows that fit, the cursor's as near their middle
    // as the ends allow.
    const fits = Math.max(1, ctx.roomUnder(head.length) - (bars ? legend.length : 0));
    const at = lessons.indexOf(cursor);
    const from = lessons.length <= fits ? 0 : Math.max(0, Math.min(lessons.length - fits, at - Math.floor(fits / 2)));
    const rows = lessons.slice(from, from + fits).flatMap((l, i) => {
      const p = s.progress[l.id];
      const sel = l === cursor;
      const mark = `${sel ? t.fg('key', t.bold(t.glyph.pointer)) : ' '} ${p.complete ? t.fg('ok', t.glyph.check) : t.fg('faint', t.glyph.dotOff)}`;
      const pillBg = sel ? 'accentBg' : p.complete ? 'okBg' : 'dimBg';
      const name = sel ? t.bold(t.fg('key', titleOf(l))) : t.fg(p.complete ? 'text' : 'muted', titleOf(l));
      const state = p.complete ? t.fg('ok', C.mapDone) : l === next ? t.fg('accent', t.bold(C.mapNext)) : '';
      const medal = l.id.endsWith('capstone') ? t.emoji('cup') : p.complete && l.content?.badge ? t.emoji('badge') : '';
      const fitTitle = pad(cut(name, titleW + 1, t.unicode ? '…' : '.'), titleW + 1);
      const line = `${mark} ${t.pill(pad(lessonLabel(l.id), 3), pillBg, sel || p.complete ? 'white' : 'dimText')} ${fitTitle} ${bars ? `${mixBar(ctx, l, BAR)}  ` : ''}${pad(state, 5)}${medal ? ` ${medal}` : ''}`;
      return i ? [spacer('', 'lessons'), line] : [line];
    });
    return {
      head,
      // The footer says what the welcome's hint says: it gives way before a row.
      body: bars ? [...legend.map((x, i) => `${i ? ' '.repeat(width(C.help) + 2) : `${t.fg('muted', C.help)}  `}${x}`), SPACER, ...rows, SPACER, ...optional(para(t, C.mapFooter, W, 'muted'))] : rows,
      // Where the bar is short, as in ASCII at 60x20, "choose" gives way so
      // the arrows that switch level stay: the pointer shows what up and
      // down do.
      keys: [{ ...key(t.glyph.up, C.k.choose), short: '' }, levelsOf(s).length > 1 ? key(t.glyph.sides, C.k.level) : null, key('enter', C.k.open), key('m', C.k.back), key('q', C.k.quit)],
    };
  },

  // The lesson's check, item by item. Where the items don't all fit, the
  // page's address gives way (p shows it) and the items scroll: whole items
  // from s.itemsAt down, one a press of the arrows, with a line that says
  // which are shown, and never past the window that ends on the last item.
  // An item too tall for that room takes the card's other rows; the items
  // never drop, a toast does. Which rows the card has comes from the lesson
  // and what r and errors said, so a poll changes only marks.
  checkonly(ctx) {
    const { s, t, inner } = ctx;
    const l = lessonOf(s);
    const results = s.checks[l.id];
    const head = lessonHead(ctx, '', l.minutes);
    // A slow item a run left out shows as not checked yet. The mark of an
    // item that starts passing pops: hollow, a ring, then the check mark.
    const popping = into(ctx, 'itemPass');
    const passMark = (index) => (!s.fx.itemsPassed?.includes(index) || popping === Infinity ? t.glyph.check
      : popping < SHOTS.itemPass.pop ? t.glyph.dotOff : t.glyph.ring);
    const blocks = l.items.map((text, index) => {
      const r = results?.items?.find((x) => x.index === index);
      const mark = !r || r.slow ? t.fg('faint', t.glyph.dotOff) : r.pass ? t.fg('ok', passMark(index)) : t.fg('warn', t.glyph.warnMark);
      return kept(para(t, text, inner - 4).map((x, i) => `${i ? ' ' : mark} ${x}`));
    });
    const intro = [...sentence(t, checkOnlyWords(l), inner, 'text'), SPACER];
    const url = [...para(t, l.url, inner, 'key').map((x) => t.link(x, l.url)), SPACER];
    // What the runs said beyond the marks: kept, like a step's status line.
    // A slow item stays unchecked until r runs it; once r has, a poll keeps
    // its result (flow), so the line goes for good.
    const unchecked = !l.newCopy && l.slow.some((i) => !results?.items?.some((x) => x.index === i && !x.slow));
    const notes = [];
    if (unchecked) notes.push(SPACER, ...kept(para(t, `${t.lead('watch')}${C.slowWait}`, inner, 'muted')));
    if (results?.error) notes.push(SPACER, ...kept(para(t, `${t.lead('broken')}${C.broken(results.error)}`, inner, 'bad')));
    // The card's text rows: the body's room less the blank above the card,
    // its two borders and its first blank.
    const room = ctx.roomUnder(head.length) - 4;
    const rows = blocks.flat().length;
    let shown = blocks;
    let above = intro.length + url.length + rows + notes.length <= room ? [...intro, ...url] : intro;
    let more = [];
    let last = 0;
    if (above.length + rows + notes.length > room) {
      const avail = room - intro.length - notes.length - 1;
      last = blocks.length - 1;
      while (last > 0 && placesTo(blocks, last - 1, avail) === blocks.length) last--;
      const from = Math.min(s.itemsAt, last);
      const k = placesTo(blocks, from, avail);
      shown = blocks.slice(from, k);
      more = [t.fg('muted', k - from === 1 ? C.itemOf(from + 1, blocks.length) : C.itemsShown(from + 1, k, blocks.length))];
      // One item taller than that room: the line, then the sentence, give way.
      const tall = shown[0].length;
      if (tall > avail) more = [];
      if (tall > avail + 1) above = [];
    }
    return {
      head,
      body: card(ctx, { tint: 'muted', where: `${t.lead('terminal')}${C.where.terminal}`, done: s.progress[l.id].complete, rows: [...above, ...shown.flat(), ...more, ...notes], mood: checkOnlyMood(results) }),
      keys: [shown.length < blocks.length ? key(t.glyph.up, C.k.scroll) : null, l.newCopy ? null : key('r', C.k.checkNow), key('p', C.k.page), key('m', C.k.map), key('q', C.k.quit)],
      itemsMax: last,
    };
  },
};

function windows(ctx) {
  const { t, W } = ctx;
  const box = (title, lines, inner, color) => {
    const top = `${t.fg(color, `${t.glyph.tl}${t.glyph.rule}`)} ${t.bold(t.fg('white', title))} ${t.fg(color, `${t.glyph.rule.repeat(Math.max(0, inner - width(title) - 3))}${t.glyph.tr}`)}`;
    return [top, ...lines.map((l) => `${t.fg(color, t.glyph.rail)}${pad(l, inner)}${t.fg(color, t.glyph.rail)}`), t.fg(color, `${t.glyph.bl}${t.glyph.rule.repeat(inner)}${t.glyph.br}`)];
  };
  // Side by side, closer together below 66 columns.
  const wide = W >= 66;
  const left = box(C.thisWindow, [`  ${t.fg('code', 'npm run learn')}`, ...C.thisWindowLines.map((l) => `  ${t.fg('text', l)}`)], wide ? 26 : 22, 'accent');
  const right = box(C.otherWindow, C.otherWindowLines.map((l) => `  ${t.fg('text', l)}`), wide ? 27 : 26, 'key');
  // On entry one pulse crosses the arrow toward the other window, a cell at a time.
  const n = wide ? 2 : 1;
  const e = into(ctx, 'welcome');
  const k = e < SHOTS.welcome.pulse ? -1 : Math.floor((e - SHOTS.welcome.pulse) / SHOTS.welcome.cell);
  const [before, after] = wide ? ['  ', '   '] : [' ', ' '];
  const arrow = k >= 0 && k < n
    ? `${before}${t.fg('faint', t.glyph.rule.repeat(k))}${t.fg('key', t.glyph.bold)}${t.fg('faint', `${t.glyph.rule.repeat(n - k - 1)}${t.glyph.right}`)}${after}`
    : t.fg('faint', `${before}${t.glyph.rule.repeat(n)}${t.glyph.right}${after}`);
  return left.map((l, i) => `${l}${i === 2 ? arrow : ' '.repeat(width(arrow))}${right[i]}`);
}

// Pip with text beside it, from Pip's second row, or from its first when the
// text needs all four. Decoration: below 24 rows Pip can give way, leaving
// the text. Each part wraps to the width it is given.
function withPip(ctx, art, parts) {
  const text = (w) => parts.flatMap((part) => part(w));
  const beside = text(ctx.W - 13);
  const from = beside.length > 3 ? 0 : 1;
  const rows = Array.from({ length: Math.max(art.length, from + beside.length) }, (_, i) => {
    const x = beside[i - from];
    return x === undefined ? ` ${art[i] ?? ''}` : ` ${art[i] ?? ' '.repeat(9)}   ${x}`;
  });
  return decor(rows, text(ctx.W - 1).map((x) => ` ${x}`));
}

// One row per tier, climbing. A repeat: below 24 rows it compacts to one
// row, the mix bar and the pills of the easiest and hardest tiers present.
function staircase(ctx, m, done) {
  const { t } = ctx;
  const [g, h, c] = m;
  const glyphs = (tier, n) => t.fg(done ? 'ok' : TIER_STYLE[tier].tint, t.glyph[TIER_STYLE[tier].on].repeat(n));
  const row = (indent, tier, n) => `${' '.repeat(indent)}${glyphs(tier, n)}   ${tierPill(t, tier)}   ${t.fg('muted', C.tierHelp[tier])}`;
  const out = [];
  if (c) out.push(row(g + h + 4, 'challenge', c));
  if (h) out.push(row(g + 2, 'hinted', h));
  if (g) out.push(row(0, 'guided', g));
  const present = TIERS.filter((_, i) => m[i]);
  const ends = [...new Set([present[0], present.at(-1)])].map((tier) => tierPill(t, tier)).join(` ${t.fg('muted', t.glyph.right)} `);
  return [repeat(out, [`${bar(t, m, done)}   ${ends}`])];
}

// A mix as one row of tier marks, in the tiers' tints or, once done, green.
const bar = (t, m, done) => TIERS.map((k, i) => t.fg(done ? 'ok' : TIER_STYLE[k].tint, t.glyph[TIER_STYLE[k].on].repeat(m[i]))).join('');

// The cells of a lesson's climb on the map and the next screen.
const BAR = 12;

// A lesson's climb as `cells` tier marks, from its content: a lesson with
// no lesson file has none, so it draws blank cells.
function mixBar(ctx, lesson, cells) {
  const { s, t } = ctx;
  if (!lesson.content) return ' '.repeat(cells);
  const idx = s.course.findIndex((l) => l.id === lesson.id);
  return bar(t, scaleMix(mix(ruleTiers(s.course.map((l) => l.content), idx)), cells));
}

// ---- the step card -----------------------------------------------------------
// The level's first warm-up: the first step a lesson plays, on a warm-up,
// in the first lesson of its level that has warm-ups. It comes from the
// content and the step's place alone: nothing is saved.
const firstWarmupOfLevel = (s) => s.pos.step === 0
  && levelLessons(s, levelOf(s)).find((l) => l.content?.warmup.length)?.id === s.lesson;

function stepView(ctx) {
  const { s, t, inner } = ctx;
  const content = contentOf(s);
  const step = stepOf(s);
  const beat = beatOf(s);
  const st = s.beat;
  const tier = tierOf(s);
  const authored = authoredTier(s);
  const style = TIER_STYLE[tier];
  const done = ['done', 'already'].includes(st.status);
  const isLastBeat = s.pos.beat === step.beats.length - 1;
  const hideRuns = tier !== 'guided' && authored === 'guided';
  const inlineBottom = tier === 'guided' && authored !== 'guided';
  const rows = [t.bold(t.fg('white', beat.kind === 'type' && step.part === 'Check' ? C.lastQuestion : step.title))];
  if (step.part === 'Warm-up') {
    // A warm-up from another level names that level.
    const other = levelOf(s, step.from) !== levelOf(s);
    rows.push(t.fg('muted', C.warmup(lessonNumber(s, step.from), other ? levelName(s, step.from) : null)));
    if (firstWarmupOfLevel(s)) rows.push(...optional(para(t, C.warmupWhy, inner, 'muted')));
  }
  // At GUIDED the beat's reason, in the page's words, sits under the title;
  // a learner who knows the idea has it behind w.
  if (tier === 'guided' && ['do', 'ask'].includes(beat.kind) && beat.why.length) rows.push(...whyLine(t, beat.why[0], inner, 'accent'));
  const quoted = (text, color = 'muted') => para(t, text, inner, color, { quote: true });
  // As the step passes, each command still without a tick gets one, in turn.
  const passing = into(ctx, 'stepDone');
  let fresh = 0;
  // A satisfied "Done when": hidden where the evidence line replaces it, and
  // otherwise optional, since the card already says the step is done.
  const doneWhen = (lines) => (!done ? lines : showsEvidence(s, beat, isLastBeat) ? [] : optional(lines));

  if (beat.kind === 'self') rows.push(...led(t, 'self', beat.self, inner, 'white'));
  if (beat.kind === 'predict') {
    for (const l of beat.lines) if (l.key === 'note') rows.push(...quoted(l.text, 'text'));
  } else {
    beat.lines.forEach((l, i) => {
      const prevRun = beat.lines[i - 1]?.key === 'run';
      const nextRun = beat.lines[i + 1]?.key === 'run';
      if (l.key === 'run') {
        if (hideRuns) return;
        if (!prevRun && i > 0) rows.push(SPACER);
        const cmd = (t.caps.win32 && l.win) || withRoot(l.text, s.facts.root, t.caps.win32);
        const cw = chipWidth(ctx, beat);
        const long = cw + 22 <= inner;
        const live = l.tick === 'practice-dir' && s.facts.practiceDir;
        const checked = done && ['check', 'file'].includes(beat.verify.kind);
        // A live tick stays and takes no turn; each other command takes the next.
        const turn = checked && !live ? ++fresh : 0;
        const ticked = checked && (live || passing >= SHOTS.stepDone.tick * turn);
        const tick = live && !done ? `  ${t.fg('ok', long ? `${t.glyph.check} .practice/ exists` : t.glyph.check)}` : ticked ? `  ${t.fg('ok', t.glyph.check)}` : '';
        const lines = chip(t, cmd, beat.where, cw);
        rows.push(lines[0] + tick, ...lines.slice(1));
        if (!nextRun && i < beat.lines.length - 1) rows.push(SPACER);
      } else if (l.key === 'goal') {
        rows.push(...(tier === 'challenge' ? led(t, 'goal', l.text, inner, 'white') : para(t, l.text, inner, 'white')));
      } else if (l.doneWhen) rows.push(...doneWhen(para(t, l.text, inner, 'text')));
      else if (l.key === 'say' || l.key === 'do') rows.push(...para(t, l.text, inner, 'text'));
      else if (l.key === 'note') rows.push(...quoted(l.text, 'text'));
      else if (l.key === 'rule') rows.push(...led(t, 'safety', l.text, inner, 'text', { quote: true }));
      else if (l.key === 'after') {
        const aw = width(t.glyph.arrow) + 1;
        rows.push(...para(t, l.text, inner - aw, 'text').map((x, i) => `${i ? ' '.repeat(aw - 1) : t.fg('accent', t.glyph.arrow)} ${x}`));
      }
      else if (l.key === 'expect') {
        if (['check', 'file'].includes(beat.verify.kind)) rows.push(...doneWhen(para(t, `${C.doneWhen}${l.text}`, inner, 'muted')));
        else rows.push(...quoted(l.text));
      }
    });
    if (inlineBottom) {
      for (const b of beat.bottom) {
        const text = (t.caps.win32 && b.win) || b.text;
        rows.push(...(text.includes('`') ? para(t, text, inner, 'text') : chip(t, text, beat.where, chipWidth(ctx, beat))));
      }
    }
    const firstBeat = step.beats.findIndex((b) => b.kind !== 'predict');
    // "Done before" only when the app saw the learner do it.
    const before = doneBefore(s);
    if (tier === 'challenge' && OWN_PARTS.has(step.part) && s.pos.beat === firstBeat) rows.push(SPACER, ...para(t, before ? `${C.noCommands} ${C.doneEachPart}` : C.noCommands, inner, 'muted'));
    else if (before && stepNote(s) && s.pos.beat === firstBeat && !done) rows.push(SPACER, ...para(t, hintAvailable(s) ? C.doneBefore.hinted : C.doneBefore.challenge, inner, 'muted'));
    if (hideRuns && beat.lines.some((l) => l.key === 'run') && !done) rows.push(...para(t, C.pressH, inner, 'muted'));
  }
  // A Windows note never drops: without it the step breaks there.
  if (beat.winNote && t.caps.win32) rows.push(...kept(quoted(beat.winNote, 'text')));

  // The question, if this beat asks one.
  if (beat.kind === 'type') {
    rows.push(...kept(para(t, beat.ask, inner, 'white').map((x) => t.bold(x))), ...para(t, C.typeIt, inner, 'muted'), SPACER,
      ...kept([`  ${t.fg('muted', '›')} ${t.fg('code', st.status === 'done' && st.revealed ? '' : st.typed)}${st.status === 'done' ? '' : t.inverse(' ')}`]));
    if (st.status !== 'done') rows.push(SPACER, ...para(t, C.emptyShows, inner, 'muted'));
  } else if (beat.ask) {
    const recall = beat.recall ? Object.entries(s.progress[s.lesson].answers).find(([k]) => k.startsWith(`${beat.recall}.`)) : null;
    rows.push(SPACER);
    if (recall) rows.push(t.fg('muted', C.youGuessed(plainText(recall[1]))));
    // A safety choice says so on its own line; the question wraps under its lead.
    if (beat.kind === 'predict' && beat.safety) rows.push(...kept([`${t.lead('safety')}${t.fg('warn', C.safetyChoice)}`]));
    const prefix = t.lead('guess');
    rows.push(...kept(hang(prefix, para(t, beat.ask, inner - width(prefix), 'white').map((x) => t.bold(x)))));
    rows.push(SPACER, ...kept(options(ctx, beat)));
    if (beat.kind === 'predict' && !st.answer) rows.push(SPACER, ...para(t, C.anyAnswer, inner, 'muted'));
  }

  const footer = footerRows(ctx, { beat, content, isLastBeat });
  // Feedback, the hint box and the eased line: none of them drops.
  if (footer.length) rows.push(SPACER, ...kept(footer));

  const whereKey = beat.kind === 'do' ? beat.where : beat.kind;
  const whereEmoji = { terminal: 'terminal', claude: 'claude', shell: 'terminal', editor: 'editor', predict: 'guess', ask: 'guess', type: 'goal', self: 'self' }[whereKey];
  const where = `${t.lead(whereEmoji)}${C.where[whereKey]}`;
  const tint = done ? 'ok' : style.tint;
  return {
    head: lessonHead(ctx, tierPill(t, tier), C.stepOf(s.pos.step + 1, stepsOf(s).length)),
    body: card(ctx, { tint, where, done: done && ['check', 'file', 'git-clean'].includes(beat.verify.kind), rows, mood: stepMood(s, beat, isLastBeat) }),
    keys: stepKeys(ctx, { beat, step, content, done, isLastBeat }),
  };
}

// Pip's face for what the card shows the app saw (design 2.2): the step's
// last beat done or already done, as the cheer does (a beat before it rests,
// as the hop does); `opening`, while the card says "Checking" (a check, git
// or a file read); a check that could not run; a "Not yet", a `▲` git line,
// a pick that wasn't right, the hint box or the "Stuck?" offer; else at rest.
function stepMood(s, beat, isLastBeat) {
  const st = s.beat;
  if (['done', 'already'].includes(st.status)) return isLastBeat ? 'done' : 'rest';
  if (st.status === 'opening') return 'checking';
  if (st.status === 'broken') return 'broken';
  const gitLine = beat.verify.kind === 'git-clean' && st.status === 'waiting' && Boolean(s.git?.paths?.length);
  const wrong = ['wrong', 'stuck'].includes(st.feedback?.kind);
  const stuck = st.idle && hintAvailable(s);
  return st.status === 'fail' || gitLine || wrong || st.rung >= 0 || st.confirm || stuck ? 'worried' : 'rest';
}

// The check-only card: a check that could not run, an item not passing yet.
// Worried only where the card shows a failing mark: a slow item no run has
// checked shows as not checked yet.
function checkOnlyMood(results) {
  if (results?.error) return 'broken';
  return results?.items?.some((x) => !x.pass && !x.slow) ? 'worried' : 'rest';
}

// Chips in a beat share one width: room for the longest command, up to the
// card's width. A live tick beside a chip shortens to a mark when it won't fit.
const chipWidth = (ctx, beat) => {
  const longest = Math.max(...beat.lines.filter((l) => l.key === 'run').map((l) => Math.max(width(withRoot(l.text, ctx.s.facts.root, ctx.t.caps.win32)), width(l.win ?? ''))), ...beat.bottom.map((b) => Math.max(width(b.text), width(b.win ?? ''))), 10);
  // Room for the tick a done command gets beside its chip.
  return Math.min(ctx.inner - 2 - width(ctx.t.glyph.check), Math.max(longest + 4, 30));
};

function options(ctx, beat) {
  const { s, t, inner } = ctx;
  const st = s.beat;
  return beat.options.map((o, i) => {
    const chosen = st.answer?.index === i;
    const wrong = st.wrongs.includes(i);
    const right = st.answer && o.kind === 'right' && (st.revealed || chosen || (beat.kind === 'predict' && !beat.revealAt));
    const cursor = !st.answer && s.cursor === i;
    const mark = right ? t.fg('ok', t.glyph.check) : wrong ? t.fg('warn', t.glyph.warnMark) : cursor ? t.fg('key', t.bold(t.glyph.pointer)) : chosen ? t.fg('key', t.glyph.pointer) : ' ';
    const num = cursor ? t.inverse(t.fg('key', t.bold(` ${i + 1} `))) : t.fg('muted', ` ${i + 1} `);
    const color = right ? 'ok' : wrong || o.kind === 'other' ? 'muted' : cursor ? 'key' : 'text';
    const tag = wrong && st.wrongs.at(-1) === i && !st.answer ? `  ${t.fg('warn', `${t.unicode ? '←' : '<-'} not this one`)}` : '';
    // The option wraps short of the tag beside its first line.
    const text = para(t, o.text, inner - 10 - width(tag), color);
    return text.map((x, k) => (k ? `       ${x}` : ` ${mark} ${num}  ${cursor ? t.bold(x) : x}${tag}`));
  }).flat();
}

// The checking label, with the spinner in the cell after it once a child has
// run 150 ms, and from 3 s the seconds it has run (every label leaves room
// for both).
function spinning(ctx, lines) {
  const { t, ph } = ctx;
  if (ph.spinner === null) return lines;
  const spin = t.fg('key', t.glyph.spinner[ph.spinner % t.glyph.spinner.length]);
  const secs = ph.elapsed === null ? '' : `  ${t.fg('muted', C.seconds(ph.elapsed))}`;
  return [...lines.slice(0, -1), `${lines.at(-1)} ${spin}${secs}`];
}

function footerRows(ctx, { beat, content, isLastBeat }) {
  const { s, t, inner } = ctx;
  const st = s.beat;
  const rows = [];
  const quoted = (text, color = 'text') => para(t, text, inner - 2, color, { quote: true });
  const stepNumber = (id) => stepsOf(s).findIndex((x) => x.id === id) + 1;
  // A new "Not yet" line's mark pops from hollow.
  const warnMark = into(ctx, 'notYet') < SHOTS.notYet.pop ? t.glyph.warnPop : t.glyph.warnMark;
  // Room for text beside the burst.
  const room = inner - (t.unicode ? 21 : 7);
  const celebrate = (lines) => {
    const count = s.session + (firstPass(s) ? 1 : 0);
    // The check mark draws in strokes, then the sparks.
    const e = into(ctx, 'stepDone');
    const { strokes, stroke } = SHOTS.stepDone;
    const frame = e < strokes ? 0 : Math.min(4, 1 + Math.floor((e - strokes) / stroke));
    rows.push(...burst(t, [t.bold(t.fg('ok', C.stepDone(s.pos.step + 1))), ...lines, lead(t, 'fire', t.bold(t.fg('challenge', C.session(count))))], frame));
  };

  // What the beat watches, as its waiting line names it, or how far a run
  // of several items has got.
  if (st.status === 'opening') rows.push(...spinning(ctx, para(t, st.running?.m > 1 ? C.checkingItem(st.running.n, st.running.m) : C.checking(beat.watching ?? beat.evidence), inner, 'key')));
  else if (st.status === 'broken') rows.push(...para(t, `${t.lead('broken')}${C.broken(st.error)}`, inner, 'bad'));
  else if (st.status === 'already') {
    if (st.codespace) rows.push(...para(t, `${t.lead('verified')}"${beat.codespace}"`, inner, 'ok'));
    else rows.push(...para(t, `${t.lead('verified')}${beat.verify.all ? C.alreadyCheck : C.already}`, inner, 'ok'));
  }
  if (beat.verify.all && ['done', 'already'].includes(st.status) && s.checks[s.lesson]?.items) {
    const items = s.checks[s.lesson].items;
    rows.push(`${t.fg('ok', t.glyph.check)} ${t.fg('code', `npm run check -- ${s.lesson}`)} ${t.fg('ok', C.checkPasses(items.filter((x) => x.pass).length, items.length)[0])}`, ...para(t, C.runItToo(C.where[beat.where] ?? C.where.terminal), inner, 'muted'));
  } else if (st.status === 'done' && ['check', 'file'].includes(beat.verify.kind)) {
    // What the file holds, beside the burst; on two lines when one is too long.
    const one = `${beat.evidence} holds ${st.evidence}`;
    const ev = !showsEvidence(s, beat, isLastBeat) ? []
      : width(one) <= room ? [`${t.fg('code', beat.evidence)}${t.fg('text', ' holds ')}${t.fg('code', st.evidence)}`]
        : [t.fg('code', cut(beat.evidence, room, t.unicode ? '…' : '.')), `${t.fg('text', 'holds ')}${t.fg('code', cut(st.evidence, room - 6, t.unicode ? '…' : '.'))}`];
    if (isLastBeat) celebrate(ev.length ? ev : para(t, C.beatDone, room, 'text'));
    else rows.push(lead(t, 'verified', t.fg('ok', C.beatDone)));
  } else if (st.status === 'done' && beat.verify.kind === 'git-clean') {
    if (isLastBeat) celebrate(para(t, C.cleanCopy, room, 'text'));
    else rows.push(lead(t, 'verified', t.fg('ok', C.cleanCopy)));
  } else if (st.status === 'done') {
    const f = st.feedback;
    if (beat.kind === 'predict') {
      if (beat.revealAt) rows.push(t.fg('ok', C.findOutAt(stepNumber(beat.revealAt))));
      else {
        rows.push(t.fg('ok', st.answer.kind === 'right' ? `${t.glyph.check} ${C.guessRight}` : C.nowYouKnow));
        if (beat.reveal) rows.push(...quoted(beat.reveal));
      }
    } else if (f?.kind === 'right') {
      rows.push(t.bold(t.fg('ok', `${t.glyph.check} ${C.right}`)));
      if (beat.reveal) rows.push(...quoted(beat.reveal));
    } else if (f?.kind === 'revealed') {
      rows.push(t.fg('ok', C.theAnswer));
      if (beat.reveal) rows.push(...quoted(beat.reveal));
      else rows.push(t.fg('text', C.theAnswerIs(st.answer.index + 1)));
    } else if (f) {
      rows.push(t.fg('ok', f.kind === 'other' ? C.otherFine : `${t.glyph.check} ${C.answered}`));
      if (f.because) rows.push(...quoted(f.because));
      if (beat.reveal) rows.push(...quoted(beat.reveal));
      if (f.kind === 'other' && !f.because) rows.push(...para(t, C.stillStuck, inner, 'muted'));
    }
  } else if (st.status === 'waiting' && st.slowWait) {
    rows.push(...para(t, `${t.lead('watch')}${C.slowWait}`, inner, 'muted'));
  } else if (st.status === 'waiting' && ['check', 'file'].includes(beat.verify.kind)) {
    const [a, what, b] = (st.stale ? C.staleWatch : C.watching)(beat.watching ?? beat.evidence ?? 'your files');
    rows.push(...para(t, `${t.lead('watch')}${a}\`${what}\`${b}`, inner, 'muted'));
  } else if (beat.verify.kind === 'git-clean' && (st.status === 'waiting' || st.status === 'fail')) {
    const paths = s.git?.paths ?? [];
    if (st.status === 'fail' || paths.length) {
      const shown = (st.fail?.paths ?? paths).slice(0, 3).join(', ');
      rows.push(...para(t, `${st.status === 'fail' ? `${C.notYet} ` : ''}${C.gitDirty((st.fail?.paths ?? paths).length)} ${shown}`, inner - 2, 'warn').map((x, i) => (i ? `  ${x}` : `${t.fg('warn', st.status === 'fail' ? warnMark : t.glyph.warnMark)} ${x}`)));
      if (st.status === 'fail') rows.push(`  ${t.fg('muted', C.gitFailAfter)}`);
    } else rows.push(lead(t, 'watch', `${t.fg('muted', C.watchingGit)}${t.fg('code', 'git status')}${t.fg('muted', ':')} ${t.fg('ok', `${t.glyph.check} ${C.gitClean}`)}`));
  } else if (st.status === 'fail' && st.fail?.hint) {
    rows.push(...para(t, `${C.notYet} ${diagnosis(st.fail.hint)}`, inner - 2, 'text').map((x, i) => (i ? `  ${x}` : `${t.fg('warn', t.bold(warnMark))} ${x}`)));
  }

  // Feedback on a pick that wasn't right, before the answer.
  if (st.status !== 'done' && st.feedback) {
    const f = st.feedback;
    if (f.kind === 'wrong') {
      const box = [];
      if (f.because) {
        box.push(...para(t, `**${C.notQuite}** ${C.trueOfElse}`, inner - 2, 'text'), ...quoted(f.because));
        if (f.point) box.push(`${t.lead('hint')}${t.fg('text', C.lookFor)} ${para(t, f.point, inner - 14, 'warn', { quote: true })[0]}`);
      } else if (f.hint) box.push(`${t.bold(t.fg('warn', C.notQuite))}`, ...quoted(f.hint));
      else box.push(...para(t, `**${C.notQuite}** ${C.lookAgain}`, inner - 2, 'text'));
      rows.push(...hintBox(t, box));
    } else if (f.kind === 'stuck') rows.push(...hintBox(t, [...para(t, C.fixFirst, inner - 2, 'warn'), ...quoted(f.because), ...para(t, C.fixThenPick, inner - 2, 'muted')]));
  }

  // The hint box: one rung at a time, the y/n before the exact command.
  if (!['done', 'already'].includes(st.status)) {
    if (st.confirm) rows.push(...hintBox(t, [`${t.lead('hint')}${t.fg('warn', C.showExact)}`]));
    else if (st.rung >= 0) {
      const rungs = rungsOf(s);
      const r = rungs[st.rung] ?? { kind: 'quote', text: '' };
      const box = [];
      const hw = inner - 2 - Math.max(3, width(t.lead('hint')));
      if (r.kind === 'ask') box.push(...para(t, r.text, hw, 'warn'));
      else if (r.kind === 'check') box.push(t.fg('muted', C.checkSays), ...para(t, r.text, hw, 'text'));
      else if (r.kind === 'quote') box.push(...para(t, r.text, hw, 'warn', { quote: true }));
      else box.push(...r.lines.flatMap((b) => {
        const text = (t.caps.win32 && b.win) || withRoot(b.text, s.facts.root, t.caps.win32);
        return text.includes('`') ? para(t, text, hw, 'text') : chip(t, text, beat.where, Math.min(chipWidth(ctx, beat), hw));
      }));
      const more = st.rung < rungs.length - 1;
      const pad3 = ' '.repeat(Math.max(3, width(t.lead('hint'))));
      const lines = box.map((x, i) => (i ? `${pad3}${x}` : `${t.lead('hint')}${' '.repeat(Math.max(0, 3 - width(t.lead('hint'))))}${x}`));
      if (more) lines.push(`   ${t.fg('muted', C.pressHAgain)}`);
      rows.push(...hintBox(t, lines));
    } else if (hintStatus(st) === 'fail' && hintAvailable(s)) rows.push(...para(t, C.pressH, inner - 2, 'muted').map((x) => `  ${x}`));
    else if (st.idle && hintAvailable(s)) rows.push(t.fg('warn', C.stuckOffer));
  }
  if (st.eased && !['done', 'already'].includes(st.status) && s.pos.beat === 0) rows.push(...para(t, C.eased, inner, 'muted'));
  return rows;
}

// Whether a done beat's footer draws the evidence line: what the file holds.
const showsEvidence = (s, beat, isLastBeat) => isLastBeat && s.beat.status === 'done' && ['check', 'file'].includes(beat.verify.kind)
  && Boolean(beat.evidence && s.beat.evidence) && !(beat.verify.all && s.checks[s.lesson]?.items);

// The first clause of a check's FAIL message: what is wrong, before how to fix it.
export function diagnosis(hint) {
  let code = false;
  for (let i = 0; i < hint.length; i++) {
    if (hint[i] === '`') code = !code;
    if (code) continue;
    if (hint.startsWith('. ', i)) return hint.slice(0, i + 1);
    // A colon that introduces a short list of names, such as the files a check
    // found, belongs to what is wrong: keep the list.
    if (hint.startsWith(': ', i)) {
      const rest = hint.slice(i + 2);
      const end = rest.search(/\.(\s|$)/);
      const list = end === -1 ? rest : rest.slice(0, end);
      if (/^[^\s`]+(, [^\s`]+)*$/.test(list)) return hint.slice(0, i + 2 + list.length + 1);
      return hint.slice(0, i);
    }
  }
  return hint;
}

function stepKeys(ctx, { beat, step, content, done, isLastBeat }) {
  const { s, t } = ctx;
  const st = s.beat;
  const tier = tierOf(s);
  const style = TIER_STYLE[tier];
  const card = cardKey(s);
  if (st.confirm) return [mainKey('y', C.k.yes, 'warn', 'black'), key('n', C.k.no)];
  if (done) {
    const next = isLastBeat ? stepsOf(s)[s.pos.step + 1] : null;
    const label = next ? C.k.nextTo(next.title) : C.k.next;
    return [mainKey('enter', label, undefined, undefined, C.k.next), key('b', C.k.back), beat.why.length ? key('w', C.k.why) : null, key('m', C.k.map), card, key('q', C.k.quit)];
  }
  if (beat.kind === 'type') return [key('enter', C.k.answer), key('esc', C.k.clear), key('ctrl+c', C.k.quit)];
  const hint = hintAvailable(s) ? key('h', st.rung >= 0 ? C.k.moreHelp : hintStatus(st) === 'fail' ? C.k.help : C.k.hint) : null;
  const why = beat.why.length ? key('w', C.k.why) : null;
  if (beat.ask && !st.answer) {
    return [key(t.glyph.up, C.k.choose), key('enter', C.k.answer), st.wrongs.length && beat.kind !== 'predict' ? key('s', C.k.showAnswer) : null, hint, why, key('q', C.k.quit)];
  }
  const v = beat.verify.kind;
  if (v === 'self' || v === 'none' || beat.kind === 'self' || (v === 'git-clean' && beat.doneLabel)) {
    const k = v === 'none' ? 'enter' : 'space';
    // A done-label git beat at CHALLENGE: r is the try that opens h, so offer it.
    const r = !hint && tier === 'challenge' && tryFirst(s) === 'r' && !st.unlocked && rungsOf(s).length ? key('r', C.k.checkNow) : null;
    return [mainKey(k, beat.doneLabel ?? C.k.next, style.bg, style.fgOnBg), hint ?? r, why, key('m', C.k.map), card, key('q', C.k.quit)];
  }
  const r = hintStatus(st) === 'fail' ? key('r', C.k.checkAgain) : key('r', C.k.checkNow);
  return [hint, r, why, key('m', C.k.map), hint ? null : key('?', C.k.more), card, key('q', C.k.quit)];
}
// The next screen's enter: the next lesson, or the map after the last.
const nextKey = (s) => {
  const next = nextLessonOf(s);
  return next ? mainKey('enter', C.k.startN(lessonLabel(next.id))) : mainKey('enter', C.k.map);
};
// `c card`, once the card has an entry. It is low: a bar too narrow for it
// gives it up before the main key's long label, and it sits before q, so
// a short bar drops it first too.
const cardKey = (s) => (cardOf(s).length ? { ...key('c', C.k.card), low: true } : null);

// ---- overlays ----------------------------------------------------------------
// Whole places (each a run of rows) from place `from` on, as many as `avail`
// rows hold: the first always, then each next one while it fits. `first` is
// the rows the first takes on screen. Returns the index after the last
// shown. The card overlay and the check-only card scroll by it.
function placesTo(places, from, avail, first = places[from].length) {
  let k = from + 1;
  let used = first;
  while (k < places.length && used + places[k].length <= avail) used += places[k++].length;
  return k;
}

// The card's layout: a title, its intro and `units`, the entries' rows,
// then the guide's Commands by level page. Where it is taller than its
// room, it shows whole places from s.cardAt down, one a press of the
// arrows: each entry is a place, and the link is the last, so the last
// place always shows it, a toast or not. `scroll` is the arrows' key, or null.
function cardPlaces(ctx, units, title, intro) {
  const { s, t, inner, room } = ctx;
  const head = [t.bold(t.fg('white', title)), ...para(t, intro, inner, 'muted'), ''];
  // Under an entry, the link keeps a blank above it.
  const places = [...units, [...(units.length ? [''] : []), t.fg('text', C.cardLink), ...para(t, COMMANDS_URL, inner, 'key').map((x) => t.link(x, COMMANDS_URL))]];
  const avail = room - head.length;
  const from = places.flat().length <= avail ? 0 : Math.min(s.cardAt, places.length - 1);
  // The first place shown never opens on a blank: the link's goes there.
  const shown = places[from][0] === '' ? places[from].slice(1) : [...places[from]];
  const k = placesTo(places, from, avail, shown.length);
  shown.push(...places.slice(from + 1, k).flat());
  return { body: [...head, ...shown], scroll: from > 0 || k < places.length ? key(t.glyph.up, C.k.scroll) : null };
}

// The fewest columns the comparison gives what a command does beside it.
const COMPARE_MIN = 24;

const OVERLAYS = {
  why(ctx) {
    const { s, t, inner } = ctx;
    return {
      body: [t.bold(t.fg('white', C.why)), SPACER, ...beatOf(s).why.flatMap((w) => para(t, w, inner, 'text', { quote: true }))],
      keys: [key('w', C.k.close), key('q', C.k.close)],
    };
  },
  help(ctx) {
    const { t, inner, rows, room } = ctx;
    // A key padded as drawn: ASCII spells some arrows wider.
    const row = ([k, label]) => `  ${t.fg('key', t.bold(pad(t.unicode ? k : ascii(k), 10)))}${t.fg('text', label)}`;
    // The calm line drops before any key or blank does: it shows only on
    // one row, from 24 rows, where the keys and their blanks leave room.
    const calm = rows >= 24 && width(C.calm) <= inner;
    const list = [...C.keyHelp];
    // ← → on the map, under the arrows' row, where the course has more than
    // one level.
    if (levelsOf(ctx.s).length > 1) list.splice(list.findIndex(([k]) => k.startsWith('↑')) + 1, 0, C.levelKey);
    const keys = list.map(row);
    // c's row, under p's, shows only where every key, blank and the calm
    // line leave it room, so it never costs a blank: 60x20 gives it up.
    if (room >= 3 + keys.length + (calm ? 2 : 0) && width(row(C.cardKey)) <= inner) keys.splice(list.findIndex(([k]) => k === 'p') + 1, 0, row(C.cardKey));
    return {
      body: [t.bold(t.fg('white', C.keysTitle)), SPACER, ...keys, ...(calm ? optional(['', ...para(t, C.calm, inner, 'muted')]) : [])],
      keys: [key('?', C.k.close), key('q', C.k.close)],
    };
  },
  // Your card: the entries from cardOf, each its lesson, the page's command
  // and what it does.
  card(ctx) {
    const { s, t, inner } = ctx;
    // What it does hangs under the command, past the lesson's pill.
    const units = cardOf(s).map((e) => {
      const label = `${t.pill(pad(lessonLabel(e.lesson), 3), 'dimBg', 'dimText')}  `;
      return [`${label}${t.fg('code', e.show)}`, ...hang(' '.repeat(width(label)), para(t, e.does, inner - width(label), 'text', { quote: true }))];
    });
    const { body, scroll } = cardPlaces(ctx, units, C.cardTitle, units.length ? C.cardIntro : C.cardEmpty);
    return { body, keys: [scroll, key('c', C.k.close), key('q', C.k.close)] };
  },
  // Recall, then compare: the lesson's own entries, whole as soon as space
  // asks. One lesson needs no pill, so what it does sits beside the command,
  // or under it, as on the card, where a long command would leave it less
  // than COMPARE_MIN columns. Enter goes on as from the next screen; space
  // goes back to it.
  compare(ctx) {
    const { s, t, inner } = ctx;
    const entries = recallOf(s);
    const col = Math.max(0, ...entries.map((e) => width(e.show))) + 3;
    const units = entries.map((e) => (inner - col >= COMPARE_MIN
      ? hang(t.fg('code', pad(e.show, col)), para(t, e.does, inner - col, 'text', { quote: true }))
      : [t.fg('code', e.show), ...hang('   ', para(t, e.does, inner - 3, 'text', { quote: true }))]));
    const { body, scroll } = cardPlaces(ctx, units, C.compareTitle(lessonLabel(s.lesson)), C.compareIntro);
    return { body, keys: [nextKey(s), scroll, key('space', C.k.close), key('q', C.k.close)] };
  },
  page(ctx) {
    const { s, t, inner } = ctx;
    const step = s.view === 'step' ? stepOf(s) : null;
    // A warm-up recalls an earlier lesson: its page is that lesson's.
    const l = step?.part === 'Warm-up' ? lessonOf(s, step.from) : lessonOf(s);
    const anchor = step && step.part !== 'Warm-up' ? `#${step.part.toLowerCase().replace(/ /g, '-')}` : '';
    const url = `${l.url}${anchor}`;
    const stuck = l.content?.stuck ?? l.stuck;
    // Go further with its address spelled out, for a terminal with no links.
    // The parser holds a read line to one link.
    const read = l.content?.intro.read;
    return {
      body: [t.bold(t.fg('white', C.pageTitle)), ...para(t, url, inner, 'key').map((x) => t.link(x, url)), SPACER,
        t.fg('text', C.stuckLink), ...para(t, stuck, inner, 'key').map((x) => t.link(x, stuck)),
        ...(read ? [SPACER, ...goFurther(t, read, inner, absolute(inline(read).find((r) => r.url).url))] : [])],
      keys: [key('p', C.k.close), key('q', C.k.close)],
    };
  },
};
