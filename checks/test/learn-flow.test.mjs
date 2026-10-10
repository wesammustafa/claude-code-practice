// The learn app's decisions, through its pure reducer: when a step is done,
// what a wrong answer gets, how hints open, how help fades and comes back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hintAvailable, normalize, rungsOf, stepOf, tierOf, tiersOf, watching } from '../../learn/lib/flow.mjs';
import { b1Item, driver } from './learn-drive.mjs';

const at = (step, extra = {}) => {
  const d = driver({ saved: { format: 1, welcomed: true, lessons: { 'b-1': { step, beat: 0, ...extra } } }, ...extra.driver });
  d.key('enter');
  return d;
};
const missing = b1Item(null);
const empty = b1Item('');
const passed = b1Item('2.1.285 (Claude Code)\n');

test('a check step waits, says "not yet" only when something changed, and turns done on a pass', () => {
  const d = at('W3');
  assert.equal(d.state.beat.status, 'opening');
  assert.deepEqual(d.effects.at(-2), { type: 'check', lesson: 'b-1', items: [0], evidence: '.practice/version.txt' });
  d.send({ type: 'check', lesson: 'b-1', items: [missing] });
  assert.equal(d.state.beat.status, 'waiting');
  d.key('enter');
  assert.equal(stepOf(d.state).id, 'W3', 'enter does nothing until the step is done');
  d.send({ type: 'check', lesson: 'b-1', items: [missing] });
  assert.equal(d.state.beat.status, 'waiting', 'the same FAIL as on opening is not "not yet"');
  d.key('r');
  d.send({ type: 'check', lesson: 'b-1', items: [missing] });
  assert.equal(d.state.beat.status, 'fail', 'r asks, so the answer is shown');
  d.send({ type: 'check', lesson: 'b-1', items: [empty] });
  assert.equal(d.state.beat.fail.hint, empty.hint);
  d.send({ type: 'check', lesson: 'b-1', items: [passed], evidence: '2.1.285 (Claude Code)' });
  assert.equal(d.state.beat.status, 'done');
  assert.equal(d.state.beat.evidence, '2.1.285 (Claude Code)');
  assert.equal(watching(d.state), null, 'a done step watches nothing');
  d.key('enter');
  assert.equal(stepOf(d.state).id, 'W4');
});

test('a check that already passes when the step opens counts at once', () => {
  const d = at('Y1', { levels: ['hinted'] });
  d.send({ type: 'check', lesson: 'b-1', items: [passed] });
  assert.equal(d.state.beat.status, 'already');
  const broken = at('W3');
  broken.send({ type: 'check-error', lesson: 'b-1', message: 'it took too long' });
  assert.equal(broken.state.beat.status, 'broken');
});

test('questions: a wrong pick explains, a second reveals; s reveals; a guess is never wrong', () => {
  const d = at('W5');
  d.key('1');
  assert.equal(d.state.beat.status, 'waiting');
  assert.equal(d.state.beat.feedback.kind, 'wrong');
  assert.match(d.state.beat.feedback.because, /header above the prompt/);
  assert.match(d.state.beat.feedback.point, /Login method/);
  d.key('3');
  assert.equal(d.state.beat.status, 'done');
  assert.equal(d.state.beat.revealed, true);
  const s = at('W5');
  s.key('s');
  assert.equal(s.state.beat.revealed, true);
  const other = at('W5');
  other.key('4');
  assert.equal(other.state.beat.status, 'done', '"I saw something different" is never called wrong');
  const stuck = at('W2');
  stuck.key('2');
  assert.equal(stuck.state.beat.status, 'waiting', 'the PATH fix keeps the step open');
  assert.equal(stuck.state.beat.feedback.kind, 'stuck');
  const guess = at('W4');
  guess.key('2');
  assert.equal(guess.state.beat.status, 'done');
  assert.equal(guess.state.progress['b-1'].answers['W4.0'], '**Yes, I trust this folder**');
});

