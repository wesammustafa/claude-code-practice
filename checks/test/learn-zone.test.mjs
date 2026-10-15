// Scripted learners played through the real Beginner lessons with the
// reducer: whatever they do, the help each step gets stays where the design
// puts it, and the screen claims only the help it gives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C } from '../../learn/lib/copy.mjs';
import { hintAvailable, IDLE_MS, stepOf, stepsOf, tierOf, tiersOf } from '../../learn/lib/flow.mjs';
import { render } from '../../learn/lib/render.mjs';
import { strip } from '../../learn/lib/text.mjs';
import { theme } from '../../learn/lib/theme.mjs';
import { ruleTiers, TIERS } from '../../learn/lib/tiers.mjs';
import { course, driver, failCheck, playUntil } from './learn-drive.mjs';

const contents = course.map((l) => l.content);
const rank = (t) => TIERS.indexOf(t);
// The course plan for the steps of a lesson as they are played: a warm-up
// is always CHALLENGE, every other step gets what `ruleTiers` gives it with
// no third argument.
function plan(s) {
  const idx = course.findIndex((l) => l.id === s.lesson);
  return [...s.progress[s.lesson].warm.map(() => 'challenge'), ...ruleTiers(contents, idx)];
}
const where = (s) => `${s.lesson} ${stepOf(s).id}`;
const onStep = (s) => s.view === 'step' || s.view === 'levelup';

// The driver, with `look(state)` after every event the learner causes.
const watched = (d, look) => ({
  get state() { return d.state; },
  send: (ev) => { const r = d.send(ev); look(d.state); return r; },
  key: (name, ch) => { const r = d.key(name, ch); look(d.state); return r; },
});

// Plays on as playUntil's learner, one action at a time, calling `atBeat(d)`
// once as each beat opens, until `stop(state)` holds.
function play(d, stop, atBeat) {
  const seen = new Set();
  while (!stop(d.state)) {
    const s = d.state;
    const at = s.view === 'step' && `${where(s)}.${s.pos.beat}`;
    if (at && !seen.has(at)) {
      seen.add(at);
      atBeat(d);
      if (stop(d.state)) return;
    }
    playUntil(d, (x) => x !== s);
  }
}
// Climbs to the exact command on the beat on screen, where it has one: at
// CHALLENGE, hints open after a try or two quiet minutes.
function exactCommand(d) {
  if (['done', 'already'].includes(d.state.beat.status)) return false;
  failCheck(d);
  if (!hintAvailable(d.state)) d.send({ type: 'tick', wait: IDLE_MS + 1_000 });
  for (let i = 0; i < 8 && hintAvailable(d.state) && !d.state.beat.confirm; i++) d.key('h');
  if (!d.state.beat.confirm) return false;
  d.key('y');
  return true;
}

// The learners. Each starts afresh and calls `look` after every event.
const finale = (s) => s.lesson === 'b-capstone' && s.view === 'complete';
// Every lesson in order, needing no help.
function inOrder(look) {
  playUntil(watched(driver({ course }), look), finale);
}
// Every lesson in order, climbing to the exact command on every beat of a
// step that isn't GUIDED. Returns the steps where it was shown.
function exactEverywhere(look) {
  const taken = [];
  play(watched(driver({ course }), look), finale, (d) => {
    if (tierOf(d.state) !== 'guided' && exactCommand(d)) taken.push(where(d.state));
  });
  return taken;
}
// b-4 opened from the map with nothing done, played to its end.
function b4FromMap(look) {
  const d = watched(driver({ course, saved: { format: 1, welcomed: true, lessons: {} } }), look);
  d.key('m');
  while (course[d.state.mapCursor].id !== 'b-4') d.key('down');
  d.key('enter');
  assert.deepEqual([d.state.view, d.state.lesson], ['intro', 'b-4']);
  playUntil(d, (s) => s.lesson === 'b-4' && s.view === 'complete');
}

