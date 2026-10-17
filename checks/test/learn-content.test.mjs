// The learn app's lesson files, learn/lessons/<id>.md. These tests check
// their shape; whether each quote still matches its lesson page is the
// guide's job (its quote check compares them every week).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GUIDE, indexLevel, parseLesson, PATH, WHERE } from '../../learn/lib/content.mjs';
import { C, TERMS } from '../../learn/lib/copy.mjs';
import { inline, width, wrapRuns } from '../../learn/lib/text.mjs';
import { lessons } from '../lessons/index.mjs';
import { ruleTiers, TIERS } from '../../learn/lib/tiers.mjs';
import { DEMO_B2, DEMO_I1, DEMO_I1_INDEX, root, withCode } from './learn-drive.mjs';

const dir = join(root, 'learn', 'lessons');
const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
const parsed = Object.fromEntries(files.map((f) => [f.replace(/\.md$/, ''), parseLesson(readFileSync(join(dir, f), 'utf8'), `learn/lessons/${f}`)]));
const contents = PATH.map((p) => parsed[p.id] ?? null);
const tracked = new Set(execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n'));
const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts;
const quotesOf = (step) => step.beats.flatMap((b) => [
  ...b.lines.filter((l) => l.quoted).flatMap((l) => [l.text, l.win]), ...b.hints, ...b.bottom.flatMap((x) => [x.text, x.win]), ...b.why,
  ...b.options.flatMap((o) => [o.quoted ? o.text : null, o.because]), b.reveal, b.point, b.self, b.codespace, b.winNote,
].filter(Boolean)).join('\n');
// Every step a lesson can show: its warm-ups, then its own steps.
const allSteps = (l) => [...l.warmup, ...l.steps];
const appWords = (step) => step.beats.flatMap((b) => [
  ...b.lines.filter((l) => !l.quoted).map((l) => l.text), b.ask, b.doneLabel, ...b.options.filter((o) => !o.quoted && o.kind !== 'decoy').map((o) => o.text),
].filter(Boolean));

test('every lesson file belongs to a lesson on PATH, in its file, and parses', () => {
  assert.ok(files.length > 0);
  for (const [id, l] of Object.entries(parsed)) {
    assert.ok(PATH.some((p) => p.id === id), `${id} is not on PATH`);
    assert.equal(l.lesson, id);
    assert.ok(l.steps.length > 0);
  }
});

test('front matter: the page, its title and Stamp, the Stuck link and the next lesson', () => {
  for (const [id, l] of Object.entries(parsed)) {
    const entry = PATH.find((p) => p.id === id);
    assert.equal(l.source, entry.page);
    assert.equal(l.page, `${GUIDE}/blob/main/${entry.page}`);
    assert.equal(l.stuck, `${GUIDE}/issues/new?template=lesson-feedback.yml&lesson=${id}`);
    assert.match(l.stamp, /^Verified against Claude Code v\d+\.\d+\.\d+ \(stable\) on \d{4}-\d{2}-\d{2}$/);
    assert.match(l['source-commit'], /^[0-9a-f]{7,40}$/);
    // The page's heading, which holds the check's shorter title.
    assert.ok(l.title.toLowerCase().includes(lessons[id].title.toLowerCase()), `${id}: the title "${l.title}" doesn't hold its check's, "${lessons[id].title}"`);
    if (l.next) assert.ok(PATH.some((p) => p.id === l.next), `${id}: unknown next lesson ${l.next}`);
    assert.ok(l.intro.can.length > 0 && l.intro.minutes);
  }
});

test('intro: every lesson says why it matters, and its payoff is one of its can lines', () => {
  for (const [id, l] of Object.entries(parsed)) {
    assert.ok(l.intro.why, `${id}: no why line`);
    assert.ok(l.intro.can.includes(l.intro.payoff), `${id}: the payoff "${l.intro.payoff}" is not a can line`);
  }
});

test('card: every lesson puts the commands its page gives on the card, each once in the course', () => {
  for (const [id, l] of Object.entries(parsed)) assert.ok(l.card.length > 0, `${id}: no card entries`);
  // Authored entries catch what no run line holds (design D8).
  assert.ok(['/rewind', '/resume'].every((cmd) => parsed['b-4'].card.some((e) => e.show === cmd)), 'b-4 lists /rewind and /resume');
  const shows = Object.values(parsed).flatMap((l) => l.card.map((e) => e.show));
  assert.deepEqual(shows.filter((x, i) => shows.indexOf(x) !== i), [], 'a command on two lessons\' cards');
});

test('intro: each why wraps to at most 2 lines at the 60-column content width', () => {
  // The intro's text width is the window less 4 columns (render's W); the
  // Why lead and its space come off that.
  const room = 60 - 4 - width(`${C.whyLead} `);
  for (const [id, l] of Object.entries(parsed)) {
    const lines = wrapRuns(inline(`"${l.intro.why}"`), room);
    assert.ok(lines.length <= 2, `${id}: the why wraps to ${lines.length} lines`);
  }
});

// Go further (146): one primary source to read next, as the page lists it.
// A capstone's page has no Go further list, so its file has no read line.
test('intro: every lesson but a capstone names one source to read, quoted with its Markdown link', () => {
  for (const [id, l] of Object.entries(parsed)) {
    if (id.endsWith('capstone')) {
      assert.equal(l.intro.read, undefined, `${id}: a capstone has no Go further`);
      continue;
    }
    assert.ok(l.intro.read, `${id}: no read line`);
    const links = inline(l.intro.read).filter((r) => r.url);
    assert.equal(links.length, 1, `${id}: the read line holds ${links.length} links`);
    assert.match(links[0].url, /^https:\/\/\S+$/, `${id}: the read line's link is no full URL`);
    // The page's own line: the link comes first, then what it covers.
    assert.match(l.intro.read, /^\[[^\]]+\]\(https:\/\/[^)]+\): \S/, `${id}: "${l.intro.read}"`);
  }
});

// A first meeting's GUIDED step with no Why line on its card, and why. Name
// one here only where the page has no sentence that is a reason for the step.
const NO_WHY = {
  'b-2 W8': 'the goal line already gives the page\'s reason, "so Your turn starts clean"; the Check item about the snapshot states a file the app may not have seen',
  'b-4 W7': 'the page gives no reason to resume; the sentence before it is about /clear, which would read as a claim about /exit and cue W7.1\'s answer',
};

