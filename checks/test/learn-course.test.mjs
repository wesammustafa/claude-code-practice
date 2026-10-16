// Every lesson of the guide in the app (ticket 83): the 23 lessons on PATH in
// course order, the ones with no lesson file shown through their check, and
// a check-only lesson that can be completed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLesson, PATH, SLOW } from '../../learn/lib/content.mjs';
import { C } from '../../learn/lib/copy.mjs';
import { watching } from '../../learn/lib/flow.mjs';
import { main } from '../../learn/lib/main.mjs';
import { itemsMax, render } from '../../learn/lib/render.mjs';
import { sanitize, snapshot } from '../../learn/lib/store.mjs';
import { graphemes, isEmoji, strip, width } from '../../learn/lib/text.mjs';
import { theme } from '../../learn/lib/theme.mjs';
import { lessons } from '../lessons/index.mjs';
import { course, driver, finishedBefore, mapTo, playUntil, root } from './learn-drive.mjs';

const FULL = theme({ tty: true, depth: 8, unicode: true, links: true, win32: false });
const ASCII = theme({ tty: true, depth: 1, unicode: false, links: false, win32: true });
const SIZES = [[60, 20], [80, 24]];
// The course with no lesson file at all, so every lesson shows its check.
const noFiles = course.map((l) => ({ ...l, content: null }));
// A lesson's check-only view, opened from the map.
const checkOnly = (id, lessons = noFiles, saved = {}) => {
  const d = driver({ course: lessons, saved: { format: 1, welcomed: true, lessons: saved } });
  if (d.state.view !== 'map') d.key('m');
  mapTo(d, id);
  d.key('enter');
  assert.deepEqual([d.state.view, d.state.lesson], ['checkonly', id]);
  return d;
};
// A result for every item of a lesson: `pass(i)` says which pass, and the
// slow ones a poll leaves out come back unrun.
const result = (id, pass = () => false, { slow = true } = {}) => ({ type: 'check', lesson: id,
  items: lessons[id].items.map((it, index) => (slow && (SLOW[id] ?? []).includes(index) ? { index, text: it.text, pass: false, slow: true, hint: '' }
    : { index, text: it.text, pass: pass(index), hint: pass(index) ? '' : `${it.text} is not there yet: do the step, then look again.` })) });
// An arrow as main sends it: with how far the card scrolls in that window.
const arrow = (d, name, [cols, rows], t = FULL) => d.send({ type: 'key', name, wait: 10, itemsMax: itemsMax(d.state, { cols, rows }, t) });
const lines = (s, [cols, rows], t = FULL) => render(s, { cols, rows }, t).map((l) => strip(l).trimEnd());
// The card's rows, without its rail, as one line of text.
const cardText = (ls) => ls.filter((l) => /^\s*[│|] /.test(l)).map((l) => l.replace(/^\s*[│|] +/, '')).join(' ').replace(/\s+/g, ' ');
const flat = (text) => text.replaceAll('`', '').replace(/\s+/g, ' ');

// The guide's pages and the time each page's header line gives.
const PAGES = [
  ['b-1', 'beginner', '01-install-and-look-around', 'about 20 minutes'],
  ['b-2', 'beginner', '02-permission-modes-and-plan-mode', 'about 20 minutes'],
  ['b-3', 'beginner', '03-first-change', 'about 20 minutes'],
  ['b-4', 'beginner', '04-keep-a-session-on-track', 'about 20 minutes'],
  ['b-5', 'beginner', '05-project-memory', 'about 20 minutes'],
  ['b-capstone', 'beginner', 'capstone', '30 to 60 minutes'],
  ['i-1', 'intermediate', '01-first-skill', 'about 20 minutes'],
  ['i-2', 'intermediate', '02-organize-memory', 'about 20 minutes'],
  ['i-3', 'intermediate', '03-model-and-effort', 'about 15 minutes'],
  ['i-4', 'intermediate', '04-permissions-and-sandbox', 'about 20 minutes'],
  ['i-5', 'intermediate', '05-hooks', 'about 20 minutes'],
  ['i-6', 'intermediate', '06-subagents', 'about 20 minutes'],
  ['i-7', 'intermediate', '07-mcp', 'about 20 minutes'],
  ['i-8', 'intermediate', '08-plugins', 'about 20 minutes'],
  ['i-capstone', 'intermediate', 'capstone', '30 to 60 minutes'],
  ['a-1', 'advanced', '01-parallel-sessions', 'about 20 minutes'],
  ['a-2', 'advanced', '02-orchestration-patterns', 'about 20 minutes'],
  ['a-3', 'advanced', '03-dynamic-workflows', 'about 20 minutes, plus run time'],
  ['a-4', 'advanced', '04-headless', 'about 20 minutes'],
  ['a-5', 'advanced', '05-github-actions', 'about 20 minutes, plus run time'],
  ['a-6', 'advanced', '06-share-your-setup', 'about 20 minutes'],
  ['a-7', 'advanced', '07-bounded-runs', 'about 20 minutes, plus run time'],
  ['a-capstone', 'advanced', 'capstone', '30 to 60 minutes, plus run time'],
];

