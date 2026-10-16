// Lesson content files, learn/lessons/<id>.md. A double-quoted value is the
// lesson page's exact words; an unquoted value is the app's own words and
// states no Claude Code fact. The guide's weekly quote check compares every
// quoted value with the page.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { frontmatter } from '../../checks/frontmatter.mjs';
import { lessons as checks } from '../../checks/lessons/index.mjs';
import { inline } from './text.mjs';

export const STEP_HEADING = /^### (W\d+|Y\d+|T\d+|C|R\d+) \| (?:(Worked example|Your turn|The task) step (\d+) of (\d+)|(Check|Warm-up)) \| (\S.*)$/;
// Parts whose steps the learner does on their own, with the goal in front.
export const OWN_PARTS = new Set(['Your turn', 'The task']);
export const STEP_KEYS = new Set(['tier', 'skill', 'where', 'from']);
// Where a step's work happens: the other terminal, Claude Code, a third
// terminal for shell commands while Claude Code is still open, or an editor.
export const WHERE = new Set(['terminal', 'claude', 'shell', 'editor']);
export const BEAT_KINDS = new Set(['do', 'predict', 'ask', 'type', 'self']);
// Keys a beat may hold, and whether their value must be a quote of the page.
export const BEAT_KEYS = {
  where: false, verify: false, 'done-label': false, watching: false, evidence: false, safety: false, tick: false, skill: false,
  say: false, ask: false, other: false, decoy: false, 'reveal-at': false, recall: false, accept: false,
  goal: true, do: true, run: true, win: true, expect: true, note: true, rule: true, after: true, why: true,
  codespace: true, 'win-note': true, hint: true, bottom: true, because: true, point: true, reveal: true, self: true,
  right: null, wrong: null, option: null, stuck: null,
};
// `why`: why the lesson matters; `payoff`: the one `can` line the intro and
// complete screens flag as what the lesson builds to; `read`: one line of
// the page's Go further list, with its Markdown link, to read next. At most
// one of each.
export const INTRO_KEYS = { minutes: true, can: true, why: true, payoff: true, read: true };
export const LADDER_KEYS = { hint: true, bottom: true, win: true };
// The card (the c overlay): each entry a `skill` line in the app's words,
// then the page's command (`show`) and what it does (`does`). An entry shows
// once the learner finished a step on its skill.
export const CARD_KEYS = { skill: false, show: true, does: true };
const OPTION_KEYS = new Set(['right', 'wrong', 'option', 'stuck', 'other', 'decoy']);

