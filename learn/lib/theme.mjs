// Colors, glyphs and emoji, by what the terminal can show. Every color comes
// with a symbol or a word, so meaning survives NO_COLOR and color blindness.

// Each token: a 256-color index, then the 16-color foreground code (a
// background adds 10).
const COLORS = {
  accent: [213, 95], accentBg: [127, 95],
  key: [81, 96], code: [117, 96], codeBg: [236, 90],
  ok: [78, 92], okBg: [29, 32], warn: [221, 93], bad: [203, 91],
  text: [252, 37], white: [231, 97], muted: [245, 90], faint: [240, 90],
  chipBg: [238, 90], gold: [220, 93], dimBg: [239, 90], dimText: [250, 37],
  guidedBg: [33, 34], guided: [75, 94], hintedBg: [98, 35], hinted: [141, 95],
  challengeBg: [202, 33], challenge: [209, 33], black: [16, 30],
  heat2: [111, 94], heat4: [177, 95],
};

const UNICODE_GLYPHS = {
  rule: '─', bold: '━', rail: '│', bar: '▌', tl: '╭', tr: '╮', bl: '╰', br: '╯',
  check: '✔', warnMark: '▲', pointer: '❯', arrow: '➜', right: '▸', star: '★', starOff: '☆',
  dot: '●', dotOff: '○', diamond: '◆', diamondOff: '◇', ellipsis: '…', bullet: '·', up: '↑↓',
};
const ASCII_GLYPHS = {
  rule: '-', bold: '=', rail: '|', bar: '|', tl: '+', tr: '+', bl: '+', br: '+',
  check: '[x]', warnMark: '!', pointer: '>', arrow: '->', right: '>', star: '*', starOff: '.',
  dot: '#', dotOff: 'o', diamond: '+', diamondOff: '+', ellipsis: '...', bullet: '|', up: 'up/down',
};

// One job each. ASCII mode drops some and spells others out.
const EMOJI = {
  wave: ['👋', ''], terminal: ['💻', '[TERMINAL]'], claude: ['💬', '[CLAUDE CODE]'], watch: ['👀', '[..]'],
  verified: ['✅', '[ok]'], guess: ['🤔', '?'], hint: ['💡', 'Hint:'], goal: ['🎯', 'Goal:'], safety: ['🔒', 'Safety:'],
  self: ['🙋', '[you]'], level: ['🚀', '>>'], fire: ['🔥', '**'], party: ['🎉', '***'], badge: ['🏅', '[badge]'],
  cup: ['🏆', '[cup]'], map: ['🧭', ''], broken: ['🚧', '[!!]'],
};

export function theme(caps) {
  const { depth, unicode } = caps;
  const sgr = (code) => `\x1b[${code}m`;
  const color = (token, bg = false) => {
    const [i256, i16] = COLORS[token];
    if (depth >= 8) return `${bg ? 48 : 38};5;${i256}`;
    return String(bg ? i16 + 10 : i16);
  };
  const fg = (token, s) => (depth > 1 && s ? `${sgr(color(token))}${s}${sgr(39)}` : s);
  const bg = (token, s) => (depth > 1 && s ? `${sgr(color(token, true))}${s}${sgr(49)}` : s);
  const bold = (s) => (s ? `${sgr(1)}${s}${sgr(22)}` : s);
  const inverse = (s) => (s ? `${sgr(7)}${s}${sgr(27)}` : s);
  // A label on a colored block. Without color it is inverse video.
  const pill = (text, bgToken, fgToken = 'white') => {
    if (depth <= 1) return inverse(bold(` ${text} `));
    return `${sgr(`1;${color(fgToken)};${color(bgToken, true)}`)} ${text} ${sgr('22;39;49')}`;
  };
  const glyph = unicode ? UNICODE_GLYPHS : ASCII_GLYPHS;
  const emoji = (name) => EMOJI[name][unicode ? 0 : 1];
  // An emoji and a space, or the ASCII word and a space, or nothing.
  const lead = (name) => (emoji(name) ? `${emoji(name)} ` : '');
  const link = (text, url) => (caps.links && url ? `\x1b]8;;${url}\x07${text}\x1b]8;;\x07` : text);
  return { caps, fg, bg, bold, inverse, pill, glyph, emoji, lead, link, unicode, depth };
}

export const TIER_STYLE = {
  guided: { label: 'GUIDED', stars: [1, 3], bg: 'guidedBg', tint: 'guided', fgOnBg: 'white', on: 'dot', off: 'dotOff' },
  hinted: { label: 'HINTED', stars: [2, 3], bg: 'hintedBg', tint: 'hinted', fgOnBg: 'white', on: 'diamond', off: 'diamondOff' },
  challenge: { label: 'CHALLENGE', stars: [3, 3], bg: 'challengeBg', tint: 'challenge', fgOnBg: 'black', on: 'star', off: 'starOff' },
};

export function tierLabel(t, tier) {
  const s = TIER_STYLE[tier];
  const stars = t.glyph.star.repeat(s.stars[0]) + t.glyph.starOff.repeat(s.stars[1] - s.stars[0]);
  return `${s.label} ${stars}`;
}

export const tierPill = (t, tier) => t.pill(tierLabel(t, tier), TIER_STYLE[tier].bg, TIER_STYLE[tier].fgOnBg);
