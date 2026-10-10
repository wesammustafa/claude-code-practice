// Lesson content files, learn/lessons/<id>.md. A double-quoted value is the
// lesson page's exact words; an unquoted value is the app's own words and
// states no Claude Code fact. The guide's weekly quote check compares every
// quoted value with the page.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { frontmatter } from '../../checks/frontmatter.mjs';
import { lessons as checks } from '../../checks/lessons/index.mjs';

export const STEP_HEADING = /^### (W\d+|Y\d+|C) \| (?:(Worked example|Your turn) step (\d+) of (\d+)|(Check)) \| (\S.*)$/;
export const STEP_KEYS = new Set(['tier', 'skill', 'where']);
export const BEAT_KINDS = new Set(['do', 'predict', 'ask', 'type', 'self']);
// Keys a beat may hold, and whether their value must be a quote of the page.
export const BEAT_KEYS = {
  where: false, verify: false, 'done-label': false, watching: false, evidence: false, safety: false, tick: false,
  say: false, ask: false, other: false, decoy: false, 'reveal-at': false, recall: false, accept: false,
  goal: true, do: true, run: true, win: true, expect: true, note: true, rule: true, after: true, why: true,
  codespace: true, 'win-note': true, hint: true, bottom: true, because: true, point: true, reveal: true, self: true,
  right: null, wrong: null, option: null, stuck: true,
};
export const INTRO_KEYS = { minutes: true, can: true };
export const LADDER_KEYS = { hint: true, bottom: true, win: true };
const OPTION_KEYS = new Set(['right', 'wrong', 'option', 'stuck', 'other', 'decoy']);

// The guide's Beginner path, in course order. Pages and time estimates for
// lessons the app shows only through their check.
export const PATH = [
  { id: 'b-1', page: 'docs/beginner/01-install-and-look-around.md', minutes: 'about 20 minutes' },
  { id: 'b-2', page: 'docs/beginner/02-permission-modes-and-plan-mode.md', minutes: 'about 20 minutes' },
  { id: 'b-3', page: 'docs/beginner/03-first-change.md', minutes: 'about 20 minutes' },
  { id: 'b-4', page: 'docs/beginner/04-keep-a-session-on-track.md', minutes: 'about 20 minutes' },
  { id: 'b-5', page: 'docs/beginner/05-project-memory.md', minutes: 'about 20 minutes' },
  { id: 'b-capstone', page: 'docs/beginner/capstone.md', minutes: '30 to 60 minutes' },
];
export const GUIDE = 'https://github.com/wesammustafa/Claude-Code-Everything-You-Need-to-Know';

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
  const lesson = { ...fm.fields, intro: { can: [] }, steps: [], ladder: [] };
  let section = null;
  let step = null;
  let beat = null;
  let rung = null;
  const fail = (n, msg) => {
    throw new Error(`${file}:${n + 1}: ${msg}`);
  };
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const h2 = line.match(/^## (intro|steps|ladder)$/);
    if (h2) {
      section = h2[1];
      continue;
    }
    if (section === 'steps' && line.startsWith('### ')) {
      const m = line.match(STEP_HEADING);
      if (!m) fail(i, `a step heading the app can't read: ${line}`);
      step = { id: m[1], part: m[2] ?? 'Check', n: m[3] ? Number(m[3]) : null, of: m[4] ? Number(m[4]) : null, title: m[6], beats: [], line: i + 1 };
      lesson.steps.push(step);
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
      else lesson.intro[key] = v.text;
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
    if (section !== 'steps' || !step) fail(i, `a line outside a step: ${line}`);
    if (key === 'beat') {
      if (!BEAT_KINDS.has(raw)) fail(i, `unknown beat kind ${raw}`);
      beat = { kind: raw, lines: [], options: [], hints: [], bottom: [], why: [], accept: [], line: i + 1 };
      step.beats.push(beat);
      continue;
    }
    if (!beat) {
      if (!STEP_KEYS.has(key)) fail(i, `unknown step key ${key}`);
      step[key] = raw;
      continue;
    }
    if (!(key in BEAT_KEYS)) fail(i, `unknown beat key ${key}`);
    if (BEAT_KEYS[key] === true && !v.quoted) fail(i, `${key} must be a quote of the lesson`);
    if (BEAT_KEYS[key] === false && v.quoted) fail(i, `${key} holds the app's own words: no quotes`);
    if (OPTION_KEYS.has(key)) beat.options.push({ kind: key, ...v });
    else if (key === 'because') {
      const last = beat.options.at(-1);
      if (!last) fail(i, 'a because line with no option above it');
      last.because = v.text;
    } else if (key === 'win') {
      const last = beat.lines.at(-1);
      if (last?.key !== 'run') fail(i, 'a win line with no run line above it');
      last.win = v.text;
    } else if (key === 'tick') {
      const last = beat.lines.at(-1);
      if (last?.key !== 'run') fail(i, 'a tick line with no run line above it');
      last.tick = raw;
    } else if (key === 'hint') beat.hints.push(v.text);
    else if (key === 'bottom') beat.bottom.push(v.text);
    else if (key === 'why') beat.why.push(v.text);
    else if (key === 'accept') beat.accept.push(raw);
    else if (['goal', 'say', 'do', 'run', 'note', 'rule', 'after', 'expect'].includes(key)) beat.lines.push({ key, text: v.text, quoted: v.quoted });
    else beat[camel(key)] = v.text;
  }
  for (const s of lesson.steps) {
    if (!s.beats.length) throw new Error(`${file}:${s.line}: step ${s.id} has no beats`);
    for (const b of s.beats) {
      b.where = b.where ?? s.where;
      b.verify = parseVerify(b, file);
    }
  }
  return lesson;
}

const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function parseVerify(beat, file) {
  if (beat.kind !== 'do') return { kind: beat.kind === 'self' ? 'self' : 'answer' };
  const v = beat.verify ?? (beat.ask ? 'answer' : 'none');
  if (v === 'check all') return { kind: 'check', all: true };
  const check = v.match(/^check (\d+(?: \d+)*)$/);
  if (check) return { kind: 'check', items: check[1].split(' ').map(Number) };
  if (['git-clean', 'answer', 'self', 'none'].includes(v)) return { kind: v };
  throw new Error(`${file}:${beat.line}: unknown verify value ${v}`);
}

// Every Beginner lesson in course order: its check module and, when it has
// one, its content file. `root` is the practice copy the app runs from.
export function loadCourse(root) {
  return PATH.map((entry) => {
    const file = join(root, 'learn', 'lessons', `${entry.id}.md`);
    const content = existsSync(file) ? parseLesson(readFileSync(file, 'utf8'), `learn/lessons/${entry.id}.md`) : null;
    const check = checks[entry.id];
    return {
      ...entry,
      title: check.title,
      url: `${GUIDE}/blob/main/${entry.page}`,
      stuck: `${GUIDE}/issues/new?template=lesson-feedback.yml&lesson=${entry.id}`,
      items: check.items.map((it) => it.text),
      content,
    };
  });
}
