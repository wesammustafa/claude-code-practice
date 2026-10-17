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
// Verify kinds the app answers by reading the beat's file itself, with no
// process: `file`, and HOLDS, what a file holds (ticket 87).
export const HOLDS = new Set(['json', 'match', 'no-match']);
export const READS = new Set(['file', ...HOLDS]);
// Verify kinds the app answers with git status (ticket 88): the whole tree
// clean, or part of it.
export const GIT = new Set(['git-clean', 'git-changed', 'git-only', 'git-staged']);
export const BEAT_KINDS = new Set(['do', 'predict', 'ask', 'type', 'self']);
// Keys a beat may hold, and whether their value must be a quote of the page.
export const BEAT_KEYS = {
  where: false, verify: false, 'done-label': false, watching: false, evidence: false, safety: false, tick: false, skill: false,
  say: false, ask: false, other: false, decoy: false, 'reveal-at': false, recall: false, accept: false, code: false,
  goal: true, do: true, run: true, win: true, expect: true, note: true, rule: true, after: true, why: true,
  codespace: true, 'win-note': true, hint: true, bottom: true, because: true, point: true, reveal: true, self: true,
  right: null, wrong: null, option: null, stuck: null,
};
// `why`: why the lesson matters; `payoff`: the one `can` line the intro and
// complete screens flag as what the lesson builds to; `read`: one line of
// the page's Go further list, with its Markdown link, to read next. At most
// one of each. `need`: a line of the page's You need that names commands,
// shown for each one the learner's PATH lacks; the front matter's `needs`
// says which (ticket 89). `win-note`: the page's note for native Windows,
// at most one.
export const INTRO_KEYS = { minutes: true, can: true, why: true, payoff: true, read: true, need: true, 'win-note': true };
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
// the lesson's check runs there, once the learner gives its folder, never in
// this practice copy. `folder: 'copy'` pins a lesson to the practice copy
// whatever its level's work folder is, until its lesson file's front matter
// says so (ticket 86).
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
  { id: 'i-capstone', level: 'intermediate', page: 'docs/intermediate/capstone.md', minutes: '30 to 60 minutes', folder: 'copy' },
  { id: 'a-1', level: 'advanced', page: 'docs/advanced/01-parallel-sessions.md', minutes: 'about 20 minutes' },
  { id: 'a-2', level: 'advanced', page: 'docs/advanced/02-orchestration-patterns.md', minutes: 'about 20 minutes' },
  { id: 'a-3', level: 'advanced', page: 'docs/advanced/03-dynamic-workflows.md', minutes: 'about 20 minutes, plus run time' },
  { id: 'a-4', level: 'advanced', page: 'docs/advanced/04-headless.md', minutes: 'about 20 minutes' },
  { id: 'a-5', level: 'advanced', page: 'docs/advanced/05-github-actions.md', minutes: 'about 20 minutes, plus run time', newCopy: true },
  { id: 'a-6', level: 'advanced', page: 'docs/advanced/06-share-your-setup.md', minutes: 'about 20 minutes' },
  { id: 'a-7', level: 'advanced', page: 'docs/advanced/07-bounded-runs.md', minutes: 'about 20 minutes, plus run time' },
  { id: 'a-capstone', level: 'advanced', page: 'docs/advanced/capstone.md', minutes: '30 to 60 minutes, plus run time', newCopy: true },
];
// The guide's levels, in course order.
export const LEVELS = [...new Set(PATH.map((p) => p.level))];
// A warm-up may quote a level's index page, docs/<level>/README.md, with
// `- from: <level>-index` (ticket 178): its level, or null for a lesson id.
export const indexLevel = (id) => LEVELS.find((level) => id === `${level}-index`) ?? null;
// The levels whose lessons practise in a work folder the learner picks, the
// practice copy by default (ticket 86): Beginner practises in the copy.
export const WORK_LEVELS = ['intermediate', 'advanced'];
// What the app saves of the work folders: one a level, and one for each
// lesson that runs in a new copy.
export const FOLDER_KEYS = [...WORK_LEVELS, ...PATH.filter((p) => p.newCopy).map((p) => p.id)];
// The longest folder path the app takes, typed or pasted.
export const PATH_MAX = 1024;
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
// A level's index page, which a `<level>-index` warm-up quotes.
export const indexUrl = (level) => `${GUIDE}/blob/main/docs/${level}/README.md`;

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
  // `folder` pins the lesson's folder (ticket 86): `copy`, the practice copy
  // whatever its level's work folder is, or `new copy`, the copy of the
  // template the page has the learner make, which the app asks for.
  if ('folder' in fm.fields && !['copy', 'new copy'].includes(fm.fields.folder)) throw new Error(`${file}: folder is copy or new copy, not ${fm.fields.folder}`);
  const lesson = { ...fm.fields, intro: { can: [] }, warmup: [], steps: [], ladder: [], card: [] };
  const cardLines = [];
  const needLines = [];
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
      else if (key === 'need') needLines.push({ quote: v.text, line: i });
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
      if (key === 'from' && raw.endsWith('-index') && !indexLevel(raw)) fail(i, `from ${raw}: a level index is ${LEVELS.map((l) => `${l}-index`).join(', ').replace(/, (?=[^,]*$)/, ' or ')}`);
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
      // a code block, or the last bottom line when that came last.
      const last = beat.lastKey === 'bottom' ? beat.bottom.at(-1) : beat.lines.at(-1);
      if (beat.lastKey !== 'bottom' && !['run', 'code'].includes(last?.key)) fail(i, 'a win line with no run, code or bottom line above it');
      last.win = v.text;
    } else if (key === 'code') {
      if (beat.lines.some((l) => l.key === 'code')) fail(i, 'a second code block on one beat');
      if (['predict', 'type'].includes(beat.kind)) fail(i, `a code block on a ${beat.kind} beat: only a do, ask or self beat shows one`);
      const open = lines[i + 1]?.match(FENCE);
      if (!open) fail(i, 'a code line with no fenced block under it');
      const end = lines.findIndex((l, k) => k > i + 1 && closes(open[1], l));
      if (end < 0) fail(i, 'a code block with no closing fence');
      const block = lines.slice(i + 2, end);
      if (!block.some((l) => l.trim())) fail(i, 'an empty code block');
      if (block.some((l) => /<your (practice copy|repo)>/.test(l))) fail(i, 'a code block that names <your practice copy> or <your repo>: a run line fills in the folder, a block does not');
      const shows = raw.match(/^(?:lines (\d+)-(\d+) )?point (\d+)$/);
      if (!shows) fail(i, 'a code line is [lines <first>-<last>] point <line>, the lines this beat shows and the one it explains');
      const [from, to, point] = [Number(shows[1] ?? 1), Number(shows[2] ?? block.length), Number(shows[3])];
      if (from < 1 || to > block.length || from > to) fail(i, `lines ${from}-${to}: the block has ${block.length} lines`);
      if (to - from + 1 > CODE_LINES) fail(i, `this beat shows ${to - from + 1} lines of code; a beat shows at most ${CODE_LINES}: name the lines it shows, as lines ${from}-${from + CODE_LINES - 1}`);
      if (point < from || point > to) fail(i, `point ${point} is not a line this beat shows (${from} to ${to})`);
      beat.lines.push({ key: 'code', text: block.join('\n'), quoted: true, lines: block, from, to, point });
      i = end;
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
  // The front matter's line for `key`, for an error to name.
  const fmLine = (key) => {
    const i = lines.slice(0, start).findIndex((l) => l.startsWith(`${key}:`));
    return i < 0 ? null : i;
  };
  lesson.needs = needsOf(fm.fields.needs, needLines, fmLine('needs'), fail);
  lesson.requires = requiresOf(fm.fields.requires, fm.fields.lesson, fmLine('requires'), fail);
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
      if (b.lines.some((l) => l.doneWhen) && b.verify.kind !== 'check' && !READS.has(b.verify.kind)) throw new Error(`${file}:${b.line}: a "Done when" say line needs a check beat or a beat that reads a file`);
    }
  }
  return lesson;
}

