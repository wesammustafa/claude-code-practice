// What a lesson needs before it starts (ticket 89): the commands its page's
// You need lists, the work an earlier lesson leaves behind, and, on native
// Windows, the page's note. The intro shows what is missing, so the learner
// finds out before spending usage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLesson } from '../../learn/lib/content.mjs';
import { C } from '../../learn/lib/copy.mjs';
import { introAsks } from '../../learn/lib/flow.mjs';
import { render } from '../../learn/lib/render.mjs';
import { snapshot } from '../../learn/lib/store.mjs';
import { strip, width } from '../../learn/lib/text.mjs';
import { theme } from '../../learn/lib/theme.mjs';
import { course, DEMO_I1, driver, finishedBefore, root, threeLevels } from './learn-drive.mjs';

// The guide's own You need lines, as the lessons that need them quote them.
const NEED_JQ = '`jq`, which the hook scripts use, and `python3`, which `format-after-edit.sh` uses.';
const NEED_SANDBOX = 'On Linux and WSL 2, the sandbox needs `bubblewrap` and `socat`';

// DEMO_I1 with `front` lines added to its front matter and `intro` lines to
// its intro.
const withNeeds = ({ front = [], intro = [] } = {}) => DEMO_I1
  .replace('next: i-2\n---', `next: i-2\n${front.map((l) => `${l}\n`).join('')}---`)
  .replace('- can: "do it"\n', `- can: "do it"\n${intro.map((l) => `${l}\n`).join('')}`);
const parse = (opts) => parseLesson(withNeeds(opts), 'i-1.md');

test('front matter names the commands the page needs: each needs item is the commands one need line quotes, "on linux" for Linux only', () => {
  const l = parse({ front: ['needs: [jq python3, bwrap socat on linux]'], intro: [`- need: "${NEED_JQ}"`, `- need: "${NEED_SANDBOX}"`] });
  assert.deepEqual(l.needs, [
    { commands: ['jq', 'python3'], linux: false, quote: NEED_JQ },
    { commands: ['bwrap', 'socat'], linux: true, quote: NEED_SANDBOX },
  ]);
  assert.deepEqual(parse().needs, [], 'a lesson that names none needs none');
});

test('a needs item the app can\'t read, or one with no need line to quote, is an error naming the file', () => {
  const bad = [
    [{ front: ['needs: [jq]'] }, /i-1\.md: needs has 1 item and the intro 0 need lines/],
    [{ intro: [`- need: "${NEED_JQ}"`] }, /i-1\.md: needs has 0 items and the intro 1 need line/],
    [{ front: ['needs: [jq, python3]'], intro: [`- need: "${NEED_JQ}"`] }, /needs has 2 items and the intro 1 need line/],
    [{ front: ['needs: [jq;rm]'], intro: [`- need: "${NEED_JQ}"`] }, /i-1\.md:\d+: needs item "jq;rm" is command names/],
    [{ front: ['needs: [../bin/jq]'], intro: [`- need: "${NEED_JQ}"`] }, /needs item "\.\.\/bin\/jq"/],
    [{ front: ['needs: [bwrap on mac]'], intro: [`- need: "${NEED_SANDBOX}"`] }, /needs item "bwrap on mac"/],
    [{ front: ['needs: [on linux]'], intro: [`- need: "${NEED_SANDBOX}"`] }, /needs item "on linux"/],
    [{ front: ['needs: [jq]'], intro: ['- need: jq is needed'] }, /need must be a quote of the lesson/],
  ];
  for (const [opts, error] of bad) assert.throws(() => parse(opts), error, JSON.stringify(opts));
  // A block list reads as the inline one does.
  assert.deepEqual(parse({ front: ['needs:', '  - jq'], intro: [`- need: "${NEED_JQ}"`] }).needs, [{ commands: ['jq'], linux: false, quote: NEED_JQ }]);
});

