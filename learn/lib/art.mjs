// Pip the mascot, block-letter banners, the check burst and confetti. Each
// has a plain ASCII form. Nothing here is random: the same screen draws the
// same art every time.
import { SHOTS, TIMING } from './motion.mjs';
import { PALETTE, rasterizePip, renderPip, restPose, SIZES } from './pip/pip.mjs';
import { width } from './text.mjs';

// Pip is the pip-terminal package's (pip/pip.mjs, as it ships): its glyph
// art, colored here by the theme. Each mood is one of the package's states
// at rest, so Pip shows only what the app saw: the big Pip's happy, focus
// and party, and the card's rest, checking, worried, done and broken.
const STATE = { happy: 'ready', focus: 'working', party: 'success', rest: 'ready', checking: 'working', worried: 'retry', done: 'success', broken: 'error' };
// Worried keeps the package's asymmetric retry: its right eye half shut.
const MOOD = { worried: { right: 0.6 } };
// A one-shot's frame, over the mood: eyes shut, waking or awake, with a
// smile whatever the mood's mouth (a shut eye over a flat mouth would read
// as one rule); a glance toward the other window, which is the greeting's
// look right too, and its look left or up (176); a cheer's happy eyes and
// sparks, or happy eyes alone; or a hop's sparks alone, its eyes the mood's.
const OPEN = { left: 1, right: 1, happy: 0, smile: 1 };
const FRAME = {
  shut: { ...OPEN, left: 0, right: 0 }, waking: { ...OPEN, left: 0.45, right: 0.45 }, awake: OPEN,
  glance: { ...OPEN, gazeX: 0.7 }, lookLeft: { ...OPEN, gazeX: -0.7 }, lookUp: { ...OPEN, gazeY: -0.7 },
  cheer: { happy: 1, smile: 1.2, spark: 1 }, glad: { happy: 1, smile: 1.2 }, sparks: { spark: 1 },
};
// ASCII Pip is still, with three faces: at rest, checking, and done.
// Broken draws as rest, since the package's ASCII error face is checking's.
const ASCII_STATE = { ...STATE, broken: STATE.rest };
const over = (mood, frame) => ({ ...restPose(STATE[mood]), ...MOOD[mood], ...FRAME[frame] });
// Pip's pose `ms` into `face`: a FRAME name, none for the mood's own face,
// or a track of [ms, frame] keyframes (motion.mjs's SHOTS), each frame over
// the mood and each value interpolated linearly between the keyframes
// either side, so only the package's glyphs step (181).
function poseOf(t, mood, face, ms = 0) {
  if (!t.unicode) return restPose(ASCII_STATE[mood]);
  const keys = Array.isArray(face) ? face : [[0, face ?? null]];
  const k = keys.findIndex(([at]) => at > ms);
  const [[from, a], [to, b]] = k > 0 ? [keys[k - 1], keys[k]] : [keys.at(k), keys.at(k)];
  const [p, q] = [over(mood, a), over(mood, b)];
  const u = to > from ? (ms - from) / (to - from) : 0;
  return Object.fromEntries(Object.entries(q).map(([key, v]) => [key, typeof v === 'number' ? p[key] + (v - p[key]) * u : v]));
}

// Each cell's color, by its place: o the outline, e the eyes, antenna and
// sparks, m the mouth. A run of one color takes one code; a blank, none.
// The places mirror the package's glyph rows, which it does not export; a
// newer pip.mjs fails the test that pins its hash, so they get rechecked.
const INK = { o: 'pipOutline', e: 'pipEyes', m: 'pipMouth' };
function ink(t, row, places) {
  const cells = [...row];
  const key = cells.map((ch, i) => (ch === ' ' ? ' ' : places[i])).join('');
  let at = 0;
  return key.match(/(.)\1*/g).map((run) => {
    const s = cells.slice(at, (at += run.length)).join('');
    return run[0] === ' ' ? s : t.fg(INK[run[0]], s);
  }).join('');
}

