// The learn app's screens: every screen of lesson 1, at every size and in
// every color mode, fits the terminal exactly and draws only what that mode
// can show.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { C } from '../../learn/lib/copy.mjs';
import { beatOf, hintAvailable, IDLE_MS, rungsOf, stepNote, stepOf, tierOf } from '../../learn/lib/flow.mjs';
import { render } from '../../learn/lib/render.mjs';
import { graphemes, isEmoji, strip, width } from '../../learn/lib/text.mjs';
import { COLORS, theme, TIER_STYLE } from '../../learn/lib/theme.mjs';
import { allScreens, bottomRung, course as allCourse, driver, failCheck, finished, finishedBefore, playUntil, root } from './learn-drive.mjs';

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

test('lessons after the first: page links, Windows bottom lines, slow checks and a harder step', async () => {
  const { courseWith, DEMO_B2 } = await import('./learn-drive.mjs');
  const text = DEMO_B2.replace('- goal: "Save it again."', '- goal: "Save it again."\n- note: "See [Watch out](#watch-out) and [lesson 5](05-project-memory.md#worked-example)."\n- bottom: "printf x > a.txt"\n- win: "Set-Content a.txt x"');
  const course = courseWith({ 'b-2': text });
  const d = driver({ course, saved: { format: 1, welcomed: true, lessons: { 'b-1': finished(allCourse.find((l) => l.id === 'b-1')), 'b-2': { warm: ['R1', 'R2'], step: 'Y1', beat: 0, levels: ['challenge'] } } } });
  d.key('enter');
  const draw = (caps) => render(d.state, { cols: 100, rows: 40 }, theme({ ...CAPS.full, ...caps })).join('\n');
  const links = [...draw({ links: true }).matchAll(/\x1b\]8;;([^\x07]*)\x07/g)].map((m) => m[1]).filter(Boolean);
  const page = 'https://github.com/wesammustafa/Claude-Code-Everything-You-Need-to-Know/blob/main/docs/beginner/';
  assert.ok(links.includes(`${page}02-permission-modes-and-plan-mode.md#watch-out`), links.join(' '));
  assert.ok(links.includes(`${page}05-project-memory.md#worked-example`), links.join(' '));
  // The bottom rung, on Windows, shows the Windows line.
  d.send({ type: 'check', lesson: 'b-2', items: [{ index: 0, text: 'x', pass: false, hint: 'No file yet.' }], path: '.practice/b-2-before.txt', stamp: '' });
  d.key('r');
  d.send({ type: 'check', lesson: 'b-2', items: [{ index: 0, text: 'x', pass: false, hint: 'No file yet.' }], path: '.practice/b-2-before.txt', stamp: '' });
  for (let i = 0; i < 4 && !d.state.beat.confirm; i++) d.send({ type: 'key', name: 'h', ch: 'h', wait: 3_000 }), d.send({ type: 'flush', wait: 400 });
  d.key('y');
  assert.match(strip(draw({ win32: true, unicode: true })), /Set-Content a\.txt x/);
  assert.doesNotMatch(strip(draw({ win32: true, unicode: true })), /printf x > a\.txt/);
  assert.match(strip(draw({})), /printf x > a\.txt/);
  // A slow item says to press r.
  const slow = driver({ saved: { format: 1, welcomed: true, lessons: { 'b-1': { step: 'C', beat: 0, levels: ['hinted', 'challenge'] } } } });
  slow.key('enter');
  slow.send({ type: 'check', lesson: 'b-1', items: [{ index: 0, text: 'x', pass: false, slow: true, hint: '' }] });
  assert.match(strip(render(slow.state, { cols: 100, rows: 40 }, theme(CAPS.full)).join('\n')), /takes a while, so it runs only when you ask: press r/);
});

// First rungs that a small window still cuts, each with its reason.
const FIRST_RUNG_CUT = {
  'b-capstone T1.2 hint 1 at 60x20 (ascii)': 'the Windows note fills the card; 142\'s drop order keeps the hint box',
};

