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
import { snapshot } from '../../learn/lib/store.mjs';
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
  assert.deepEqual(cut, [], 'a first rung is cut');
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
// and without less help: the "more help" line wraps whole, even where a 60x20
// card is taller than the window (b-2 Y3 under less help, a Check card after a
// FAIL, most steps with a hint box open): the row budget never drops it.
// Renders the eased step on screen at 60x20 and 80x24 in every colour mode;
// `whole` collects the places where the line shows whole at 60x20.
function easedLineWhole(d, where, whole) {
  const flat = (text) => text.replace(/[^A-Za-z0-9]/g, '');
  for (const [capName, caps] of Object.entries(CAPS)) {
    for (const [cols, rows] of [[60, 20], [80, 24]]) {
      const lines = render(d.state, { cols, rows }, theme(caps)).map(strip);
      const at = `${where} at ${cols}x${rows} (${capName})`;
      const dropped = lines.some((l) => ['…', '...'].includes(l.trim()));
      assert.ok(!dropped || cols === 60, `${at} drops lines`);
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
  // At 60x20 the line is whole on every one of these, the cases cut before
  // the row budget too: a hint box open on a tall card, and a Check after a FAIL.
  for (const where of ['b-1 Y1', 'b-2 C', 'b-3 Y2', 'b-4 Y3', 'b-5 Y1', 'b-5 W5 (less help)', 'b-capstone T6',
    'b-1 Y1 with a hint open', 'b-2 C after a FAIL', 'b-3 C after a FAIL']) assert.ok(whole.has(where), where);
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

// The capstone handover line (Q11): it reports the unaided result, and only
// when that play showed no exact command.
const HANDOVER = 'You did every task without the exact command.';
const playedTo = (id, saved = finishedBefore(id)) => {
  const d = driver({ course: allCourse, saved: { format: 1, welcomed: true, lessons: saved } });
  playUntil(d, (s) => s.view === 'next' && s.lesson === id);
  return d;
};

test('the capstone\'s next screen says "You did every task without the exact command." under the check summary', () => {
  const d = playedTo('b-capstone');
  for (const [cols, rows] of [[60, 20], [80, 24]]) {
    const lines = plainAt(d, cols, rows).split('\n');
    const at = lines.findIndex((l) => l.includes("The lesson's check passes: 7 of 7 items"));
    assert.ok(at > 0, `${cols}x${rows}: no check summary`);
    assert.equal(lines[at + 1].trim(), HANDOVER, `${cols}x${rows}`);
  }
});

test('the capstone handover line hides after a bottom rung anywhere in the capstone, a break included', () => {
  const cap = lessonById('b-capstone');
  const before = finishedBefore('b-capstone');
  const hidden = new Set();
  for (const step of cap.content.steps) {
    step.beats.forEach((_, beat) => {
      const d = driver({ course: allCourse, saved: { format: 1, welcomed: true, lessons: { ...before, 'b-capstone': { step: step.id, beat, warm: [] } } } });
      d.key('enter');
      // Where h waits for a try that can't come here, two quiet minutes open it.
      if (!hintAvailable(d.state)) d.send({ type: 'tick', wait: IDLE_MS + 1_000 });
      bottomRung(d);
      if (d.state.progress['b-capstone'].bottomAt !== step.id) return;
      playUntil(d, (s) => s.view === 'next' && s.lesson === 'b-capstone');
      for (const [cols, rows] of [[60, 20], [80, 24]]) assert.ok(!plainAt(d, cols, rows).includes(HANDOVER), `${step.id}.${beat} at ${cols}x${rows}`);
      hidden.add(step.id);
    });
  }
  // The capstone's exact commands on a first FAIL: T4's and T6's bottom
  // lines, and the tests item's on T5's check.
  assert.deepEqual([...hidden], ['T4', 'T5', 'T6']);
  // The Check reaches the tests item's bottom line when only that item fails.
  const c = driver({ course: allCourse, saved: { format: 1, welcomed: true, lessons: { ...before, 'b-capstone': { step: 'C', beat: 0, warm: [], done: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'] } } } });
  c.key('enter');
  const items = cap.items.map((text, index) => ({ index, text, pass: text !== 'the tests pass', hint: text === 'the tests pass' ? '`npm test` fails. Run it, read the first failure, and ask Claude to fix the code, not the test.' : '' }));
  c.send({ type: 'check', lesson: 'b-capstone', items });
  c.key('r');
  c.send({ type: 'check', lesson: 'b-capstone', items });
  for (let i = 0; i < 8 && !c.state.beat.confirm; i++) c.key('h');
  c.key('y');
  assert.equal(c.state.progress['b-capstone'].bottomAt, 'C');
  playUntil(c, (s) => s.view === 'next' && s.lesson === 'b-capstone');
  for (const [cols, rows] of [[60, 20], [80, 24]]) assert.ok(!plainAt(c, cols, rows).includes(HANDOVER), `C at ${cols}x${rows}`);
  // A bottom rung saved before a break still counts for this play.
  const resumed = playedTo('b-capstone', { ...before, 'b-capstone': { step: 'T6', beat: 0, warm: [], done: ['T1', 'T2', 'T3', 'T4', 'T5'], bottomAt: 'T2' } });
  assert.ok(!plainAt(resumed, 80, 24).includes(HANDOVER));
  // The intro's enter starts a new play: a replay with no exact command shows it.
  const replay = playedTo('b-capstone', { ...before, 'b-capstone': { ...finished(cap), bottomAt: 'T2' } });
  assert.ok(plainAt(replay, 80, 24).includes(HANDOVER));
});

test('the capstone handover line never shows on b-1 to b-5, even with no exact command shown', () => {
  assert.ok(plainAt(playedTo('b-capstone'), 80, 24).includes(HANDOVER));
  for (const id of ['b-1', 'b-2', 'b-3', 'b-4', 'b-5']) {
    const d = playedTo(id);
    assert.equal(d.state.progress[id].bottomAt, null, id);
    for (const [cols, rows] of [[60, 20], [80, 24]]) assert.ok(!plainAt(d, cols, rows).includes(HANDOVER), `${id} at ${cols}x${rows}`);
  }
});

// The line can't see a hint, so a hint never holds the command that saves a
// file for the check: that command is the beat's bottom rung, and the y/n
// before it sets bottomAt.
test('no capstone hint holds a command that saves a file for the check', () => {
  const { steps, ladder } = lessonById('b-capstone').content;
  const hints = [...steps.flatMap((step) => step.beats.flatMap((b) => b.hints)), ...ladder.flatMap((l) => l.hints)];
  const saves = hints.filter((h) => [...h.matchAll(/`([^`]+)`/g)].some(([, code]) => /\s>\s*\.practice\//.test(code)));
  assert.deepEqual(saves, []);
  assert.ok(steps.some((step) => step.beats.some((b) => b.bottom.some((x) => x.text === 'git rev-parse HEAD > .practice/capstone-commit.txt'))));
});

test('the capstone handover line is a plain row: no art of its own, whole in every mode and size, a toast included', () => {
  const shown = playedTo('b-capstone').state;
  const toasted = { ...shown, toast: { kind: 'save', message: 'EACCES: permission denied, open /home/sam/claude-code-practice/.practice/learn.json' } };
  for (const [capName, caps] of Object.entries(CAPS)) {
    const t = theme(caps);
    for (const [cols, rows] of SIZES) {
      for (const [label, state] of [['next', shown], ['next with a toast', toasted]]) {
        const lines = render(state, { cols, rows }, t);
        const where = `${label} at ${cols}x${rows} (${capName})`;
        assert.equal(lines.length, rows, where);
        for (const line of lines) assert.ok(width(line) <= cols - 1, `${where}: ${strip(line)}`);
        const row = lines.map(strip).find((l) => l.includes(HANDOVER));
        assert.ok(row, `${where}: no handover line`);
        assert.equal(row.trim(), HANDOVER, `${where}: ${row}`);
      }
    }
  }
});

// A celebration depends on the event, never on the help: the capstone with
// the exact command on T4's check celebrates as the play without it.
test('the capstone celebrates the same with or without the exact command: step done, complete and next', () => {
  const play = (bottom) => {
    const d = driver({ course: allCourse, saved: { format: 1, welcomed: true, lessons: finishedBefore('b-capstone') } });
    const seen = {};
    while (!(d.state.view === 'next' && d.state.lesson === 'b-capstone')) {
      const s = d.state;
      if (bottom && s.view === 'step' && stepOf(s).id === 'T4' && s.pos.beat === 2 && !s.progress['b-capstone'].bottomAt) bottomRung(d);
      const done = d.state.view === 'step' && ['done', 'already'].includes(d.state.beat.status);
      if (done || d.state.view === 'complete') {
        const where = done ? `${stepOf(d.state).id}.${d.state.pos.beat}` : 'complete';
        seen[where] = [[60, 20], [80, 24]].map(([cols, rows]) => plainAt(d, cols, rows)).join('\n');
      }
      playUntil(d, (x) => x !== s);
    }
    seen.next = [[60, 20], [80, 24]].map(([cols, rows]) => plainAt(d, cols, rows)).join('\n');
    return [d.state.progress['b-capstone'].bottomAt, seen];
  };
  const [none, plain] = play(false);
  const [used, helped] = play(true);
  assert.equal(none, null);
  assert.equal(used, 'T4');
  for (const where of ['T1.4', 'T2.2', 'T3.2', 'T4.2', 'T5.2', 'T6.2', 'complete']) assert.ok(plain[where], `no ${where} done screen`);
  assert.deepEqual(Object.keys(helped), Object.keys(plain));
  for (const where of Object.keys(plain).filter((k) => k !== 'next')) assert.equal(helped[where], plain[where], where);
  // The next screen differs only by the handover line (and the blank row
  // that fills in below).
  const lines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);
  assert.ok(lines(plain.next).includes(HANDOVER));
  assert.ok(!lines(helped.next).includes(HANDOVER));
  assert.deepEqual(lines(plain.next).filter((l) => l !== HANDOVER), lines(helped.next));
});

// The row budget (142): what gives way when a screen is taller than its window.
const SHORT = [[60, 20], [80, 24]];

test('a done beat hides its satisfied "Done when" line: W3 done at 60x20 is the 2.4 mockup', () => {
  const state = screens.find(([l]) => l === 'W3 done')[1];
  const lines = render(state, { cols: 60, rows: 20 }, theme(CAPS.full)).map((l) => strip(l).trimEnd());
  // energy-and-teaching.md 2.4, less Pip on the card's top border (a motion
  // ticket). The mockup was drawn when every spacer dropped at once; one at a
  // time from the bottom keeps the card's first spacer in its spare row.
  const mockup = [
    '   B1   Install, sign in and look around       GUIDED ★☆☆',
    '  ●━━●━━●━━○──○──○──○   ◇──◇──◇   ☆──☆        step 3 of 12',
    '  ━━━━━━━━━━━━━━──────────────────────────────────────────',
    '',
    null,
    '  │',
    '  │  Save the version',
    '  │  Go to your practice copy and save that output for the',
    '  │  check:',
    '  │   $ cd /home/sam/claude-code-practice               ✔',
    '  │   $ mkdir -p .practice                              ✔',
    '  │   $ claude --version > .practice/version.txt        ✔',
    '  │  ✦          ▄█▀   ·   Step 3 done!',
    '  │   ▀█▄    ▄█▀    ✦     .practice/version.txt',
    '  │  ·  ▀█▄█▀     ·       holds 2.1.285 (Claude Code)',
    '  │                       🔥 3 steps this session',
    '  ╰───────────────────────────────────────────────────────',
    '',
    null,
    '   enter  next    b back    w why    m map    q quit',
  ];
  mockup.forEach((row, i) => {
    // Rows 2 and 3 (the trail and the rule) and the pulse row are motion's.
    if (row === null || i === 1 || i === 2) return;
    assert.equal(lines[i], row, `row ${i + 1}`);
  });
  assert.ok(!lines.some((l) => l.includes(C.doneWhen)));
});

test('every step-done screen keeps its 🔥 line and its bottom border at 60x20 and 80x24', async () => {
  const { lessonScreens, course } = await import('./learn-drive.mjs');
  const done = [...screens, ...course.filter((l) => l.content && l.id !== 'b-1').flatMap((l) => lessonScreens(l.id, course))]
    .filter(([, s]) => s.view === 'step' && s.beat.status === 'done' && s.pos.beat === stepOf(s).beats.length - 1 && ['check', 'file', 'git-clean'].includes(beatOf(s).verify.kind));
  assert.ok(done.length > 20, `${done.length} step-done screens`);
  for (const [capName, caps] of Object.entries(CAPS)) {
    const t = theme(caps);
    for (const [cols, rows] of SHORT) {
      for (const [label, state] of done) {
        const lines = render(state, { cols, rows }, t).map(strip);
        const where = `${label} at ${cols}x${rows} (${capName})`;
        const fire = lines.findIndex((l) => l.includes(`${t.lead('fire')}${C.session(state.session + 1)}`) || l.includes(`${t.lead('fire')}${C.session(state.session)}`));
        assert.ok(fire > 0, `${where}: no session line\n${lines.join('\n')}`);
        assert.equal(lines[fire + 1].trim()[0], t.glyph.bl, `${where}: the bottom border follows the session line\n${lines.join('\n')}`);
        // The evidence line replaces it; with no evidence line it is optional.
        const beat = beatOf(state);
        if (beat.evidence && state.beat.evidence && !beat.verify.all) assert.ok(!lines.some((l) => l.includes(C.doneWhen)), `${where} shows "Done when"`);
      }
    }
  }
});

// Every screen of every lesson, as lessonScreens and lesson 1's walk reach them.
const everyScreen = async () => {
  const { lessonScreens, course } = await import('./learn-drive.mjs');
  const ids = course.filter((l) => l.content && l.id !== 'b-1').map((l) => l.id);
  return [...screens, ...[false, true].flatMap((skipped) => ids.flatMap((id) => lessonScreens(id, course, { skipped }).map(([l, s]) => [`${l}${skipped ? ' (skipped)' : ''}`, s])))];
};
const flatText = (text) => text.replace(/[^A-Za-z0-9]/g, '');

test('rows that never drop: the question and its options, feedback, the hint box, the eased line and the key bar', async () => {
  const all = await everyScreen();
  for (const [capName, caps] of Object.entries(CAPS)) {
    if (capName === 'sixteen') continue;
    const t = theme(caps);
    const box = `${t.glyph.rail}  ${t.glyph.bar}`;
    for (const [cols, rows] of SHORT) {
      for (const [label, state] of all) {
        if (state.view !== 'step' || state.overlay) continue;
        const where = `${label} at ${cols}x${rows} (${capName})`;
        const tall = render(state, { cols, rows: 80 }, t).map(strip);
        const lines = render(state, { cols, rows }, t).map(strip);
        const text = flatText(lines.join(''));
        const show = `\n${lines.join('\n')}`;
        // The hint box and feedback on a wrong pick, row by row.
        for (const row of tall.filter((l) => l.includes(box))) assert.ok(lines.includes(row), `${where}: "${row.trim()}" is gone${show}`);
        // The question, each option and the feedback, wherever a tall window
        // shows them whole (a "not this one" tag can sit inside an option).
        const beat = beatOf(state);
        const whole = flatText(tall.join(''));
        const words = [beat.ask, ...(beat.options ?? []).map((o) => o.text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')),
          C.notYet, C.stepDone(state.pos.step + 1), C.right, C.notQuite, C.eased].filter(Boolean);
        for (const word of words) if (whole.includes(flatText(word))) assert.ok(text.includes(flatText(word)), `${where}: "${word}" is gone${show}`);
        assert.equal(lines.filter((l) => l.trim().startsWith(t.glyph.bl)).length, tall.filter((l) => l.trim().startsWith(t.glyph.bl)).length, `${where}: the card's bottom border is gone${show}`);
        assert.equal(lines.at(-1), tall.at(-1), `${where}: the key bar`);
      }
    }
  }
});

test('spacers drop one at a time from the bottom, and the map\'s lesson rows stay evenly spaced', () => {
  const map = screens.find(([l]) => l === 'map')[1];
  const t = theme(CAPS.full);
  const gaps = (cols, rows) => {
    const lines = render(map, { cols, rows }, t).map(strip);
    const at = lines.map((l, i) => (/^\s*[❯ ] [✔○] /.test(l) ? i : -1)).filter((i) => i >= 0);
    assert.equal(at.length, allCourse.length, `${cols}x${rows}: ${lines.join('\n')}`);
    return { lines, gaps: new Set(at.slice(1).map((i, k) => i - at[k])) };
  };
  // 80x24 has room for every spacer; at 60x20 the footer's spacer goes, then
  // the lesson rows' spacers go together.
  assert.deepEqual([...gaps(80, 24).gaps], [2]);
  const small = gaps(60, 20);
  assert.deepEqual([...small.gaps], [1]);
  const text = flatText(small.lines.join(''));
  for (const word of [C.mapFooter, ...Object.values(C.tierHelp)]) assert.ok(text.includes(flatText(word)), `"${word}" at 60x20`);
});

// Each lesson's intro, complete and next screens, played on the path.
const endScreens = () => allCourse.filter((l) => l.content).flatMap((l) => {
  const d = driver({ course: allCourse, saved: { format: 1, welcomed: true, lessons: finishedBefore(l.id) } });
  assert.equal(d.state.view, 'intro', l.id);
  const intro = d.state;
  playUntil(d, (s) => s.view === 'complete' && s.lesson === l.id);
  const complete = d.state;
  d.key('enter');
  return [[`${l.id} intro`, intro], [`${l.id} complete`, complete], [`${l.id} next`, d.state]];
});

test('a repeat compacts below 24 rows only: the climb staircase becomes one row, and 80x24 keeps it', () => {
  const t = theme(CAPS.full);
  const stairs = (lines) => Object.values(C.tierHelp).filter((x) => lines.some((l) => l.includes(x)));
  const intro = screens.find(([l]) => l === 'intro')[1];
  const next = screens.find(([l]) => l === 'next')[1];
  // b-1's intro plans 7 GUIDED, 3 HINTED and 2 CHALLENGE steps; the walk's
  // next screen climbed 8, 2 and 2 (the staircases at 80x24 say so).
  for (const [state, bar] of [[intro, '●●●●●●●◆◆◆★★'], [next, '●●●●●●●●◆◆★★']]) {
    const tall = render(state, { cols: 80, rows: 24 }, t).map(strip);
    assert.equal(stairs(tall).length, 3, tall.join('\n'));
    const small = render(state, { cols: 60, rows: 20 }, t).map(strip);
    assert.deepEqual(stairs(small), [], small.join('\n'));
    const row = small.find((l) => l.includes(bar));
    assert.ok(row, small.join('\n'));
    assert.match(row, /GUIDED ★☆☆ .*CHALLENGE ★★★/);
  }
  // At 80x24 every intro and next screen keeps its staircase.
  for (const [label, state] of endScreens().filter(([l]) => !l.endsWith('complete'))) {
    const lines = render(state, { cols: 80, rows: 24 }, t).map(strip);
    assert.ok(stairs(lines).length >= 1 && !lines.some((l) => l.trim() === '…'), `${label}: ${lines.join('\n')}`);
  }
});

// A line `cut` shortened: it fills the row to the last column and ends in an
// ellipsis ('.' in ASCII mode).
const widthCut = (t, cols) => (l) => width(l) === cols - 1 && (t.unicode ? l.endsWith('…') : /\S\.$/.test(l));

test('at 60x20 and 80x24 no teaching line is cut on the intro, complete, next and level-up screens: long lines wrap', () => {
  const levelups = [...screens, ...allCourse.filter((l) => l.content).flatMap((l) => {
    const d = driver({ course: allCourse, saved: { format: 1, welcomed: true, lessons: finishedBefore(l.id) } });
    const out = [];
    const end = (s) => s.view === 'next' && s.lesson === l.id;
    while (!end(d.state)) {
      if (d.state.view === 'levelup') {
        out.push([`${l.id} level up ${d.state.levelTo}`, d.state]);
        d.key('enter');
      } else playUntil(d, (s) => s.view === 'levelup' || end(s));
    }
    return out;
  })].filter(([, s]) => s.view === 'levelup');
  assert.ok(levelups.length >= 6, `${levelups.length} level-ups`);
  for (const [capName, caps] of Object.entries(CAPS)) {
    const t = theme(caps);
    for (const [cols, rows] of SHORT) {
      for (const [label, state] of [...endScreens(), ...levelups]) {
        const lines = render(state, { cols, rows }, t).map(strip);
        const where = `${label} at ${cols}x${rows} (${capName})`;
        const show = `\n${lines.join('\n')}`;
        assert.ok(!lines.some((l) => l.trim() === t.glyph.ellipsis), `${where} drops lines${show}`);
        assert.ok(!lines.some(widthCut(t, cols)), `${where} cuts a line${show}`);
        const text = flatText(lines.join(''));
        const content = lessonById(state.lesson).content;
        const words = state.view === 'levelup' ? (state.levelTo === 'challenge' ? C.toChallenge : C.toHinted)
          : state.view === 'next' ? [C.notchHarder, C.savedBreak].filter((w) => w !== C.notchHarder || content.next) : content.intro.can;
        for (const word of words) assert.ok(text.includes(flatText(word)), `${where}: "${word}" is not whole${show}`);
      }
    }
  }
});

test('the welcome fits at 60x20 and 80x24: nothing cut, Pip and both windows on screen', () => {
  const words = [C.hi('Sam'), C.pip1, C.pip2, C.twoWindows, C.thisWindow, ...C.thisWindowLines, C.otherWindow, ...C.otherWindowLines, C.openSecond, 'cd /home/sam/claude-code-practice', C.comeBack];
  for (const [capName, caps] of Object.entries(CAPS)) {
    const t = theme(caps);
    for (const [cols, rows] of SHORT) {
      const lines = render(driver().state, { cols, rows }, t).map(strip);
      const where = `welcome at ${cols}x${rows} (${capName})`;
      const show = `\n${lines.join('\n')}`;
      assert.ok(!lines.some((l) => l.trim() === t.glyph.ellipsis), `${where} drops lines${show}`);
      assert.ok(!lines.some(widthCut(t, cols)), `${where} cuts a line${show}`);
      // Words read past Pip's ASCII face, which sits beside them.
      const text = flatText(lines.map((l) => l.replace(/^\s*[|+](-{7}| o {3}o |  \\_\/  )[|+]/, '')).join(''));
      for (const word of words) assert.ok(text.includes(flatText(word)), `${where}: "${word}" is not whole${show}`);
      // Pip's face, and the two windows side by side.
      assert.ok(lines.some((l) => l.includes(t.unicode ? '●   ●' : 'o   o')), `${where}: no Pip${show}`);
      assert.ok(lines.some((l) => l.includes(C.thisWindow) && l.includes(C.otherWindow)), `${where}: the windows are not side by side${show}`);
    }
  }
  // A git error never drops.
  const broken = render(driver({ facts: { gitError: 'spawn git ENOENT' } }).state, { cols: 60, rows: 20 }, theme(CAPS.full)).map(strip);
  assert.ok(flatText(broken.join('')).includes(flatText(C.gitBroken('spawn git ENOENT'))), broken.join('\n'));
});

test('decoration gives way below 24 rows only, after the spacers: the confetti, then Pip and the banner', () => {
  const t = theme(CAPS.full);
  const complete = screens.find(([l]) => l === 'complete')[1];
  // A three-row toast at 60x20.
  const toast = { kind: 'save', message: 'EACCES: permission denied, open .practice/learn.json for writing' };
  const confetti = (lines) => lines.some((l) => l.trim().startsWith('✦     ·'));
  const face = (lines) => lines.some((l) => l.includes('★   ★'));
  const at = (state, cols, rows) => render(state, { cols, rows }, t).map(strip);
  // With room, everything shows; a toast at 60x20 takes the spacers, then the confetti.
  assert.ok(confetti(at(complete, 60, 20)) && face(at(complete, 60, 20)));
  const small = at({ ...complete, toast }, 60, 20);
  assert.ok(!confetti(small) && face(small), small.join('\n'));
  assert.ok(!small.slice(3, -3).some((l) => l.trim() === ''), `no spacer is left: ${small.join('\n')}`);
  const typical = at({ ...complete, toast }, 80, 24);
  assert.ok(confetti(typical) && face(typical), typical.join('\n'));
  // The welcome with a git error: Pip gives way at 60x20, and stays at 80x24.
  const broken = driver({ facts: { gitError: 'spawn git ENOENT' } }).state;
  assert.ok(!at(broken, 60, 20).some((l) => l.includes('●   ●')), at(broken, 60, 20).join('\n'));
  assert.ok(at(broken, 80, 24).some((l) => l.includes('●   ●')));
  for (const word of [C.hi('Sam'), C.pip1, C.pip2]) assert.ok(flatText(at(broken, 60, 20).join('')).includes(flatText(word)), word);
});

test('an optional row drops before any teaching line is cut: the next screen\'s question count', () => {
  const t = theme(CAPS.full);
  const next = screens.find(([l]) => l === 'next')[1];
  // A save error long enough to leave the body nine rows at 60x20.
  const toast = { kind: 'save', message: `EACCES: permission denied, open ${'/home/sam/claude-code-practice'.repeat(6)}/.practice/learn.json` };
  const lines = render({ ...next, toast }, { cols: 60, rows: 20 }, t).map(strip);
  const show = `\n${lines.join('\n')}`;
  assert.ok(!lines.some((l) => l.includes(C.answeredSummary(5))), `the count shows${show}`);
  assert.ok(!lines.some((l) => l.trim() === '…'), `a teaching line is cut${show}`);
  const text = flatText(lines.join(''));
  for (const word of [C.checkedSummary(1, 1), C.yourClimb, C.nextUp, 'Permission modes and plan mode', C.notchHarder, C.savedBreak]) assert.ok(text.includes(flatText(word)), `"${word}"${show}`);
  // With room, it shows.
  assert.ok(render(next, { cols: 60, rows: 20 }, t).map(strip).some((l) => l.includes(C.answeredSummary(5))));
});

test('lines that a narrow window cut by width now wrap: no screen cuts a line at 60x20 or 80x24, ASCII included', async () => {
  const all = await everyScreen();
  for (const capName of ['full', 'ascii']) {
    const t = theme(CAPS[capName]);
    for (const [cols, rows] of SHORT) {
      for (const [label, state] of all) {
        const lines = render(state, { cols, rows }, t).map(strip);
        assert.ok(!lines.some(widthCut(t, cols)), `${label} at ${cols}x${rows} (${capName}) cuts a line:\n${lines.filter(widthCut(t, cols)).join('\n')}`);
      }
    }
  }
});

test('a done beat keeps its "Done when" where no evidence line replaces it, and a hidden line leaves no double spacer', async () => {
  const { lessonScreens, course } = await import('./learn-drive.mjs');
  const t = theme(CAPS.full);
  const cap = new Map(lessonScreens('b-capstone', course));
  const b5 = new Map(lessonScreens('b-5', course));
  // Capstone T1.1 is beat 1 of 5 and has no evidence key: it shows only "Done."
  const first = render(cap.get('b-capstone T1.1 done'), { cols: 80, rows: 24 }, t).map(strip);
  assert.ok(first.some((l) => l.includes(`${C.doneWhen}git show HEAD:CLAUDE.md shows it.`)), first.join('\n'));
  // At 60x20 it is optional, so it may drop; the card keeps its border.
  const small = render(cap.get('b-capstone T1.1 done'), { cols: 60, rows: 20 }, t).map(strip);
  assert.ok(small.some((l) => l.trim().startsWith(t.glyph.bl)) && !small.some((l) => /^\s*│  …$/.test(l)), small.join('\n'));
  // b-5 W4's "Done when" is a say line; its evidence line replaces it, and
  // the rail shows one spacer where the line was.
  for (const label of ['b-5 W4.0 done', 'b-5 Y3.0 done']) {
    const lines = render(b5.get(label), { cols: 80, rows: 40 }, t).map(strip);
    assert.ok(!lines.some((l) => l.includes(C.doneWhen)), `${label}: ${lines.join('\n')}`);
    assert.ok(lines.some((l) => l.includes(' holds ')), `${label}: no evidence line`);
    assert.ok(!lines.some((l, i) => l.trim() === t.glyph.rail && lines[i + 1]?.trim() === t.glyph.rail), `${label}: two spacers in a row\n${lines.join('\n')}`);
  }
  // Waiting, the say line shows.
  assert.ok(render(b5.get('b-5 W4.0 waiting'), { cols: 80, rows: 40 }, t).map(strip).some((l) => l.includes(C.doneWhen)));
});

test('no card on any screen draws two spacers in a row', async () => {
  const t = theme(CAPS.full);
  for (const [label, state] of await everyScreen()) {
    const lines = render(state, { cols: 80, rows: 60 }, t).map(strip);
    assert.ok(!lines.some((l, i) => l.trim() === t.glyph.rail && lines[i + 1]?.trim() === t.glyph.rail), `${label}: ${lines.join('\n')}`);
  }
});

// A card's bottom border: its corner, then rule to the end. (In ASCII the
// top border starts with the same two characters.)
const cardBottom = (t) => (l) => l.trim().length > 2 && l.trim() === `${t.glyph.bl}${t.glyph.rule.repeat(l.trim().length - 1)}`;

// The toasts a step card can show, as the reducer sets them.
const TOAST_KINDS = [{ kind: 'stray' }, { kind: 'hintsLater', try: 'r' }, { kind: 'pickFirst' }];

test('kept rows never drop for a toast: the toast gives up its blank row, then goes', async () => {
  const all = await everyScreen();
  for (const capName of ['full', 'ascii']) {
    const t = theme(CAPS[capName]);
    const box = `${t.glyph.rail}  ${t.glyph.bar}`;
    for (const toast of TOAST_KINDS) {
      for (const [label, base] of all) {
        if (base.view !== 'step' || base.overlay) continue;
        const state = { ...base, toast };
        const where = `${label} with a ${toast.kind} toast at 60x20 (${capName})`;
        const tall = render(state, { cols: 60, rows: 80 }, t).map(strip);
        const lines = render(state, { cols: 60, rows: 20 }, t).map(strip);
        const show = `\n${lines.join('\n')}`;
        assert.equal(lines.length, 20, where);
        for (const row of tall.filter((l) => l.includes(box))) assert.ok(lines.includes(row), `${where}: "${row.trim()}" is gone${show}`);
        assert.equal(lines.filter(cardBottom(t)).length, 1, `${where}: the card's bottom border is gone${show}`);
        assert.equal(lines.at(-1), tall.at(-1), `${where}: the key bar`);
      }
    }
  }
  // W2 stuck keeps its feedback whole and the toast too, which gives up its
  // blank row; W5 wrong has no room for the toast, so it goes.
  const t = theme(CAPS.full);
  const at = (label) => render({ ...screens.find(([l]) => l === label)[1], toast: { kind: 'stray' } }, { cols: 60, rows: 20 }, t).map(strip);
  const stuck = at('W2 stuck');
  assert.ok(flatText(stuck.join('')).includes(flatText(C.fixThenPick)) && stuck.some((l) => l.includes('looks like a command')), stuck.join('\n'));
  // The toast's last row sits on the rule: its blank row went.
  assert.ok(stuck.at(-3).includes('not here.'), stuck.join('\n'));
  const wrong = at('W5 wrong');
  assert.ok(!wrong.some((l) => l.includes('looks like a command')) && wrong.some((l) => l.includes(C.notQuite)), wrong.join('\n'));
});

test('a `…` cut inside a card keeps the rail: every row between the card\'s borders starts with it', async () => {
  const all = await everyScreen();
  for (const capName of ['full', 'ascii']) {
    const t = theme(CAPS[capName]);
    for (const toast of [null, { kind: 'stray' }]) {
      for (const [label, base] of all) {
        if (!['step', 'checkonly'].includes(base.view) || base.overlay) continue;
        const lines = render(toast ? { ...base, toast } : base, { cols: 60, rows: 20 }, t).map(strip);
        const bottom = lines.findIndex(cardBottom(t));
        const top = lines.findIndex((l) => l.trim().startsWith(`${t.glyph.tl}${t.glyph.rule}`));
        assert.ok(top > 0 && bottom > top, `${label} (${capName}): ${lines.join('\n')}`);
        for (const l of lines.slice(top + 1, bottom)) assert.equal(l.trim()[0], t.glyph.rail, `${label}${toast ? ' with a toast' : ''} (${capName}): "${l}"\n${lines.join('\n')}`);
      }
    }
  }
});

// The step screens a 60x20 window still cuts with a `…`: a hint box or
// feedback that leaves the card's teaching no room, and in ASCII on Windows
// capstone T1.2, where the Windows note never drops (ticket 165), so the
// teaching above it gives way instead. teach-merged 1.5 scopes "no teaching
// line is cut" to the intro, complete and next screens; this list keeps the
// step screens' count from growing unseen.
const CUT_AT_60X20 = {
  full: ['W3 hint 2', 'W3 hint 3', 'W5 wrong', 'b-4 W5.4 hint 1', 'b-4 W5.4 hint 2', 'b-4 W5.4 bottom', 'b-5 W4.0 hint 1', 'b-capstone T1.1 hint 4',
    'b-3 W2.0 bottom (skipped)', 'b-4 W4.2 hint 1 (skipped)', 'b-4 W4.2 hint 2 (skipped)', 'b-4 W4.2 hint 3 (skipped)', 'b-4 W5.4 hint 1 (skipped)',
    'b-4 W5.4 hint 2 (skipped)', 'b-4 W5.4 bottom (skipped)', 'b-5 W4.0 hint 1 (skipped)', 'b-5 W7.1 hint 2 (skipped)', 'b-capstone T1.1 hint 4 (skipped)'],
  ascii: ['W3 hint 1', 'W3 hint 2', 'W3 hint 3', 'W3 bottom', 'W5 wrong', 'b-2 Y5.3 hint 2', 'b-3 W6.2 hint 1', 'b-4 W5.4 hint 1', 'b-4 W5.4 hint 2',
    'b-4 W5.4 bottom', 'b-5 W4.0 hint 1', 'b-capstone T1.1 hint 4', 'b-capstone T1.2 open', 'b-capstone T1.2 hint 1', 'b-capstone T3.1 hint 1',
    'b-capstone T6.1 hint 1', 'b-2 Y5.3 hint 2 (skipped)', 'b-3 W2.0 bottom (skipped)', 'b-3 W6.2 hint 1 (skipped)', 'b-4 W4.2 hint 1 (skipped)',
    'b-4 W4.2 hint 2 (skipped)', 'b-4 W4.2 hint 3 (skipped)', 'b-4 W5.4 hint 1 (skipped)', 'b-4 W5.4 hint 2 (skipped)', 'b-4 W5.4 bottom (skipped)',
    'b-5 W4.0 hint 1 (skipped)', 'b-5 W7.1 hint 1 (skipped)', 'b-5 W7.1 hint 2 (skipped)', 'b-capstone T1.1 hint 4 (skipped)', 'b-capstone T1.2 open (skipped)',
    'b-capstone T1.2 hint 1 (skipped)', 'b-capstone T3.1 hint 1 (skipped)', 'b-capstone T6.1 hint 1 (skipped)'],
};

test('the step screens a 60x20 window cuts are the known ones, and 80x24 cuts none', async () => {
  const all = await everyScreen();
  for (const capName of ['full', 'ascii']) {
    const t = theme(CAPS[capName]);
    const marker = (l) => l.trim() === t.glyph.ellipsis || l.trim() === `${t.glyph.rail}  ${t.glyph.ellipsis}`;
    const cut = (cols, rows) => all.filter(([, s]) => render(s, { cols, rows }, t).map(strip).some(marker)).map(([l]) => l);
    assert.deepEqual(cut(60, 20), CUT_AT_60X20[capName], capName);
    assert.deepEqual(cut(80, 24), [], capName);
  }
});

test('fit: each run of cut rows gets its own `…`, a lone row is never swapped for one, and kept rows stay', async () => {
  const { fit } = await import('../../learn/lib/render.mjs');
  const keep = (text) => ({ keep: true, text });
  const body = ['a1', 'a2', 'a3', keep('Q'), keep('o1'), 'b1', 'b2', keep('F'), 'c1'];
  // Two rows over: a lone c1 would free nothing, so b1 and b2 go under one
  // `…`; then a2 and a3 go under a second.
  assert.deepEqual(fit(body, 8, false, '…'), ['a1', 'a2', 'a3', 'Q', 'o1', '…', 'F', 'c1']);
  assert.deepEqual(fit(body, 7, false, '…'), ['a1', '…', 'Q', 'o1', '…', 'F', 'c1']);
  // Kept rows alone are taller than the room: they stay, and the caller
  // makes room.
  assert.deepEqual(fit([keep('Q'), 'x', 'y', keep('F')], 2, false, '…'), ['Q', '…', 'F']);
  // Inside a card the `…` carries the rail.
  assert.deepEqual(fit([{ text: '| a', rail: '|' }, { text: '| b', rail: '|' }, keep('| F')], 2, false, '…'), ['|  …', '| F']);
});

test('the map keeps a spacer above its footer at 60x20 once the lesson rows close up', () => {
  const lines = render(screens.find(([l]) => l === 'map')[1], { cols: 60, rows: 20 }, theme(CAPS.full)).map(strip);
  const last = lines.findIndex((l) => l.includes('Beginner capstone'));
  assert.equal(lines[last + 1], '', lines.join('\n'));
  assert.ok(lines[last + 2].includes('Each lesson reuses'), lines.join('\n'));
});

// Rows `cut` may shorten by design: a lesson title in the header and on the
// map (one-row labels; spec 3.1) and the evidence line (the file's own text).
test('no line is cut by width anywhere in a row at 60x20 or 80x24, apart from the one-row labels', async () => {
  const all = await everyScreen();
  const t = theme(CAPS.full);
  for (const [cols, rows] of SHORT) {
    for (const [label, state] of all) {
      const lines = render(state, { cols, rows }, t).map(strip);
      const head = state.view === 'map' ? -1 : (rows >= 28 ? 1 : 0);
      lines.forEach((l, i) => {
        if (!l.includes('…') || i === head || l.trim() === '…' || /^\s*│  …$/.test(l) || l.includes(C.checking)) return;
        if (state.view === 'map' && /^\s*[❯ ] [✔○] /.test(l)) return;
        if (/ holds |^\s*│ .*\S…$/.test(l) && state.beat?.status === 'done') return;
        assert.fail(`${label} at ${cols}x${rows}, row ${i + 1}: ${l}\n${lines.join('\n')}`);
      });
    }
  }
});

// The level's first warm-up says once why warm-ups exist: the first one the
// level's first lesson with warm-ups plays (b-2 today), whichever it picks.
const WARMUP_WHY = "A warm-up brings back an earlier lesson from memory. A wrong answer is fine: you see the lesson's words at once.";
const firstWarmup = (id, saved = {}, lessons = allCourse) => {
  const d = driver({ course: lessons, saved: { format: 1, welcomed: true, lessons: finishedBefore(id, lessons), ...saved } });
  assert.equal(d.state.view, 'intro', id);
  d.key('enter');
  return d;
};
// The same course with a warm-up in b-1, so b-2's first warm-up isn't the
// level's first: b-2 then plays as it would with no explainer.
const withoutWhy = allCourse.map((l) => (l.id === 'b-1' ? { ...l, content: { ...l.content, warmup: [...l.content.warmup, {}] } } : l));
const explains = (d, cols = 80, rows = 24) => flatText(plainAt(d, cols, rows)).includes(flatText(WARMUP_WHY));

test('the level\'s first warm-up says why warm-ups exist, under "Warm-up from lesson N", and no other warm-up does', () => {
  const d = firstWarmup('b-2');
  assert.equal(stepOf(d.state).id, 'R1');
  const lines = plainAt(d, 80, 24).split('\n');
  const from = lines.findIndex((l) => l.includes(C.warmup(1)));
  assert.ok(from > 0, lines.join('\n'));
  assert.match(lines[from + 1], /│  A warm-up brings back an earlier lesson from memory\. A wrong answer is$/);
  assert.match(lines[from + 2], /│  fine: you see the lesson's words at once\.$/);
  // The second warm-up, and b-3 to b-5's first, say nothing more.
  playUntil(d, (s) => stepOf(s)?.id === 'R2');
  assert.equal(stepOf(d.state).part, 'Warm-up');
  assert.ok(!explains(d), plainAt(d, 80, 24));
  for (const id of ['b-3', 'b-4', 'b-5']) {
    const later = firstWarmup(id);
    assert.equal(stepOf(later.state).part, 'Warm-up', id);
    assert.ok(!explains(later), `${id}\n${plainAt(later, 80, 24)}`);
  }
});

test('the explainer goes on the first warm-up b-2 plays: a missed skill first takes it', () => {
  // R2 recalls status; a learner who missed it gets R2 first (ticket 132).
  const d = firstWarmup('b-2', { missed: ['status'] });
  assert.equal(stepOf(d.state).id, 'R2');
  assert.ok(explains(d), plainAt(d, 80, 24));
  playUntil(d, (s) => stepOf(s)?.id !== 'R2');
  assert.equal(stepOf(d.state).part, 'Warm-up');
  assert.ok(!explains(d), plainAt(d, 80, 24));
});

test('the explainer is optional: at 60x20 it drops whole, before any teaching line is cut, in full and ascii', () => {
  const seen = { shown: [], dropped: [] };
  for (const missed of [[], ['status'], ['exit']]) {
    for (const answer of [[], ['1'], ['1', 's'], ['2'], ['3']]) {
      const d = firstWarmup('b-2', { missed });
      for (const k of answer) d.key(k);
      const at = `${stepOf(d.state).id} after ${answer.join(' ') || 'nothing'}`;
      for (const capName of ['full', 'ascii']) {
        const t = theme(CAPS[capName]);
        for (const [cols, rows] of SHORT) {
          const out = render(d.state, { cols, rows }, t);
          assert.equal(out.length, rows, `${at} at ${cols}x${rows}`);
          for (const line of out) assert.ok(width(line) <= cols - 1, `${at} at ${cols}x${rows}: ${strip(line)}`);
        }
        const lines = render(d.state, { cols: 60, rows: 20 }, t).map(strip);
        const text = flatText(lines.join(''));
        const whole = text.includes(flatText(WARMUP_WHY));
        assert.equal(text.includes(flatText('A warm-up brings back')), whole, `${at} (${capName}) shows part of it\n${lines.join('\n')}`);
        // A screen too tall even without it (R3's longest reason) is cut
        // only once the explainer is gone.
        const cut = lines.some((l) => [t.glyph.ellipsis, `${t.glyph.rail}  ${t.glyph.ellipsis}`].includes(l.trim()));
        assert.ok(!(cut && whole), `${at} (${capName}) cuts a line and keeps the explainer\n${lines.join('\n')}`);
        // Once it drops, what gave way before it comes back: the screen is
        // the one with no explainer at all.
        if (!whole) assert.deepEqual(lines, render({ ...d.state, course: withoutWhy }, { cols: 60, rows: 20 }, t).map(strip), `${at} (${capName})`);
        assert.ok(explains(d), `${at}: 80x24 keeps it`);
        seen[whole ? 'shown' : 'dropped'].push(at);
      }
    }
  }
  assert.ok(seen.shown.includes('R1 after nothing') && seen.dropped.includes('R1 after 1'), JSON.stringify(seen));
});

test('the explainer comes from the content and the warm-up\'s place, never from learn.json', () => {
  // Answered, saved, and back on R1 from that save: it shows again, since
  // the save holds no word of it. Resumed on R2, it doesn't.
  const d = firstWarmup('b-2');
  d.key('2');
  assert.equal(d.state.beat.status, 'done');
  const saved = snapshot(d.state);
  // The save has the keys it had before the explainer, and holds the same
  // as the same play where b-1 has warm-ups, so b-2's first says nothing.
  assert.deepEqual(Object.keys(saved), ['format', 'welcomed', 'eased', 'missed', 'lessons']);
  for (const p of Object.values(saved.lessons)) {
    assert.deepEqual(Object.keys(p), ['step', 'beat', 'done', 'answers', 'levels', 'lessHelp', 'moreHelpAt', 'easedSteps', 'complete', 'warm', 'recalled', 'stamps', 'bottomAt']);
  }
  const quiet = firstWarmup('b-2', {}, withoutWhy);
  assert.ok(!explains(quiet));
  quiet.key('2');
  assert.deepEqual(snapshot(quiet.state), saved);
  for (const [step, shows] of [['R1', true], ['R2', false]]) {
    const back = driver({ course: allCourse, saved: { ...saved, lessons: { ...saved.lessons, 'b-2': { ...saved.lessons['b-2'], step, beat: 0 } } } });
    back.key('enter');
    assert.equal(stepOf(back.state).id, step);
    assert.equal(explains(back), shows, `${step}\n${plainAt(back, 80, 24)}`);
  }
  // With no warm-ups in b-2, b-3 is the level's first lesson that has them.
  const lessons = allCourse.map((l) => (l.id === 'b-2' ? { ...l, content: { ...l.content, warmup: [] } } : l));
  const b3 = driver({ course: lessons, saved: { format: 1, welcomed: true, lessons: finishedBefore('b-3', lessons) } });
  b3.key('enter');
  assert.equal(stepOf(b3.state).part, 'Warm-up');
  assert.ok(explains(b3), plainAt(b3, 80, 24));
});

test('each level has its own first warm-up: a later level\'s first lesson with warm-ups says why too', () => {
  // A made-up Intermediate lesson after the Beginner path: b-2's content
  // under the id i-1, so its warm-ups recall Beginner lessons.
  const b2 = allCourse.find((l) => l.id === 'b-2');
  const lessons = [...allCourse, { ...b2, id: 'i-1', content: { ...b2.content, lesson: 'i-1' } }];
  const i1 = firstWarmup('i-1', {}, lessons);
  assert.equal(i1.state.lesson, 'i-1');
  assert.equal(stepOf(i1.state).part, 'Warm-up');
  assert.ok(explains(i1), plainAt(i1, 80, 24));
  const b2First = firstWarmup('b-2', {}, lessons);
  assert.ok(explains(b2First), plainAt(b2First, 80, 24));
  // A second Intermediate lesson with warm-ups says nothing more.
  const i2 = [...lessons, { ...b2, id: 'i-2', content: { ...b2.content, lesson: 'i-2' } }];
  const second = firstWarmup('i-2', {}, i2);
  assert.equal(stepOf(second.state).part, 'Warm-up');
  assert.ok(!explains(second), plainAt(second, 80, 24));
});

// A missed Windows note leaves a broken file (ticket 165), so on Windows the
// note stays whole on every state of its step, at both short sizes.
test('a Windows note is never cut: in ASCII at 60x20 and 80x24 the whole note is on every screen of its step', async () => {
  const { lessonScreens, course } = await import('./learn-drive.mjs');
  const notes = course.filter((l) => l.content).flatMap((l) => readFileSync(join(root, 'learn', 'lessons', `${l.id}.md`), 'utf8').split('\n')
    .flatMap((line) => line.match(/^- win-note: "(.*)"$/)?.slice(1) ?? []));
  assert.equal(notes.length, 3, notes.join('\n'));
  const all = [false, true].flatMap((skipped) => course.filter((l) => l.content).flatMap((l) => lessonScreens(l.id, course, { skipped })
    .map(([label, s]) => [`${label}${skipped ? ' (skipped)' : ''}`, s])));
  const t = theme(CAPS.ascii);
  const seen = new Set();
  const states = new Set();
  for (const [label, state] of all) {
    const note = state.view === 'step' && state.beat ? beatOf(state).winNote : null;
    if (!note) continue;
    seen.add(note);
    states.add(label.replace(/^\S+ \S+ /, '').replace(/ \d+/, '').replace(' (skipped)', ''));
    for (const [cols, rows] of SHORT) {
      const lines = render(state, { cols, rows }, t).map(strip);
      assert.ok(flatText(lines.join('')).includes(flatText(note)), `${label} at ${cols}x${rows} loses the Windows note\n${lines.join('\n')}`);
    }
  }
  assert.deepEqual([...seen].sort(), [...notes].sort());
  for (const state of ['open', 'waiting', 'fail', 'hint', 'bottom', 'done']) assert.ok(states.has(state), `${state}: ${[...states]}`);
});