// The big Pip, 4 rows of 9 cells: its antenna, its head (the antenna's foot
// in `┴`), its face, its chin. A one-shot's `face`, `ms` in, sets its eyes
// and smile: shut, waking or awake, or, to cheer, happy with sparks beside
// the antenna. ASCII Pip is still.
export function pip(t, mood = 'happy', face, ms) {
  const places = ['eeeeeeeee', t.unicode ? 'ooooeoooo' : 'ooooooooo', 'o  eme  o', 'ooooooooo'];
  return renderPip(poseOf(t, mood, face, ms), { size: 'glyph', depth: 1, unicode: t.unicode }).map((row, i) => ink(t, row, places[i]));
}

// The detailed Pip, the package's half-cell raster at its standard size,
// for a truecolor screen with rows to spare (render.mjs's pipSlot). Each
// cell is two of its pixels, over and under. `face` is the row its eyes
// are on.
export const PIP_RASTER = {
  standard: { cols: SIZES.standard[0], rows: SIZES.standard[1], face: 9 },
};

// The detailed Pip's greeting on the welcome and resume (176): a layer over
// the controller's `pose`, a pure function of the `ms` since the screen
// arrived, exactly nothing at 0 and from TIMING.greet on, at the moments of
// SHOTS.greet.raster. Its eyes widen and its antenna flicks; then its eyes
// turn happy and its antenna waves like a hand, slow swings that ease in
// and out, with a hop and a spark at each of its hops; between the hops its
// eyes, open again, look left, right and up. At the end all of it eases
// back to the pose.
const bump = (u) => (u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u) ** 2);
const rise = (ms, from, to) => {
  const u = Math.min(1, Math.max(0, (ms - from) / (to - from)));
  return u * u * (3 - 2 * u);
};
export function pipGreeting(pose, ms) {
  if (!(ms > 0 && ms < TIMING.greet)) return pose;
  const at = SHOTS.greet.raster;
  const wide = bump(ms / at.wide);
  const back = 1 - rise(ms, at.back, TIMING.greet);
  const happy = rise(ms, at.wide, at.glad) * (1 - rise(ms, at.open, at.look)) + rise(ms, at.again, at.hops[1]) * back;
  const wave = rise(ms, at.wide, at.waved) * back * Math.sin((2 * Math.PI * (ms - at.wide)) / at.swing);
  const hop = at.hops.reduce((n, from) => n + bump((ms - from) / at.hop), 0);
  return {
    ...pose,
    left: pose.left + 0.2 * wide,
    right: pose.right + 0.2 * wide,
    happy: Math.min(1, pose.happy + happy),
    antenna: pose.antenna + 0.03 * wide * Math.sin((2 * Math.PI * ms) / at.wide) + 0.05 * wave,
    lift: pose.lift + 0.03 * hop,
    spark: Math.min(1, pose.spark + hop),
    // Left then right, from `look` to `up`, then up to `again`.
    gazeX: pose.gazeX - (ms > at.look && ms < at.up ? Math.sin((2 * Math.PI * (ms - at.look)) / (at.up - at.look)) : 0),
    gazeY: pose.gazeY - bump((ms - at.up) / (at.again - at.up)),
  };
}

// The package's quintic ease, which it does not export.
const ease = (u) => {
  const v = Math.min(1, Math.max(0, u));
  return v * v * v * (v * (v * 6 - 15) + 10);
};

// The detailed Pip as the frame at `at` shows it: the controller's `pose`
// with the greeting `greetMs` in, and where main saw it jump (181), eased
// from the pose shown then, `fade.from`, over `fade.ms` from `fade.at`.
export function pipShown({ pose, fade }, greetMs, at) {
  const live = pipGreeting(pose, greetMs);
  if (!fade || !(at < fade.at + fade.ms)) return live;
  const u = ease((at - fade.at) / fade.ms);
  return Object.fromEntries(Object.entries(live).map(([k, v]) => [k, typeof v === 'number' ? fade.from[k] + (v - fade.from[k]) * u : v]));
}

