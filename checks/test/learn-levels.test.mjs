// The app's screens for a course of three levels (ticket 82), with a demo
// course of all three: labels unique in the course, lesson numbers within a
// level, the map one level at a time, and the welcome at the current level.
// Only Beginner is on PATH today, and its screens stay as they were.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATH } from '../../learn/lib/content.mjs';
import { C } from '../../learn/lib/copy.mjs';
import { stepOf } from '../../learn/lib/flow.mjs';
import { plainProgress } from '../../learn/lib/plain.mjs';
import { render } from '../../learn/lib/render.mjs';
import { graphemes, isEmoji, strip, width } from '../../learn/lib/text.mjs';
import { theme } from '../../learn/lib/theme.mjs';
import { DEMO_B2, driver, playUntil, threeLevels } from './learn-drive.mjs';

const FULL = theme({ tty: true, depth: 8, unicode: true, links: true, win32: false });
const ASCII = theme({ tty: true, depth: 1, unicode: false, links: false, win32: true });
const MODES = { full: FULL, sixteen: theme({ tty: true, depth: 4, unicode: true, links: false, win32: false }), noColor: theme({ tty: true, depth: 1, unicode: true, links: false, win32: false }), ascii: ASCII };
const screen = (state, [cols, rows] = [80, 24], t = FULL) => render(state, { cols, rows }, t).map((l) => strip(l).trimEnd());
// Every lesson before `id` complete.
const doneBefore = (course, id) => Object.fromEntries(course.slice(0, course.findIndex((l) => l.id === id)).map((l) => [l.id, { complete: true }]));

