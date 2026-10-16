// Code from the page (ticket 90): a beat's fenced block on the card, with
// its line breaks, the line the beat explains marked, and no word broken
// across rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C } from '../../learn/lib/copy.mjs';
import { stepOf } from '../../learn/lib/flow.mjs';
import { render } from '../../learn/lib/render.mjs';
import { graphemes, isEmoji, strip, width } from '../../learn/lib/text.mjs';
import { theme } from '../../learn/lib/theme.mjs';
import { course, courseWith, driver, finished, withCode } from './learn-drive.mjs';

const SIZES = [[60, 20], [80, 24]];
const CAPS = {
  full: { tty: true, depth: 8, unicode: true, links: true, win32: false },
  ascii: { tty: true, depth: 1, unicode: false, links: false, win32: false },
};
const fenced = (lines, info = 'bash') => [`\`\`\`${info}`, ...lines, '```'];

// The hooks page's Worked example step 1: a loop whose curl URL is wider
// than any card.
const URL = '"https://raw.githubusercontent.com/wesammustafa/Claude-Code-Everything-You-Need-to-Know/main/examples/intermediate/05-hooks/dot-claude/hooks/$f.sh"';
const LOOP = ['mkdir -p .claude/hooks', 'for f in protect-files format-after-edit; do', `  curl -fsSL ${URL} -o ".claude/hooks/$f.sh"`, 'done', 'chmod +x .claude/hooks/*.sh'];

// On the made-up lesson 2's Worked example, whose beat holds `lines`.
function atCode(lines, facts = {}) {
  const d = driver({ course: courseWith({ 'b-2': withCode(lines) }), facts, saved: { format: 1, welcomed: true, lessons: { 'b-1': finished(course.find((l) => l.id === 'b-1')), 'b-2': { warm: ['R1', 'R2', 'R3'], done: ['R1', 'R2', 'R3'], step: 'W1', beat: 0 } } } });
  for (let i = 0; i < 3 && d.state.view !== 'step'; i++) d.key('enter');
  if (stepOf(d.state)?.id !== 'W1') throw new Error(`atCode: on ${d.state.view}, not W1`);
  return d;
}

// A card row without the card's rail.
const inCard = (row) => row.replace(/^\s*[│|]  /, '');

// Every screen is exactly the window: `rows` lines, none wider than
// cols - 1, one emoji at most on a line.
function fits(lines, cols, rows, where) {
  assert.equal(lines.length, rows, where);
  lines.forEach((line, i) => {
    assert.ok(width(line) <= cols - 1, `${where}, line ${i + 1} is ${width(line)} wide: ${strip(line)}`);
    assert.ok(graphemes(strip(line)).filter(isEmoji).length <= 1, `${where}, line ${i + 1}`);
  });
}

test('the card shows the block with its line breaks, the line the beat explains marked, and never breaks a word across rows', () => {
  const d = atCode(['- code: point 3', ...fenced(LOOP)]);
  for (const [name, caps] of Object.entries(CAPS)) {
    const t = theme(caps);
    const pointer = caps.unicode ? '▸' : '>';
    for (const [cols, rows] of SIZES) {
      const where = `${cols}x${rows} (${name})`;
      const lines = render(d.state, { cols, rows }, t);
      fits(lines, cols, rows, where);
      const screen = lines.map((l) => strip(l));
      // Each short line is a row of its own, in the page's order.
      const at = ['mkdir -p .claude/hooks', 'for f in protect-files format-after-edit; do', 'curl -fsSL', 'done', 'chmod +x .claude/hooks/*.sh']
        .map((text) => screen.findIndex((r) => r.includes(text)));
      assert.ok(at.every((n, k) => n > 0 && (k === 0 || n > at[k - 1])), `${where}\n${screen.join('\n')}`);
      assert.ok(screen.findIndex((r) => r.includes(' done')) === at[3] && !screen[at[3]].includes('chmod'), `${where}: done is a row of its own`);
      // The curl line keeps its indent, two columns in from the loop's.
      const indentOf = (row, text) => row.indexOf(text);
      assert.equal(indentOf(screen[at[2]], 'curl') - indentOf(screen[at[1]], 'for f'), 2, where);
      // The pointer marks line 3 and no other.
      assert.ok(inCard(screen[at[2]]).startsWith(pointer), `${where}: ${screen[at[2]]}`);
      for (const k of [0, 1, 3, 4]) assert.ok(!inCard(screen[at[k]]).startsWith(pointer), `${where}: ${screen[at[k]]}`);
      // Every word the card has room for is whole on one row; the URL, wider
      // than any row, is cut at the row's end, and none of its tail shows.
      for (const word of LOOP.join(' ').split(/\s+/).filter((w) => w && w !== URL)) {
        assert.ok(screen.some((r) => r.includes(word)), `${where}: ${word} is not whole on a row\n${screen.join('\n')}`);
      }
      assert.ok(screen.some((r) => r.includes(URL.slice(0, 30)) && /(…|\.\.\.|\.)\s*$/.test(r.trimEnd())), `${where}: the URL's head\n${screen.join('\n')}`);
      assert.ok(!screen.some((r) => r.includes('hooks/$f.sh"') && !r.includes('-o')), `${where}: the URL's tail shows\n${screen.join('\n')}`);
    }
  }
});

