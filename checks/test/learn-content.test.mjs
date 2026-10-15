// The learn app's lesson files, learn/lessons/<id>.md. These tests check
// their shape; whether each quote still matches its lesson page is the
// guide's job (its quote check compares them every week).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GUIDE, parseLesson, PATH, WHERE } from '../../learn/lib/content.mjs';
import { C } from '../../learn/lib/copy.mjs';
import { lessons } from '../lessons/index.mjs';
import { ruleTiers } from '../../learn/lib/tiers.mjs';
import { root } from './learn-drive.mjs';

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
    // The page's heading, which holds the check's shorter title.
    assert.ok(l.title.toLowerCase().includes(lessons[id].title.toLowerCase()), `${id}: the title "${l.title}" doesn't hold its check's, "${lessons[id].title}"`);
    if (l.next) assert.ok(PATH.some((p) => p.id === l.next), `${id}: unknown next lesson ${l.next}`);
    assert.ok(l.intro.can.length > 0 && l.intro.minutes);
  }
});

test('steps are numbered as on the page, one part after the other', () => {
  const prefix = { 'Worked example': 'W', 'Your turn': 'Y', 'The task': 'T' };
  for (const [id, l] of Object.entries(parsed)) {
    for (const part of Object.keys(prefix)) {
      const steps = l.steps.filter((s) => s.part === part);
      steps.forEach((s, i) => {
        assert.equal(s.n, i + 1, `${id} ${s.id}`);
        assert.equal(s.of, steps.length, `${id} ${s.id}: says "of ${s.of}"`);
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
});

test('warm-ups: questions from an earlier lesson, numbered, from memory', () => {
  for (const [id, l] of Object.entries(parsed)) {
    const at = PATH.findIndex((p) => p.id === id);
    l.warmup.forEach((w, i) => {
      assert.equal(w.id, `R${i + 1}`, `${id} ${w.id}`);
      assert.equal(w.tier, 'challenge', `${id} ${w.id}: a warm-up is CHALLENGE`);
      const from = PATH.findIndex((p) => p.id === w.from);
      assert.ok(from >= 0 && from < at, `${id} ${w.id}: from ${w.from} is not an earlier lesson`);
      assert.equal(w.beats.length, 1, `${id} ${w.id}: one question`);
      assert.ok(['ask', 'type'].includes(w.beats[0].kind), `${id} ${w.id}: a warm-up asks`);
    });
    if (at > 0) assert.ok(l.warmup.length >= 2 || !l.steps.some((s) => s.part === 'Worked example'), `${id}: a lesson after the first opens with warm-ups`);
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

test('difficulty: each step\'s tier is the course rule\'s, and it climbs like a sawtooth', () => {
  const shares = [];
  contents.forEach((c, i) => {
    if (!c) return;
    const rule = ruleTiers(contents, i);
    c.steps.forEach((s, k) => assert.equal(s.tier, rule[k], `${c.lesson} ${s.id} is ${s.tier}; the course rule says ${rule[k]}`));
    assert.equal(c.steps.at(-1).tier, 'challenge', `${c.lesson}: the Check is CHALLENGE`);
    if (c.lesson.endsWith('capstone')) assert.ok(c.steps.every((s) => s.tier === 'challenge'));
    if (i > 0) assert.notEqual(c.steps[0].tier, 'guided', `${c.lesson} opens GUIDED`);
    shares.push({ id: c.lesson, share: c.steps.filter((s) => s.tier !== 'guided').length / c.steps.length });
  });
  // A lesson full of new commands may dip, but never below the lesson two
  // before it, and every lesson gives less help than the first.
  shares.forEach(({ id, share }, i) => {
    if (i > 0) assert.ok(share > shares[0].share, `${id} doesn't give less help than ${shares[0].id}`);
    if (i > 1) assert.ok(share >= shares[i - 2].share, `${id} gives more help than ${shares[i - 2].id}, two lessons before`);
  });
  // A safety choice keeps a guess before it at every tier.
  const b1 = parsed['b-1'];
  assert.ok(b1.steps.find((s) => s.id === 'W4').beats[0].safety);
  for (const l of Object.values(parsed)) for (const s of allSteps(l)) for (const b of s.beats) if (b.safety) assert.equal(b.kind, 'predict', `${l.lesson} ${s.id}: a safety choice is a guess`);
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
    assert.ok(allSteps(parsed[id]).find((s) => s.id === sid)?.beats[n]?.options.length, `${at}: the exemption names no question`);
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