// Every lesson of the guide, in course order. Each entry's level is the
// folder of its page (copy.mjs names it), and its minutes are the page's
// header line's: the view of a lesson with no lesson file shows them.
// `newCopy`: the page has the learner make a new copy of the template, so
// the lesson's check never runs in this practice copy.
export const PATH = [
  { id: 'b-1', level: 'beginner', page: 'docs/beginner/01-install-and-look-around.md', minutes: 'about 20 minutes' },
  { id: 'b-2', level: 'beginner', page: 'docs/beginner/02-permission-modes-and-plan-mode.md', minutes: 'about 20 minutes' },
  { id: 'b-3', level: 'beginner', page: 'docs/beginner/03-first-change.md', minutes: 'about 20 minutes' },
  { id: 'b-4', level: 'beginner', page: 'docs/beginner/04-keep-a-session-on-track.md', minutes: 'about 20 minutes' },
  { id: 'b-5', level: 'beginner', page: 'docs/beginner/05-project-memory.md', minutes: 'about 20 minutes' },
  { id: 'b-capstone', level: 'beginner', page: 'docs/beginner/capstone.md', minutes: '30 to 60 minutes' },
  { id: 'i-1', level: 'intermediate', page: 'docs/intermediate/01-first-skill.md', minutes: 'about 20 minutes' },
  { id: 'i-2', level: 'intermediate', page: 'docs/intermediate/02-organize-memory.md', minutes: 'about 20 minutes' },
  { id: 'i-3', level: 'intermediate', page: 'docs/intermediate/03-model-and-effort.md', minutes: 'about 15 minutes' },
  { id: 'i-4', level: 'intermediate', page: 'docs/intermediate/04-permissions-and-sandbox.md', minutes: 'about 20 minutes' },
  { id: 'i-5', level: 'intermediate', page: 'docs/intermediate/05-hooks.md', minutes: 'about 20 minutes' },
  { id: 'i-6', level: 'intermediate', page: 'docs/intermediate/06-subagents.md', minutes: 'about 20 minutes' },
  { id: 'i-7', level: 'intermediate', page: 'docs/intermediate/07-mcp.md', minutes: 'about 20 minutes' },
  { id: 'i-8', level: 'intermediate', page: 'docs/intermediate/08-plugins.md', minutes: 'about 20 minutes' },
  { id: 'i-capstone', level: 'intermediate', page: 'docs/intermediate/capstone.md', minutes: '30 to 60 minutes' },
  { id: 'a-1', level: 'advanced', page: 'docs/advanced/01-parallel-sessions.md', minutes: 'about 20 minutes' },
  { id: 'a-2', level: 'advanced', page: 'docs/advanced/02-orchestration-patterns.md', minutes: 'about 20 minutes' },
  { id: 'a-3', level: 'advanced', page: 'docs/advanced/03-dynamic-workflows.md', minutes: 'about 20 minutes, plus run time' },
  { id: 'a-4', level: 'advanced', page: 'docs/advanced/04-headless.md', minutes: 'about 20 minutes' },
  { id: 'a-5', level: 'advanced', page: 'docs/advanced/05-github-actions.md', minutes: 'about 20 minutes, plus run time', newCopy: true },
  { id: 'a-6', level: 'advanced', page: 'docs/advanced/06-share-your-setup.md', minutes: 'about 20 minutes' },
  { id: 'a-7', level: 'advanced', page: 'docs/advanced/07-bounded-runs.md', minutes: 'about 20 minutes, plus run time' },
  { id: 'a-capstone', level: 'advanced', page: 'docs/advanced/capstone.md', minutes: '30 to 60 minutes, plus run time', newCopy: true },
];
// Items whose check starts another process: a test run, a hook, a stub
// run. They run only when the learner presses r, never on every file change.
export const SLOW = {
  'b-3': [1], 'b-capstone': [3, 4],
  'i-5': [2], 'i-capstone': [1, 9],
  'a-4': [1, 2, 3], 'a-7': [0, 1, 2, 3, 4], 'a-capstone': [4, 5, 6, 11],
};
export const GUIDE = 'https://github.com/wesammustafa/Claude-Code-Everything-You-Need-to-Know';
// The guide's Commands by level page, which ends your card.
export const COMMANDS_URL = `${GUIDE}/blob/main/docs/reference/commands.md`;

function value(raw) {
  const q = raw.match(/^"(.*)"$/);
  return q ? { text: q[1], quoted: true } : { text: raw, quoted: false };
}