test('the first GUIDED Worked example step on each skill has a why line on a beat that shows it inline', () => {
  const seen = new Set();
  const first = [];
  for (const [i, l] of contents.entries()) {
    if (!l) continue;
    for (const step of l.steps) {
      if (step.part !== 'Worked example' || step.tier !== 'guided' || seen.has(step.skill)) continue;
      seen.add(step.skill);
      const at = `${PATH[i].id} ${step.id}`;
      first.push(at);
      // The card shows a do or ask beat's first why line; a predict beat keeps it behind w.
      if (!(at in NO_WHY)) assert.ok(step.beats.some((b) => ['do', 'ask'].includes(b.kind) && b.why.length), `${at} (${step.skill}) has no why line on a do or ask beat`);
    }
  }
  for (const at of Object.keys(NO_WHY)) assert.ok(first.includes(at), `${at} is no first meeting's GUIDED step`);
  // The Beginner path's first meetings, so the test can't pass on an empty list.
  assert.ok(first.includes('b-1 W1') && first.includes('b-5 W2'), first.join(', '));
});

// A page step split in two: the second step keeps the page step's number.
const SPLIT = {
  'b-5 W2': 'Q10: page step 1 splits so /init comes in a GUIDED step after Claude Code starts at CHALLENGE',
};

test('steps are numbered as on the page, one part after the other', () => {
  const prefix = { 'Worked example': 'W', 'Your turn': 'Y', 'The task': 'T' };
  const split = [];
  for (const [id, l] of Object.entries(parsed)) {
    for (const part of Object.keys(prefix)) {
      const steps = l.steps.filter((s) => s.part === part);
      steps.forEach((s, i) => {
        const before = i ? steps[i - 1].n : 0;
        if (SPLIT[`${id} ${s.id}`]) {
          assert.equal(s.n, before, `${id} ${s.id}: a split step keeps step ${before}`);
          split.push(`${id} ${s.id}`);
        } else assert.equal(s.n, before + 1, `${id} ${s.id}: step ${s.n} after step ${before}`);
        assert.equal(s.of, steps.at(-1).n, `${id} ${s.id}: says "of ${s.of}"`);
        assert.equal(s.id, `${prefix[part]}${i + 1}`);
      });
    }
    assert.equal(l.steps.at(-1).id, 'C', `${id}: the Check comes last`);
    for (const s of allSteps(l)) {
      if (s.part !== 'Warm-up') assert.ok(WHERE.has(s.where), `${id} ${s.id}: where`);
      assert.ok(/^[a-z][a-z-]*$/.test(s.skill ?? ''), `${id} ${s.id}: skill`);
      for (const b of s.beats) if (b.verify.since) assert.ok(l.steps.some((x) => x.id === b.verify.since), `${id} ${s.id}: fresh since an unknown step ${b.verify.since}`);
    }
  }
  assert.deepEqual(split, Object.keys(SPLIT), 'a split names a step that is no longer there');
});

// What is wrong with lesson `id`'s warm-ups: each a question from an earlier
// lesson, in any level, or from any level's index page (ticket 178),
// numbered, from memory.
function warmupOff(id, l) {
  const off = [];
  const at = PATH.findIndex((p) => p.id === id);
  l.warmup.forEach((w, i) => {
    if (w.id !== `R${i + 1}`) off.push(`${id} ${w.id}: not R${i + 1}`);
    if (w.tier !== 'challenge') off.push(`${id} ${w.id}: a warm-up is CHALLENGE`);
    const from = PATH.findIndex((p) => p.id === w.from);
    if (!indexLevel(w.from) && !(from >= 0 && from < at)) off.push(`${id} ${w.id}: from ${w.from} is not an earlier lesson`);
    if (w.beats.length !== 1) off.push(`${id} ${w.id}: one question`);
    if (!['ask', 'type'].includes(w.beats[0].kind)) off.push(`${id} ${w.id}: a warm-up asks`);
  });
  if (at > 0 && l.warmup.length < 2 && l.steps.some((s) => s.part === 'Worked example')) off.push(`${id}: a lesson after the first opens with warm-ups`);
  return off;
}

test('warm-ups: questions from an earlier lesson, numbered, from memory', () => {
  assert.deepEqual(Object.entries(parsed).flatMap(([id, l]) => warmupOff(id, l)), []);
});

// C.warmupWhy, on the first warm-up of each level, says a wrong answer
// shows the lesson's words at once: every warm-up there must. A wrong pick
// shows its option's because, and a wrong typed answer the first hint.
test('the level\'s first lesson with warm-ups shows the lesson\'s words on every wrong answer', () => {
  const firsts = new Map();
  for (const p of PATH) {
    const l = parsed[p.id];
    if (l?.warmup.length && !firsts.has(p.level)) firsts.set(p.level, p.id);
  }
  assert.equal(firsts.get('beginner'), 'b-2');
  for (const id of firsts.values()) {
    for (const w of parsed[id].warmup) {
      const b = w.beats[0];
      if (b.kind === 'type') assert.ok(b.hints.length, `${id} ${w.id}: a wrong typed answer shows no quote`);
      else for (const o of b.options) if (o.kind !== 'right') assert.ok(o.because, `${id} ${w.id}: "${o.text}" shows no quote`);
    }
  }
});

