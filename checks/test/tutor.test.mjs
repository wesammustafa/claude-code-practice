// The /tutor skill in .claude/skills/tutor/. It must stay user-only, grant
// itself nothing but the exact check of each lesson it tutors, keep its step
// scripts in the shape SKILL.md reads, match each check's own hints, and
// change no check result. Whether its quotes still match the lesson pages is
// the guide's job: its tutor-quotes rule compares them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { frontmatter } from '../frontmatter.mjs';
import { lessons } from '../lessons/index.mjs';
import { check, exportHead, repo, withRepo } from './helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL = '.claude/skills/tutor';
const dir = join(root, SKILL);
const skillText = readFileSync(join(dir, 'SKILL.md'), 'utf8');
const skill = frontmatter(skillText);
const tutored = skillText.match(/^Lessons with a tutor: (.+)\.$/m)?.[1].split(', ') ?? [];
const forms = (id) => [`Bash(npm run check -- ${id})`, `PowerShell(npm run check -- ${id})`, `PowerShell(npm.cmd run check -- ${id})`];

// Keys a step script may use. Quote keys hold lesson text, word for word, in
// double quotes; question keys hold the tutor's own questions.
const QUOTES = new Set(['do', 'rule', 'expect', 'note', 'after', 'own-repo', 'self', 'goal', 'quote', 'bottom', 'on-hint']);
const QUESTIONS = new Set(['predict', 'observe', 'report', 'recall']);
const OTHER = new Set(['check', 'answer', 'then', 'resume', 'resume-own', 'section', 'anchor']);
const STEP = /^### (W\d|Y\d|C) \| (?:(Worked example|Your turn) step (\d+) of (\d+)|Check) \| \S.*$/;

function steps(id) {
  const text = readFileSync(join(dir, 'steps', `${id}.md`), 'utf8');
  const { fields, body } = frontmatter(text);
  const sections = [];
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    const h2 = line.match(/^## (\S+)$/);
    const h3 = line.match(/^### (.+)$/);
    const narrow = line.match(/^- narrow "(.+)": (.+)$/);
    const keyed = line.match(/^- ([a-z-]+): (.+)$/);
    if (h2) sections.push({ name: h2[1], blocks: [] });
    else if (h3) sections.at(-1).blocks.push({ heading: line, title: h3[1], lines: [] });
    else if (narrow) sections.at(-1).blocks.at(-1).lines.push({ key: 'narrow', failKey: narrow[1], value: narrow[2] });
    else if (keyed) sections.at(-1).blocks.at(-1).lines.push({ key: keyed[1], value: keyed[2] });
    else assert.fail(`steps/${id}.md: a line the tutor can't read: ${line}`);
  }
  return { fields, sections };
}

test('the tutor is user-only and pre-approves only the exact check of each lesson it tutors', () => {
  const f = skill.fields;
  assert.equal(f.name, 'tutor');
  assert.equal(String(f['disable-model-invocation']), 'true');
  assert.deepEqual(f.arguments, ['lesson', 'phase']);
  assert.deepEqual([...f['allowed-tools']].sort(), tutored.flatMap(forms).sort());
  for (const tool of ['Edit', 'Write', 'NotebookEdit', 'Agent']) assert.ok(String(f['disallowed-tools']).split(/,\s*/).includes(tool), tool);
  for (const key of ['hooks', 'model', 'effort', 'context', 'agent', 'paths', 'shell']) assert.equal(f[key], undefined, `SKILL.md sets ${key}`);
  // Words that would let the skill pass i-capstone's skill item if the flag were dropped.
  assert.doesNotMatch(skillText, /npm run linkcheck|src\/cli\.js/);
  // No command runs while the skill loads: no ! injection, inline or fenced.
  assert.doesNotMatch(skill.body, /(^|\s)!`|^```!/m);
  // Only the two named arguments and the skill's folder are substituted.
  assert.deepEqual([...new Set([...skill.body.matchAll(/\$\{?[A-Za-z0-9_]+/g)].map((m) => m[0]))].sort(), ['$lesson', '$phase', '${CLAUDE_SKILL_DIR'].sort());
  // Compaction keeps the first 5,000 tokens of a skill; stay well inside.
  assert.ok(skillText.length < 13000, `SKILL.md has ${skillText.length} characters`);
});

test('npm run check runs the course checks, the command the tutor is allowed to run', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.check, 'node checks/run.mjs');
});

test('the tutor folder holds one SKILL.md and a Markdown step script for each lesson it tutors', () => {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath ?? e.path, e.name).slice(dir.length + 1).split('\\').join('/'))
    .sort();
  assert.deepEqual(files, ['SKILL.md', ...tutored.map((id) => `steps/${id}.md`)].sort());
  assert.ok(tutored.length > 0);
  for (const id of tutored) assert.ok(lessons[id], `${id} has no check`);
});