test('every PATH entry carries its level, the folder of its page, and the level names are the guide\'s', () => {
  for (const p of PATH) assert.equal(p.level, p.page.split('/')[1], p.id);
  assert.deepEqual(C.levels, { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' });
  assert.deepEqual(PATH.map((p) => C.levels[p.level]), ['Beginner', 'Beginner', 'Beginner', 'Beginner', 'Beginner', 'Beginner']);
});

const LABELS = ['B1', 'B2', 'B3', 'B4', 'B5', 'BC', 'I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'IC', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'AC'];

test('every lesson has a label unique in the course, and plain output shows each one', () => {
  const out = plainProgress(threeLevels(), {}, null).split('\n');
  const labels = out.filter((l) => /^\S/.test(l) && l !== C.plainIntro).map((l) => l.split(' ')[0]);
  assert.deepEqual(labels, LABELS);
});

test('titles show no literal backticks: a-4\'s in the header and in plain output', () => {
  const course = threeLevels();
  const plain = plainProgress(course, {}, null).split('\n');
  assert.ok(plain.includes('A4   Script Claude Code with claude -p: 0 of 0 check items pass'), plain.join('\n'));
  // Every lesson before a-4 done: the map opens at a-4, and enter opens its check.
  const d = driver({ course, saved: { format: 1, welcomed: true, lessons: doneBefore(course, 'a-4') } });
  assert.equal(d.state.view, 'map');
  d.key('enter');
  assert.equal(d.state.view, 'checkonly');
  for (const t of [FULL, ASCII]) {
    const head = screen(d.state, [80, 24], t)[0];
    assert.match(head, /A4 {1,3}Script Claude Code with claude -p/, head);
    assert.ok(!head.includes('`'), head);
  }
});

// A made-up i-2: the demo lesson 2, whose warm-ups recall b-1.
const I2 = DEMO_B2.replace('lesson: b-2', 'lesson: i-2').replace('next: b-3', 'next: i-3');
const has = (lines, text) => lines.some((l) => l.includes(text));

test('lesson numbers count within a level: i-2 is lesson 2, and its warm-ups from b-1 name Beginner', () => {
  const course = threeLevels({ 'i-2': I2 });
  const d = driver({ course, saved: { format: 1, welcomed: true, lessons: doneBefore(course, 'i-2') } });
  assert.equal(d.state.view, 'intro');
  assert.equal(d.state.lesson, 'i-2');
  for (const size of [[60, 20], [80, 24]]) assert.ok(has(screen(d.state, size), 'Start lesson 2'), screen(d.state, size).join('\n'));
  d.key('enter');
  assert.equal(stepOf(d.state).part, 'Warm-up');
  assert.ok(has(screen(d.state), 'Warm-up from Beginner lesson 1'), screen(d.state).join('\n'));
  playUntil(d, (s) => s.view === 'complete');
  assert.ok(has(screen(d.state), 'Lesson 2 done! You practised:'), screen(d.state).join('\n'));
  d.key('enter');
  assert.ok(has(screen(d.state), 'start I3'), screen(d.state).join('\n'));
});

test('a warm-up from its own level names no level: b-2\'s from b-1 says "Warm-up from lesson 1"', () => {
  const course = threeLevels();
  const d = driver({ course, saved: { format: 1, welcomed: true, lessons: doneBefore(course, 'b-2') } });
  d.key('enter');
  assert.equal(stepOf(d.state).part, 'Warm-up');
  assert.ok(has(screen(d.state), 'Warm-up from lesson 1'), screen(d.state).join('\n'));
});

// The map's lesson rows, by their label pills, and the one the cursor is on.
const pills = (lines) => lines.flatMap((l) => l.match(/^\s*[❯ ] [✔○] +([A-Z][1-9C])\s/)?.[1] ?? []);
const cursorOn = (lines) => lines.map((l) => l.match(/^\s*❯ [✔○] +([A-Z][1-9C])\s/)?.[1]).find(Boolean);
const mapAt = (id, course = threeLevels()) => {
  const d = driver({ course, saved: { format: 1, welcomed: true, lessons: doneBefore(course, id) } });
  // A lesson in the app opens on its intro: m shows its map.
  if (d.state.view !== 'map') d.key('m');
  assert.equal(d.state.view, 'map');
  return d;
};

test('the map shows one level, with its name and its n of m done', () => {
  const lines = screen(mapAt('i-1').state);
  assert.match(lines[0], /MAP +Intermediate path +0 of 9 done$/, lines.join('\n'));
  assert.deepEqual(pills(lines), LABELS.slice(6, 15), lines.join('\n'));
  assert.equal(cursorOn(lines), 'I1');
});

test('left and right switch level, to its next lesson; up and down stay in the level', () => {
  const d = mapAt('i-3');
  const at = () => {
    const lines = screen(d.state);
    return [lines[0].match(/(\w+) path/)[1], lines[0].match(/(\d+ of \d+) done$/)[1], cursorOn(lines), pills(lines).length];
  };
  assert.deepEqual(at(), ['Intermediate', '2 of 9', 'I3', 9]);
  d.key('left');
  assert.deepEqual(at(), ['Beginner', '6 of 6', 'B1', 6], 'a level all done: its first lesson');
  d.key('left');
  assert.deepEqual(at(), ['Beginner', '6 of 6', 'B1', 6], 'no level before Beginner');
  d.key('up');
  assert.deepEqual(at(), ['Beginner', '6 of 6', 'BC', 6], 'up from the first row wraps to the level\'s last');
  d.key('right');
  assert.deepEqual(at(), ['Intermediate', '2 of 9', 'I3', 9]);
  d.key('right');
  assert.deepEqual(at(), ['Advanced', '0 of 8', 'A1', 8]);
  d.key('right');
  assert.deepEqual(at(), ['Advanced', '0 of 8', 'A1', 8], 'no level after Advanced');
  d.key('up');
  assert.deepEqual(at(), ['Advanced', '0 of 8', 'AC', 8]);
  d.key('down');
  assert.deepEqual(at(), ['Advanced', '0 of 8', 'A1', 8], 'down from the last row wraps to the level\'s first');
  // Enter opens the lesson the cursor is on.
  d.key('up');
  d.key('enter');
  assert.equal(d.state.lesson, 'a-capstone');
  // m from a lesson opens its own level's page.
  d.key('m');
  assert.deepEqual(at(), ['Advanced', '0 of 8', 'AC', 8]);
});

test('the map\'s key bar offers the arrows that switch level, and ? lists them, only with more than one level', () => {
  const three = mapAt('i-1');
  for (const size of [[60, 20], [80, 24]]) assert.match(screen(three.state, size).at(-1), /←→ level/, size.join('x'));
  // Where the bar is short, as in ASCII at 60x20, it gives way first: enter and m stay.
  assert.equal(screen(three.state, [60, 20], ASCII).at(-1), '  up/down choose    enter open    m back    q quit');
  three.key('?');
  for (const size of [[60, 20], [80, 24]]) assert.ok(has(screen(three.state, size), C.levelKey[1]), screen(three.state, size).join('\n'));
  // Its words start where every key's do, in ASCII too.
  for (const t of [FULL, ASCII]) {
    const lines = screen(three.state, [80, 24], t);
    const col = (text) => lines.find((l) => l.endsWith(text)).indexOf(text);
    assert.equal(col(C.levelKey[1]), col(C.keyHelp.find(([k]) => k === 'h')[1]), lines.join('\n'));
  }
  const beginner = driver({ saved: { format: 1, welcomed: true, lessons: {} } });
  beginner.key('enter');
  beginner.key('m');
  assert.equal(beginner.state.view, 'map');
  assert.doesNotMatch(screen(beginner.state).at(-1), /level/);
  beginner.key('?');
  assert.ok(!has(screen(beginner.state), C.levelKey[1]));
});

const MOVING = theme({ tty: true, depth: 8, unicode: true, links: true, win32: false, motion: true });
const welcomeAt = (id, course = threeLevels()) => driver({ course, saved: { format: 1, welcomed: false, lessons: doneBefore(course, id) } });

test('the welcome names the current level and draws only its path line, with one cup for its capstone', () => {
  const d = welcomeAt('i-1');
  assert.equal(d.state.view, 'welcome');
  const lines = screen(d.state);
  assert.match(lines[0], /Intermediate path · 0 of 9 done$/, lines.join('\n'));
  assert.equal(lines[1], '  I1 ── I2 ── I3 ── I4 ── I5 ── I6 ── I7 ── I8 ── 🏆');
  assert.equal(lines.join('\n').split('🏆').length, 2, 'one cup');
  const a = screen(welcomeAt('a-1').state);
  assert.match(a[0], /Advanced path · 0 of 8 done$/);
  assert.equal(a[1], '  A1 ── A2 ── A3 ── A4 ── A5 ── A6 ── A7 ── 🏆   each stop a little harder');
  assert.match(screen(d.state, [80, 24], ASCII)[1], /^ {2}I1 -- I2 .* I8 -- \[cup\]$/);
});

test('the welcome\'s fuse runs along the current level\'s path line, link by link, and reaches its cup at +320 ms, as Beginner\'s does', () => {
  for (const [id, links] of [['b-1', 5], ['i-1', 8], ['a-1', 7]]) {
    const s = welcomeAt(id).state;
    const lit = (ms) => (render(s, { cols: 80, rows: 24 }, MOVING, { at: s.fx.view + ms }).map(strip)[1].match(/━━/g) ?? []).length;
    const run = [0, 80, 160, 240, 320, 400].map(lit);
    assert.equal(run[0], 1, `${id}: the first link at +0 ms`);
    assert.equal(run[4], links, `${id}: the cup at +320 ms, ${run}`);
    assert.equal(run[5], links, id);
    for (let k = 1; k < run.length; k++) assert.ok(run[k] >= run[k - 1] && run[k] - run[k - 1] <= 2, `${id}: ${run}`);
    assert.equal(lit(Infinity), 0, `${id} at rest`);
  }
});

test('the map\'s list scrolls with the cursor where its level doesn\'t fit: the cursor\'s row is always drawn, and no row is cut', () => {
  const d = mapAt('i-1');
  // A long toast takes rows from the list at 60x20.
  d.send({ type: 'notice', kind: 'save', message: 'EACCES: permission denied, open /home/sam/claude-code-practice/.practice/learn.json', wait: 10 });
  const level = LABELS.slice(6, 15);
  const seen = new Set();
  for (let k = 0; k < level.length; k++) {
    for (const size of [[60, 20], [80, 24]]) {
      const lines = screen(d.state, size);
      const where = `${level[k]} at ${size.join('x')}\n${lines.join('\n')}`;
      assert.ok(has(lines, C.saveFailed('EACCES').slice(0, 20)), where);
      assert.equal(cursorOn(lines), level[k], where);
      assert.ok(!lines.some((l) => l.trim() === '…'), where);
      // The rows drawn are a run of the level's lessons, in order.
      const shown = pills(lines);
      const from = level.indexOf(shown[0]);
      assert.deepEqual(shown, level.slice(from, from + shown.length), where);
      if (size[0] === 80) assert.equal(shown.length, level.length, where);
      else shown.forEach((x) => seen.add(x));
    }
    d.send({ type: 'key', name: 'down', wait: 10 });
  }
  assert.equal(seen.size, level.length, 'every row is drawn at some cursor place at 60x20');
});

test('with three levels the welcome and every map page fit at 60x20 and 80x24, in every mode, with nothing cut', () => {
  const pages = [['b-1', LABELS.slice(0, 6)], ['i-1', LABELS.slice(6, 15)], ['a-1', LABELS.slice(15)]];
  for (const [mode, t] of Object.entries(MODES)) {
    for (const [cols, rows] of [[60, 20], [80, 24]]) {
      for (const [id, labels] of pages) {
        const level = C.levels[threeLevels().find((l) => l.id === id).level];
        for (const [name, state] of [['welcome', welcomeAt(id).state], ['map', mapAt(id).state]]) {
          const raw = render(state, { cols, rows }, t);
          const lines = raw.map((l) => strip(l).trimEnd());
          const where = `${level} ${name} at ${cols}x${rows} (${mode})\n${lines.join('\n')}`;
          assert.equal(raw.length, rows, where);
          raw.forEach((l) => {
            assert.ok(width(l) <= cols - 1, where);
            assert.ok(graphemes(strip(l)).filter(isEmoji).length <= 1, where);
          });
          assert.ok(!lines.some((l) => l.trim() === t.glyph.ellipsis), `${where}: a row is dropped`);
          assert.ok(lines[0].includes(`${level} path`), where);
          if (name === 'map') {
            if (t.unicode) assert.deepEqual(pills(lines), labels, where);
            assert.ok(has(lines, C.ofDone(0, labels.length)), where);
          } else {
            // The path line whole: every lesson's label, then the cup.
            const path = labels.slice(0, -1).join(t.unicode ? ' ── ' : ' -- ');
            assert.ok(lines[1].startsWith(`  ${path}${t.unicode ? ' ── 🏆' : ' -- [cup]'}`), where);
          }
        }
      }
    }
  }
});