test('the app\'s own words name no command or code that the step\'s quotes don\'t', () => {
  for (const [id, l] of Object.entries(parsed)) {
    for (const step of allSteps(l)) {
      const quotes = quotesOf(step);
      for (const words of appWords(step)) {
        for (const [, span] of words.matchAll(/`([^`]+)`/g)) assert.ok(quotes.includes(span), `${id} ${step.id}: "${words}" names \`${span}\``);
        for (const [, cmd] of words.matchAll(/(?:^|\s)(\/[a-z][a-z-]*)/g)) assert.ok(quotes.includes(cmd), `${id} ${step.id}: "${words}" names ${cmd}`);
      }
    }
  }
  const words = copyWords(C);
  assert.ok(words.length > 50);
  for (const w of words) {
    assert.doesNotMatch(w, /`/, `copy.mjs: "${w}" holds a code span`);
    assert.doesNotMatch(w, /(^|\s)\/[a-z]/, `copy.mjs: "${w}" names a slash command`);
    assert.doesNotMatch(w, /\d+\.\d+\.\d+/, `copy.mjs: "${w}" names a version`);
    assert.doesNotMatch(w, /\b(Opus|Sonnet|Haiku|Fable)\b|claude-[a-z]+-\d/, `copy.mjs: "${w}" names a model`);
  }
});

// Every string the app's own words can produce: each function runs with
// every mix of a few arguments, so a branch on one of them gives its string.
// The arguments are the values the app passes: a via, a beat kind, a tier,
// and counts of none, one and many. A branch on any other value is unseen.
const COPY_ARGS = ['x', 'pick', 'r', 'check', 'file', 'git-clean', 'predict', 'guided', 'hinted', 'challenge', 0, 1, 2, 3, 10];
const tuples = (n) => (n === 0 ? [[]] : tuples(n - 1).flatMap((t) => COPY_ARGS.map((a) => [...t, a])));
const calls = new WeakMap();
function copyWords(value) {
  const words = new Set();
  const walk = (v) => {
    if (typeof v === 'string') words.add(v);
    else if (typeof v === 'function') {
      if (!calls.has(v)) calls.set(v, [...new Set(tuples(Math.max(v.length, 1)).map((t) => v(...t)))]);
      calls.get(v).forEach(walk);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return [...words];
}

// The screen says only what the app saw: no copy claims the app adapts or
// knows the learner, praises the person, or names work the app doesn't do.
const BANNED = [
  /master/i, /\bZPD\b/i, /adapt/i,
  /\b(genius|natural|talented|brilliant|smart|clever)\b/i, /\byou(?:'re| are) (?:a |so )/i,
  /personali[sz]/i, /tailor/i, /learns? (about )?you/i,
  /\bThinking\b/i, /\bAnaly[sz]ing\b/i, /Preparing your lesson/i, /Loading your progress/i,
];
// A celebration praises the work, never how it was done: no speed, no
// streak, no "no hints". "quick question" is a where label, not one of these.
const CELEBRATION_BANNED = /\b(first try|no hints?|fast|quick(?:ly)?|streak)\b/i;
// The words a celebration shows: the done feedback and burst on a step, and
// every word the levelup, complete and next screens read (a test below
// keeps those screens' keys on this list). Keys under C.k are 'k.<name>'.
const CELEBRATIONS = ['stepDone', 'session', 'beatDone', 'cleanCopy', 'cleanUnder', 'changedShows', 'stagedShows', 'holds', 'already', 'alreadyCheck', 'alreadyDone', 'checkPasses', 'runItToo',
  'guessRight', 'nowYouKnow', 'findOutAt', 'right', 'answered', 'otherFine', 'done',
  'stepOf', 'levelUp', 'toHinted', 'toChallenge', 'nextCounts', 'k.letsGo', 'k.bringIt', 'k.moreHelp',
  'complete', 'lessonDone', 'badge', 'k.whatsNext',
  'checkedSummary', 'handover', 'invitation', 'invitationAt', 'answeredSummary', 'yourClimb', 'nextUp', 'notchHarder', 'savedBreak', 'goFurther', 'recallAsk', 'k.startN', 'k.page', 'k.map', 'k.card', 'k.quit'];
const at = (copy, k) => k.split('.').reduce((v, part) => v?.[part], copy);
const banned = new Map();
const bannedIn = (w) => {
  if (!banned.has(w)) banned.set(w, BANNED.filter((re) => re.test(w)));
  return banned.get(w);
};
const claims = (copy) => {
  const out = [];
  for (const w of copyWords(copy)) for (const re of bannedIn(w)) out.push(`"${w}" matches ${re}`);
  for (const k of CELEBRATIONS) for (const w of copyWords(at(copy, k))) if (CELEBRATION_BANNED.test(w)) out.push(`${k}: "${w}" matches ${CELEBRATION_BANNED}`);
  return out;
};

test('the app\'s own words claim only what the app saw', () => {
  for (const k of CELEBRATIONS) assert.notEqual(at(C, k), undefined, `copy.mjs has no ${k}`);
  assert.deepEqual(claims(C), []);
  assert.equal(C.helpShrinks, 'The help shrinks each time a skill comes back:');
  assert.equal(C.lessonDone('B1'), 'B1 done! You practised:');
  // Each pattern catches a string that breaks it, wherever it sits.
  for (const bad of ['You mastered plan mode.', 'The app adapts to you.', 'Adapting the help.', 'This is your ZPD.',
    'A natural!', "You're a star.", 'Clever!', 'You are so good at this.', 'Your personalised path', 'Help tailored for you', 'The app learns about you.',
    'Thinking…', 'Analyzing your work…', 'Analysing', 'Preparing your lesson…', 'Loading your progress…']) {
    assert.equal(claims({ x: bad }).length, 1, bad);
    assert.equal(claims({ ...C, k: { ...C.k, x: () => [bad] } }).length, 1, `${bad}, in a function's array`);
  }
  for (const bad of ['Done on the first try!', 'No hints needed!', 'No hint used.', 'That was fast.', 'Quick work!', 'Done quickly.', 'A 3 step streak']) {
    assert.equal(claims({ ...C, stepDone: () => bad }).length, 1, `${bad}, on a celebration`);
    assert.equal(claims({ ...C, levelUp: [bad] }).length, 1, `${bad}, on the level-up`);
    assert.deepEqual(claims({ ...C, notYet: bad }), [], `${bad}, off a celebration`);
  }
  // A branch counts too: the walk reaches one on each value the app passes.
  for (const branch of [(via) => via === 'pick', (via) => via === 'r', (kind) => kind === 'check', (kind) => kind === 'git-clean',
    (tier) => tier === 'hinted', (tier) => tier === 'challenge', (n) => n === 0, (n) => n > 2]) {
    assert.equal(claims({ x: (v) => (branch(v) ? 'You mastered it.' : 'Fine.') }).length, 1, `${branch}`);
  }
  assert.equal(claims({ ...C, nextCounts: (h, c) => (h === 0 && c === 2 ? 'A fast finish.' : 'Fine.') }).length, 1);
  for (const k of ['answered', 'otherFine', 'findOutAt', 'done', 'savedBreak', 'k.bringIt', 'k.whatsNext']) {
    const [top, sub] = k.split('.');
    const bad = 'Answered on the first try.';
    const copy = sub ? { ...C, k: { ...C.k, [sub]: bad } } : { ...C, [top]: bad };
    assert.equal(claims(copy).length, 1, `${k}, on a celebration`);
  }
  assert.equal(C.where.ask, 'quick question', 'the where label stays off the celebration list');
});