test('a guess revealed later is recalled at its step', () => {
  const d = at('W7');
  d.key('1');
  assert.equal(d.state.beat.status, 'done');
  const y2 = at('Y2', { answers: { 'W7.0': 'Yes, it will ask again' }, levels: ['hinted'] });
  assert.equal(stepOf(y2.state).id, 'Y2');
  assert.equal(y2.state.progress['b-1'].answers['W7.0'], 'Yes, it will ask again');
});

test('typed answers ignore case, spaces and a leading slash; empty enter shows the answer', () => {
  assert.equal(normalize('  /Status '), 'status');
  const d = at('C', { levels: ['hinted', 'challenge'] });
  d.send({ type: 'check', lesson: 'b-1', items: [passed] });
  d.key('enter');
  for (const c of 'STATUS') d.key(c.toLowerCase(), c);
  d.key('enter');
  assert.equal(d.state.beat.status, 'done');
  assert.equal(d.state.beat.feedback.kind, 'right');
  const w = at('C', { levels: ['hinted', 'challenge'] });
  w.send({ type: 'check', lesson: 'b-1', items: [passed] });
  w.key('enter');
  for (const c of '/usage') w.key(c, c);
  w.key('enter');
  assert.match(w.state.beat.feedback.because, /session cost/);
  w.key('enter');
  assert.equal(w.state.beat.revealed, true);
  // q is typed, not quit, while answering.
  const q = at('C', { levels: ['hinted', 'challenge'] });
  q.send({ type: 'check', lesson: 'b-1', items: [passed] });
  q.key('enter');
  const before = q.effects.length;
  q.key('q', 'q');
  assert.equal(q.state.beat.typed, 'q');
  assert.ok(!q.effects.slice(before).some((e) => e.type === 'quit'));
});

test('hints: one rung per press, a 2 second lock, y/n before the exact command, and the skill eases', () => {
  const d = at('W3');
  d.send({ type: 'check', lesson: 'b-1', items: [missing] });
  d.send({ type: 'check', lesson: 'b-1', items: [empty] });
  assert.ok(hintAvailable(d.state));
  const rungs = rungsOf(d.state);
  assert.equal(rungs[0].kind, 'ask');
  assert.match(rungs[0].text, /on its own\?$/, 'the empty-file FAIL gets its own first question');
  assert.equal(rungs.at(-1).kind, 'bottom');
  d.key('h');
  assert.equal(d.state.beat.rung, 0);
  d.send({ type: 'key', name: 'h', wait: 500 });
  assert.equal(d.state.beat.rung, 0, 'h is ignored for 2 seconds after a rung');
  d.send({ type: 'key', name: 'h', wait: 2_100 });
  assert.equal(d.state.beat.rung, 1);
  while (!d.state.beat.confirm) d.send({ type: 'key', name: 'h', wait: 2_100 });
  assert.equal(d.state.beat.rung, rungs.length - 2);
  d.key('n');
  assert.equal(d.state.beat.confirm, false);
  d.send({ type: 'key', name: 'h', wait: 2_100 });
  d.key('y');
  assert.equal(d.state.beat.rung, rungs.length - 1);
  assert.deepEqual(d.state.eased, ['save-version']);
  // Y1 asks for the same skill: it comes back GUIDED, once.
  d.send({ type: 'check', lesson: 'b-1', items: [passed] });
  for (const k of ['enter', '1', 'enter', 'space', 'space', '2', 'enter', 'enter', '1', 'enter', '2', 'enter', 'space']) d.key(k);
  d.send({ type: 'git', paths: [] });
  d.key('enter');
  assert.equal(stepOf(d.state).id, 'Y1');
  assert.equal(tierOf(d.state), 'guided');
  assert.deepEqual(d.state.eased, []);
});

