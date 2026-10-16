// Pip the mascot, block-letter banners, the check burst and confetti. Each
// has a plain ASCII form. Nothing here is random: the same screen draws the
// same art every time.
import { rasterizePip, renderPip, restPose, SIZES } from './pip/pip.mjs';
import { width } from './text.mjs';

// Pip is the pip-terminal package's (pip/pip.mjs, as it ships): its glyph
// art, colored here by the theme. Each mood is one of the package's states
// at rest, so Pip shows only what the app saw: the big Pip's happy, focus
// and party, and the card's rest, checking, worried, done and broken.
const STATE = { happy: 'ready', focus: 'working', party: 'success', rest: 'ready', checking: 'working', worried: 'retry', done: 'success', broken: 'error' };
// Worried keeps the package's asymmetric retry: its right eye half shut.
const MOOD = { worried: { right: 0.6 } };
// A one-shot's `frame`, over the mood: eyes shut, waking or awake, with a
// smile whatever the mood's mouth (a shut eye over a flat mouth would read
// as one rule); a glance toward the other window; a cheer's happy eyes and
// sparks; or a hop's sparks alone, its eyes the mood's.
const OPEN = { left: 1, right: 1, happy: 0, smile: 1 };
const FRAME = {
  shut: { ...OPEN, left: 0, right: 0 }, waking: { ...OPEN, left: 0.45, right: 0.45 }, awake: OPEN,
  glance: { ...OPEN, gazeX: 0.7 }, cheer: { happy: 1, smile: 1.2, spark: 1 }, sparks: { spark: 1 },
};
// ASCII Pip is still, with three faces: at rest, checking, and done.
// Broken draws as rest, since the package's ASCII error face is checking's.
const ASCII_STATE = { ...STATE, broken: STATE.rest };
const poseOf = (t, mood, frame) => (t.unicode
  ? { ...restPose(STATE[mood]), ...MOOD[mood], ...FRAME[frame] }
  : restPose(ASCII_STATE[mood]));

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
// in `┴`), its face, its chin. A one-shot's `frame` sets its eyes and
// smile: shut, waking or awake, or, to cheer, happy with sparks beside the
// antenna. ASCII Pip is still.
export function pip(t, mood = 'happy', frame) {
  const places = ['eeeeeeeee', t.unicode ? 'ooooeoooo' : 'ooooooooo', 'o  eme  o', 'ooooooooo'];
  return renderPip(poseOf(t, mood, frame), { size: 'glyph', depth: 1, unicode: t.unicode }).map((row, i) => ink(t, row, places[i]));
}

// The detailed Pip, the package's half-cell raster at one of its sizes, for
// a screen with rows to spare (render.mjs's pipSlot). Each cell is two of
// its pixels, over and under. `face` is the row its eyes are on.
export const PIP_RASTER = {
  small: { cols: SIZES.small[0], rows: SIZES.small[1], face: 5 },
  standard: { cols: SIZES.standard[0], rows: SIZES.standard[1], face: 9 },
};
// The package's 256-color picks: the xterm cube and grays (pip.mjs's own,
// which it does not export).
const XTERM = Array.from({ length: 240 }, (_, i) => {
  if (i >= 216) return [8 + (i - 216) * 10, 8 + (i - 216) * 10, 8 + (i - 216) * 10];
  const levels = [0, 95, 135, 175, 215, 255];
  return [levels[Math.floor(i / 36)], levels[Math.floor(i / 6) % 6], levels[i % 6]];
});
function xterm(c) {
  let best = 0;
  let far = Infinity;
  XTERM.forEach((p, i) => {
    const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
    if (d < far) [best, far] = [i, d];
  });
  return 16 + best;
}

// `pose` from the package's controller, as `rows` lines of `cols` cells.
// The package paints its own backdrop and softens each edge toward it; here
// the backdrop is the terminal's own background, whatever it is, so neither
// a rectangle nor a dark rim shows on another. The pose is rasterized over
// black and over white: where the two differ the backdrop shows through, by
// as much as they differ. A pixel at least half Pip is Pip's own color,
// unmixed; one less is background. A cell with both halves background is a
// space, one ink half is `▀` or `▄` over the default background, two are
// `▀` in both colors. 256 colors, or 24-bit where the terminal reports it.
// Without a pose, blank rows of the same size (to measure a screen with it).
export function pipRaster(t, pose, size) {
  const { cols, rows } = PIP_RASTER[size];
  if (!pose) return Array.from({ length: rows }, () => ' '.repeat(cols));
  const dark = rasterizePip(pose, { columns: cols, rows, palette: { background: '#000000' } }).pixels;
  const light = rasterizePip(pose, { columns: cols, rows, palette: { background: '#FFFFFF' } }).pixels;
  // How much of the pixel at `at` is Pip, 0 to 1: over black it is that
  // much of Pip's color, so its color is that divided by it.
  const cover = (at) => 1 - (light[at] - dark[at] + light[at + 1] - dark[at + 1] + light[at + 2] - dark[at + 2]) / 765;
  const inked = (at) => cover(at) >= 0.5;
  const codes = new Map();
  const code = (at, bg) => {
    const a = cover(at);
    const c = [0, 1, 2].map((k) => Math.min(255, Math.round(dark[at + k] / a)));
    const key = `${bg}:${c.join(',')}`;
    if (!codes.has(key)) codes.set(key, t.depth >= 24 ? `${bg ? 48 : 38};2;${c.join(';')}` : `${bg ? 48 : 38};5;${xterm(c)}`);
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
// from the big Pip's happy, focus and party. A one-shot's `frame` is a pose
// over that face: eyes shut, a glance, or a hop's or cheer's sparks, which
// one row has no antenna for, on its sides: `+[●‿●]+`.
export const PIP_FACE = 7;
export function pipFace(t, mood, frame) {
  const pose = poseOf(t, mood, frame);
  const [face] = renderPip(pose, { size: 'compact', depth: 1, unicode: t.unicode });
  return ink(t, pose.spark > 0.5 ? `+${face.slice(1, -1)}+` : face, 'eoemeoe');
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