// Parses one content file. Throws an Error naming the file and line on any
// line it can't read, so a broken file fails its test, not the learner.
export function parseLesson(text, file = 'lesson') {
  const fm = frontmatter(text);
  if (!fm) throw new Error(`${file}: no front matter`);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((l, i) => i > 0 && l.trim() === '---') + 1;
  const lesson = { ...fm.fields, intro: { can: [] }, warmup: [], steps: [], ladder: [], card: [] };
  const cardLines = [];
  let section = null;
  let step = null;
  let beat = null;
  let rung = null;
  let payoffLine = null;
  const fail = (n, msg) => {
    throw new Error(`${file}:${n + 1}: ${msg}`);
  };
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const h2 = line.match(/^## (intro|warm-up|steps|ladder|card)$/);
    if (h2) {
      section = h2[1];
      continue;
    }
    if ((section === 'steps' || section === 'warm-up') && line.startsWith('### ')) {
      const m = line.match(STEP_HEADING);
      if (!m) fail(i, `a step heading the app can't read: ${line}`);
      if ((section === 'warm-up') !== (m[5] === 'Warm-up')) fail(i, `a ${section === 'warm-up' ? 'step' : 'warm-up'} heading in the ${section} section: ${line}`);
      step = { id: m[1], part: m[2] ?? m[5], n: m[3] ? Number(m[3]) : null, of: m[4] ? Number(m[4]) : null, title: m[6], beats: [], line: i + 1 };
      (section === 'warm-up' ? lesson.warmup : lesson.steps).push(step);
      beat = null;
      continue;
    }
    if (section === 'ladder' && line.startsWith('### ')) {
      rung = { item: line.slice(4).trim(), narrow: [], hints: [], bottom: [] };
      lesson.ladder.push(rung);
      continue;
    }
    const narrow = line.match(/^- narrow "(.+)": (.+)$/);
    if (narrow) {
      if (section !== 'ladder' || !rung) fail(i, 'a narrow line outside a ladder block');
      rung.narrow.push({ part: narrow[1], question: narrow[2] });
      continue;
    }
    const kv = line.match(/^- ([a-z-]+): (.+)$/);
    if (!kv) fail(i, `a line the app can't read: ${line}`);
    const [, key, raw] = kv;
    const v = value(raw.trim());
    if (section === 'intro') {
      if (!(key in INTRO_KEYS)) fail(i, `unknown intro key ${key}`);
      if (!v.quoted) fail(i, `${key} must be a quote of the lesson`);
      if (key === 'can') lesson.intro.can.push(v.text);
      else if (key in lesson.intro) fail(i, `a second ${key} line in the intro`);
      else lesson.intro[key] = v.text;
      if (key === 'payoff') payoffLine = i;
      // The p overlay spells out the read line's address: it needs one.
      if (key === 'read' && inline(v.text).filter((r) => r.url).length !== 1) fail(i, 'a read line links one page to read, with a Markdown link');
      continue;
    }
    if (section === 'card') {
      if (!(key in CARD_KEYS)) fail(i, `unknown card key ${key}`);
      if (CARD_KEYS[key] && !v.quoted) fail(i, `${key} must be a quote of the lesson`);
      if (!CARD_KEYS[key] && v.quoted) fail(i, `${key} holds the app's own words: no quotes`);
      if (key === 'skill') {
        lesson.card.push({ skill: raw });
        cardLines.push(i);
      } else if (!lesson.card.length) fail(i, 'a card line before its skill line');
      else if (key in lesson.card.at(-1)) fail(i, `a second ${key} line in a card entry`);
      else lesson.card.at(-1)[key] = v.text;
      continue;
    }
    if (section === 'ladder') {
      if (!rung) fail(i, 'a ladder line before its heading');
      if (!(key in LADDER_KEYS)) fail(i, `unknown ladder key ${key}`);
      if (!v.quoted) fail(i, `${key} must be a quote of the lesson`);
      if (key === 'hint') rung.hints.push(v.text);
      else if (key === 'bottom') rung.bottom.push({ text: v.text });
      else if (!rung.bottom.length) fail(i, 'a win line with no bottom line above it');
      else rung.bottom.at(-1).win = v.text;
      continue;
    }
    if (!['steps', 'warm-up'].includes(section) || !step) fail(i, `a line outside a step: ${line}`);
    if (key === 'beat') {
      if (!BEAT_KINDS.has(raw)) fail(i, `unknown beat kind ${raw}`);
      beat = { kind: raw, lines: [], options: [], hints: [], bottom: [], why: [], accept: [], line: i + 1 };
      step.beats.push(beat);
      continue;
    }
    if (!beat) {
      if (!STEP_KEYS.has(key)) fail(i, `unknown step key ${key}`);
      if (key === 'from' && step.part !== 'Warm-up') fail(i, 'only a warm-up names the lesson it comes from');
      step[key] = raw;
      continue;
    }
    if (!(key in BEAT_KEYS)) fail(i, `unknown beat key ${key}`);
    if (key !== 'win') beat.lastKey = key;
    if (BEAT_KEYS[key] === true && !v.quoted) fail(i, `${key} must be a quote of the lesson`);
    if (BEAT_KEYS[key] === false && v.quoted) fail(i, `${key} holds the app's own words: no quotes`);
    if (OPTION_KEYS.has(key)) beat.options.push({ kind: key, ...v });
    else if (key === 'because') {
      const last = beat.options.at(-1);
      if (!last) fail(i, 'a because line with no option above it');
      last.because = v.text;
    } else if (key === 'win') {
      // A Windows line replaces the command line just above it: a run line,
      // or the last bottom line when that came last.
      const last = beat.lastKey === 'bottom' ? beat.bottom.at(-1) : beat.lines.at(-1);
      if (beat.lastKey !== 'bottom' && last?.key !== 'run') fail(i, 'a win line with no run or bottom line above it');
      last.win = v.text;
    } else if (key === 'tick') {
      const last = beat.lines.at(-1);
      if (last?.key !== 'run') fail(i, 'a tick line with no run line above it');
      last.tick = raw;
    } else if (key === 'hint') beat.hints.push(v.text);
    else if (key === 'bottom') beat.bottom.push({ text: v.text });
    else if (key === 'why') beat.why.push(v.text);
    else if (key === 'accept') beat.accept.push(raw);
    else if (['goal', 'say', 'do', 'run', 'note', 'rule', 'after', 'expect'].includes(key)) {
      // A `say` that opens "Done when" is a check's expectation in the app's
      // words, for a step whose page has none to quote: like `expect`, a done
      // beat hides it where the evidence line replaces it.
      beat.lines.push({ key, text: v.text, quoted: v.quoted, ...(key === 'say' && /^Done when /.test(v.text) ? { doneWhen: true } : {}) });
    }
    else beat[camel(key)] = v.text;
  }
  // A payoff that is no `can` line would flag nothing on screen.
  if (payoffLine !== null && !lesson.intro.can.includes(lesson.intro.payoff)) fail(payoffLine, `the payoff "${lesson.intro.payoff}" is not one of the intro's can lines`);
  lesson.card.forEach((e, k) => {
    if (!e.show || !e.does) fail(cardLines[k], 'a card entry needs a show and a does line');
    if (!lesson.steps.some((s) => s.skill === e.skill)) fail(cardLines[k], `the card entry's skill ${e.skill} is no step of this lesson`);
  });
  for (const s of [...lesson.warmup, ...lesson.steps]) {
    if (!s.beats.length) throw new Error(`${file}:${s.line}: step ${s.id} has no beats`);
    for (const b of s.beats) {
      b.where = b.where ?? s.where;
      if (b.where !== undefined && !WHERE.has(b.where)) throw new Error(`${file}:${b.line}: unknown where ${b.where}`);
      b.verify = parseVerify(b, file);
      if (b.lines.some((l) => l.doneWhen) && !['check', 'file'].includes(b.verify.kind)) throw new Error(`${file}:${b.line}: a "Done when" say line needs a check or file beat`);
    }
  }
  return lesson;
}