// ---- the intro ---------------------------------------------------------------
const MINE = '/home/sam/code/my-app';
const FULL = theme({ tty: true, depth: 8, unicode: true, links: true, win32: false });
const SIZES = [[60, 20], [80, 24]];
const screen = (state, [cols, rows] = [80, 24], t = FULL) => render(state, { cols, rows }, t).map((l) => strip(l).trimEnd());
// A screen's words as one line, for a sentence that wraps; code spans lose
// their backticks on screen.
const flat = (lines) => lines.map((l) => l.trim()).join(' ').replace(/\s+/g, ' ');
const words = (text) => text.replace(/`/g, '');
// At i-1's intro, Beginner finished and Intermediate's folder answered, with
// `opts` in its lesson file; `facts` as main found them.
const atIntro = (opts, facts = {}, folders = { intermediate: MINE }) => {
  const course = threeLevels({ 'i-1': withNeeds(opts) });
  return driver({ course, facts, saved: { format: 1, welcomed: true, lessons: finishedBefore('i-1', course), folders } });
};
const NEEDS = { front: ['needs: [jq python3, bwrap socat on linux]'], intro: [`- need: "${NEED_JQ}"`, `- need: "${NEED_SANDBOX}"`] };

test('the intro asks main to look up the commands its page needs, the Linux-only ones on Linux alone; each missing one shows its You need line', () => {
  const mac = atIntro(NEEDS);
  assert.equal(mac.state.view, 'intro');
  assert.deepEqual(introAsks(mac.state), [{ type: 'commands', names: ['jq', 'python3'] }]);
  const linux = atIntro(NEEDS, { linux: true });
  assert.deepEqual(introAsks(linux.state), [{ type: 'commands', names: ['jq', 'python3', 'bwrap', 'socat'] }]);
  // Opened from the map, the intro asks again: a command installed meanwhile counts.
  linux.key('m');
  linux.key('enter');
  assert.equal(linux.state.view, 'intro');
  assert.deepEqual(linux.effects.filter((e) => e.type === 'commands').at(-1), { type: 'commands', names: ['jq', 'python3', 'bwrap', 'socat'] });
  // Before main answers, nothing is said.
  for (const size of SIZES) assert.ok(!flat(screen(linux.state, size)).includes(words(NEED_JQ)), screen(linux.state, size).join('\n'));
  linux.send({ type: 'commands', found: { jq: true, python3: false, bwrap: true, socat: true } });
  for (const size of SIZES) {
    const text = flat(screen(linux.state, size));
    assert.ok(text.includes(`${C.notOnPath('python3')} "${words(NEED_JQ)}"`), `${size}\n${screen(linux.state, size).join('\n')}`);
    assert.ok(!text.includes(words(NEED_SANDBOX)), 'what is found says nothing');
    assert.ok(text.includes(C.startLesson(1)), 'the learner can still start');
  }
  linux.send({ type: 'commands', found: { python3: true, socat: false } });
  const text = flat(screen(linux.state));
  assert.ok(!text.includes(words(NEED_JQ)) && text.includes(`${C.notOnPath('socat')} "${NEED_SANDBOX.replace(/`/g, '')}"`), text);
  // Two lines missing: one sentence names every command, then each line.
  linux.send({ type: 'commands', found: { jq: false } });
  assert.ok(flat(screen(linux.state)).includes(`${C.notOnPath('jq', 'socat')} "${words(NEED_JQ)}" "${words(NEED_SANDBOX)}"`), screen(linux.state).join('\n'));
  // On macOS a Linux-only command is never asked about, so never shown.
  mac.send({ type: 'commands', found: { jq: false, python3: false, bwrap: false } });
  const onMac = flat(screen(mac.state));
  assert.ok(onMac.includes(`${C.notOnPath('jq', 'python3')} "${words(NEED_JQ)}"`) && !onMac.includes(words(NEED_SANDBOX)), onMac);
  // A lesson that needs nothing asks nothing.
  assert.deepEqual(introAsks(atIntro().state), []);
});

// The guide's NOTE, on Intermediate lesson 1's page.
const WINDOWS = 'From this level on, the lessons are written for macOS, Linux and WSL 2.';
const ASCII_WIN = theme({ tty: true, depth: 1, unicode: false, links: false, win32: true });
const WIN = theme({ tty: true, depth: 8, unicode: true, links: true, win32: true });

test('on native Windows the intro shows the page\'s note, and the learner can still start', () => {
  assert.equal(parse({ intro: [`- win-note: "${WINDOWS}"`] }).intro['win-note'], WINDOWS);
  assert.throws(() => parse({ intro: [`- win-note: ${WINDOWS}`] }), /win-note must be a quote of the lesson/);
  assert.throws(() => parse({ intro: [`- win-note: "${WINDOWS}"`, `- win-note: "${WINDOWS}"`] }), /a second win-note line/);
  const d = atIntro({ intro: [`- win-note: "${WINDOWS}"`] }, { win32: true });
  for (const t of [WIN, ASCII_WIN]) {
    for (const size of SIZES) {
      const text = flat(screen(d.state, size, t));
      assert.ok(text.includes(`"${WINDOWS}"`), `${size}\n${screen(d.state, size, t).join('\n')}`);
      assert.ok(text.includes(C.startLesson(1)), 'the start option stays');
    }
  }
  // Elsewhere it says nothing.
  for (const size of SIZES) assert.ok(!flat(screen(d.state, size)).includes(WINDOWS));
  d.key('enter');
  assert.equal(d.state.view, 'step');
});

// ---- prerequisites -------------------------------------------------------------
const SKILL = '.claude/skills/five-whys/SKILL.md';

test('front matter names a prerequisite: an earlier lesson\'s check item, or a file an earlier lesson leaves', () => {
  const l = parseLesson(withNeeds({ front: [`requires: [b-5 check 0, b-4 file ${SKILL}]`] }).replace('lesson: i-1', 'lesson: i-3'), 'i-3.md');
  assert.deepEqual(l.requires, [{ lesson: 'b-5', item: 0 }, { lesson: 'b-4', path: SKILL }]);
  assert.deepEqual(parse().requires, []);
  const bad = [
    ['requires: [b-5]', /i-1\.md: requires item "b-5" is <lesson> check <item> or <lesson> file <path>/],
    ['requires: [b-5 check]', /requires item "b-5 check"/],
    ['requires: [b-5 check x]', /requires item "b-5 check x"/],
    ['requires: [b-5 check 9]', /b-5 has no check item 9/],
    ['requires: [z-9 check 0]', /z-9 is no lesson before i-1/],
    ['requires: [i-1 check 0]', /i-1 is no lesson before i-1/],
    ['requires: [i-2 check 0]', /i-2 is no lesson before i-1/],
    ['requires: [b-5 file ../secret.txt]', /a path from the work folder, like/],
    ['requires: [b-5 file /etc/passwd]', /a path from the work folder, like/],
    ['requires: [b-5 file a\\b.txt]', /a path from the work folder, like/],
  ];
  for (const [line, error] of bad) assert.throws(() => parse({ front: [line] }), error, line);
});

const REQUIRES = { front: [`requires: [b-5 check 0, b-4 file ${SKILL}]`] };
const B5_ITEM = 'a committed CLAUDE.md holds the rule saved in `.practice/b-5-rule.txt`';
const lastOf = (effects, type) => effects.filter((e) => e.type === type).at(-1);

test('the intro looks for its prerequisites in the work folder; one that fails says so and offers its lesson', () => {
  const d = atIntro(REQUIRES);
  const ask = { type: 'prereqs', lesson: 'i-1', dir: MINE, requires: [{ lesson: 'b-5', item: 0 }, { lesson: 'b-4', path: SKILL }] };
  assert.deepEqual(introAsks(d.state), [ask]);
  // Until main answers, the intro says nothing and offers the two starts.
  for (const size of SIZES) assert.ok(!flat(screen(d.state, size)).includes('builds on'), screen(d.state, size).join('\n'));
  // A result from another folder says nothing about this one.
  d.send({ type: 'prereq', lesson: 'i-1', dir: '/home/sam/claude-code-practice', at: 0, pass: false });
  assert.ok(!flat(screen(d.state)).includes('builds on'));
  d.send({ type: 'prereq', lesson: 'i-1', dir: MINE, at: 0, pass: false });
  d.send({ type: 'prereq', lesson: 'i-1', dir: MINE, at: 1, read: null });
  for (const size of SIZES) {
    const lines = screen(d.state, size);
    const text = flat(lines);
    const where = `${size}\n${lines.join('\n')}`;
    // The prerequisite says what isn't there where it has room; the offer
    // says whose work it is.
    if (text.includes('builds on')) {
      assert.ok(text.includes(C.buildsOnCheck('B5', words(B5_ITEM))), where);
      assert.ok(text.includes(C.buildsOnFile('B4', C.fileEmpty(SKILL))), where);
    }
    if (size[1] >= 24) assert.ok(text.includes('builds on'), where);
    assert.ok(text.includes(C.startLesson(1)) && text.includes(C.openFirst('B5')), where);
  }
  // The offer is the third option: down twice, or 3, then enter opens B5.
  d.key('down');
  d.key('down');
  d.key('enter');
  assert.deepEqual([d.state.view, d.state.lesson], ['intro', 'b-5']);
  // Back at i-1 the intro looks again; what passes now says nothing.
  const again = atIntro(REQUIRES);
  again.send({ type: 'prereq', lesson: 'i-1', dir: MINE, at: 0, pass: true });
  again.send({ type: 'prereq', lesson: 'i-1', dir: MINE, at: 1, read: Buffer.from('---\nname: five-whys\n---\n') });
  const text = flat(screen(again.state));
  assert.ok(!text.includes('builds on') && !text.includes(C.openFirst('B5')), text);
  // An item the check could not decide (a slow one, an error) says nothing.
  again.send({ type: 'prereq', lesson: 'i-1', dir: MINE, at: 0, pass: null });
  assert.ok(!flat(screen(again.state)).includes('builds on'));
  // 3 then enter goes too, and with nothing to offer 3 does nothing.
  const three = atIntro(REQUIRES);
  three.send({ type: 'prereq', lesson: 'i-1', dir: MINE, at: 1, read: Buffer.from('') });
  three.key('3');
  three.key('enter');
  assert.deepEqual([three.state.view, three.state.lesson], ['intro', 'b-4']);
  again.key('3');
  assert.equal(again.state.cursor, 0);
});

test('while the folder question waits for an answer the prerequisites wait too; the answer asks for them in that folder', () => {
  const d = atIntro(REQUIRES, {}, null);
  assert.deepEqual(introAsks(d.state), []);
  d.key('enter');
  assert.deepEqual(lastOf(d.effects, 'prereqs'), { type: 'prereqs', lesson: 'i-1', dir: '/home/sam/claude-code-practice', requires: [{ lesson: 'b-5', item: 0 }, { lesson: 'b-4', path: SKILL }] });
});

test('an offer that goes once its prerequisite passes leaves the cursor on the start option', () => {
  const d = atIntro(REQUIRES);
  d.send({ type: 'prereq', lesson: 'i-1', dir: MINE, at: 0, pass: false });
  d.key('3');
  assert.equal(d.state.cursor, 2);
  d.send({ type: 'prereq', lesson: 'i-1', dir: MINE, at: 0, pass: true });
  assert.ok(screen(d.state).some((l) => l.includes(`❯  ${C.startLesson(1)}`)), screen(d.state).join('\n'));
});

// ---- the row plan ----------------------------------------------------------------
// b-4's intro, the longest Beginner one: a Why line, four can lines and a payoff.
const B4_INTRO = readFileSync(join(root, 'learn', 'lessons', 'b-4.md'), 'utf8').match(/## intro\n([\s\S]*?)\n## /)[1];
const NEED_SHORT = '`jq`, for the load log in the Worked example.';
const MODES = [FULL, theme({ tty: true, depth: 4, unicode: true, links: false, win32: true }), theme({ tty: true, depth: 1, unicode: true, links: false, win32: false }), ASCII_WIN];
const widthCut = (t, cols) => (l) => width(l) === cols - 1 && (t.unicode ? l.endsWith('…') : /\S\.$/.test(l));
// A full intro for `id` with `front` and `intro` lines, and `extra` more can lines.
const fullIntro = (id, { front = [], intro = [] }, extra = 0) => withNeeds({ front }).replace('lesson: i-1', `lesson: ${id}`)
  .replace(/## intro\n[\s\S]*?\n## warm-up/, `## intro\n${B4_INTRO}${[...Array.from({ length: extra }, (_, k) => `- can: "practise skill ${k + 1}"`), ...intro].map((l) => `${l}\n`).join('')}\n## warm-up`);

test('the intro\'s new rows share its row plan with the Why line and the folder question: at 60x20 and 80x24 no teaching line is cut, and the Why line gives way first', () => {
  const sandbox = { front: ['needs: [jq, bwrap socat on linux]', 'requires: [b-5 check 0]'], intro: [`- need: "${NEED_SHORT}"`, `- need: "${NEED_SANDBOX}"`] };
  // Intermediate lesson 1's page has the Windows note; lesson 2's needs jq
  // and builds on Beginner lesson 5, and is the level's first intro when the
  // learner opens it first. Advanced lesson 7's needs two You need lines.
  const windows = { intro: [`- win-note: "${WINDOWS}"`] };
  const first = { front: ['needs: [jq]', 'requires: [b-5 check 0]'], intro: [`- need: "${NEED_SHORT}"`] };
  // At `id`'s intro, with every command missing and the prerequisite
  // failing: its level's folder question waiting (`asking`), answered there
  // with this practice copy (`answered`), or saved before (`saved`).
  const COPY = '/home/sam/claude-code-practice';
  const at = (id, opts, extra, mode) => {
    const course = threeLevels({ [id]: fullIntro(id, opts, extra) });
    // Every lesson before it finished, but its level's: its folder question
    // is the level's first.
    const lessons = Object.fromEntries(course.slice(0, course.findIndex((l) => l.id === id)).map((l) => [l.id, { complete: true }]));
    const level = course.find((l) => l.id === id).level;
    const d = driver({ course, facts: { linux: true, win32: true }, saved: { format: 1, welcomed: true, lessons, ...(mode === 'saved' ? { folders: { [level]: MINE } } : {}) } });
    assert.equal(d.state.lesson, id);
    if (mode === 'answered') d.key('enter');
    d.send({ type: 'commands', found: { jq: false, bwrap: false, socat: false } });
    d.send({ type: 'prereq', lesson: id, dir: mode === 'saved' ? MINE : COPY, at: 0, pass: false });
    return d.state;
  };
  const cases = [
    // A level's first intro: the folder question, then its answer.
    ...[0, 1].flatMap((extra) => [
      [`first, asking, the Windows note, ${extra} more can lines`, at('i-1', windows, extra, 'asking'), [C.folderAsk('Intermediate'), C.folderOther], WINDOWS],
      [`first, answered, the Windows note, ${extra} more can lines`, at('i-1', windows, extra, 'answered'), [C.workFolder, C.startLesson(1)], WINDOWS],
      [`first, asking, a command missing, ${extra} more can lines`, at('i-2', first, extra, 'asking'), [C.folderAsk('Intermediate'), C.folderOther, words(NEED_SHORT)]],
    ]),
    ['first, answered, a command and a prerequisite missing', at('i-2', first, 0, 'answered'), [C.workFolder, words(NEED_SHORT), C.openFirst('B5')]],
    // A later intro with two You need lines missing.
    ['later, two needs', at('a-7', sandbox, 0, 'saved'), [words(NEED_SHORT), words(NEED_SANDBOX), C.openFirst('B5')]],
  ];
  const why = parse().intro.why ?? B4_INTRO.match(/- why: "(.*)"/)[1];
  let dropped = 0;
  for (const [label, state, rows, winNote] of cases) {
    const can = [...state.course.find((l) => l.id === state.lesson).content.intro.can];
    for (const t of MODES) {
      for (const [cols, size] of SIZES) {
        const lines = render(state, { cols, rows: size }, t).map(strip);
        const where = `${label} at ${cols}x${size}\n${lines.join('\n')}`;
        assert.ok(!lines.some((l) => l.trim() === t.glyph.ellipsis), `${where}: a row is dropped`);
        assert.ok(!lines.some(widthCut(t, cols)), `${where}: a line is cut`);
        const text = flat(lines);
        for (const c of can) assert.ok(text.includes(words(c)), `${where}: "${c}" is not whole`);
        for (const r of rows) assert.ok(text.includes(r), `${where}: "${r}" is not whole`);
        if (winNote && t.caps.win32) assert.ok(text.includes(winNote), `${where}: the Windows note`);
        // The Why line is whole, or gone with nothing else gone.
        if (text.includes(`${C.whyLead} "${why.slice(0, 20)}`)) assert.ok(text.includes(words(why)), `${where}: the Why line is cut`);
        else dropped += 1;
      }
    }
  }
  assert.ok(dropped > 0, 'the Why line never had to give way');
});

// Each intro in learn/lessons as the learner may meet it: every command it
// needs missing, every prerequisite failing, on native Windows, and, in a
// later level, as its level's first intro, asking and then answered there.
test('every lesson file\'s intro fits at 60x20 and 80x24 with everything it needs missing: no teaching line cut', () => {
  const COPY = '/home/sam/claude-code-practice';
  const states = course.filter((l) => l.content).flatMap((l) => {
    // Every lesson before it finished, and no work folder saved yet.
    const lessons = Object.fromEntries(course.slice(0, course.indexOf(l)).map((x) => [x.id, { complete: true }]));
    const modes = l.level === 'beginner' ? ['beginner'] : ['asking', 'answered'];
    return modes.map((mode) => {
      const d = driver({ course, facts: { linux: true, win32: true }, saved: { format: 1, welcomed: true, lessons } });
      assert.deepEqual([d.state.view, d.state.lesson], ['intro', l.id]);
      if (mode === 'answered') d.key('enter');
      d.send({ type: 'commands', found: Object.fromEntries(l.content.needs.flatMap((n) => n.commands).map((c) => [c, false])) });
      l.content.requires.forEach((r, at) => d.send({ type: 'prereq', lesson: l.id, dir: COPY, at, ...(r.path ? { read: null } : { pass: false }) }));
      return [`${l.id} ${mode}`, d.state];
    });
  });
  assert.ok(states.length >= 6);
  for (const [label, state] of states) {
    const { content } = state.course.find((l) => l.id === state.lesson);
    const rows = [...content.intro.can, ...content.needs.map((n) => n.quote), ...(content.intro['win-note'] ? [content.intro['win-note']] : [])];
    for (const t of MODES) {
      for (const [cols, size] of SIZES) {
        const lines = render(state, { cols, rows: size }, t).map(strip);
        const where = `${label} at ${cols}x${size}\n${lines.join('\n')}`;
        assert.ok(!lines.some((l) => l.trim() === t.glyph.ellipsis), `${where}: a row is dropped`);
        assert.ok(!lines.some(widthCut(t, cols)), `${where}: a line is cut`);
        const text = flat(lines);
        for (const r of rows) assert.ok(text.includes(words(r)), `${where}: "${r}" is not whole`);
      }
    }
  }
});

test('what main finds, on the PATH and in the work folder, is never saved', () => {
  const d = atIntro({ ...REQUIRES, front: [...REQUIRES.front, 'needs: [jq]'], intro: [`- need: "${NEED_JQ}"`] });
  const before = JSON.stringify(snapshot(d.state));
  d.send({ type: 'commands', found: { jq: false } });
  d.send({ type: 'prereq', lesson: 'i-1', dir: MINE, at: 0, pass: false });
  d.send({ type: 'prereq', lesson: 'i-1', dir: MINE, at: 1, read: null });
  assert.ok(flat(screen(d.state)).includes(C.openFirst('B5')));
  assert.equal(JSON.stringify(snapshot(d.state)), before);
});