test('hint gates: CHALLENGE opens hints only after a "not yet" or two quiet minutes', () => {
  const d = at('Y4', { levels: ['hinted', 'challenge'] });
  assert.equal(tierOf(d.state), 'challenge');
  d.send({ type: 'git', paths: [] });
  assert.equal(hintAvailable(d.state), false);
  d.send({ type: 'tick', wait: 121_000 });
  assert.equal(d.state.beat.idle, true);
  assert.equal(hintAvailable(d.state), true);
  const f = at('Y4', { levels: ['hinted', 'challenge'] });
  f.key('space');
  f.send({ type: 'git', paths: ['notes.md'] });
  assert.equal(f.state.beat.status, 'fail');
  assert.equal(hintAvailable(f.state), true);
  f.send({ type: 'git', paths: [] });
  assert.equal(f.state.beat.status, 'done');
});

test('a git step with a done-label decides only after the learner says the session ended', () => {
  const d = at('Y4', { levels: ['hinted', 'challenge'] });
  d.send({ type: 'git', paths: [] });
  assert.equal(d.state.beat.status, 'waiting');
  d.key('space');
  assert.deepEqual(d.effects.at(-1), { type: 'git' });
  d.send({ type: 'git', paths: [] });
  assert.equal(d.state.beat.status, 'done');
  const w7 = at('W7', { beat: 2 });
  assert.equal(stepOf(w7.state).id, 'W7');
  w7.send({ type: 'git', paths: [] });
  assert.equal(w7.state.beat.status, 'done', 'without a done-label the clean tree is enough');
});