// One name for each thing (TERMS in copy.mjs). An older name is an alias,
// and so is any table of the three tiers that words them differently. A
// sentence that tells the learner what a tier change gives them and which
// key to press (doneBefore, toHinted) is no table: it isn't checked here.
// The work folder's words (ticket 86) have theirs too: a working folder or
// directory, a repo, the page's "template copy" for the practice copy or for
// a new copy.
const ALIASES = [/practice folder/i, /\byour copy\b/i, /\bgoal and hints\b/i, /\bgoal only\b/i,
  /\bwork(ing)? dir(ector(y|ies))?\b/i, /\bworking folder\b/i, /\brepo\b/i, /\byour own repository\b/i, /\btemplate copy\b/i, /\b(fresh|second|other) copy\b/i];
const aliasIn = (w) => ALIASES.filter((re) => re.test(w)).map((re) => `"${w}" matches ${re}`);
const aliases = (copy) => {
  const out = copyWords(copy).flatMap(aliasIn);
  const walk = (v, at) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return;
    const keys = Object.keys(v);
    if (keys.length === TIERS.length && TIERS.every((k) => typeof v[k] === 'string')) {
      if (TIERS.some((k) => v[k] !== TERMS.tierHelp[k])) out.push(`${at} describes the tiers a second way`);
    } else for (const k of keys) walk(v[k], at ? `${at}.${k}` : k);
  };
  walk(copy, '');
  return out;
};

test('one name for each thing: the app\'s words use no alias of a TERMS name', () => {
  assert.equal(TERMS.practiceCopy, 'practice copy');
  assert.equal(TERMS.workFolder, 'work folder');
  assert.equal(TERMS.yourRepository, 'your repository');
  assert.equal(TERMS.newCopy, 'new copy');
  assert.deepEqual(TERMS.tierHelp, { guided: 'every command shown', hinted: 'the goal, hints if you ask', challenge: 'just the goal' });
  // The guide's level names, one each: the map, the welcome and a warm-up read them here.
  assert.deepEqual(TERMS.levels, { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' });
  assert.equal(C.levels, TERMS.levels);
  assert.equal(C.pathLabel(TERMS.levels.intermediate, 2, 9), 'Intermediate path · 2 of 9 done');
  assert.deepEqual(aliases(C), []);
  // A lesson file's unquoted lines are the app's words too; its quotes are the guide's.
  for (const [id, l] of Object.entries(parsed)) {
    for (const step of allSteps(l)) assert.deepEqual(appWords(step).flatMap(aliasIn), [], `${id} ${step.id}`);
  }
  assert.equal(C.pip1, "I'm Pip. I watch your practice copy and light up");
  assert.equal(C.cleanCopy, 'Your practice copy is clean: nothing to commit.');
  assert.equal(C.folderOther, 'In another folder, such as your repository');
  assert.equal(C.folderPrompt('Intermediate'), 'The work folder for Intermediate');
  assert.equal(C.folderNewCopy, 'Give the folder of your new copy');
  for (const bad of ["I'm Pip. I watch your practice folder and light up", 'Your copy is clean: nothing to commit.', 'goal and hints', 'goal only',
    'Your working directory', 'The working folder for Intermediate', 'In your repo', 'In your own repository', 'Work dir:', 'This template copy', 'Give the folder of your fresh copy']) {
    assert.equal(aliases({ ...C, x: bad }).length, 1, bad);
  }
  assert.equal(aliases({ ...C, legend: { guided: 'all commands', hinted: 'hints on h', challenge: 'nothing more' } }).length, 1, 'a second tier description');
  assert.deepEqual(aliases({ ...C, legend: { ...TERMS.tierHelp } }), [], 'the same words again are no alias');
});

test('every word the levelup, complete and next screens read is on the celebration list', () => {
  const src = readFileSync(join(root, 'learn', 'lib', 'render.mjs'), 'utf8');
  const from = src.indexOf('\n  levelup(ctx) {');
  const to = src.indexOf('\n  map(ctx) {');
  assert.ok(from > 0 && to > from, 'render.mjs: no levelup, complete and next views before map');
  const keys = new Set([...src.slice(from, to).matchAll(/\bC\.(k\.\w+|\w+)/g)].map((m) => m[1]));
  assert.ok(keys.has('lessonDone') && keys.has('answeredSummary') && keys.has('k.bringIt'));
  for (const k of keys) assert.ok(CELEBRATIONS.includes(k), `C.${k} shows on a celebration screen: add '${k}' to CELEBRATIONS`);
});

test('questions: one right answer, a reason for every wrong one, real files in decoys', () => {
  for (const [id, l] of Object.entries(parsed)) {
    for (const step of allSteps(l)) {
      for (const b of step.beats) {
        const where = `${id} ${step.id} (${b.kind})`;
        if (b.kind === 'type') {
          assert.ok(b.accept.length, `${where}: no accepted answer`);
          for (const a of b.accept) assert.ok(quotesOf(step).includes(a), `${where}: ${a} is in no quote`);
          assert.ok(b.reveal, `${where}: no reveal`);
          continue;
        }
        if (!b.ask) {
          assert.equal(b.options.length, 0, `${where}: options with no question`);
          continue;
        }
        assert.match(b.ask, /\?$/, `${where}: a question ends with ?`);
        const rights = b.options.filter((o) => o.kind === 'right');
        assert.equal(rights.length, 1, `${where}: ${rights.length} right options`);
        assert.ok(b.options.length >= 2 && b.options.length <= 9, `${where}: ${b.options.length} options`);
        for (const o of b.options) {
          if (o.kind === 'wrong' || o.kind === 'stuck') assert.ok(o.because, `${where}: "${o.text}" needs a because`);
          if (o.kind === 'decoy') {
            for (const [, span] of o.text.matchAll(/`([^`]+)`/g)) {
              const script = span.match(/^npm (?:run )?(\S+)$/)?.[1];
              assert.ok(tracked.has(span) || (script && scripts[script]), `${where}: decoy \`${span}\` is not a file or script`);
            }
          }
        }
        // An unquoted right answer is a claim only through a quote that reveals it.
        if (!rights[0].quoted) {
          const at = b.revealAt ? l.steps.find((s) => s.id === b.revealAt) : step;
          assert.ok(at?.beats.some((x) => x.reveal), `${where}: no reveal for its right answer`);
        }
        if (b.revealAt) assert.ok(l.steps.some((s) => s.id === b.revealAt && s.beats.some((x) => x.recall === step.id)), `${where}: ${b.revealAt} doesn't recall it`);
      }
    }
  }
});

