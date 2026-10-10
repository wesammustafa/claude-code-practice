// Measuring and wrapping terminal text. A string may hold SGR escapes; they
// take no columns. An emoji with Emoji_Presentation takes two columns, every
// other grapheme one.
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const SGR = /\x1b\[[0-9;]*m/g;
const OSC8 = /\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)/g;

export const strip = (s) => s.replace(OSC8, '').replace(SGR, '');
export const isEmoji = (g) => /\p{Emoji_Presentation}/u.test(g);
export const graphemes = (s) => [...segmenter.segment(s)].map((x) => x.segment);

// East Asian Wide and Fullwidth characters, such as CJK in a folder name,
// take two columns like emoji.
const WIDE = /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]|[\u{20000}-\u{3fffd}]/u;
export const cellWidth = (g) => (isEmoji(g) || WIDE.test(g) ? 2 : 1);

export function width(s) {
  let w = 0;
  for (const g of graphemes(strip(s))) w += cellWidth(g);
  return w;
}

export const pad = (s, w) => s + ' '.repeat(Math.max(0, w - width(s)));

// Cuts a styled string to `w` columns, keeping its escapes.
export function cut(s, w, ellipsis = '…') {
  if (width(s) <= w) return s;
  let out = '';
  let used = 0;
  for (const part of s.split(/(\x1b\[[0-9;]*m|\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\))/)) {
    if (part.startsWith('\x1b')) {
      out += part;
      continue;
    }
    for (const g of graphemes(part)) {
      const gw = cellWidth(g);
      if (used + gw > w - 1) return `${out}${ellipsis}\x1b[0m`;
      out += g;
      used += gw;
    }
  }
  return out;
}

// Inline Markdown as the lesson pages write it: `code`, **bold** and
// [text](url). Returns runs of { text, code, bold, url }.
export function inline(text) {
  const runs = [];
  const re = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) runs.push({ text: m[1], code: true });
    else if (m[2] !== undefined) {
      // Bold may hold code: **`x`** is rare in the lessons; keep it simple.
      runs.push({ text: m[2].replace(/`/g, ''), bold: true });
    } else runs.push({ text: m[3], url: m[4] });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs;
}

export const plainText = (text) => inline(text).map((r) => r.text).join('');

// Wraps runs into lines of at most `w` columns. Words are split on spaces
// outside code; a code span longer than a line is broken anywhere. Returns
// arrays of runs, one per line.
export function wrapRuns(runs, w) {
  const words = [];
  let word = [];
  const push = () => {
    if (word.length) words.push(word);
    word = [];
  };
  for (const run of runs) {
    const parts = run.code ? [run.text] : run.text.split(/( )/);
    for (const part of parts) {
      if (part === ' ') push();
      else if (part) word.push({ ...run, text: part });
    }
  }
  push();
  const lines = [];
  let line = [];
  let used = 0;
  const wordWidth = (wd) => wd.reduce((n, r) => n + width(r.text), 0);
  for (let wd of words) {
    let ww = wordWidth(wd);
    if (line.length && used + 1 + ww > w) {
      lines.push(line);
      line = [];
      used = 0;
    }
    while (ww > w) {
      // A single word wider than the line: break it.
      const text = wd.map((r) => r.text).join('');
      let head = '';
      for (const g of graphemes(text)) {
        if (width(head + g) > w) break;
        head += g;
      }
      if (!head) head = graphemes(text)[0];
      lines.push([...line, { ...wd[0], text: head }]);
      line = [];
      used = 0;
      wd = [{ ...wd[0], text: text.slice(head.length) }];
      ww = wordWidth(wd);
    }
    if (line.length) {
      line.push({ text: ' ' });
      used += 1;
    }
    line.push(...wd);
    used += ww;
  }
  if (line.length) lines.push(line);
  return lines.length ? lines : [[]];
}