test('difficulty: the level-up shows once per tier, "less help" hides the commands, g keeps it guided', () => {
  const d = at('W7', { beat: 2, done: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'] });
  d.send({ type: 'git', paths: [] });
  d.key('enter');
  assert.equal(d.state.view, 'levelup');
  assert.equal(d.state.levelTo, 'hinted');
  d.key('enter');
  assert.equal(d.state.view, 'step');
  assert.ok(d.state.progress['b-1'].levels.includes('hinted'));
  d.key('b');
  d.key('enter');
  d.send({ type: 'git', paths: [] });
  d.key('enter');
  assert.equal(d.state.view, 'step', 'not twice');

  const less = driver({ saved: { format: 1, welcomed: true } });
  less.key('down');
  less.key('enter');
  assert.equal(less.state.progress['b-1'].lessHelp, true);
  assert.deepEqual(tiersOf(less.state).slice(0, 7), Array(7).fill('hinted'));
  less.key('space');
  less.key('1');
  less.key('enter');
  assert.equal(stepOf(less.state).id, 'W3');
  assert.deepEqual(rungsOf(less.state).at(-1).lines.map((l) => l.text), ['cd <your practice copy>', 'mkdir -p .practice', 'claude --version > .practice/version.txt']);
  // The safety guess stays.
  less.send({ type: 'check', lesson: 'b-1', items: [passed] });
  less.key('enter');
  assert.equal(stepOf(less.state).beats[less.state.pos.beat].kind, 'predict');

  const g = at('W7', { beat: 2 });
  g.send({ type: 'git', paths: [] });
  g.key('enter');
  g.key('g');
  assert.equal(g.state.progress['b-1'].keepGuided, true);
  assert.equal(tierOf(g.state), 'guided');
});

test('a Codespace is credited for the install steps', () => {
  const d = driver({ saved: { format: 1, welcomed: true }, facts: { codespace: true } });
  d.key('enter');
  assert.equal(d.state.beat.status, 'already');
  d.key('enter');
  assert.equal(d.state.beat.status, 'already');
});

test('resume: the saved step opens; unknown steps and lessons are ignored', () => {
  const d = driver({ saved: { format: 1, welcomed: true, lessons: { 'b-1': { step: 'Y3', beat: 0, done: ['W1', 'ZZ'] } } } });
  assert.equal(d.state.view, 'resume');
  assert.deepEqual(d.state.progress['b-1'].done, ['W1']);
  d.key('enter');
  assert.equal(stepOf(d.state).id, 'Y3');
  const gone = driver({ saved: { format: 1, welcomed: true, lessons: { 'b-1': { step: 'W9' } } } });
  assert.equal(gone.state.view, 'intro');
  const start = driver();
  assert.equal(start.state.view, 'welcome');
});

test('the wrong-window guard: a paste or fast typing shows a toast and does nothing else', () => {
  const d = at('W5');
  const before = d.state.pos;
  d.send({ type: 'paste', text: 'curl -fsSL https://claude.ai/install.sh | bash' });
  assert.equal(d.state.toast.kind, 'stray');
  assert.deepEqual(d.state.pos, before);
  const t = at('W5');
  for (const c of 'clab') t.send({ type: 'key', name: c, ch: c, wait: 100 });
  assert.equal(t.state.toast.kind, 'stray');
  assert.deepEqual(t.state.pos, before, 'the b in a typed command does not go back');
  t.send({ type: 'key', name: 'space', ch: ' ', wait: 100 });
  assert.equal(t.state.beat.answer, null);
});

test('map and check-only mode: a lesson without a content file watches its check', () => {
  const d = driver({ saved: { format: 1, welcomed: true } });
  d.key('m');
  assert.equal(d.state.view, 'map');
  d.key('down');
  d.key('enter');
  assert.equal(d.state.view, 'checkonly');
  assert.equal(d.state.lesson, 'b-2');
  assert.deepEqual(watching(d.state), { check: { lesson: 'b-2', items: null } });
  d.key('r');
  assert.deepEqual(d.effects.at(-1), { type: 'check', lesson: 'b-2', items: null, slow: true });
});

test('review fixes: CHALLENGE hints open after the idle offer', () => {
  const d = at('Y4', { levels: ['hinted', 'challenge'] });
  d.send({ type: 'git', paths: [] });
  d.send({ type: 'tick', wait: 121_000 });
  d.key('h');
  assert.equal(d.state.beat.rung, 0, 'h after the "Stuck?" offer opens the first hint');
});

test('review fixes: an error while a hint is open closes it', () => {
  const d = at('W3');
  d.send({ type: 'check', lesson: 'b-1', items: [missing] });
  d.send({ type: 'check', lesson: 'b-1', items: [empty] });
  d.key('h');
  d.send({ type: 'check-error', lesson: 'b-1', message: 'it took too long' });
  assert.equal(d.state.beat.status, 'broken');
  assert.equal(d.state.beat.rung, -1);
  d.send({ type: 'check', lesson: 'b-1', items: [empty] });
  assert.equal(d.state.beat.status, 'fail', 'a good result clears "broken"');
});

test('review fixes: a saved place past the end of a step opens its first beat', () => {
  const d = driver({ saved: { format: 1, welcomed: true, lessons: { 'b-1': { step: 'W5', beat: 3 } } } });
  assert.equal(d.state.progress['b-1'].beat, 0);
  d.key('enter');
  assert.equal(stepOf(d.state).id, 'W5');
  assert.equal(d.state.pos.beat, 0);
});

test('review fixes: a finished lesson stays finished', () => {
  const done = { format: 1, welcomed: true, lessons: { 'b-1': { complete: true, done: ['W1', 'W2'] } } };
  const d = driver({ saved: done });
  assert.equal(d.state.view, 'map', 'with every lesson in the app done, the app opens on the map');
  assert.equal(d.state.lesson, 'b-2');
  // Playing it again from the map keeps the badge and the ticks.
  d.key('up');
  d.key('enter');
  assert.equal(d.state.view, 'intro');
  d.key('enter');
  assert.equal(d.state.progress['b-1'].complete, true);
  assert.deepEqual(d.state.progress['b-1'].done, ['W1', 'W2']);
});

test('review fixes: a command typed into the app window does nothing', () => {
  const typed = (d, text) => {
    for (const ch of text) d.send({ type: 'key', name: ch === ' ' ? 'space' : ch, ch, wait: 120 });
    d.send({ type: 'flush', wait: 900 });
  };
  const w5 = at('W5');
  typed(w5, '/status');
  assert.equal(w5.state.beat.revealed, false, 'the s in /status does not show the answer');
  assert.equal(w5.state.toast.kind, 'stray');
  const w1 = at('W1');
  typed(w1, 'cd x');
  assert.equal(stepOf(w1.state).id, 'W1', 'the space in "cd x" does not finish the step');
  const lv = at('W7', { beat: 2 });
  lv.send({ type: 'git', paths: [] });
  lv.key('enter');
  assert.equal(lv.state.view, 'levelup');
  typed(lv, 'git status');
  assert.equal(lv.state.progress['b-1'].keepGuided, false, 'the g in git does not keep it guided');
  // A single letter still works, a moment later.
  const one = at('W5');
  one.press('s');
  assert.equal(one.state.beat.revealed, true);
});

test('review fixes: starting over asks first', () => {
  const d = driver({ saved: { format: 1, welcomed: true, lessons: { 'b-1': { step: 'Y3', done: ['W1'] } } } });
  d.key('r');
  assert.equal(d.state.view, 'resume', 'r no longer starts over');
  d.key('x');
  assert.equal(d.state.confirmRestart, true);
  d.key('n');
  assert.deepEqual(d.state.progress['b-1'].done, ['W1']);
  d.key('x');
  d.key('y');
  assert.deepEqual(d.state.progress['b-1'].done, []);
  assert.equal(d.state.view, 'intro');
});

test('review fixes: the y/n prompt closes when the step passes', () => {
  const d = at('W3');
  d.send({ type: 'check', lesson: 'b-1', items: [missing] });
  d.send({ type: 'check', lesson: 'b-1', items: [empty] });
  while (!d.state.beat.confirm) d.send({ type: 'key', name: 'h', ch: 'h', wait: 2_100 }), d.send({ type: 'flush', wait: 400 });
  d.send({ type: 'check', lesson: 'b-1', items: [passed] });
  assert.equal(d.state.beat.confirm, false);
  d.key('enter');
  assert.equal(stepOf(d.state).id, 'W4');
  assert.deepEqual(d.state.eased, [], 'nothing eased: the exact command was never shown');
});

test('review fixes: the status follows the check, with no stale "not yet"', () => {
  const d = at('W3');
  const wrong = b1Item('hello\n');
  d.send({ type: 'check', lesson: 'b-1', items: [missing] });
  d.send({ type: 'check', lesson: 'b-1', items: [empty] });
  d.send({ type: 'check', lesson: 'b-1', items: [missing] });
  assert.equal(d.state.beat.fail.hint, missing.hint, 'back to the first message: the screen says so');
  d.send({ type: 'check', lesson: 'b-1', items: [wrong] });
  assert.equal(d.state.beat.fail.hint, wrong.hint);
  // An error while opening: the first good answer is still the baseline.
  const e = at('W3');
  e.send({ type: 'check-error', lesson: 'b-1', message: 'boom' });
  e.send({ type: 'check', lesson: 'b-1', items: [missing] });
  assert.equal(e.state.beat.status, 'waiting');
});

test('review fixes: a result that misses an item, or leaves a slow one for r, decides nothing', () => {
  const d = at('W3');
  d.send({ type: 'check', lesson: 'b-1', items: [] });
  assert.equal(d.state.beat.status, 'opening');
  d.send({ type: 'check', lesson: 'b-1', items: [{ ...passed, slow: true, pass: false }] });
  assert.equal(d.state.beat.status, 'opening');
  d.key('r');
  assert.equal(d.effects.at(-1).slow, true, 'r runs slow items too');
});

test('review fixes: closing the map the app opened on opens its lesson', () => {
  // Every lesson in the app is done, so the app opens on the map, at the next
  // lesson, which has no content file yet.
  const d = driver({ saved: { format: 1, welcomed: true, lessons: { 'b-1': { complete: true } } } });
  assert.equal(d.state.view, 'map');
  d.key('m');
  assert.equal(d.state.view, 'checkonly');
  assert.equal(d.state.lesson, 'b-2');
});