test('verify lines name real check items, and ladder headings are check items', () => {
  for (const [id, l] of Object.entries(parsed)) {
    const items = lessons[id].items;
    for (const step of l.steps) {
      for (const b of step.beats) {
        if (b.verify.kind !== 'check') continue;
        if (b.verify.all) assert.equal(step.part, 'Check', `${id} ${step.id}: check all outside the Check`);
        else for (const i of b.verify.items) assert.ok(items[i], `${id} ${step.id}: no item ${i}`);
        assert.ok(b.watching || b.evidence || b.verify.all, `${id} ${step.id}: says nothing about what it watches`);
      }
    }
    for (const rung of l.ladder) assert.ok(items.some((it) => it.text === rung.item), `${id}: the ladder heading "${rung.item}" is no check item`);
  }
});

// The climb (ticket 80, Q2): one rule for each level, with skill counts
// carried across the course. A level's first lesson may open GUIDED; every
// later one opens above it and gives less help than the level's first. A
// lesson full of new commands may dip below the lesson two before it in its
// level: that is reported, not failed. `course` holds parsed contents in
// course order, null for a lesson with no file.
function climb(course) {
  const off = [];
  const dips = [];
  const levels = new Map();
  course.forEach((c, i) => {
    if (!c) return;
    const rule = ruleTiers(course, i);
    c.steps.forEach((s, k) => {
      if (s.tier !== rule[k]) off.push(`${c.lesson} ${s.id} is ${s.tier}; the course rule says ${rule[k]}`);
    });
    if (c.steps.at(-1).tier !== 'challenge') off.push(`${c.lesson}: the Check is not CHALLENGE`);
    if (c.lesson.endsWith('capstone') && !c.steps.every((s) => s.tier === 'challenge')) off.push(`${c.lesson}: a capstone step is not CHALLENGE`);
    const shares = levels.get(PATH[i].level) ?? [];
    levels.set(PATH[i].level, shares);
    if (shares.length && c.steps[0].tier === 'guided') off.push(`${c.lesson} opens GUIDED`);
    shares.push({ id: c.lesson, share: c.steps.filter((s) => s.tier !== 'guided').length / c.steps.length });
  });
  for (const shares of levels.values()) {
    shares.forEach(({ id, share }, i) => {
      if (i > 0 && share <= shares[0].share) off.push(`${id} doesn't give less help than ${shares[0].id}`);
      if (i > 1 && share < shares[i - 2].share) dips.push(`${id} gives more help than ${shares[i - 2].id}, two lessons before`);
    });
  }
  return { off, dips };
}

test('difficulty: each step\'s tier is the course rule\'s, and it climbs like a sawtooth', (t) => {
  const { off, dips } = climb(contents);
  assert.deepEqual(off, []);
  for (const dip of dips) t.diagnostic(dip);
  // A safety choice keeps a guess before it at every tier.
  const b1 = parsed['b-1'];
  assert.ok(b1.steps.find((s) => s.id === 'W4').beats[0].safety);
  for (const l of Object.values(parsed)) for (const s of allSteps(l)) for (const b of s.beats) if (b.safety) assert.equal(b.kind, 'predict', `${l.lesson} ${s.id}: a safety choice is a guess`);
});

// A made-up lesson file with `steps`, each [id, tier, skill]: W steps are
// Worked examples and C the Check, each one beat the check verifies.
function madeUp(id, steps) {
  const heading = ([sid]) => (sid === 'C' ? '### C | Check | Check' : `### ${sid} | Worked example step ${sid.slice(1)} of ${steps.length - 1} | Do it`);
  const text = [`---\nlesson: ${id}\ntitle: "Demo"\n---\n\n## intro\n- can: "do it"\n\n## steps`,
    ...steps.map((st) => `\n${heading(st)}\n- tier: ${st[1]}\n- skill: ${st[2]}\n- beat: do\n- verify: ${st[0] === 'C' ? 'check all' : 'check 0'}\n- goal: "Do it."`)].join('\n');
  return parseLesson(text, `${id}.md`);
}
// The real Beginner lessons, then the made-up Intermediate ones in `made`,
// { id: content }.
const withIntermediate = (made) => PATH.map((p) => (p.level === 'beginner' ? parsed[p.id] ?? null : made[p.id] ?? null));
const CHECK = ['C', 'challenge', 'check'];

test('difficulty: help fades within each level, a level\'s first lesson may open GUIDED, skill counts carry across levels, and a dip only reports', () => {
  // i-1 opens GUIDED on a new skill, and commit, which Beginner asked three
  // times, is CHALLENGE even in a Worked example. i-2 and i-3 are all Check.
  // i-4 gives less help than i-1 but more than i-2, two lessons before.
  const i4 = madeUp('i-4', [['W1', 'challenge', 'commit'], ['W2', 'challenge', 'start'], ['W3', 'guided', 'agent'], CHECK]);
  const { off, dips } = climb(withIntermediate({ 'i-1': parseLesson(DEMO_I1, 'i-1.md'), 'i-2': madeUp('i-2', [CHECK]), 'i-3': madeUp('i-3', [CHECK]), 'i-4': i4 }));
  assert.deepEqual(off, []);
  assert.deepEqual(dips, ['i-4 gives more help than i-2, two lessons before']);
  // A later lesson in the level still opens above GUIDED and gives less help
  // than the level's first.
  const i2 = madeUp('i-2', [['W1', 'guided', 'agent'], ['W2', 'guided', 'hook'], CHECK]);
  assert.deepEqual(climb(withIntermediate({ 'i-1': parseLesson(DEMO_I1, 'i-1.md'), 'i-2': i2 })).off, ['i-2 opens GUIDED', 'i-2 doesn\'t give less help than i-1']);
});