test('PATH lists all 23 lessons in course order, each with its page, its level and the minutes its page\'s header line gives', () => {
  assert.deepEqual(PATH.map(({ id, level, page, minutes }) => ({ id, level, page, minutes })),
    PAGES.map(([id, level, page, minutes]) => ({ id, level, page: `docs/${level}/${page}.md`, minutes })));
  assert.deepEqual(PATH.map((p) => p.id), Object.keys(lessons), 'every lesson with a check, in the checks\' order');
});

// Measured on the solutions branch, each item alone: the items that start a
// process (stub runs, hooks, npm test).
test('SLOW holds every item that starts a process, so a poll or a file event never runs one', () => {
  assert.deepEqual(SLOW, {
    'b-3': [1], 'b-capstone': [3, 4],
    'i-5': [2], 'i-capstone': [1, 9],
    'a-4': [1, 2, 3], 'a-7': [0, 1, 2, 3, 4], 'a-capstone': [4, 5, 6, 11],
  });
});

test('plain output runs no slow item: it names how many slower ones npm run check also runs', () => {
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const r = spawnSync(process.execPath, [join(root, 'learn', 'app.mjs')], { input: '', encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  const line = (label) => r.stdout.split('\n').find((l) => l.startsWith(`${label} `)) ?? '';
  for (const [label, id, n] of [['I5', 'i-5', 1], ['IC', 'i-capstone', 2], ['A4', 'a-4', 3], ['A7', 'a-7', 5]]) {
    assert.match(line(label), new RegExp(`\\(npm run check -- ${id} also runs ${n} slower one${n === 1 ? '' : 's'}\\)`), r.stdout);
  }
});

test('the check-only view of every lesson fits at 60x20 and 80x24, and the arrows bring every item into view, whole', () => {
  for (const id of PATH.map((p) => p.id)) {
    const d = checkOnly(id);
    const states = [['opened', () => {}], ['failing', () => d.send(result(id))],
      ['a broken check', () => d.send({ type: 'check-error', lesson: id, message: 'it took too long' })],
      ['a toast', () => d.send({ type: 'notice', kind: 'save', message: 'EACCES', wait: 10 })],
      ['every item passing', () => d.send(result(id, () => true, { slow: false }))]];
    for (const [name, make] of states) {
      make();
      for (const size of SIZES) {
        for (const t of [FULL, ASCII]) {
          const seen = new Set();
          for (let k = 0; k <= lessons[id].items.length; k++) {
            const raw = render(d.state, { cols: size[0], rows: size[1] }, t);
            const ls = raw.map((l) => strip(l).trimEnd());
            const where = `${id} ${name} at ${size.join('x')}${t.unicode ? '' : ' (ASCII)'}, ${k} down\n${ls.join('\n')}`;
            assert.equal(raw.length, size[1], where);
            for (const l of raw) {
              assert.ok(width(l) <= size[0] - 1, where);
              assert.ok(graphemes(strip(l)).filter(isEmoji).length <= 1, where);
            }
            assert.ok(!ls.some((l) => l.trim() === t.glyph.ellipsis || l.endsWith('…') || /[│|] +(…|\.\.\.)$/.test(l)), `${where}: a row is cut`);
            const text = cardText(ls);
            lessons[id].items.forEach((it, i) => text.includes(flat(it.text)) && seen.add(i));
            arrow(d, 'down', size, t);
          }
          assert.equal(seen.size, lessons[id].items.length, `${id} ${name} at ${size.join('x')}: items seen ${[...seen]}`);
          for (let k = 0; k <= lessons[id].items.length; k++) arrow(d, 'up', size, t);
          assert.equal(d.state.itemsAt, 0, `${id} ${name} at ${size.join('x')}: up goes back to the first item`);
        }
      }
    }
  }
});

// Every Beginner lesson finished, the way a learner leaves them.
const beginnerDone = () => finishedBefore('i-1');
const mapRow = (ls, label) => ls.find((l) => new RegExp(`^\\s*[❯ ] [✔○] +${label} `).test(l)) ?? '';

test('a check-only lesson is complete once a full check passes, slow items included: saved, counted, and the map\'s next marker moves on', () => {
  const d = checkOnly('i-5', course, beginnerDone());
  const all = () => true;
  // A poll leaves the slow item out: everything it ran passes, but that is no full check.
  d.send(result('i-5', all));
  assert.equal(d.state.progress['i-5'].complete, false, 'a poll without the slow item');
  const out = d.key('r');
  assert.deepEqual(out.find((e) => e.type === 'check'), { type: 'check', lesson: 'i-5', items: null, slow: true });
  // r's run with a failing item: still not complete.
  d.send(result('i-5', (i) => i !== 0, { slow: false }));
  assert.equal(d.state.progress['i-5'].complete, false, 'an item fails');
  const effects = d.send(result('i-5', all, { slow: false }));
  assert.equal(d.state.progress['i-5'].complete, true);
  assert.ok(effects.some((e) => e.type === 'save'), 'saved');
  // The card says so, as a step's card does once its check passes.
  for (const size of SIZES) assert.match(lines(d.state, size).find((l) => l.includes('╭')), /╭─ .* ✔ DONE /, size.join('x'));
  assert.equal(snapshot(d.state).lessons['i-5'].complete, true, 'in learn.json');
  assert.equal(sanitize(JSON.parse(JSON.stringify(snapshot(d.state)))).lessons['i-5'].complete, true, 'and read back');
  // A later failing poll takes nothing back.
  d.send(result('i-5'));
  assert.equal(d.state.progress['i-5'].complete, true);
  // The level's n of m on the map and the welcome.
  d.key('m');
  assert.match(lines(d.state, [80, 24])[0], /Intermediate path +1 of 9 done$/);
  assert.match(mapRow(lines(d.state, [80, 24]), 'I5'), /done/);
  const w = driver({ course, saved: { format: 1, welcomed: false, lessons: { ...beginnerDone(), 'i-1': { complete: true } } } });
  assert.match(lines(w.state, [80, 24])[0], /Intermediate path · 1 of 9 done$/);
});

test('a check-only lesson with no slow item is complete on any result where every item passes, and the next marker moves to the lesson after it', () => {
  const d = checkOnly('i-1', course, beginnerDone());
  assert.match(mapRow(lines((d.key('m'), d.state), [80, 24]), 'I1'), /next/);
  d.key('m');
  assert.equal(d.state.view, 'checkonly');
  d.send(result('i-1', () => true));
  assert.equal(d.state.progress['i-1'].complete, true);
  d.key('m');
  const ls = lines(d.state, [80, 24]);
  assert.match(mapRow(ls, 'I1'), /done/, ls.join('\n'));
  assert.match(mapRow(ls, 'I2'), /next/, ls.join('\n'));
  // The app opens on the next lesson's map row after a restart.
  const again = driver({ course, saved: snapshot(d.state) });
  assert.deepEqual([again.state.view, again.state.course[again.state.mapCursor].id], ['map', 'i-2']);
});

// The tier marks a mix bar draws, in Unicode.
const TIER_MARKS = /[●◆★]/;

test('a lesson with no lesson file shows no tier bar on the map, and a page with no bar has no legend or footer about them', () => {
  const d = checkOnly('i-1', course, beginnerDone());
  d.key('m');
  for (const size of SIZES) {
    const ls = lines(d.state, size);
    const rows = ['I1', 'I2', 'I3'].map((label) => mapRow(ls, label));
    for (const row of rows) assert.doesNotMatch(row, TIER_MARKS, `${size.join('x')}\n${ls.join('\n')}`);
    // With no bar on the page, nothing explains bars or the help they show.
    assert.ok(!ls.some((l) => l.includes(C.help) || l.includes(C.tierHelp.guided)), `${size.join('x')}\n${ls.join('\n')}`);
    assert.ok(!ls.join(' ').includes(C.mapFooter.slice(0, 20)), `${size.join('x')}\n${ls.join('\n')}`);
  }
  const b = driver({ course, saved: { format: 1, welcomed: true, lessons: { 'b-1': { complete: true } } } });
  b.key('m');
  const beginner = lines(b.state, [80, 24]);
  assert.match(mapRow(beginner, 'B2'), TIER_MARKS, 'a lesson with its file keeps its bar');
  assert.ok(beginner.some((l) => l.includes(C.help)) && beginner.join(' ').includes(C.mapFooter), beginner.join('\n'));
  // b-2 with no lesson file: no bar.
  const none = driver({ course: course.map((l) => (l.id === 'b-1' ? l : { ...l, content: null })), saved: { format: 1, welcomed: true, lessons: { 'b-1': { complete: true } } } });
  if (none.state.view !== 'map') none.key('m');
  assert.doesNotMatch(mapRow(lines(none.state, [80, 24]), 'B2'), TIER_MARKS);
});

test('next may name the next level\'s first lesson: the next screen offers it, with no tier bar or "a notch harder", and enter opens its check', () => {
  const text = readFileSync(join(root, 'learn', 'lessons', 'b-capstone.md'), 'utf8').replace(/^---\n/, '---\nnext: i-1\n');
  const lessons = course.map((l) => (l.id === 'b-capstone' ? { ...l, content: parseLesson(text, 'b-capstone.md') } : l));
  const d = driver({ course: lessons, saved: { format: 1, welcomed: true, lessons: finishedBefore('b-capstone') } });
  playUntil(d, (s) => s.view === 'next' && s.lesson === 'b-capstone');
  for (const size of SIZES) {
    const ls = lines(d.state, size);
    const where = `${size.join('x')}\n${ls.join('\n')}`;
    assert.match(ls.at(-1), /enter +start I1/, where);
    const up = ls.findIndex((l) => l.includes(C.nextUp));
    assert.ok(up > 0 && ls[up].includes('I1'), where);
    assert.ok(!ls.some((l) => l.includes(C.notchHarder.slice(0, 15))), where);
    assert.doesNotMatch(ls.slice(up).join('\n'), TIER_MARKS, where);
  }
  d.key('enter');
  assert.deepEqual([d.state.view, d.state.lesson], ['checkonly', 'i-1']);
});

test('a-5 and a-capstone run in a new copy of the template: PATH says so, and in the practice copy their view says so and runs no check', async () => {
  assert.deepEqual(PATH.filter((p) => p.newCopy).map((p) => p.id), ['a-5', 'a-capstone']);
  for (const id of ['a-5', 'a-capstone']) {
    const d = checkOnly(id, course);
    assert.ok(!d.effects.some((e) => e.type === 'check' && e.lesson === id), `${id}: a check ran`);
    assert.equal(watching(d.state), null, `${id}: the polls and the watcher ask for nothing`);
    assert.ok(!d.key('r').some((e) => e.type === 'check'), `${id}: r runs nothing`);
    for (const size of SIZES) {
      const ls = lines(d.state, size);
      const where = `${id} at ${size.join('x')}\n${ls.join('\n')}`;
      assert.ok(cardText(ls).includes(flat(C.newCopy.join(' '))), where);
      assert.ok(!cardText(ls).includes(flat(C.checkOnly.join(' '))), where);
      assert.doesNotMatch(ls.at(-1), /check now/, where);
    }
  }
  // Plain output runs no check for them, and says why.
  const asked = [];
  let out = '';
  await main({ stdin: { isTTY: false }, stdout: { isTTY: false, write: (x) => { out += x; } }, root, runCheck: async (dir, id) => (asked.push(id), { items: [] }) });
  assert.deepEqual(asked, PATH.map((p) => p.id).filter((id) => !['a-5', 'a-capstone'].includes(id)));
  for (const label of ['A5', 'AC']) assert.ok(out.split('\n').find((l) => l.startsWith(`${label} `)).endsWith(C.newCopyPlain), out);
});

test('a learner who starts at Intermediate or Advanced reaches its first lesson from the map in two keys', () => {
  for (const [keys, id] of [[['right', 'enter'], 'i-1'], [['left', 'enter'], 'a-1']]) {
    // A new learner: the app opens on the first lesson with a lesson file.
    const d = driver({ course });
    d.key('enter');
    assert.deepEqual([d.state.view, d.state.lesson], ['intro', 'b-1']);
    d.key('m');
    for (const k of keys) d.key(k);
    assert.deepEqual([d.state.view, d.state.lesson], ['checkonly', id], keys.join(' '));
  }
  // Every Beginner lesson done: the app opens on the map at the next level's first lesson.
  const done = driver({ course, saved: { format: 1, welcomed: true, lessons: beginnerDone() } });
  assert.deepEqual([done.state.view, done.state.course[done.state.mapCursor].id], ['map', 'i-1']);
  done.key('enter');
  assert.deepEqual([done.state.view, done.state.lesson], ['checkonly', 'i-1']);
});

const MOVING = theme({ tty: true, depth: 8, unicode: true, links: true, win32: false, motion: true });

test('the check-only card has Pip on its top border, at rest, in every lesson, and once done beside the DONE pill where the border has room', () => {
  for (const id of PATH.map((p) => p.id)) {
    const d = checkOnly(id);
    for (const size of SIZES) {
      const top = lines(d.state, size).find((l) => l.includes('╭'));
      assert.match(top, /\(●‿●\) ──$/, `${id} at ${size.join('x')}: ${top}`);
    }
    // Done: the pill takes border room. Pip steps off only where fewer than
    // its face's cells and a rule are left, which is ASCII at 60 columns.
    const done = checkOnly(id, noFiles, { [id]: { complete: true } });
    for (const size of SIZES) {
      for (const t of [FULL, ASCII]) {
        const top = lines(done.state, size, t).find((l) => /^\s*(╭|\+-)/.test(l));
        const where = `${id} done at ${size.join('x')}${t.unicode ? '' : ' (ASCII)'}: ${top}`;
        assert.match(top, /DONE/, where);
        if (t.unicode) assert.match(top, /\(●‿●\) ──$/, where);
        else if (size[0] === 80) assert.match(top, /\(o_o\) --$/, where);
        else assert.match(top, /DONE {2}-+$/, where);
      }
    }
  }
});

test('an item\'s mark pops ○ ◉ ✔ as a poll finds it passing; nothing else on the card moves, and the rest frame is the calm one', () => {
  const d = checkOnly('i-1', course, beginnerDone());
  d.send(result('i-1', (i) => i === 0));
  // Long after the card opened: its entrance and reading grace are over.
  d.send({ type: 'tick', wait: 30_000 });
  const poll = d.send(result('i-1', (i) => i <= 1)) && d.now;
  const frame = (ms) => render(d.state, { cols: 80, rows: 24 }, MOVING, { at: poll + ms }).map(strip);
  const rest = render(d.state, { cols: 80, rows: 24 }, MOVING).map(strip);
  assert.deepEqual(rest, render(d.state, { cols: 80, rows: 24 }, FULL).map(strip), 'the rest frame is the calm frame');
  const row = (ls, text) => ls.find((l) => l.includes(text)) ?? '';
  const [first, second, third] = lessons['i-1'].items.map((it) => flat(it.text).slice(0, 30));
  const markOf = (ls, text) => row(ls, text).match(/[│|] +(\S)/)?.[1];
  assert.deepEqual([0, 40, 80, 120, 160, 200].map((ms) => markOf(frame(ms), second)), ['○', '○', '◉', '◉', '✔', '✔']);
  for (const ms of [0, 40, 80, 120, 160]) {
    const ls = frame(ms);
    assert.equal(markOf(ls, first), '✔', `+${ms} ms: an item that passed before stays still`);
    assert.equal(markOf(ls, third), '▲', `+${ms} ms`);
    // Only the mark's cell and the pulse line differ from the rest frame.
    ls.forEach((l, i) => {
      if (i === ls.length - 2) return;
      const r = rest[i];
      if (l.includes(second)) assert.equal(l.replace(/[○◉✔]/, '*'), r.replace('✔', '*'), `+${ms} ms row ${i}`);
      else assert.equal(l, r, `+${ms} ms row ${i}`);
    });
  }
  // The first look pops nothing: the app saw no item fail before it.
  const fresh = checkOnly('i-1', course, beginnerDone());
  fresh.send({ type: 'tick', wait: 30_000 });
  fresh.send(result('i-1', () => true));
  assert.equal(markOf(render(fresh.state, { cols: 80, rows: 24 }, MOVING, { at: fresh.now }).map(strip), first), '✔');
});

// The rows of a frame with each item's mark as *, and without the pulse line.
const masked = (ls, t) => {
  const mark = new RegExp(`^(\\s*[│|] +)(${[t.glyph.dotOff, t.glyph.check, t.glyph.warnMark].map((g) => g.replace(/[[\]]/g, '\\$&')).join('|')}) `);
  return ls.filter((_, i) => i !== ls.length - 2).map((l) => l.replace(mark, '$1* '));
};

test('a poll changes no row of the check-only card: only marks move, and once r has run the slow items, a poll keeps what r found', () => {
  for (const id of ['i-5', 'i-capstone', 'a-4', 'a-7']) {
    for (const size of SIZES) {
      for (const t of [FULL, ASCII]) {
        const at = `${id} at ${size.join('x')}${t.unicode ? '' : ' (ASCII)'}`;
        const d = checkOnly(id);
        const opened = lines(d.state, size, t);
        // The slow items wait for r from the start, so the line about them is already there.
        assert.ok(cardText(opened).includes(flat(C.slowWait).slice(0, 30)), `${at}\n${opened.join('\n')}`);
        // A poll that leaves the slow items out, with every item it ran passing.
        d.send(result(id, () => true));
        const polled = lines(d.state, size, t);
        assert.deepEqual(masked(polled, t), masked(opened, t), `${at}: the first poll moved more than marks\n${polled.join('\n')}`);
        assert.ok(!polled.some((l) => new RegExp(`^\\s*[│|] +${t.glyph.warnMark.replace(/[[\]]/g, '\\$&')} `).test(l)), at);
        // Pip worries only where the card shows a failing mark: none here.
        if (t.unicode) assert.match(polled.find((l) => l.includes('╭')), /\(●‿●\) ──$/, `${at}: an unrun slow item is no failure`);
        // r's run passes every item; then a poll leaves the slow ones out again.
        d.send(result(id, () => true, { slow: false }));
        const ran = lines(d.state, size, t);
        assert.ok(!cardText(ran).includes(flat(C.slowWait).slice(0, 30)), `${at}: r ran them\n${ran.join('\n')}`);
        d.send({ type: 'tick', wait: 2_000 });
        d.send(result(id, () => true));
        const after = lines(d.state, size, t);
        assert.deepEqual(after.filter((_, i) => i !== after.length - 2), ran.filter((_, i) => i !== ran.length - 2), `${at}: a poll after r changed a row\n${after.join('\n')}`);
        assert.ok(SLOW[id].every((i) => d.state.checks[id].items[i].pass), `${at}: the slow items keep r's result`);
      }
    }
  }
});

test('the arrows move the check-only card only where it scrolls: pressed while every item fits, a later error and toast still show item 1 first', () => {
  const size = [60, 20];
  const d = checkOnly('i-2');
  const first = flat(lessons['i-2'].items[0].text);
  assert.doesNotMatch(lines(d.state, size).at(-1), /scroll/, 'every item fits');
  for (let i = 0; i < 5; i++) arrow(d, 'down', size);
  assert.equal(d.state.itemsAt, 0, 'nothing to scroll: the arrows move nothing');
  d.send({ type: 'check-error', lesson: 'i-2', message: 'it took too long' });
  d.send({ type: 'notice', kind: 'save', message: 'EACCES: permission denied, open /home/sam/claude-code-practice/.practice/learn.json', wait: 10 });
  const ls = lines(d.state, size);
  assert.match(ls.at(-1), /scroll/, `the card scrolls now\n${ls.join('\n')}`);
  assert.ok(cardText(ls).includes(first), `item 1 shows first\n${ls.join('\n')}`);
});

test('the check-only card scrolls no further than the window that ends on the last item, and up moves it at once', () => {
  for (const size of SIZES) {
    for (const t of [FULL, ASCII]) {
      const at = `i-capstone at ${size.join('x')}${t.unicode ? '' : ' (ASCII)'}`;
      const d = checkOnly('i-capstone');
      const shown = () => lines(d.state, size, t).join('\n').match(/Items? (\d+)(?: to (\d+))? of (\d+)/);
      const opened = shown();
      assert.ok(opened, at);
      const per = Number(opened[2] ?? opened[1]) - Number(opened[1]) + 1;
      for (let i = 0; i < 20; i++) arrow(d, 'down', size, t);
      const end = shown();
      assert.equal(Number(end[2] ?? end[1]), 11, `${at}: the last item shows\n${lines(d.state, size, t).join('\n')}`);
      assert.ok(Number(end[2] ?? end[1]) - Number(end[1]) + 1 >= per, `${at}: the last window holds as many items as the first\n${lines(d.state, size, t).join('\n')}`);
      arrow(d, 'up', size, t);
      assert.equal(Number(shown()[1]), Number(end[1]) - 1, `${at}: up moved the card at once`);
      // Scrolled further than this window allows, as in a smaller one before
      // a resize: the card still shows the last full window.
      for (let i = 0; i < 20; i++) d.send({ type: 'key', name: 'down', wait: 10 });
      assert.deepEqual(shown().slice(1), end.slice(1), `${at}\n${lines(d.state, size, t).join('\n')}`);
    }
  }
});

test('until a-5 and a-capstone can run in their own copy, the next lesson passes over them: the map marks a-6, and left, right and a restart land there', () => {
  const done = (ids) => Object.fromEntries(ids.map((id) => [id, { complete: true }]));
  const saved = { ...beginnerDone(), ...done(['i-1', 'i-2', 'i-3', 'i-4', 'i-5', 'i-6', 'i-7', 'i-8', 'i-capstone', 'a-1', 'a-2', 'a-3', 'a-4']) };
  const d = driver({ course, saved: { format: 1, welcomed: true, lessons: saved } });
  assert.deepEqual([d.state.view, d.state.course[d.state.mapCursor].id], ['map', 'a-6'], 'the app opens on the map at a-6');
  const ls = lines(d.state, [80, 24]);
  assert.match(mapRow(ls, 'A6'), /next/, ls.join('\n'));
  assert.doesNotMatch(mapRow(ls, 'A5'), /next/, ls.join('\n'));
  d.key('right');
  d.key('left');
  assert.equal(d.state.course[d.state.mapCursor].id, 'a-6', 'back on Advanced, at a-6');
  // Only they are left: the app opens on the map at a-5, which no marker names.
  const rest = driver({ course, saved: { format: 1, welcomed: true, lessons: { ...saved, ...done(['a-6', 'a-7']) } } });
  assert.deepEqual([rest.state.view, rest.state.course[rest.state.mapCursor].id], ['map', 'a-5']);
  assert.ok(!lines(rest.state, [80, 24]).some((l) => / next/.test(l)), lines(rest.state, [80, 24]).join('\n'));
});