// A front matter list: an inline or block list, or one item alone.
const listOf = (raw) => (raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]);

// `needs: [jq python3, bwrap socat on linux]`: the commands the page's You
// need lists, as the app looks them up on the PATH. Each item is the
// commands the intro's need line of the same place quotes (the first item
// the first need line), and "on linux" makes them Linux only, as the
// sandbox's are. Errors name the front matter's needs line.
const COMMAND = /^[A-Za-z0-9][\w.+-]*$/;
function needsOf(raw, lines, at, fail) {
  const items = listOf(raw);
  if (items.length !== lines.length) {
    fail(at ?? lines[0].line, `needs has ${items.length} item${items.length === 1 ? '' : 's'} and the intro ${lines.length} need line${lines.length === 1 ? '' : 's'}: each item is the commands one need line quotes`);
  }
  return items.map((item, k) => {
    const words = item.trim().split(/\s+/);
    const linux = words.length > 2 && words.at(-2) === 'on' && words.at(-1) === 'linux';
    const commands = linux ? words.slice(0, -2) : words;
    // "on" only opens the qualifier: "bwrap on mac" is no command list.
    const bad = commands.find((c) => c === 'on' || !COMMAND.test(c));
    if (!item.trim() || bad !== undefined) fail(at, `needs item "${item}" is command names, then "on linux" for Linux only`);
    return { commands, linux, quote: lines[k].quote };
  });
}

