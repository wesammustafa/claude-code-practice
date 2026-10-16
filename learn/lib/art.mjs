// Pip the mascot, block-letter banners, the check burst and confetti. Each
// has a plain ASCII form. Nothing here is random: the same screen draws the
// same art every time.
import { width } from './text.mjs';

// A one-shot's `frame` changes only Pip's eyes: shut, waking, or awake (the
// happy eyes, whatever the mood); or, to cheer, sparks with its arms up, out
// past its first row's sides. ASCII Pip is still.
export function pip(t, mood = 'happy', frame) {
  if (!t.unicode) {
    const eyes = { happy: 'o   o', focus: 'O   O', party: '*   *' }[mood];
    const mouth = { happy: '\\_/', focus: '---', party: '\\_/' }[mood];
    return ['+-------+', `| ${eyes} |`, `|  ${mouth}  |`, '+-------+'];
  }
  const f = (s) => t.fg('accent', s);
  const pose = { shut: '─   ─', waking: '◡   ◡', awake: '●   ●' }[frame];
  const eyes = frame === 'cheer' ? t.fg('gold', '✦   ✦') : pose ? t.fg('key', pose) : { happy: t.fg('key', '●   ●'), focus: t.fg('key', '◉   ◉'), party: t.fg('gold', '★   ★') }[mood];
  const mouth = { happy: t.fg('challenge', '╰─╯'), focus: t.fg('challenge', '───'), party: t.fg('challenge', '╰─╯') }[mood];
  return [f(frame === 'cheer' ? '\\╭───────╮/' : '╭───────╮'), `${f('│')} ${eyes} ${f('│')}`, `${f('│')}  ${mouth}  ${f('│')}`, f('╰───────╯')];
}

// Pip's small face for a card's top border, 7 cells: ` (●‿●) `, or with
// its arms up `\(^_^)/`. Its moods name what the card shows (rest, checking,
// worried, done, broken), apart from the big Pip's happy, focus and party.
// A one-shot's `frame` is a pose over that face: eyes shut, or arms up.
export const PIP_FACE = 7;
export function pipFace(t, mood, frame) {
  const { eye, mouth, arms = [' ', ' '] } = { ...t.pipGlyphs[mood], ...t.pipPoses[frame] };
  const e = t.fg(mood === 'done' ? 'gold' : 'key', eye);
  return `${t.fg('accent', `${arms[0]}(`)}${e}${t.fg('challenge', mouth)}${e}${t.fg('accent', `)${arms[1]}`)}`;
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