// Every lesson after the first, on the path and with every lesson before it
// skipped, so the steps that drop to GUIDED show their bottom lines too.
for (const skipped of [false, true]) test(`every lesson in the app${skipped ? ', with nothing done before it' : ''}: every beat fits the window, and nothing is cut at 80x24 or larger`, async () => {
  const { lessonScreens, course } = await import('./learn-drive.mjs');
  const ids = course.filter((l) => l.content && l.id !== 'b-1').map((l) => l.id);
  // Only letters and digits, so the box's edges, a wrap and ASCII stand-ins
  // don't count as a cut.
  const flat = (text) => text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[^A-Za-z0-9]/g, '');
  const cut = [];
  for (const id of ids) {
    const all = lessonScreens(id, course, { skipped });
    assert.ok(all.length > 10, `${id}: ${all.length} screens`);
    for (const [capName, caps] of Object.entries(CAPS)) {
      const t = theme(caps);
      for (const [cols, rows] of SIZES) {
        for (const [label, state] of all) {
          const lines = render(state, { cols, rows }, t);
          const where = `${label} at ${cols}x${rows} (${capName})`;
          assert.equal(lines.length, rows, where);
          for (const line of lines) assert.ok(width(line) <= cols - 1, `${where}: ${strip(line)}`);
          // The first quote behind h shows whole, even in a small window.
          const rung = /hint 1$/.test(label) && rungsOf(state)[state.beat.rung];
          if (rung?.kind === 'quote' && cols <= 80 && !flat(lines.map(strip).join('')).includes(flat(rung.text))) cut.push(where);
          if (cols >= 80 && (capName === 'full' || capName === 'ascii')) {
            const plain = lines.map(strip);
            const end = t.unicode ? '…' : '.';
            assert.ok(!plain.some((l) => l.endsWith(end) && width(l) === cols - 1 && (t.unicode || /\S\.$/.test(l))), `${where} cuts a line:\n${plain.filter((l) => width(l) === cols - 1).join('\n')}`);
          }
        }
      }
    }
  }
  assert.deepEqual(cut, Object.keys(FIRST_RUNG_CUT), 'a first rung is cut');
});

test('real-run fixes: prompts wrap at spaces, a short list stays in "not yet", a safety guess wraps cleanly', async () => {
  const { diagnosis } = await import('../../learn/lib/render.mjs');
  // The first clause of a FAIL message, with a list of names kept.
  assert.equal(diagnosis("These new files don't start with `// linkcheck source.`: src/stats.js. Check that the rule is committed."), "These new files don't start with `// linkcheck source.`: src/stats.js.");
  assert.equal(diagnosis('Changed but not in the plan: src/a.js, test/b.js. Compare the plan.'), 'Changed but not in the plan: src/a.js, test/b.js.');
  assert.equal(diagnosis('No `.practice/version.txt` yet: run `claude --version > .practice/version.txt` in /x, the folder.'), 'No `.practice/version.txt` yet');
  // A long prompt keeps its words whole.
  const { courseWith, DEMO_B2 } = await import('./learn-drive.mjs');
  const prompt = 'Add src/external.js with a function countExternal(markdown) that returns how many of the links findLinks finds are external, according to isExternal.';
  const text = DEMO_B2.replace('- run: "git status --porcelain > .practice/b-2-before.txt"', `- run: "${prompt}"`);
  const d = driver({ course: courseWith({ 'b-2': text }), saved: { format: 1, welcomed: true, lessons: { 'b-1': finished(allCourse.find((l) => l.id === 'b-1')), 'b-2': { warm: [], step: 'W1', beat: 0 } } } });
  d.key('enter');
  for (const cols of [60, 80]) {
    const plain = render(d.state, { cols, rows: 30 }, theme(CAPS.full)).map(strip).join('\n');
    for (const word of prompt.split(' ')) assert.ok(plain.includes(word), `${cols} cols: "${word}" is split`);
  }
});

