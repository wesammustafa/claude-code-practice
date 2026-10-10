// The learn app's screens: every screen of lesson 1, at every size and in
// every color mode, fits the terminal exactly and draws only what that mode
// can show.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '../../learn/lib/render.mjs';
import { graphemes, isEmoji, strip, width } from '../../learn/lib/text.mjs';
import { COLORS, theme, TIER_STYLE } from '../../learn/lib/theme.mjs';
import { allScreens, driver, root } from './learn-drive.mjs';

const SIZES = [[60, 20], [80, 24], [100, 30], [120, 40], [200, 50]];
const CAPS = {
  full: { tty: true, depth: 8, unicode: true, links: true, win32: false },
  sixteen: { tty: true, depth: 4, unicode: true, links: false, win32: false },
  noColor: { tty: true, depth: 1, unicode: true, links: false, win32: false },
  ascii: { tty: true, depth: 1, unicode: false, links: false, win32: true },
};
const screens = allScreens();

test('lesson 1 reaches every screen the app has', () => {
  const labels = screens.map(([label]) => label);
  for (const view of ['welcome', 'intro', 'complete', 'next', 'map', 'help', 'check-only', 'page', 'resume']) assert.ok(labels.includes(view), view);
  assert.equal(screens.find(([l]) => l === 'complete')[1].view, 'complete');
  assert.equal(screens.find(([l]) => l === 'W3 done')[1].beat.status, 'done');
});

test('every screen is exactly the window: no line too wide, one emoji at most', () => {
  for (const [capName, caps] of Object.entries(CAPS)) {
    const t = theme(caps);
    for (const [cols, rows] of SIZES) {
      for (const [label, state] of screens) {
        const lines = render(state, { cols, rows }, t);
        const where = `${label} at ${cols}x${rows} (${capName})`;
        assert.equal(lines.length, rows, `${where}: ${lines.length} lines`);
        lines.forEach((line, i) => {
          assert.ok(width(line) <= cols - 1, `${where}, line ${i + 1} is ${width(line)} wide: ${strip(line)}`);
          const emoji = graphemes(strip(line)).filter(isEmoji);
          assert.ok(emoji.length <= 1, `${where}, line ${i + 1} has ${emoji.length} emoji`);
          assert.doesNotMatch(line, /️/, `${where}, line ${i + 1} has U+FE0F`);
        });
      }
    }
  }
});

test('nothing on a screen is cut at 80x24 or larger', () => {
  const t = theme(CAPS.full);
  for (const [cols, rows] of SIZES.slice(1)) {
    for (const [label, state] of screens) {
      const lines = render(state, { cols, rows }, t).map(strip);
      // `cut` fills a line to the last column and ends it with an ellipsis.
      assert.ok(!lines.some((l) => l.endsWith('…') && width(l) === cols - 1), `${label} at ${cols}x${rows} cuts a line`);
      assert.ok(!lines.some((l) => l.trim() === '…'), `${label} at ${cols}x${rows} drops lines`);
    }
  }
});