// Action beats above GUIDED that may show nothing behind h, each with its
// reason. Any other beat that hides its command needs a rung.
const NO_RUNG = {
  'b-capstone T4.0': 'the capstone page names no plan menu choice, and only its own words can be quoted here',
};

test('help: above GUIDED, every action with no command on its card has a rung behind h', () => {
  const bare = [];
  const exempt = [];
  contents.forEach((c, i) => {
    if (!c) return;
    const rule = ruleTiers(contents, i);
    c.steps.forEach((s, k) => {
      if (s.part === 'Check' || rule[k] === 'guided') return;
      s.beats.forEach((b, n) => {
        if (b.kind !== 'do' || b.ask || b.lines.some((l) => l.key === 'run')) return;
        const at = `${c.lesson} ${s.id}.${n}`;
        // A check item's ladder shows its own rungs once the check says no.
        const laddered = b.verify.kind === 'check' && !b.verify.all && b.verify.items.every((it) => {
          const rung = c.ladder.find((r) => r.item === lessons[c.lesson].items[it].text);
          return rung && (rung.hints.length || rung.bottom.length || rung.narrow.length);
        });
        if (!b.hints.length && !b.bottom.length && !laddered) (NO_RUNG[at] ? exempt : bare).push(at);
      });
    });
  });
  assert.deepEqual(bare, [], 'nothing behind h');
  assert.deepEqual(exempt, Object.keys(NO_RUNG), 'an exemption names a beat that still has nothing behind h');
});

test('help: above GUIDED, no card runs a slash command', () => {
  const shown = [];
  contents.forEach((c, i) => {
    if (!c) return;
    const rule = ruleTiers(contents, i);
    const steps = [...c.warmup.map((s) => [s, 'challenge']), ...c.steps.map((s, k) => [s, rule[k]])];
    for (const [s, tier] of steps) {
      if (tier === 'guided') continue;
      s.beats.forEach((b, n) => {
        for (const l of b.lines) if (l.key === 'run' && l.text.startsWith('/')) shown.push(`${c.lesson} ${s.id}.${n}: ${l.text}`);
      });
    }
  });
  assert.deepEqual(shown, [], 'a slash command on the card above GUIDED');
});

test('the Check\'s recall question files a miss under a skill the course has taught', () => {
  const untagged = [];
  contents.forEach((c, i) => {
    if (!c) return;
    const taught = new Set(contents.slice(0, i + 1).flatMap((x) => (x?.steps ?? []).map((s) => s.skill)));
    taught.delete('check');
    for (const b of c.steps.find((s) => s.part === 'Check').beats) if (b.kind === 'type' && !taught.has(b.skill)) untagged.push(`${c.lesson} C: ${b.skill ?? 'no skill'}`);
  });
  assert.deepEqual(untagged, [], 'a Check question\'s skill is one a step so far uses');
});

// Lessons with no skill in their warm-up pool that comes back in their own
// steps, so R1 can't be one; each with its reason.
const R1_NOT_REUSED = {
  'b-4': 'no skill in its pool comes back in b-4',
  // R1 (project memory) still primes T1's CLAUDE.md commit, check item 5,
  // whose step is tagged save-version.
  'b-capstone': 'no capstone step is tagged with the b-4 and b-5 skills its pool recalls, so a missed one keeps its ease for Intermediate (D12)',
};

// What is wrong with the order of lesson `id`'s warm-ups.
function pairOff(id, l) {
  const off = [];
  const [r1, r2] = l.warmup;
  if (!r1) return off;
  // A pool that recalls only one lesson has no lags to mix. A level index
  // counts as a source of its own (ticket 178): R1 from a lesson and R2 from
  // an index mix two.
  if (r2 && new Set(l.warmup.map((w) => w.from)).size > 1 && r1.from === r2.from) off.push(`${id}: R1 and R2 both come from ${r1.from}`);
  // Where the pool holds a skill this lesson reuses, R1 is one, so a missed
  // warm-up eases a step here.
  const reused = (w) => l.steps.some((s) => s.skill === w.skill);
  if (R1_NOT_REUSED[id]) {
    if (l.warmup.some(reused)) off.push(`${id}: its pool has a skill this lesson reuses: drop the exemption`);
  } else if (!reused(r1)) off.push(`${id}: R1 (${r1.skill}) is a skill no step here reuses`);
  return off;
}

test('warm-ups: the first two mix a recent lesson and an older one, and R1 comes back in this lesson', () => {
  assert.deepEqual(Object.entries(parsed).flatMap(([id, l]) => pairOff(id, l)), []);
  for (const id of Object.keys(R1_NOT_REUSED)) assert.ok(parsed[id]?.warmup.length, `${id}: the exemption names no lesson with warm-ups`);
});

// Ticket 85: i-1's and i-2's pools recall Beginner skills Beginner never
// asks again. i-1's R1 is one i-1 reuses, and its R2 an older lesson's.
test('warm-ups: a lesson may recall a lesson of an earlier level, as i-1 recalls Beginner', () => {
  const i1 = parseLesson(DEMO_I1, 'i-1.md');
  assert.deepEqual(i1.warmup.map((w) => [w.from, w.skill]), [['b-5', 'commit'], ['b-4', 'compact']]);
  assert.deepEqual([...warmupOff('i-1', i1), ...pairOff('i-1', i1)], []);
});

// Ticket 178: a warm-up may recall a level's index page, any level's, from
// any lesson. The index has no lesson file and no place on PATH.
test('warm-ups: a warm-up may recall a level index, from any lesson', () => {
  const i1 = parseLesson(DEMO_I1_INDEX, 'i-1.md');
  assert.deepEqual(i1.warmup.map((w) => [w.from, w.skill]), [['b-5', 'commit'], ['intermediate-index', 'when-to-use']]);
  assert.deepEqual([...warmupOff('i-1', i1), ...pairOff('i-1', i1)], []);
  // Beginner's second lesson may quote the Advanced index.
  const b2 = parseLesson(DEMO_B2.replace('- from: b-1\n- beat: type', '- from: advanced-index\n- beat: type'), 'b-2.md');
  assert.deepEqual(b2.warmup.map((w) => w.from), ['b-1', 'advanced-index', 'b-1']);
  assert.deepEqual(warmupOff('b-2', b2), []);
});