const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function parseVerify(beat, file) {
  if (beat.kind !== 'do') return { kind: beat.kind === 'self' ? 'self' : 'answer' };
  const v = beat.verify ?? (beat.ask ? 'answer' : 'none');
  if (v === 'check all') return { kind: 'check', all: true };
  // `fresh`: it counts only once the beat's evidence file has changed since
  // its step opened (or since the step `since` names), so a step that redoes
  // an earlier one can't pass on what the earlier one left behind.
  const fresh = v.match(/ fresh(?: since ([WYTCR]\d*))?$/);
  const base = fresh ? v.slice(0, fresh.index) : v;
  const extra = fresh ? { fresh: true, since: fresh[1] ?? null } : {};
  // `file <path>`: a file no check item covers, done once it holds a line.
  const path = base.match(/^file (\S+)$/);
  if (path) {
    if (beat.evidence && beat.evidence !== path[1]) throw new Error(`${file}:${beat.line}: a file check's evidence is its own file`);
    beat.evidence = path[1];
    return { kind: 'file', path: path[1], ...extra };
  }
  if (fresh && !beat.evidence) throw new Error(`${file}:${beat.line}: a fresh check needs an evidence file`);
  const check = base.match(/^check (\d+(?: \d+)*)$/);
  if (check) return { kind: 'check', items: check[1].split(' ').map(Number), ...extra };
  if (fresh) throw new Error(`${file}:${beat.line}: only a check or a file can be fresh`);
  if (['git-clean', 'answer', 'self', 'none'].includes(v)) return { kind: v };
  throw new Error(`${file}:${beat.line}: unknown verify value ${v}`);
}

// Every lesson on `path` in course order: its check module and, when it has
// one, its content file. `root` is the practice copy the app runs from.
export function loadCourse(root, path = PATH) {
  return path.map((entry) => {
    const file = join(root, 'learn', 'lessons', `${entry.id}.md`);
    const content = existsSync(file) ? parseLesson(readFileSync(file, 'utf8'), `learn/lessons/${entry.id}.md`) : null;
    const check = checks[entry.id];
    return {
      ...entry,
      title: check.title,
      url: `${GUIDE}/blob/main/${entry.page}`,
      stuck: `${GUIDE}/issues/new?template=lesson-feedback.yml&lesson=${entry.id}`,
      items: check.items.map((it) => it.text),
      slow: SLOW[entry.id] ?? [],
      content,
    };
  });
}