// `requires: [b-5 check 0, i-1 file .claude/skills/five-whys/SKILL.md]`:
// what an earlier lesson leaves that this one builds on, looked at in this
// lesson's work folder. `<lesson> check <item>` passes when that lesson's
// check item does, `<lesson> file <path>` once the file holds a line. A
// check item that starts another process (SLOW) runs only on r, so it is no
// prerequisite; a file is a file, not a folder. Errors name the front
// matter's requires line.
function requiresOf(raw, id, at, fail) {
  const items = listOf(raw);
  const here = PATH.findIndex((p) => p.id === id);
  if (items.length && here < 0) fail(at, `requires: ${id} is no lesson on the path`);
  const before = PATH.slice(0, here).map((p) => p.id);
  const seen = new Set();
  return items.map((item) => {
    const m = item.trim().match(/^(\S+) (?:check (\d+)|file (\S+))$/);
    if (!m) fail(at, `requires item "${item}" is <lesson> check <item> or <lesson> file <path>`);
    const [, lesson, n, path] = m;
    if (!before.includes(lesson)) fail(at, `requires item "${item}": ${lesson} is no lesson before ${id}`);
    if (seen.has(m[0])) fail(at, `requires item "${item}" is named twice`);
    seen.add(m[0]);
    if (n !== undefined) {
      if (!checks[lesson].items[Number(n)]) fail(at, `requires item "${item}": ${lesson} has no check item ${n}`);
      if (SLOW[lesson]?.includes(Number(n))) fail(at, `requires item "${item}": ${lesson}'s check item ${n} starts another process, so it runs only on r`);
      return { lesson, item: Number(n) };
    }
    if (!workPath(path) || path.endsWith('/')) fail(at, `requires item "${item}" names a file from the work folder, like .claude/settings.json, not ${path}`);
    return { lesson, path };
  });
}

// A path named from the work folder, like src/ or .claude/settings.json:
// never ./, / or .. in it, nor a backslash.
const workPath = (path) => !path.includes('\\') && !path.startsWith('/') && !path.replace(/\/$/, '').split('/').some((part) => ['', '.', '..'].includes(part));