test('every step script is in the shape SKILL.md reads', () => {
  for (const id of tutored) {
    const { fields, sections } = steps(id);
    const where = `steps/${id}.md`;
    assert.equal(fields.lesson, id, where);
    for (const key of ['title', 'source', 'source-commit', 'stamp', 'page', 'stuck', 'next']) assert.ok(fields[key], `${where} has no ${key}`);
    assert.match(fields.stamp, /^Verified against Claude Code v\d+\.\d+\.\d+ \(stable\) on \d{4}-\d{2}-\d{2}$/, where);
    assert.deepEqual(fields.phases, ['start', 'your-turn', 'check'], where);
    assert.deepEqual(sections.map((s) => s.name), ['start', 'your-turn', 'check', 'ladder'], where);
    const items = lessons[id].items.map((i) => i.text);
    for (const section of sections) {
      for (const block of section.blocks) {
        const at = `${where}, ${block.title}`;
        if (section.name === 'ladder') assert.ok(items.includes(block.title), `${at}: not the text of a ${id} check item`);
        else assert.match(block.heading, STEP, at);
        const quoted = block.lines.filter((l) => QUOTES.has(l.key)).map((l) => l.value).join('\n');
        for (const line of block.lines) {
          const known = QUOTES.has(line.key) || QUESTIONS.has(line.key) || OTHER.has(line.key) || line.key === 'narrow';
          assert.ok(known, `${at}: unknown key ${line.key}`);
          if (QUOTES.has(line.key)) assert.match(line.value, /^"[^"].*"$/, `${at}: ${line.key} must be one quoted line`);
          if (line.key === 'check') assert.equal(line.value, id, at);
          if (line.key === 'answer') assert.equal(line.value, 'read-only', at);
          if (line.key.startsWith('resume')) assert.match(line.value, new RegExp(`^/tutor ${id} (your-turn|check)$`), at);
          if (QUESTIONS.has(line.key) || line.key === 'narrow') assert.match(line.value, /\?$/, `${at}: a ${line.key} line asks a question`);
          // A question names only what a quote of the same step names.
          if (QUESTIONS.has(line.key) || line.key === 'narrow' || line.key === 'then') {
            for (const [, span] of line.value.matchAll(/`([^`]+)`/g)) {
              assert.ok(span.startsWith(`/tutor ${id}`) || quoted.includes(span), `${at}: \`${span}\` is in no quote of this step`);
            }
          }
        }
      }
    }
  }
});

// Check states that fail each item of a tutored lesson for each reason its
// hints give, and one state that passes.
const FIXTURES = {
  'b-1': {
    fail: [{}, { '.practice/version.txt': '' }, { '.practice/version.txt': 'zsh: command not found: claude\n' }],
    pass: { '.practice/version.txt': '2.1.285 (Claude Code)\n' },
  },
};

test('every FAIL hint of a tutored check matches exactly one narrow key', () => {
  for (const id of tutored) {
    const fixtures = FIXTURES[id];
    assert.ok(fixtures, `no fixtures for ${id}`);
    const keys = steps(id).sections.find((s) => s.name === 'ladder').blocks.flatMap((b) => b.lines.filter((l) => l.key === 'narrow').map((l) => l.failKey));
    const seen = new Set();
    for (const files of fixtures.fail) {
      withRepo(() => repo(files), (d) => {
        const { code, out } = check([id, '--dir', d]);
        assert.equal(code, 1, out);
        const hits = keys.filter((k) => out.includes(k));
        assert.equal(hits.length, 1, `${id} ${JSON.stringify(files)}: ${hits.length} keys match\n${out}`);
        seen.add(hits[0]);
      });
    }
    assert.equal(seen.size, keys.length, `${id}: a narrow key matches no fixture`);
    withRepo(() => repo(fixtures.pass), (d) => assert.equal(check([id, '--dir', d]).code, 0));
  }
});

const normalized = (out, d) => [d, realpathSync(d)].reduce((text, p) => text.split(p).join('<dir>'), out).replace(/\b[0-9a-f]{7,40}\b/g, '<sha>');

test('the tutor changes no check result or hint', () => {
  const withTutor = exportHead(root);
  const without = exportHead(root, SKILL);
  try {
    const a = normalized(check(['all', '--dir', withTutor]).out, withTutor).split('\n');
    const b = normalized(check(['all', '--dir', without]).out, without).split('\n');
    // The lines that differ first, so a failure names the item; then the order.
    assert.deepEqual({ onlyWithTutor: a.filter((l) => !b.includes(l)), onlyWithout: b.filter((l) => !a.includes(l)) }, { onlyWithTutor: [], onlyWithout: [] });
    assert.deepEqual(a, b);
  } finally {
    rmSync(withTutor, { recursive: true, force: true });
    rmSync(without, { recursive: true, force: true });
  }
});