// A typed answer, a wrong or decoy pick, or s on any question but a guess
// marks the skill missed, for a warm-up to ask it first later (flow.mjs:
// submitTyped, pick and s).
const MISSABLE = new Set(['right', 'wrong', 'decoy']);
const marksMissed = (b) => b.kind === 'type' || (Boolean(b.ask) && b.kind !== 'predict' && b.options.some((o) => MISSABLE.has(o.kind)));
// Skills a question can mark missed that no later lesson's pool recalls, each
// with its reason.
const LATER = 'returns in i-1 or i-2 (ticket 85)';
const NO_LATER_WARMUP = {
  compact: LATER,
  resume: LATER,
  commit: LATER,
  clear: 'only b-5\'s pool asks it, so only the capstone\'s could recall it, and D12 gives the capstone two: memory and rewind',
  'save-version': 'only the capstone asks it, and no Beginner lesson comes after the capstone',
};

// The skills a question in `contents` (in PATH order) can mark missed that
// no later lesson's pool recalls.
function closureGaps(contents) {
  // The first lesson whose questions can mark each skill missed. A level
  // index warm-up recalls a level, not a lesson's skill (ticket 178).
  const first = new Map();
  contents.forEach((c, i) => {
    for (const s of c ? allSteps(c).filter((x) => !indexLevel(x.from)) : []) for (const b of s.beats) if (marksMissed(b) && !first.has(b.skill ?? s.skill)) first.set(b.skill ?? s.skill, i);
  });
  return [...first].filter(([skill, i]) => !contents.slice(i + 1).some((c) => c?.warmup.some((w) => w.skill === skill))).map(([skill]) => skill);
}

test('warm-ups: a skill a question can mark missed comes back in a later lesson\'s pool', () => {
  const gaps = closureGaps(contents);
  assert.deepEqual(gaps.filter((k) => !NO_LATER_WARMUP[k]), [], 'no later warm-up and no exemption');
  assert.deepEqual(Object.keys(NO_LATER_WARMUP).filter((k) => !gaps.includes(k)), [], 'an exemption names a skill that is no gap now: a later warm-up asks it, or no question can mark it missed');
});

// Ticket 178: a warm-up from a level index recalls that level, so its skill
// is no lesson's for a later pool to ask again. i-1's R1, from b-5, is.
test('warm-ups: a level index warm-up leaves no skill for a later pool to recall', () => {
  const i1 = parseLesson(DEMO_I1_INDEX, 'i-1.md');
  assert.deepEqual(closureGaps(PATH.map((p) => (p.id === 'i-1' ? i1 : null))), ['commit']);
});

// Questions whose options keep a natural order, so their right answer's
// place says nothing; each with its reason.
const NATURAL_ORDER = {
  'b-2 W2.0': 'One, Two, Three are counts, in counting order',
};