// A code block (ticket 90): one fenced block of the page, for code a quote
// can't carry, such as a loop, a JSON file or a script. A beat holds one:
//
//   - code: lines 9-16 point 12
//   ```bash
//   <the page block's lines>
//   ```
//
// The fence opens on the line under the `code` line, at its first column,
// with the page's info string, and its lines are the page block's lines
// exactly, less the indent the page's fence has (three spaces inside a
// numbered step), blank lines included: the guide's quote check compares
// them with the page's blocks. A block shows on a do, ask or self beat,
// and names no <your practice copy> or <your repo>, which only a run line
// fills in.
// The `code` line is the app's own words: `point <n>` is the line the beat
// explains, counted from the block's first line, and the card marks it.
// A beat shows at most CODE_LINES lines, so a longer block names the lines
// the beat shows, `lines <first>-<last>`, which hold its point: each beat
// that explains a part of a longer block carries the whole block again,
// with its own window. A `win` line right after the block replaces it on
// native Windows, as it replaces a run line.
export const CODE_LINES = 8;
// A fence at the start of a line, three backticks or tildes or more, with
// the page's info string; it closes on a line of the same character, at
// least as long, as CommonMark has it.
const FENCE = /^(`{3,}|~{3,})([^`]*)$/;
const closes = (fence, line) => {
  const m = line.match(/^(`{3,}|~{3,})[ \t]*$/);
  return Boolean(m) && m[1][0] === fence[0] && m[1].length >= fence.length;
};

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
  // The beats that read a file themselves: its evidence is its own file.
  const own = (path) => {
    if (beat.evidence && beat.evidence !== path) throw new Error(`${file}:${beat.line}: a file check's evidence is its own file`);
    beat.evidence = path;
  };
  // `file <path>`: a file no check item covers, done once it holds a line.
  const path = base.match(/^file (\S+)$/);
  if (path) {
    own(path[1]);
    return { kind: 'file', path: path[1], ...extra };
  }
  // `json <path> [<key.path>[=<value>]]`: done once the file parses, and
  // holds the key, with that value when one is given.
  const json = base.match(/^json (\S+)(?: ([^\s=]+)(?:=(.+))?)?$/);
  if (json) {
    own(json[1]);
    return { kind: 'json', path: json[1], key: json[2] ?? null, value: json[3] ?? null, ...extra };
  }
  // `match <path> <regex>`: done once a line of the file matches.
  // `no-match`: done once the file is there and no line matches.
  const lines = base.match(/^(match|no-match) (\S+) (.+)$/);
  if (lines) {
    own(lines[2]);
    return { kind: lines[1], path: lines[2], regex: lines[3], ...extra };
  }
  if (fresh && !beat.evidence) throw new Error(`${file}:${beat.line}: a fresh check needs an evidence file`);
  const check = base.match(/^check (\d+(?: \d+)*)$/);
  if (check) return { kind: 'check', items: check[1].split(' ').map(Number), ...extra };
  if (fresh) throw new Error(`${file}:${beat.line}: only a check or a file can be fresh`);
  // A path git status is asked about, as it names one: from the work folder.
  const gitPath = (path) => {
    if (!workPath(path)) {
      throw new Error(`${file}:${beat.line}: a git path is named from the work folder, like src/ or .claude/settings.json, not ${path}`);
    }
    return path;
  };
  // `git-clean <path>...`: git status lists nothing under those paths; with
  // none, nothing at all.
  const clean = v.match(/^git-clean (\S+(?: \S+)*)$/);
  if (clean) return { kind: 'git-clean', paths: clean[1].split(' ').map(gitPath) };
  // `git-changed <path>`: git status lists something under the path.
  // `git-only <path>`: it lists something, and all of it under the path.
  const scoped = v.match(/^(git-changed|git-only) (\S+)$/);
  if (scoped) return { kind: scoped[1], path: gitPath(scoped[2]) };
  // `git-staged`: git status says a path is staged.
  if (['git-clean', 'git-staged', 'answer', 'self', 'none'].includes(v)) return { kind: v };
  throw new Error(`${file}:${beat.line}: unknown verify value ${v}`);
}

// Every lesson on `path` in course order: its check module and, when it has
// one, its content file. `root` is the practice copy the app runs from.
export function loadCourse(root, path = PATH) {
  return path.map((entry, at) => {
    const file = join(root, 'learn', 'lessons', `${entry.id}.md`);
    const content = existsSync(file) ? parseLesson(readFileSync(file, 'utf8'), `learn/lessons/${entry.id}.md`) : null;
    // A prerequisite comes from a lesson this course puts first.
    const late = content?.requires.find((r) => !path.slice(0, at).some((p) => p.id === r.lesson));
    if (late) throw new Error(`learn/lessons/${entry.id}.md: requires ${late.lesson}, no lesson before ${entry.id} here`);
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
