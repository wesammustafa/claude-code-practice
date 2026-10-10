// Pip the mascot, block-letter banners, the check burst and confetti. Each
// has a plain ASCII form. Nothing here is random: the same screen draws the
// same art every time.
import { width } from './text.mjs';

export function pip(t, mood = 'happy') {
  if (!t.unicode) {
    const eyes = { happy: 'o   o', focus: 'O   O', party: '*   *' }[mood];
    const mouth = { happy: '\\_/', focus: '---', party: '\\_/' }[mood];
    return ['+-------+', `| ${eyes} |`, `|  ${mouth}  |`, '+-------+'];
  }
  const f = (s) => t.fg('accent', s);
  const eyes = { happy: t.fg('key', '●   ●'), focus: t.fg('key', '◉   ◉'), party: t.fg('gold', '★   ★') }[mood];
  const mouth = { happy: t.fg('challenge', '╰─╯'), focus: t.fg('challenge', '───'), party: t.fg('challenge', '╰─╯') }[mood];
  return [f('╭───────╮'), `${f('│')} ${eyes} ${f('│')}`, `${f('│')}  ${mouth}  ${f('│')}`, f('╰───────╯')];
}

const FONT = {
  L: ['█  ', '█  ', '█▄▄'], E: ['█▀▀', '█▀▀', '█▄▄'], V: ['█ █', '█ █', '▀▄▀'], U: ['█ █', '█ █', '█▄█'],
  P: ['█▀█', '█▀▀', '█  '], C: ['█▀▀', '█  ', '█▄▄'], O: ['█▀█', '█ █', '█▄█'], M: ['█▀▄▀█', '█ ▀ █', '█   █'],
  T: ['▀█▀', ' █ ', ' █ '], ' ': [' ', ' ', ' '],
};
const HEAT = ['guided', 'guided', 'heat2', 'hinted', 'hinted', 'heat4', 'accent', 'challenge'];

// A three-row banner, colored cool to hot; one bold word in ASCII mode.
export function banner(t, word) {
  if (!t.unicode) return [t.bold(word)];
  const rows = ['', '', ''];
  [...word].forEach((ch, i) => {
    for (let r = 0; r < 3; r++) rows[r] += (i ? ' ' : '') + (ch === ' ' ? FONT[ch][r] : t.fg(HEAT[i % HEAT.length], FONT[ch][r]));
  });
  return rows;
}
export const bannerWidth = (word) => [...word].reduce((n, ch) => n + FONT[ch][0].length, 0) + word.length - 1;

// The check burst beside a celebration's three lines.
export function burst(t, lines) {
  const art = t.unicode
    ? [`${t.fg('gold', '✦')}          ${t.fg('ok', '▄█▀')}   ${t.fg('accent', '·')}`,
      ` ${t.fg('ok', '▀█▄')}    ${t.fg('ok', '▄█▀')}    ${t.fg('key', '✦')}`,
      `${t.fg('accent', '·')}  ${t.fg('ok', '▀█▄█▀')}     ${t.fg('gold', '·')}`]
    : ['    /', ' \\ /', '  V'];
  const w = t.unicode ? 21 : 7;
  return lines.map((l, i) => `${art[i] ?? ''}${' '.repeat(Math.max(0, w - width(art[i] ?? '')))}${l}`);
}

export function confetti(t, cols) {
  const glyphs = t.unicode ? ['✦', '·', '◆', '•', '✧', '■'] : ['*', '.', '+', 'o', 'x', '#'];
  const colors = ['gold', 'key', 'accent', 'ok', 'challenge', 'hinted'];
  const out = [];
  for (let i = 0; i * 6 < cols - 1; i++) out.push(t.fg(colors[i % colors.length], glyphs[i % glyphs.length]));
  return out.join('     ');
}