test('questions give no cue: not by length, quotes, bold, code or place', () => {
  const plain = (t) => t.replace(/\*\*|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  const cues = [];
  for (const [id, l] of Object.entries(parsed)) {
    const slots = [];
    for (const step of allSteps(l)) {
      step.beats.forEach((b, n) => {
        // Predictions count too: a cue gives a guess away as well.
        const opts = b.options.filter((o) => o.kind !== 'other' && o.kind !== 'stuck');
        const r = opts.findIndex((o) => o.kind === 'right');
        if (!b.ask || r < 0 || opts.length < 2) return;
        const at = `${id} ${step.id}.${n}`;
        const others = opts.filter((_, k) => k !== r);
        const len = plain(opts[r].text).length;
        const longest = Math.max(...others.map((o) => plain(o.text).length));
        if (len > 1.25 * longest && len - longest > 10) cues.push(`${at}: the right option is the longest`);
        if (opts[r].quoted && others.every((o) => !o.quoted)) cues.push(`${at}: the right option is the only quote`);
        for (const [mark, re] of [['bold', /\*\*/], ['a code span', /`/]]) {
          if (re.test(opts[r].text) && others.every((o) => !re.test(o.text))) cues.push(`${at}: ${mark} marks the right option alone`);
        }
        if (!NATURAL_ORDER[at]) slots.push({ at: r === 0 ? 'first' : r === opts.length - 1 ? 'last' : 'middle', three: opts.length >= 3 });
      });
    }
    if (slots.length >= 4) {
      for (const slot of ['first', 'middle', 'last']) {
        const k = slots.filter((x) => x.at === slot).length;
        if (k / slots.length > 0.6) cues.push(`${id}: ${k} of ${slots.length} right answers come ${slot}`);
      }
    }
    const three = slots.filter((x) => x.three);
    if (three.length >= 4) {
      const k = three.filter((x) => x.at === 'middle').length;
      if (k / three.length > 0.5) cues.push(`${id}: ${k} of ${three.length} right answers with three or more options sit in the middle`);
    }
  }
  assert.deepEqual(cues, []);
  for (const at of Object.keys(NATURAL_ORDER)) {
    const [id, ref] = at.split(' ');
    const [sid, n] = ref.split('.');
    const b = allSteps(parsed[id]).find((s) => s.id === sid)?.beats[n];
    assert.ok(b?.ask && b.options.some((o) => o.kind === 'right'), `${at}: the exemption names no question with a right option`);
  }
});

test('no key-shaped string, em dash or emoji variation selector under learn/', () => {
  const all = execFileSync('git', ['ls-files', '-co', '--exclude-standard', 'learn'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.ok(all.length > 5);
  for (const f of all) {
    const text = readFileSync(join(root, f), 'utf8');
    assert.doesNotMatch(text, /sk-ant-/, f);
    assert.doesNotMatch(text, /—/, `${f} has an em dash`);
    assert.doesNotMatch(text, /️/, `${f} has U+FE0F`);
  }
});

// A match or no-match line's regex is the app's own words: it compiles, and
// it holds no code span, which would read as a quote of the page.
const regexProblems = (l) => allSteps(l).flatMap((st) => st.beats.filter((b) => ['match', 'no-match'].includes(b.verify.kind)).flatMap((b) => {
  const found = [];
  try {
    new RegExp(b.verify.regex);
  } catch (error) {
    found.push(`${st.id}: ${error.message}`);
  }
  if (/`[^`]+`/.test(b.verify.regex)) found.push(`${st.id}: a code span in ${b.verify.regex}`);
  return found;
}));

test('every match and no-match regex compiles and holds no code span', () => {
  for (const [id, l] of Object.entries(parsed)) assert.deepEqual(regexProblems(l), [], id);
  // The rule finds both, on made-up lessons.
  const withVerify = (v) => parseLesson(DEMO_B2.replace('- verify: check 0 fresh\n- watching: .practice/b-2-before.txt\n- evidence: .practice/b-2-before.txt', `- verify: ${v}`), 'b-2.md');
  assert.equal(regexProblems(withVerify('match CLAUDE.md ^@(docs')).length, 1);
  assert.match(regexProblems(withVerify('no-match SKILL.md `TODO`'))[0], /a code span/);
  assert.deepEqual(regexProblems(withVerify('match CLAUDE.md ^@docs/.+\\.md$')), []);
});

// ---- code blocks (ticket 90) --------------------------------------------------
// The hooks page's Your turn skeleton, from its first line to its case block:
// indented lines and a blank line, as the page has them.
const SKELETON = ['#!/bin/bash', 'INPUT=$(cat)', 'FILE_PATH=$(echo "$INPUT" | jq -r \'.tool_input.file_path // empty\')', 'FILE_PATH="${FILE_PATH//\\\\//}"', 'NAME=$(basename "$FILE_PATH")', '', 'case "/$FILE_PATH" in', '  */package-lock.json | */.git/*)'];
const fenced = (lines, info = 'bash') => [`\`\`\`${info}`, ...lines, '```'];
const codeOf = (lines) => parseLesson(withCode(lines), 'b-2.md').steps[0].beats[0].lines.find((l) => l.key === 'code');

test('a beat holds one fenced block from the page, its lines kept as they are', () => {
  const code = codeOf(['- code: point 3', ...fenced(SKELETON)]);
  assert.deepEqual(code.lines, SKELETON);
  // The lines after the block are the beat's again.
  const l = parseLesson(withCode(['- code: point 1', ...fenced(['ls']), '- note: "The page says so."']), 'b-2.md');
  assert.deepEqual(l.steps[0].beats[0].lines.map((x) => x.key), ['code', 'note']);
});

test('a code block is closed and not empty, one to a beat', () => {
  const bad = [
    [['- code: point 1', '```bash', 'ls'], /b-2\.md:\d+: a code block with no closing fence/],
    [['- code: point 1', '```bash', '```'], /b-2\.md:\d+: an empty code block/],
    [['- code: point 1', '```bash', '', '```'], /an empty code block/],
    [['- code: point 1', '- note: "x"'], /a code line with no fenced block under it/],
    [['- code: point 1', ...fenced(['ls']), '- code: point 1', ...fenced(['pwd'])], /a second code block on one beat/],
    // A closing fence is as long as the opening one, at least: a shorter one
    // is the block's own line.
    [['- code: point 1', '````markdown', '```', 'ls'], /a code block with no closing fence/],
  ];
  for (const [lines, error] of bad) assert.throws(() => codeOf(lines), error, lines.join('\n'));
  assert.deepEqual(codeOf(['- code: point 1', '````markdown', '```bash', 'ls', '```', '````']).lines, ['```bash', 'ls', '```']);
});

// The whole skeleton: 17 lines.
const SKELETON_ALL = [...SKELETON, '    echo "Blocked: $FILE_PATH is protected" >&2', '    exit 2', '    ;;', 'esac', '', '# TODO: block a file named .env, or .env. followed by anything except example', '# TODO: block any file inside a secrets/ folder', '', 'exit 0'];

test('a beat shows at most 8 lines of code, with a pointer on the line it explains; a longer block shows a window of it on each beat', () => {
  const whole = codeOf(['- code: point 3', ...fenced(SKELETON)]);
  assert.deepEqual([whole.from, whole.to, whole.point], [1, 8, 3]);
  const part = codeOf(['- code: lines 9-16 point 10', ...fenced(SKELETON_ALL)]);
  assert.deepEqual([part.from, part.to, part.point, part.lines.length], [9, 16, 10, 17]);
  const bad = [
    // 17 lines with no window: a beat would show all of them.
    [['- code: point 3', ...fenced(SKELETON_ALL)], /b-2\.md:\d+: this beat shows 17 lines of code; a beat shows at most 8: name the lines it shows, as lines 1-8/],
    [['- code: lines 1-9 point 3', ...fenced(SKELETON_ALL)], /this beat shows 9 lines of code; a beat shows at most 8/],
    [['- code: lines 9-16', ...fenced(SKELETON_ALL)], /a code line is \[lines <first>-<last>\] point <line>/],
    [['- code: lines 9-16 point 3', ...fenced(SKELETON_ALL)], /point 3 is not a line this beat shows \(9 to 16\)/],
    [['- code: lines 12-18 point 12', ...fenced(SKELETON_ALL)], /lines 12-18: the block has 17 lines/],
    [['- code: lines 5-4 point 4', ...fenced(SKELETON_ALL)], /lines 5-4: the block has 17 lines/],
    [['- code: point 0', ...fenced(['ls'])], /point 0 is not a line this beat shows \(1 to 1\)/],
    [['- code: the loop', ...fenced(['ls'])], /a code line is \[lines <first>-<last>\] point <line>/],
  ];
  for (const [lines, error] of bad) assert.throws(() => codeOf(lines), error, lines[0]);
});

test('a code block shows on a do, ask or self beat, and names no folder a run line would fill in', () => {
  const asKind = (kind, lines) => withCode(lines).replace('- where: shell\n- beat: do\n', `- where: shell\n- beat: ${kind}\n`);
  for (const kind of ['predict', 'type']) {
    assert.throws(() => parseLesson(asKind(kind, ['- code: point 1', ...fenced(['ls'])]), 'b-2.md'), new RegExp(`b-2\\.md:\\d+: a code block on a ${kind} beat`), kind);
  }
  for (const line of ['cd <your practice copy>', 'git -C <your repo> status']) {
    assert.throws(() => codeOf(['- code: point 1', ...fenced(['ls', line])]), /a code block that names <your practice copy> or <your repo>/, line);
  }
});

// Until ticket 91 teaches the guide's quote check the block format, no
// shipped lesson uses one: 91 removes this test.
test('no lesson file holds a code block before the guide checks them', () => {
  for (const f of files) assert.doesNotMatch(readFileSync(join(dir, f), 'utf8'), /^- code: /m, f);
});
