// The learn app's lesson files, learn/lessons/<id>.md. These tests check
// their shape; whether each quote still matches its lesson page is the
// guide's job (its quote check compares them every week).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GUIDE, parseLesson, PATH } from '../../learn/lib/content.mjs';
import { C } from '../../learn/lib/copy.mjs';
import { lessons } from '../lessons/index.mjs';
import { openRepo } from '../repo.mjs';
import { ruleTiers } from '../../learn/lib/tiers.mjs';
import { repo, withRepo, write } from './helpers.mjs';
import { root } from './learn-drive.mjs';

const dir = join(root, 'learn', 'lessons');
const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
const parsed = Object.fromEntries(files.map((f) => [f.replace(/\.md$/, ''), parseLesson(readFileSync(join(dir, f), 'utf8'), `learn/lessons/${f}`)]));
const contents = PATH.map((p) => parsed[p.id] ?? null);
const tracked = new Set(execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n'));
const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts;
const quotesOf = (step) => step.beats.flatMap((b) => [
  ...b.lines.filter((l) => l.quoted).map((l) => l.text), ...b.hints, ...b.bottom, ...b.why,
  ...b.options.flatMap((o) => [o.quoted ? o.text : null, o.because]), b.reveal, b.point, b.self, b.codespace, b.winNote,
].filter(Boolean)).join('\n');
const appWords = (step) => step.beats.flatMap((b) => [
  ...b.lines.filter((l) => !l.quoted).map((l) => l.text), b.ask, b.doneLabel, ...b.options.filter((o) => !o.quoted && o.kind !== 'decoy').map((o) => o.text),
].filter(Boolean));

test('every lesson file belongs to a Beginner lesson, in its file, and parses', () => {
  assert.ok(files.length > 0);
  for (const [id, l] of Object.entries(parsed)) {
    assert.ok(PATH.some((p) => p.id === id), `${id} is not on the Beginner path`);
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
    assert.equal(l.title, lessons[id].title, `${id}: the title differs from its check's`);
    if (l.next) assert.ok(PATH.some((p) => p.id === l.next), `${id}: unknown next lesson ${l.next}`);
    assert.ok(l.intro.can.length > 0 && l.intro.minutes);
  }
});

test('steps are numbered as on the page, one part after the other', () => {
  for (const [id, l] of Object.entries(parsed)) {
    for (const part of ['Worked example', 'Your turn']) {
      const steps = l.steps.filter((s) => s.part === part);
      steps.forEach((s, i) => {
        assert.equal(s.n, i + 1, `${id} ${s.id}`);
        assert.equal(s.of, steps.length, `${id} ${s.id}: says "of ${s.of}"`);
        assert.equal(s.id, `${part === 'Worked example' ? 'W' : 'Y'}${i + 1}`);
      });
    }
    assert.equal(l.steps.at(-1).id, 'C', `${id}: the Check comes last`);
    for (const s of l.steps) {
      assert.ok(['terminal', 'claude'].includes(s.where), `${id} ${s.id}: where`);
      assert.ok(/^[a-z][a-z-]*$/.test(s.skill ?? ''), `${id} ${s.id}: skill`);
    }
  }
});

test('the app\'s own words name no command or code that the step\'s quotes don\'t', () => {
  for (const [id, l] of Object.entries(parsed)) {
    for (const step of l.steps) {
      const quotes = quotesOf(step);
      for (const words of appWords(step)) {
        for (const [, span] of words.matchAll(/`([^`]+)`/g)) assert.ok(quotes.includes(span), `${id} ${step.id}: "${words}" names \`${span}\``);
        for (const [, cmd] of words.matchAll(/(?:^|\s)(\/[a-z][a-z-]*)/g)) assert.ok(quotes.includes(cmd), `${id} ${step.id}: "${words}" names ${cmd}`);
      }
    }
  }
  // Every string the app's own words can produce.
  const words = [];
  const walk = (v) => {
    if (typeof v === 'string') words.push(v);
    else if (typeof v === 'function') walk(v('x', 1, 'y', 'z'));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(C);
  assert.ok(words.length > 50);
  for (const w of words) {
    assert.doesNotMatch(w, /`/, `copy.mjs: "${w}" holds a code span`);
    assert.doesNotMatch(w, /(^|\s)\/[a-z]/, `copy.mjs: "${w}" names a slash command`);
    assert.doesNotMatch(w, /\d+\.\d+\.\d+/, `copy.mjs: "${w}" names a version`);
    assert.doesNotMatch(w, /\b(Opus|Sonnet|Haiku|Fable)\b|claude-[a-z]+-\d/, `copy.mjs: "${w}" names a model`);
  }
});

test('questions: one right answer, a reason for every wrong one, real files in decoys', () => {
  for (const [id, l] of Object.entries(parsed)) {
    for (const step of l.steps) {
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

test('verify lines name real check items, and every FAIL message has its own first hint', () => {
  for (const [id, l] of Object.entries(parsed)) {
    const items = lessons[id].items;
    for (const step of l.steps) {
      for (const b of step.beats) {
        if (b.verify.kind !== 'check') continue;
        if (b.verify.all) assert.equal(step.part, 'Check', `${id} ${step.id}: check all outside the Check`);
        else for (const i of b.verify.items) assert.ok(items[i], `${id} ${step.id}: no item ${i}`);
        assert.ok(b.watching || b.verify.all, `${id} ${step.id}: says nothing about what it watches`);
      }
    }
    for (const rung of l.ladder) assert.ok(items.some((it) => it.text === rung.item), `${id}: the ladder heading "${rung.item}" is no check item`);
  }
  // Lesson 1's three FAIL messages, each matched by exactly one narrow question.
  const b1 = parsed['b-1'];
  const fails = [null, '', 'zsh: command not found: claude\n'].map((text) => withRepo(() => repo(), (d) => {
    if (text !== null) write(d, { '.practice/version.txt': text });
    return lessons['b-1'].items[0].check(openRepo(d));
  }));
  const ladder = b1.ladder.find((r) => r.item === lessons['b-1'].items[0].text);
  for (const hint of fails) {
    assert.equal(typeof hint, 'string');
    assert.equal(ladder.narrow.filter((n) => hint.includes(n.part)).length, 1, `no single narrow question for: ${hint}`);
  }
  const src = readFileSync(join(root, 'checks', 'lessons', 'b-1.mjs'), 'utf8');
  assert.equal((src.match(/return `/g) ?? []).length, fails.length, 'b-1 has a FAIL message this test has no fixture for');
  for (const n of ladder.narrow) assert.match(n.question, /\?$/);
});

test('difficulty: each step\'s tier is the course rule\'s, and it climbs', () => {
  const shares = [];
  contents.forEach((c, i) => {
    if (!c) return;
    const rule = ruleTiers(contents, i);
    c.steps.forEach((s, k) => assert.equal(s.tier, rule[k], `${c.lesson} ${s.id} is ${s.tier}; the course rule says ${rule[k]}`));
    assert.equal(c.steps.at(-1).tier, 'challenge', `${c.lesson}: the Check is CHALLENGE`);
    if (c.lesson.endsWith('capstone')) assert.ok(c.steps.every((s) => s.tier === 'challenge'));
    if (i > 0) assert.notEqual(c.steps[0].tier, 'guided', `${c.lesson} opens GUIDED`);
    shares.push(c.steps.filter((s) => s.tier !== 'guided').length / c.steps.length);
  });
  for (let i = 1; i < shares.length; i++) assert.ok(shares[i] > shares[i - 1], `lesson ${i + 1} doesn't open harder than lesson ${i}`);
  // A safety choice keeps a guess before it at every tier.
  const b1 = parsed['b-1'];
  assert.ok(b1.steps.find((s) => s.id === 'W4').beats[0].safety);
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