test('each color mode draws only what it can show', () => {
  const codes = (line) => [...line.matchAll(/\x1b\[([0-9;]*)m/g)].map((m) => m[1]);
  for (const [label, state] of screens) {
    const none = render(state, { cols: 100, rows: 30 }, theme(CAPS.noColor)).join('\n');
    for (const c of codes(none)) for (const p of c.split(';')) assert.ok(['0', '1', '22', '7', '27', ''].includes(p), `${label} without color uses SGR ${c}`);
    const sixteen = render(state, { cols: 100, rows: 30 }, theme(CAPS.sixteen)).join('\n');
    assert.doesNotMatch(sixteen, /38;5|48;5/, `${label} in 16 colors uses a 256-color code`);
    const ascii = render(state, { cols: 100, rows: 30 }, theme(CAPS.ascii)).map(strip).join('\n');
    assert.doesNotMatch(ascii, /[^\x00-\x7f]/, `${label} in ASCII mode draws ${ascii.match(/[^\x00-\x7f]/)?.[0]}`);
  }
});

test('a guided step draws as the approved mockup', () => {
  const d = driver({ saved: { format: 1, welcomed: true, lessons: { 'b-1': { step: 'W3', beat: 0, done: ['W1', 'W2'] } } } });
  d.key('enter');
  d.send({ type: 'check', lesson: 'b-1', items: [{ index: 0, text: 'x', pass: false, hint: 'No `.practice/version.txt` yet: run it' }] });
  const lines = render(d.state, { cols: 84, rows: 26 }, theme(CAPS.noColor)).map((l) => strip(l).trimEnd());
  const golden = readFileSync(join(root, 'checks', 'test', 'fixtures', 'learn', 'w3-waiting.txt'), 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n');
  assert.deepEqual(lines.join('\n').trimEnd().split('\n'), golden);
});

test('review fixes: paths are quoted and measured, toasts show everywhere, no hint crash', async () => {
  const { quotePath } = await import('../../learn/lib/render.mjs');
  assert.equal(quotePath('/home/sam/claude-code-practice', false), '/home/sam/claude-code-practice');
  assert.equal(quotePath('/Users/Jane Doe/practice', false), "'/Users/Jane Doe/practice'");
  assert.equal(quotePath("/tmp/it's", false), "'/tmp/it'\\''s'");
  assert.equal(quotePath('C:\\Users\\Jane Doe\\practice', true), '"C:\\Users\\Jane Doe\\practice"');
  assert.equal(width('練習'), 4);
  const t = theme(CAPS.full);
  // A long folder name in CJK still fits the window.
  const wide = driver({ facts: { root: `/home/${'練習'.repeat(30)}` } });
  for (const [cols, rows] of SIZES) for (const l of render(wide.state, { cols, rows }, t)) assert.ok(width(l) <= cols - 1);
  // The wrong-window note shows on the welcome screen too.
  wide.send({ type: 'paste', text: 'claude' });
  assert.match(render(wide.state, { cols: 100, rows: 30 }, t).map(strip).join('\n'), /Type it in your other terminal/);
  // "Less help": the exact command uses the real folder, not the placeholder.
  const less = driver({ saved: { format: 1, welcomed: true, lessons: { 'b-1': { lessHelp: true, step: 'W3' } } } });
  less.key('enter');
  less.send({ type: 'check', lesson: 'b-1', items: [{ index: 0, text: 'x', pass: false, hint: 'a' }] });
  while (!less.state.beat.confirm) less.send({ type: 'key', name: 'h', ch: 'h', wait: 2_100 }), less.send({ type: 'flush', wait: 400 });
  less.key('y');
  const shown = render(less.state, { cols: 100, rows: 30 }, t).map(strip).join('\n');
  assert.doesNotMatch(shown, /<your practice copy>/);
  assert.match(shown, /cd \/home\/sam\/claude-code-practice/);
  // The welcome screen states no command of its own.
  const welcome = render(driver().state, { cols: 100, rows: 30 }, t).map(strip).join('\n');
  assert.doesNotMatch(welcome, /\$ claude\b/);
});

test('every label on a colored block reaches 4.5:1 contrast, and marks on a dark background 3:1', () => {
  // xterm's 256-color values and WCAG's relative luminance.
  const rgb = (n) => {
    if (n >= 232) return Array(3).fill(8 + (n - 232) * 10);
    const c = (v) => (v ? 55 + v * 40 : 0);
    return [c(Math.floor((n - 16) / 36)), c(Math.floor((n - 16) / 6) % 6), c((n - 16) % 6)];
  };
  const lum = (n) => rgb(n).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => {
    const [hi, lo] = [lum(COLORS[a][0]), lum(COLORS[b][0])].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const pills = [['accentBg', 'white'], ['chipBg', 'white'], ['okBg', 'white'], ['warn', 'black'], ['dimBg', 'dimText'],
    ['codeBg', 'code'], ['codeBg', 'prompt'],
    ...Object.values(TIER_STYLE).map((x) => [x.bg, x.fgOnBg])];
  for (const [bg, fg] of pills) assert.ok(ratio(bg, fg) >= 4.5, `${fg} on ${bg}: ${ratio(bg, fg).toFixed(2)}:1`);
  // A dark terminal background, like the screenshots': xterm's 233.
  COLORS.darkBg = [233, 30];
  for (const token of ['faint', 'muted', 'text', 'code', 'key', 'ok', 'warn', 'guided', 'hinted', 'challenge']) {
    assert.ok(ratio(token, 'darkBg') >= 3, `${token} on a dark background: ${ratio(token, 'darkBg').toFixed(2)}:1`);
  }
  delete COLORS.darkBg;
});