// `pose` from the package's controller, as `rows` lines of `cols` cells.
// The package paints its own backdrop (#1E1E1E) and softens each edge
// toward it. Here the backdrop is the terminal's own background, so no
// rectangle shows on another one. The package blends linearly, so one pass
// in a code palette gives each pixel's cover and its mix of Pip's colors:
// red is how much of it is Pip, green how much is gold, blue how much is
// mouth, the rest outline. The terminal's own background shows where Pip
// covers under a quarter of a pixel (PIP_INK); any other pixel is drawn in
// Pip's own colors, unmixed with a backdrop, so an edge that breathing
// moves is never a dark speck on a light terminal, and a shut eye still
// shows. A cell with both halves background is a space, one ink half is `▀`
// or `▄` over the default background, two are `▀` in both colors, in
// 24-bit color. Without a pose, blank rows of the same size (to measure a
// screen with it).
export const PIP_INK = 0.25;
const CODES = { background: '#000000', outline: '#FF0000', eyes: '#FFFF00', mouth: '#FF00FF' };
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const [OUTLINE, GOLD, MOUTH] = [PALETTE.outline, PALETTE.eyes, PALETTE.mouth].map(rgb);
export function pipRaster(pose, size) {
  const { cols, rows } = PIP_RASTER[size];
  if (!pose) return Array.from({ length: rows }, () => ' '.repeat(cols));
  const px = rasterizePip(pose, { columns: cols, rows, palette: CODES }).pixels;
  const inked = (at) => px[at] / 255 >= PIP_INK;
  const codes = new Map();
  const code = (at, bg) => {
    // Each color's share of the pixel, in 255ths: their sum is its cover,
    // or a little over where the package's rounding leaves gold and mouth
    // over it, so the color is a mix of Pip's own either way.
    const [gold, mouth] = [px[at + 1], px[at + 2]];
    const outline = Math.max(0, px[at] - gold - mouth);
    const sum = outline + gold + mouth;
    const c = [0, 1, 2].map((k) => Math.round((OUTLINE[k] * outline + GOLD[k] * gold + MOUTH[k] * mouth) / sum));
    const key = `${bg}:${c.join(',')}`;
    if (!codes.has(key)) codes.set(key, `${bg ? 48 : 38};2;${c.join(';')}`);
    return codes.get(key);
  };
  return Array.from({ length: rows }, (_, row) => {
    let line = '';
    let fg = null;
    let bg = null;
    for (let col = 0; col < cols; col++) {
      const over = (row * 2 * cols + col) * 3;
      const under = over + cols * 3;
      const ink = [inked(over), inked(under)];
      // A space shows only its background, so it keeps the foreground.
      const [ch, f, b] = !ink[0] && !ink[1] ? [' ', fg, null]
        : !ink[1] ? ['▀', code(over, false), null]
          : !ink[0] ? ['▄', code(under, false), null]
            : ['▀', code(over, false), code(under, true)];
      const set = [...(f !== fg ? [f ?? '39'] : []), ...(b !== bg ? [b ?? '49'] : [])];
      if (set.length) line += `\x1b[${set.join(';')}m`;
      [fg, bg] = [f, b];
      line += ch;
    }
    return fg || bg ? `${line}\x1b[39;49m` : line;
  });
}

// Pip's small face for a card's top border, 7 cells: ` [●‿●] `. Its moods
// name what the card shows (rest, checking, worried, done, broken), apart
// from the big Pip's happy, focus and party. A one-shot's `face`, `ms` in,
// is a pose over that face: eyes shut, a glance, or a hop's or cheer's
// sparks, which one row has no antenna for, on its sides: `+[●‿●]+`.
export const PIP_FACE = 7;
export function pipFace(t, mood, face, ms) {
  const pose = poseOf(t, mood, face, ms);
  const [row] = renderPip(pose, { size: 'compact', depth: 1, unicode: t.unicode });
  return ink(t, pose.spark > 0.5 ? `+${row.slice(1, -1)}+` : row, 'eoemeoe');
}