test('in order, with no hints: every tier equals the course plan', () => {
  const met = new Set();
  inOrder((s) => {
    if (!onStep(s)) return;
    assert.deepEqual(tiersOf(s), plan(s), where(s));
    met.add(where(s));
  });
  for (const l of course) for (const step of l.content.steps) assert.ok(met.has(`${l.id} ${step.id}`), `${l.id} ${step.id} was met`);
});

test('in order, taking the exact command on every non-guided step: no step ever gets less help than the plan', () => {
  let easier = 0;
  const taken = exactEverywhere((s) => {
    if (!onStep(s)) return;
    const tiers = tiersOf(s);
    plan(s).forEach((t, i) => {
      assert.ok(rank(tiers[i]) <= rank(t), `${s.lesson} ${stepsOf(s)[i].id} at ${where(s)}: ${tiers[i]}, the plan says ${t}`);
      if (rank(tiers[i]) < rank(t)) easier += 1;
    });
  });
  assert.ok(taken.length > 20, `the exact command was shown ${taken.length} times`);
  assert.ok(easier > 0, 'some step got more help than the plan');
});

test('b-4 opened from the map with nothing done: each step gets a first meeting\'s tier, and the Check is CHALLENGE', () => {
  // A first meeting: a worked example is GUIDED, a turn HINTED, the last turn
  // the app checks CHALLENGE. No step is done, so no b-4 skill was met.
  const first = { W1: 'guided', W2: 'guided', W3: 'guided', W4: 'guided', W5: 'guided', W6: 'guided', W7: 'guided', Y1: 'hinted', Y2: 'hinted', Y3: 'hinted', Y4: 'hinted', Y5: 'challenge', C: 'challenge' };
  const idx = course.findIndex((l) => l.id === 'b-4');
  assert.deepEqual(contents[idx].steps.map((x) => x.id), Object.keys(first));
  assert.deepEqual(ruleTiers(contents, idx, () => false), Object.values(first), 'what ruleTiers gives a first meeting');
  const met = new Set();
  b4FromMap((s) => {
    if (!onStep(s)) return;
    assert.equal(s.lesson, 'b-4');
    const tiers = tiersOf(s);
    stepsOf(s).forEach((step, i) => assert.equal(tiers[i], step.part === 'Warm-up' ? 'challenge' : first[step.id], `${step.id} at ${where(s)}`));
    met.add(stepOf(s).id);
  });
  for (const id of Object.keys(first)) assert.ok(met.has(id), `${id} was met`);
});

// The "more help" line, read off the card as drawn at rest (render has no
// clock) at 80x24, where the line is never dropped.
const FULL = theme({ tty: true, depth: 8, unicode: true, links: false, win32: false });
const flat = (text) => text.replace(/[^A-Za-z0-9]/g, '');
const showsMoreHelp = (s) => flat(render(s, { cols: 80, rows: 24 }, FULL).map(strip).join('')).includes(flat(C.eased));

test('throughout every run: a card with the "more help" line gives one tier more help than it would without the ease', () => {
  const shown = new Set();
  const look = (s) => {
    if (s.view !== 'step' || !showsMoreHelp(s)) return;
    const p = s.progress[s.lesson];
    const { [stepOf(s).id]: _, ...others } = p.easedSteps;
    const without = tiersOf({ ...s, progress: { ...s.progress, [s.lesson]: { ...p, easedSteps: others } } })[s.pos.step];
    assert.equal(rank(tierOf(s)), rank(without) - 1, `${where(s)}: ${tierOf(s)} with the ease, ${without} without`);
    shown.add(where(s));
  };
  inOrder(look);
  b4FromMap(look);
  assert.equal(shown.size, 0, `a learner who needed no help saw the line on ${[...shown].join(', ')}`);
  exactEverywhere(look);
  assert.ok(shown.size > 5, `the line showed on ${[...shown].join(', ')}`);
});