// The hooks page's Your turn skeleton: 17 lines.
const SKELETON = ['#!/bin/bash', 'INPUT=$(cat)', 'FILE_PATH=$(echo "$INPUT" | jq -r \'.tool_input.file_path // empty\')', 'FILE_PATH="${FILE_PATH//\\\\//}"', 'NAME=$(basename "$FILE_PATH")', '', 'case "/$FILE_PATH" in', '  */package-lock.json | */.git/*)',
  '    echo "Blocked: $FILE_PATH is protected" >&2', '    exit 2', '    ;;', 'esac', '', '# TODO: block a file named .env, or .env. followed by anything except example', '# TODO: block any file inside a secrets/ folder', '', 'exit 0'];

test('a beat on part of a longer block shows only its window, each line under its number in the block', () => {
  const d = atCode(['- code: lines 9-16 point 10', ...fenced(SKELETON)]);
  for (const [name, caps] of Object.entries(CAPS)) {
    const t = theme(caps);
    const where = `80x24 (${name})`;
    const lines = render(d.state, { cols: 80, rows: 24 }, t);
    fits(lines, 80, 24, where);
    const card = lines.map((l) => inCard(strip(l)));
    const row = (n) => card.find((r) => new RegExp(`^.\\s+${n}  `).test(r));
    assert.match(row(9), /echo "Blocked: \$FILE_PATH is protected" >&2/, where);
    assert.match(row(10), /^[▸>]\s+10      exit 2/, `${where}: the pointer on line 10\n${card.join('\n')}`);
    assert.match(row(15), /# TODO: block any file inside a secrets\/ folder/, where);
    assert.match(row(16), /^\s+16\s*$/, `${where}: the blank line 16 is a row`);
    for (const n of [1, 8, 17]) assert.equal(row(n), undefined, `${where}: line ${n} shows`);
    assert.ok(!card.some((r) => r.includes('#!/bin/bash') || r.includes('exit 0')), where);
  }
});

test('a block too tall for the window shows its first lines whole, then points to the page', () => {
  const d = atCode(['- code: lines 9-16 point 10', ...fenced(SKELETON)]);
  for (const [name, caps] of Object.entries(CAPS)) {
    const t = theme(caps);
    const where = `60x20 (${name})`;
    const lines = render(d.state, { cols: 60, rows: 20 }, t);
    fits(lines, 60, 20, where);
    const card = lines.map((l) => inCard(strip(l)));
    const text = card.join('\n');
    assert.match(text, /9\s+echo "Blocked: \$FILE_PATH is protected"\s*\n\s+>&2/, where);
    assert.match(text, /10\s+exit 2/, where);
    // The page pointer stands where the lines that don't fit would be.
    const more = card.findIndex((r) => r.includes(C.codeMore));
    assert.ok(more > card.findIndex((r) => /10\s+exit 2/.test(r)), `${where}\n${text}`);
    assert.ok(!card.some((r) => /^(…|\.\.\.)\s*$/.test(r)), `${where}: a bare ellipsis\n${text}`);
    // A line shows whole or not at all: no line's first row without the rest.
    assert.ok(!text.includes('# TODO: block a file named .env, or .env.') || text.includes('followed by anything except example'), `${where}\n${text}`);
    assert.ok(!text.includes('# TODO: block any file inside a secrets/') || text.includes('secrets/ folder'), `${where}\n${text}`);
  }
});

test('a win line under a block replaces it on native Windows, as it replaces a run line', () => {
  const block = ['mkdir -p .practice', 'git status --porcelain > .practice/b-2-before.txt'];
  const WIN_LINE = 'New-Item -ItemType Directory -Force .practice';
  const lines = ['- code: point 1', ...fenced(block), `- win: "${WIN_LINE}"`];
  assert.throws(() => atCode(['- code: point 1', ...fenced(block), '- note: "x"', `- win: "${WIN_LINE}"`]), /a win line with no run, code or bottom line above it/);
  for (const win32 of [false, true]) {
    const d = atCode(lines, { win32 });
    for (const [name, caps] of Object.entries(CAPS)) {
      const t = theme({ ...caps, win32 });
      for (const [cols, rows] of SIZES) {
        const where = `${cols}x${rows} (${name}, ${win32 ? 'Windows' : 'not Windows'})`;
        const out = render(d.state, { cols, rows }, t);
        fits(out, cols, rows, where);
        const text = out.map((l) => strip(l)).join('\n');
        // A command wraps at a space on a narrow card, as a run line does.
        const flat = out.map((l) => inCard(strip(l)).trim()).join(' ').replace(/\s+/g, ' ');
        assert.equal(flat.includes(WIN_LINE), win32, `${where}\n${text}`);
        assert.equal(text.includes('mkdir -p .practice'), !win32, `${where}\n${text}`);
        assert.equal(text.includes('git status --porcelain'), !win32, where);
      }
    }
  }
});

// The key bar's last row, without color.
const keyBar = (out) => strip(out.at(-1));

test('k copies the block: it asks the terminal to copy the whole block, says what it did, and is on the key bar only where a block is', () => {
  const d = atCode(['- code: lines 1-5 point 3', ...fenced([...LOOP, 'ls -l .claude/hooks'])]);
  for (const [name, caps] of Object.entries(CAPS)) {
    for (const [cols, rows] of SIZES) assert.match(keyBar(render(d.state, { cols, rows }, theme(caps))), new RegExp(`\\bk ${C.k.copy}\\b`), `${cols}x${rows} (${name})`);
  }
  // The whole block, not only the lines this beat shows.
  assert.deepEqual(d.key('k').filter((e) => e.type === 'copy'), [{ type: 'copy', text: [...LOOP, 'ls -l .claude/hooks'].join('\n') }]);
  for (const [name, caps] of Object.entries(CAPS)) {
    for (const [cols, rows] of SIZES) {
      const out = render(d.state, { cols, rows }, theme(caps));
      fits(out, cols, rows, `${cols}x${rows} (${name})`);
      const flat = out.map((l) => strip(l).trim()).join(' ').replace(/\s+/g, ' ');
      assert.ok(flat.includes(C.copied(6)), `${cols}x${rows} (${name})\n${out.map(strip).join('\n')}`);
    }
  }
  assert.equal(d.state.beat.status === 'done', false, 'copying is no step done');
  // On native Windows, a win line stands in for the block: k copies it.
  const WIN_LINE = 'New-Item -ItemType Directory -Force .practice';
  const win = atCode(['- code: point 1', ...fenced(['mkdir -p .practice']), `- win: "${WIN_LINE}"`], { win32: true });
  assert.deepEqual(win.key('k').filter((e) => e.type === 'copy'), [{ type: 'copy', text: WIN_LINE }]);
  // A beat with no block: no k, and k does nothing.
  const plain = atCode(['- run: "git status --porcelain > .practice/b-2-before.txt"']);
  assert.doesNotMatch(keyBar(render(plain.state, { cols: 80, rows: 24 }, theme(CAPS.full))), /\bk copy\b/);
  assert.deepEqual(plain.key('k').filter((e) => e.type === 'copy'), []);
});