test('real-run fixes: a done git step ticks no command, and "Still stuck?" only where nothing explains', () => {
  const d = driver({ saved: { format: 1, welcomed: true, lessons: { 'b-1': { step: 'W7', beat: 2, levels: [] } } } });
  d.key('enter');
  d.send({ type: 'git', paths: [] });
  const plain = render(d.state, { cols: 80, rows: 30 }, theme(CAPS.full)).map(strip).join('\n');
  assert.match(plain, /\$ git status\s+\n/, 'no tick beside git status');
});

test('h at CHALLENGE: the toast names the try and fits; the level-up says to try first', async () => {
  const { C } = await import('../../learn/lib/copy.mjs');
  assert.equal(C.hintsLater('r'), 'Try it first: press r to check, then h works.');
  assert.equal(C.hintsLater('pick'), 'Try it first: pick an answer, then h works.');
  assert.deepEqual(C.toChallenge, ['From memory now: just the goal.', 'Try it first, then press h if you need a hint.']);
  const t = theme(CAPS.full);
  const flat = (lines) => lines.map((l) => strip(l).trim()).join(' ').replace(/\s+/g, ' ');
  const level = screens.find(([l]) => l === 'level up challenge')[1];
  for (const via of ['r', 'pick']) {
    const d = driver({ saved: { format: 1, welcomed: true, lessons: { 'b-1': { step: 'Y4', beat: 0, levels: ['hinted', 'challenge'] } } } });
    d.key('enter');
    d.key('h');
    const state = { ...d.state, toast: { ...d.state.toast, try: via } };
    for (const [cols, rows] of [[60, 20], [80, 24]]) {
      const lines = render(state, { cols, rows }, t);
      assert.equal(lines.length, rows);
      for (const l of lines) assert.ok(width(l) <= cols - 1, `${cols}x${rows}: ${strip(l)}`);
      assert.ok(flat(lines).includes(C.hintsLater(via)), `the whole toast shows at ${cols}x${rows}`);
      assert.ok(flat(render(level, { cols, rows }, t)).includes(C.toChallenge[1]), `the level-up line shows at ${cols}x${rows}`);
    }
  }
});

test('both level-ups show "g more help" in the key bar, at 60x20 and 80x24', () => {
  const t = theme(CAPS.full);
  const bars = { 'level up hinted': "enter let's go g more help q quit", 'level up challenge': 'enter bring it on g more help q quit' };
  for (const [label, bar] of Object.entries(bars)) {
    const state = screens.find(([l]) => l === label)[1];
    for (const [cols, rows] of [[60, 20], [80, 24]]) {
      const lines = render(state, { cols, rows }, t);
      assert.equal(strip(lines.at(-1)).trim().replace(/\s+/g, ' '), bar, `${label} at ${cols}x${rows}`);
      assert.ok(!lines.some((l) => strip(l).includes('keep it guided')));
    }
  }
});

