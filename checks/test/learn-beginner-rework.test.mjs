// Current production content, independent of the stable reducer-course
// fixtures. A complete walk proves each real beat is reachable and fits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liveCourse, lessonScreens, driver, finishedBefore, root } from './learn-drive.mjs';
import { render } from '../../learn/lib/render.mjs';
import { strip, width } from '../../learn/lib/text.mjs';
import { theme } from '../../learn/lib/theme.mjs';
import { beatOf, rungsOf } from '../../learn/lib/flow.mjs';
import { lessons } from '../lessons/index.mjs';
import { openRepo } from '../repo.mjs';
import { commit, repo, withRepo, write } from './helpers.mjs';

const beginner = liveCourse.filter(l => l.level === 'beginner');
test('lesson 3 sets lesson 2 aside before starting a new change', () => {
  const first = beginner.find(l => l.id === 'b-3').content.steps[0].beats[0];
  assert.equal(first.verify.kind, 'git-clean');
  assert.equal(first.where, 'terminal');
  assert.ok(first.bottom.some(line => line.text.includes('git stash push --include-untracked -m b-2')));
});

test('capstone prepares committed memory and preserves its Windows reproduction warning', () => {
  const first = beginner.find(l => l.id === 'b-capstone').content.steps[0];
  assert.ok(first.beats.some(b => b.verify.kind === 'check' && b.verify.items?.includes(5)));
  assert.ok(first.beats.some(b => b.verify.kind === 'git-clean'));
  assert.ok(first.beats.some(b => b.winNote?.includes('Set-Content')));
});

test('Beginner live content teaches the promoted features and all four memory notes', () => {
  const text = id => readFileSync(join(root, 'learn/lessons', `${id}.md`), 'utf8');
  for (const feature of ['Ctrl+B', '/btw', '/tasks']) assert.ok(text('b-3').includes(feature), feature);
  for (const feature of ['Restore code', 'Summarize from here', '/branch']) assert.ok(text('b-4').includes(feature), feature);
  for (const note of ['npm run tests', '~/scratch/linkcheck-docs', 'summary at the end', 'linkcheck:']) assert.ok(text('b-5').includes(note), note);
  for (const scope of ['~/.claude/CLAUDE.md', 'CLAUDE.local.md', 'Auto memory']) assert.ok(text('b-5').includes(scope), scope);
  assert.ok(!text('b-1').includes('.practice/version.txt'));
});

test('each reworked Beginner beat fits at 60x20 and 80x24 in Unicode and ASCII', () => {
  for (const unicode of [true, false]) {
    const t = theme({ tty: true, depth: 1, unicode, links: false, win32: !unicode });
    for (const l of beginner) {
      const screens = lessonScreens(l.id, liveCourse);
      for (const step of l.content.steps) for (let n = 0; n < step.beats.length; n++) {
        assert.ok(screens.some(([label]) => label.startsWith(`${l.id} ${step.id}.${n} `)), `${l.id} ${step.id}.${n}`);
      }
      for (const [cols, rows] of [[60, 20], [80, 24]]) for (const [label, state] of screens) {
        const lines = render(state, { cols, rows }, t).map(strip);
        assert.equal(lines.length, rows, label);
        assert.ok(lines.every(line => width(line) < cols), `${label}: line too wide`);
        assert.ok(lines.every(line => line.trim() !== '…' && !(line.endsWith('…') && width(line) === cols - 1)), `${label} ${cols}x${rows}: teaching text cut`);
      }
    }
  }
});

// Every ladder scenario at the actual lesson's Check, with the real
// repository failure. Generic reducer fixtures do not cover these messages.
test('real Beginner failures preserve the title, Goal, whole check message and border at both sizes', async () => {
  const flat = text => text.replace(/[`*]/g, '').replace(/\s+/g, '');
  let covered = 0;
  let expected = 0;
  for (const l of beginner) {
    const { scenarios } = await import(`./ladders/${l.id}.mjs`);
    expected += scenarios.length;
    for (let index = 0; index < l.items.length; index++) {
      const candidates = scenarios.filter(s => s.item === index);
      assert.ok(candidates.length, `${l.id} ${index}: no failure scenarios`);
      for (const sc of candidates) {
        const hint = withRepo(() => repo(), dir => {
          if (sc.files) write(dir, sc.files);
          if (sc.setup) sc.setup(dir, { write, commit });
          if (sc.command) { write(dir, { 'bin/claude': sc.command }); chmodSync(join(dir, 'bin/claude'), 0o755); }
          const previous = process.env.PATH;
          try {
            if (sc.path) process.env.PATH = join(dir, sc.path);
            return lessons[l.id].items[index].check(openRepo(dir));
          } finally { if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous; }
        });
        assert.equal(typeof hint, 'string', `${l.id} ${index}: scenario must fail`);
        const d = driver({ course: liveCourse, saved: { format: 1, welcomed: true, lessons: { ...finishedBefore(l.id, liveCourse), [l.id]: { step: 'C', beat: 0, warm: [] } } } });
        d.key('enter');
        const items = l.items.map((text, i) => ({ index: i, text, pass: i !== index, hint: i === index ? hint : '' }));
        d.send({ type: 'check', lesson: l.id, items }); d.key('r');
        d.send({ type: 'check', lesson: l.id, items, asked: d.state.beat.asked });
        for (let n = 0; n < 8 && rungsOf(d.state)[d.state.beat.rung]?.kind !== 'check'; n++) d.key('h');
        assert.equal(rungsOf(d.state)[d.state.beat.rung]?.kind, 'check', `${l.id} ${index}`);
        covered++;
        const goal = beatOf(d.state).lines.find(line => line.key === 'goal').text;
        for (const unicode of [true, false]) {
          const t = theme({ tty: true, depth: 1, unicode, links: false, win32: !unicode });
          for (const [cols, rows] of [[60, 20], [80, 24]]) {
            const lines = render(d.state, { cols, rows }, t).map(strip);
            const screen = flat(lines.map(line => line.replace(/^\s*[│|]\s*(?:[▌|]\s*)?/, '')).join(''));
            const label = `${l.id} ${index} ${sc.name} ${cols}x${rows}`;
            assert.ok(screen.includes(flat('Check')), `${label}: title gone\n${lines.join('\n')}`);
            assert.ok(screen.includes(flat(goal)), `${label}: Goal gone\n${lines.join('\n')}`);
          assert.ok(screen.includes(flat('The check says:')), `${label}: hint box gone\n${lines.join('\n')}`);
            assert.ok(screen.includes(flat(hint)), `${label}: check message cut\n${lines.join('\n')}`);
            assert.ok(lines.some(line => line.includes(t.glyph.bl)), `${label}: bottom border gone`);
          }
        }
      }
    }
  }
  assert.equal(covered, expected, 'every scenario targets a real item');
});