const FONT = {
  L: ['█  ', '█  ', '█▄▄'], E: ['█▀▀', '█▀▀', '█▄▄'], V: ['█ █', '█ █', '▀▄▀'], U: ['█ █', '█ █', '█▄█'],
  P: ['█▀█', '█▀▀', '█  '], C: ['█▀▀', '█  ', '█▄▄'], O: ['█▀█', '█ █', '█▄█'], M: ['█▀▄▀█', '█ ▀ █', '█   █'],
  T: ['▀█▀', ' █ ', ' █ '], ' ': [' ', ' ', ' '],
};
const HEAT = ['guided', 'guided', 'heat2', 'hinted', 'hinted', 'heat4', 'accent', 'challenge'];

// A three-row banner, colored cool to hot; one bold word in ASCII mode.
// `reveal` shows part of it: its first `cells`, behind a moving edge (a
// wipe), or its first `letters` (a stamp).
export function banner(t, word, { cells = Infinity, letters = Infinity } = {}) {
  if (!t.unicode) return [t.bold(word)];
  const rows = ['', '', ''];
  let used = 0;
  [...word].forEach((ch, i) => {
    if (i >= letters) return;
    const sep = i ? 1 : 0;
    for (let r = 0; r < 3; r++) {
      // Every glyph in FONT is one UTF-16 unit, so slicing counts cells.
      const shown = `${' '.repeat(sep)}${FONT[ch][r]}`.slice(0, Math.max(0, cells - used));
      const body = shown.slice(sep);
      rows[r] += shown.slice(0, sep) + (ch === ' ' ? body : t.fg(HEAT[i % HEAT.length], body));
    }
    used += sep + FONT[ch][0].length;
  });
  return cells < bannerWidth(word) ? rows.map((r) => `${r}${t.fg('accent', t.glyph.bar)}`) : rows;
}
export const bannerWidth = (word) => [...word].reduce((n, ch) => n + FONT[ch][0].length, 0) + word.length - 1;

// The check burst beside a celebration's three lines. `frame` 0 is blank
// art, 1 to 3 the check mark's strokes, 4 (the default) the sparks too.
export function burst(t, lines, frame = 4) {
  const p = (s, color, from) => (frame >= from ? t.fg(color, s) : ' '.repeat(width(s)));
  const art = t.unicode
    ? [`${p('✦', 'gold', 4)}          ${p('▄█▀', 'ok', 3)}   ${p('·', 'accent', 4)}`,
      ` ${p('▀█▄', 'ok', 1)}    ${p('▄█▀', 'ok', 2)}    ${p('✦', 'key', 4)}`,
      `${p('·', 'accent', 4)}  ${p('▀█▄█▀', 'ok', 2)}     ${p('·', 'gold', 4)}`]
    : ['    /', ' \\ /', '  V'];
  const w = t.unicode ? 21 : 7;
  return lines.map((l, i) => `${art[i] ?? ''}${' '.repeat(Math.max(0, w - width(art[i] ?? '')))}${l}`);
}

// A row of confetti, a glyph every 6 columns; all of them by default. As it
// falls, `frame` picks which show, by index: the first `shown`, or, on turn
// `turn`, every other glyph, the odd ones in one `row` and the even ones in
// the other, changing places each turn.
export function confetti(t, cols, frame) {
  const glyphs = t.unicode ? ['✦', '·', '◆', '•', '✧', '■'] : ['*', '.', '+', 'o', 'x', '#'];
  const colors = ['gold', 'key', 'accent', 'ok', 'challenge', 'hinted'];
  const shows = (i) => (!frame ? true : frame.shown !== undefined ? i < frame.shown : (i + frame.turn + frame.row) % 2 === 0);
  const out = [];
  for (let i = 0; i * 6 < cols - 1; i++) out.push(shows(i) ? t.fg(colors[i % colors.length], glyphs[i % glyphs.length]) : ' ');
  return out.join('     ').trimEnd();
}