test('the Check\'s level-up shows no "g more help": g has nothing to give there', () => {
  const t = theme(CAPS.full);
  const d = driver({ saved: { format: 1, welcomed: true, lessons: { 'b-1': { step: 'W7', beat: 2, done: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'] } } } });
  d.key('enter');
  d.send({ type: 'git', paths: [] });
  d.key('enter');
  d.key('g');
  playUntil(d, (s) => s.view === 'levelup');
  assert.equal(stepOf(d.state).id, 'C');
  for (const [cols, rows] of [[60, 20], [80, 24]]) {
    const lines = render(d.state, { cols, rows }, t);
    assert.equal(lines.length, rows);
    assert.equal(strip(lines.at(-1)).trim().replace(/\s+/g, ' '), 'enter bring it on q quit', `${cols}x${rows}`);
  }
});

test('h at CHALLENGE: nothing sits in front of h during the 2 second lock', () => {
  const t = theme(CAPS.full);
  const d = driver({ saved: { format: 1, welcomed: true, lessons: { 'b-capstone': { step: 'T5', beat: 0, warm: [] } } }, course: allCourse });
  d.key('enter');
  d.key('h');
  assert.equal(d.state.beat.rung, 0);
  assert.ok(d.now < d.state.beat.lockUntil, 'still inside the lock');
  for (const [cols, rows] of [[60, 20], [80, 24]]) {
    const inLock = render(d.state, { cols, rows }, t);
    // The same screen once the lock is over: no countdown, fill or faint key.
    assert.deepEqual(render({ ...d.state, now: d.state.beat.lockUntil + 1 }, { cols, rows }, t), inLock);
  }
  const before = render(d.state, { cols: 80, rows: 24 }, t);
  d.send({ type: 'key', name: 'h', ch: 'h', wait: 100 });
  d.send({ type: 'flush', wait: 400 });
  assert.ok(d.now < d.state.beat.lockUntil);
  assert.equal(d.state.beat.rung, 0, 'h inside the lock opens nothing');
  assert.deepEqual(render(d.state, { cols: 80, rows: 24 }, t), before);
});

test('h at CHALLENGE: a done-label git beat offers r, the try the toast names', () => {
  const t = theme(CAPS.full);
  const d = driver({ saved: { format: 1, welcomed: true, lessons: { 'b-1': { step: 'Y4', beat: 0, levels: ['hinted', 'challenge'] } } } });
  d.key('enter');
  d.send({ type: 'git', paths: ['notes.md'] });
  d.key('h');
  const bar = (state, cols, rows) => strip(render(state, { cols, rows }, t).at(-1));
  for (const [cols, rows] of [[60, 20], [80, 24]]) {
    assert.match(bar(d.state, cols, rows), /space .* r check now .*q quit/, `${cols}x${rows}`);
  }
  d.key('r');
  for (const [cols, rows] of [[60, 20], [80, 24]]) {
    const b = bar(d.state, cols, rows);
    assert.match(b, /h hint/, `${cols}x${rows}: h replaces r once tried`);
    assert.doesNotMatch(b, / r /);
  }
});

// Every step a real bottom rung eases, in a real play from that rung on, with
// and without less help: the "more help" line wraps whole wherever the card
// fits the window. A 60x20 card can be taller than the window (b-2 Y3 under
// less help, or most steps with a hint box open), and then its last rows give
// way to a `…` whether or not the step is eased; 142's drop order keeps the
// line there.
// Renders the eased step on screen at 60x20 and 80x24 in every colour mode:
// the line is whole wherever the card fits, and `whole` collects the places
// where it fits at 60x20 too.
function easedLineWhole(d, where, whole) {
  const flat = (text) => text.replace(/[^A-Za-z0-9]/g, '');
  for (const [capName, caps] of Object.entries(CAPS)) {
    for (const [cols, rows] of [[60, 20], [80, 24]]) {
      const lines = render(d.state, { cols, rows }, theme(caps)).map(strip);
      const at = `${where} at ${cols}x${rows} (${capName})`;
      const dropped = lines.some((l) => ['…', '...'].includes(l.trim()));
      assert.ok(!dropped || cols === 60, `${at} drops lines`);
      if (dropped) continue;
      assert.ok(flat(lines.join('')).includes(flat(C.eased)), `${at}: ${lines.join('\n')}`);
      assert.ok(!lines.some((l) => /(…|\.\.\.)$/.test(l) && width(l) === cols - 1), `${at} cuts a line`);
      if (cols === 60) whole.add(where);
    }
  }
}

test('an eased step: the "more help" line wraps whole, even at 60x20', () => {
  assert.match(C.eased, /you needed help with it last time\.$/);
  const whole = new Set();
  const check = (d, where) => easedLineWhole(d, where, whole);
  const landed = new Set();
  for (const lesson of allCourse) {
    if (!lesson.content) continue;
    const before = finishedBefore(lesson.id);
    for (const step of lesson.content.steps) {
      step.beats.forEach((_, beat) => {
        for (const lessHelp of [false, true]) {
          const d = driver({ course: allCourse, saved: { format: 1, welcomed: true, lessons: { ...before, [lesson.id]: { step: step.id, beat, warm: [], lessHelp } } } });
          d.key('enter');
          bottomRung(d);
          if (!d.state.eased.length) continue;
          playUntil(d, (s) => s.beat?.eased || (s.lesson === 'b-capstone' && s.view === 'complete'));
          if (d.state.view !== 'step') continue;
          const where = `${d.state.lesson} ${stepOf(d.state).id}${lessHelp ? ' (less help)' : ''}`;
          if (landed.has(where)) continue;
          landed.add(where);
          check(d, where);
          failCheck(d);
          check(d, `${where} after a FAIL`);
          d.send({ type: 'tick', wait: IDLE_MS + 1_000 });
          check(d, `${where} after two quiet minutes`);
          if (!hintAvailable(d.state)) continue;
          d.key('h');
          d.send({ type: 'tick', wait: 3_000 });
          d.key('h');
          check(d, `${where} with a hint open`);
        }
      });
    }
  }
  // At 60x20 the line fits whole as the step opens on every one of these.
  for (const where of ['b-1 Y1', 'b-2 C', 'b-3 Y2', 'b-4 Y3', 'b-5 Y1', 'b-5 W5 (less help)', 'b-capstone T6']) assert.ok(whole.has(where), where);
});

// Every warm-up missed (shown with s, or an empty answer), in a real play from
// there: where its ease lands, the line is whole as the step opens.
test('a missed warm-up: the "more help" line wraps whole where its ease lands', () => {
  const whole = new Set();
  for (const lesson of allCourse) {
    if (!lesson.content) continue;
    const before = finishedBefore(lesson.id);
    for (const w of lesson.content.warmup) {
      const d = driver({ course: allCourse, saved: { format: 1, welcomed: true, lessons: { ...before, [lesson.id]: { step: w.id, beat: 0, warm: [w.id] } } } });
      d.key('enter');
      d.key(beatOf(d.state).kind === 'type' ? 'enter' : 's');
      assert.equal(d.state.beat.revealed, true, `${lesson.id} ${w.id}`);
      assert.ok(d.state.eased.includes(w.skill), `${lesson.id} ${w.id} eases ${w.skill}`);
      playUntil(d, (s) => s.beat?.eased || (s.lesson === 'b-capstone' && s.view === 'complete'));
      if (d.state.view !== 'step') continue;
      easedLineWhole(d, `${d.state.lesson} ${stepOf(d.state).id} from ${lesson.id} ${w.id}`, whole);
    }
  }
  // In b-2, b-3 and b-5 the ease lands on the same lesson's W1, whole at 60x20.
  for (const where of ['b-2 W1 from b-2 R1', 'b-3 W1 from b-3 R1', 'b-5 W1 from b-5 R1']) assert.ok(whole.has(where), where);
});

// Fading counts only what this learner did.
const lessonById = (id) => allCourse.find((l) => l.id === id);
const plainAt = (d, cols, rows) => render(d.state, { cols, rows }, theme(CAPS.full)).map(strip).join('\n');

test('fading counts only what this learner did: a skipped skill opens GUIDED with its exact command on the card', () => {
  // The seeded b-5 run: b-1 to b-4 complete, with no step done.
  const skipped = Object.fromEntries(['b-1', 'b-2', 'b-3', 'b-4'].map((id) => [id, { complete: true, done: [] }]));
  const cmd = 'git rev-parse HEAD > .practice/b-5-commit.txt';
  const d = driver({ course: allCourse, saved: { format: 1, welcomed: true, lessons: { ...skipped, 'b-5': { step: 'W7', beat: 1, warm: [] } } } });
  d.key('enter');
  assert.equal(tierOf(d.state), 'guided');
  for (const [cols, rows] of [[60, 20], [80, 24]]) assert.ok(plainAt(d, cols, rows).includes(cmd), `${cols}x${rows}`);
  // On the path W7 is HINTED: the command waits behind h.
  const path = driver({ course: allCourse, saved: { format: 1, welcomed: true, lessons: { ...finishedBefore('b-5'), 'b-5': { step: 'W7', beat: 1, warm: [] } } } });
  path.key('enter');
  assert.equal(tierOf(path.state), 'hinted');
  assert.ok(!plainAt(path, 80, 24).includes(cmd));
});

test('fading counts only what this learner did: "done each part before" only after a finished step on every part', async () => {
  const { courseWith, DEMO_B2 } = await import('./learn-drive.mjs');
  assert.equal(C.noCommands, 'No commands this time.');
  assert.equal(C.doneEachPart, "You've done each part before.");
  const flat = (text) => text.replace(/\s+/g, ' ');
  const t2 = lessonById('b-capstone').content.steps.find((x) => x.id === 'T2');
  const beat = t2.beats.findIndex((b) => b.kind !== 'predict');
  const open = (lessons) => {
    const d = driver({ course: allCourse, saved: { format: 1, welcomed: true, lessons: { ...lessons, 'b-capstone': { step: 'T2', beat, warm: [] } } } });
    d.key('enter');
    assert.equal(tierOf(d.state), 'challenge', 'the capstone never drops to GUIDED');
    return d;
  };
  const none = open({});
  for (const [cols, rows] of [[60, 20], [80, 24]]) {
    const text = flat(plainAt(none, cols, rows));
    assert.ok(text.includes(C.noCommands), `${cols}x${rows}`);
    assert.ok(!text.includes(C.doneEachPart), `${cols}x${rows}: no history, so no "done before"`);
  }
  // A capstone step draws on every lesson before it: a finished step on its
  // own skill alone is not each part.
  const some = open({ 'b-2': { complete: true, done: ['W2'] } });
  assert.equal(lessonById('b-2').content.steps.find((x) => x.id === 'W2').skill, t2.skill);
  for (const [cols, rows] of [[60, 20], [80, 24]]) assert.ok(!flat(plainAt(some, cols, rows)).includes(C.doneEachPart), `${cols}x${rows}`);
  const did = open(finishedBefore('b-capstone'));
  for (const [cols, rows] of [[60, 20], [80, 24]]) assert.ok(plainAt(did, cols, rows).includes(`${C.noCommands} ${C.doneEachPart}`), `${cols}x${rows}`);
  // T1 saves the version (b-1), but also commits a CLAUDE.md (b-5): a learner
  // who did only b-1 hasn't done each part.
  const b1 = driver({ course: allCourse, saved: { format: 1, welcomed: true, lessons: { 'b-1': finished(lessonById('b-1')), 'b-capstone': { step: 'T1', beat: 0, warm: [] } } } });
  b1.key('enter');
  assert.equal(stepOf(b1.state).skill, 'save-version');
  for (const [cols, rows] of [[60, 20], [80, 24]]) {
    const text = flat(plainAt(b1, cols, rows));
    assert.ok(text.includes(C.noCommands) && !text.includes(C.doneEachPart), `${cols}x${rows}`);
  }
  // A harder step's line, too: a skill put on the plan by a warm-up, with no
  // step finished on it, gets no "You've done this before".
  const text = DEMO_B2.replace(/## steps[\s\S]*$/, ['## steps', '',
    '### W1 | Worked example step 1 of 3 | New', '- tier: guided', '- skill: brand-new', '- where: claude', '- beat: do', '- verify: self', '- goal: "Do it."', '',
    '### W2 | Worked example step 2 of 3 | Old', '- tier: hinted', '- skill: status', '- where: claude', '- beat: do', '- verify: self', '- goal: "Do it."', '',
    '### W3 | Worked example step 3 of 3 | New again', '- tier: guided', '- skill: other-new', '- where: claude', '- beat: do', '- verify: self', '- goal: "Do it."', '',
    '### C | Check | Check', '- tier: challenge', '- skill: check', '- where: terminal', '- beat: do', '- verify: self', '- goal: "Do it."', ''].join('\n'));
  const saw = courseWith({ 'b-2': text });
  const atW2 = (b1, recalled) => {
    const d = driver({ course: saw, saved: { format: 1, welcomed: true, lessons: { 'b-1': b1, 'b-2': { warm: [], recalled, step: 'W2', beat: 0 } } } });
    d.key('enter');
    assert.equal(stepNote(d.state), 'hinted');
    return flat(plainAt(d, 80, 24));
  };
  assert.match(atW2(finished(lessonById('b-1')), []), /You've done this before/);
  assert.doesNotMatch(atW2({ complete: true, done: [] }, ['R1']), /You've done this before/, 'R1 (status) was recalled, but no status step was finished');
});

test('fading counts only what this learner did: a replay\'s intro shows the help the play starts with', () => {
  // b-1 done, b-2 skipped, b-3 finished with R1 and R2 recalled: the enter
  // clears the recalls, so the intro already leaves them out.
  const b3 = lessonById('b-3');
  const replay = (recalled) => {
    const d = driver({ course: allCourse, saved: { format: 1, welcomed: true, lessons: { 'b-1': finished(lessonById('b-1')), 'b-3': { ...finished(b3), recalled } } } });
    if (d.state.view !== 'map') d.key('m');
    while (d.state.mapCursor !== allCourse.indexOf(b3)) d.key('down');
    d.key('enter');
    assert.equal(d.state.view, 'intro');
    return d;
  };
  const old = replay(['R1', 'R2']);
  const clean = replay([]);
  for (const [cols, rows] of [[60, 20], [80, 24]]) assert.equal(plainAt(old, cols, rows), plainAt(clean, cols, rows), `${cols}x${rows}`);
  // And the play then starts at the tiers the intro drew.
  old.key('enter');
  clean.key('enter');
  assert.equal(tierOf(old.state), tierOf(clean.state));
  assert.equal(old.state.progress['b-3'].warm.join(), clean.state.progress['b-3'].warm.join());
});

// Words that claim only what the app saw.
test('the next screen counts the questions in the steps this learner finished', () => {
  const b4 = lessonById('b-4');
  const questions = (steps) => steps.flatMap((st) => st.beats).filter((b) => b.ask && b.kind !== 'predict').length;
  const count = (d, cols, rows) => plainAt(d, cols, rows).match(/(\d+) questions? answered/)?.[1];
  // A full play: every question in the play, warm-ups too, as before.
  const d = driver({ course: allCourse, saved: { format: 1, welcomed: true, lessons: finishedBefore('b-4') } });
  playUntil(d, (s) => s.view === 'next' && s.lesson === 'b-4');
  const p = d.state.progress['b-4'];
  const played = [...p.warm.map((id) => b4.content.warmup.find((w) => w.id === id)), ...b4.content.steps];
  assert.ok(played.every((st) => p.done.includes(st.id)));
  assert.equal(questions(played), 9, 'every question beat in the play');
  for (const [cols, rows] of [[60, 20], [80, 24]]) assert.equal(count(d, cols, rows), '9', `${cols}x${rows}`);
  // The same play marked complete with no step done: the app saw no answer.
  const at = (done) => ({ state: { ...d.state, progress: { ...d.state.progress, 'b-4': { ...p, done } } } });
  for (const [cols, rows] of [[60, 20], [80, 24]]) {
    assert.ok(!plainAt(at([]), cols, rows).includes('9 questions answered'), `${cols}x${rows}`);
    assert.equal(count(at([]), cols, rows), '0', `${cols}x${rows}`);
  }
  // Part of it: only the steps done count.
  const some = played.slice(0, 5);
  assert.ok(questions(some) > 0 && questions(some) < 9);
  assert.equal(count(at(some.map((x) => x.id)), 80, 24), String(questions(some)));
});
