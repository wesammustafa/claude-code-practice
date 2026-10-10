// Shared by the learn app's tests: lesson 1 driven through the reducer, with
// the check's real FAIL messages, so tests can look at every screen.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCourse } from '../../learn/lib/content.mjs';
import { DEFER_MS, initialState, reduce } from '../../learn/lib/flow.mjs';
import { versionSaved } from '../lessons/b-1.mjs';
import { openRepo } from '../repo.mjs';
import { repo, withRepo, write } from './helpers.mjs';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const course = loadCourse(root);
export const FACTS = { root: '/home/sam/claude-code-practice', name: 'Sam', gitError: null, practiceDir: true, codespace: false, win32: false };

// The b-1 item's real result for a version.txt holding `text` (null: no file).
export function b1Item(text) {
  return withRepo(() => repo(), (dir) => {
    if (text !== null) write(dir, { '.practice/version.txt': text });
    const outcome = versionSaved.check(openRepo(dir));
    return { index: 0, text: versionSaved.text, pass: outcome === true, hint: outcome === true ? '' : outcome.replace(dir, FACTS.root) };
  });
}

export function driver({ saved = null, facts = {} } = {}) {
  let now = 1_000;
  let state = initialState({ course, saved, facts: { ...FACTS, ...facts }, now });
  const effects = [];
  const send = (ev) => {
    now += ev.wait ?? 3_000;
    const r = reduce(state, { now, ...ev });
    state = r.state;
    effects.push(...r.effects);
    return r.effects;
  };
  // A key press as a person makes it: then a pause, so a held letter acts.
  const press = (name, ch, wait) => {
    const out = send({ type: 'key', name, ch: ch ?? (name.length === 1 ? name : name === 'space' ? ' ' : undefined), wait });
    return [...out, ...send({ type: 'flush', wait: DEFER_MS + 50 })];
  };
  const key = (name, ch) => press(name, ch);
  return { send, key, press, effects, get state() { return state; }, get now() { return now; } };
}

// Every screen of lesson 1, in order, as [label, state] pairs.
export function allScreens() {
  const d = driver();
  const out = [];
  const snap = (label) => out.push([label, d.state]);
  const missing = b1Item(null);
  const empty = b1Item('');
  const passed = b1Item('2.1.285 (Claude Code)\n');
  snap('welcome');
  d.key('enter'); snap('intro');
  d.key('enter'); snap('W1');
  d.key('space'); snap('W2');
  d.key('2'); snap('W2 stuck');
  d.key('1'); snap('W2 right');
  d.key('enter'); snap('W3 opening');
  d.send({ type: 'check', lesson: 'b-1', items: [missing] }); snap('W3 waiting');
  d.send({ type: 'check', lesson: 'b-1', items: [empty] }); snap('W3 not yet');
  d.key('h'); snap('W3 hint 1');
  d.key('h'); snap('W3 hint 2');
  d.key('h'); snap('W3 hint 3');
  d.key('h'); snap('W3 confirm');
  d.key('y'); snap('W3 bottom');
  d.key('w'); snap('W3 why');
  d.key('w');
  d.send({ type: 'check', lesson: 'b-1', items: [passed], evidence: '2.1.285 (Claude Code)' }); snap('W3 done');
  d.key('enter'); snap('W4 predict');
  d.key('2'); snap('W4 guessed');
  d.key('enter'); snap('W4 sign in');
  d.key('space'); snap('W4 trust');
  d.key('space'); snap('W5');
  d.key('w'); snap('W5 why');
  d.key('w');
  d.key('1'); snap('W5 wrong');
  d.key('s'); snap('W5 revealed');
  d.key('enter'); snap('W6');
  d.key('enter'); snap('W6 ask');
  d.key('2'); snap('W6 decoy');
  d.key('1'); snap('W6 right');
  d.key('enter'); snap('W7 predict');
  d.key('2'); snap('W7 guessed');
  d.key('enter'); snap('W7 exit');
  d.key('space'); snap('W7 git opening');
  d.send({ type: 'git', paths: ['src/notes.md', 'test/new.test.js', 'a.txt', 'b.txt'] }); snap('W7 git dirty');
  d.send({ type: 'git', paths: [] }); snap('W7 git clean');
  // The bottom rung at W3 eased save-version: Y1 comes back GUIDED, so the
  // level-up waits for Y2.
  d.key('enter'); snap('Y1 eased');
  d.send({ type: 'check', lesson: 'b-1', items: [passed], evidence: '2.1.285 (Claude Code)' }); snap('Y1 already');
  d.key('enter'); snap('level up hinted');
  d.key('enter'); snap('Y2');
  d.key('1'); snap('Y2 option');
  d.key('enter'); snap('Y3');
  d.key('h'); snap('Y3 hint');
  d.key('space'); snap('level up challenge');
  d.key('enter'); snap('Y4 opening');
  d.send({ type: 'git', paths: ['notes.md'] }); snap('Y4 live dirty');
  d.send({ type: 'tick', wait: 121_000 }); snap('Y4 idle');
  d.send({ type: 'git', paths: [] }); snap('Y4 live clean');
  d.send({ type: 'paste', text: 'claude --version' }); snap('Y4 stray');
  d.key('space'); d.send({ type: 'git', paths: ['notes.md'] }); snap('Y4 not yet');
  d.send({ type: 'git', paths: [] }); snap('Y4 done');
  d.key('enter'); d.send({ type: 'check', lesson: 'b-1', items: [passed] }); snap('C check');
  d.key('enter'); for (const c of '/usage') d.key(c, c); snap('C typing');
  d.key('enter'); snap('C wrong');
  d.key('enter'); snap('C revealed');
  d.key('enter'); snap('C self');
  d.key('space'); snap('complete');
  d.key('enter'); snap('next');
  d.key('m'); snap('map');
  d.key('?'); snap('help');
  d.key('?'); d.key('down'); d.key('enter'); snap('check-only');
  d.send({ type: 'check', lesson: 'b-2', items: [{ index: 0, text: 'x', pass: true, hint: '' }, { index: 1, text: 'y', pass: false, hint: 'no' }] }); snap('check-only results');
  d.key('p'); snap('page');
  const r = driver({ saved: { format: 1, welcomed: true, eased: [], lessons: { 'b-1': { step: 'Y3', beat: 0, done: ['W1'] } } } });
  out.push(['resume', r.state]);
  r.key('x');
  out.push(['resume confirm', r.state]);
  r.key('n');
  r.send({ type: 'check-error', lesson: 'b-1', message: 'boom' });
  r.key('enter'); out.push(['Y3 resumed', r.state]);
  const b = driver({ saved: { format: 1, welcomed: true, lessons: { 'b-1': { step: 'W3', beat: 0 } } } });
  b.key('enter'); b.send({ type: 'check-error', lesson: 'b-1', message: 'it took too long' });
  out.push(['W3 broken', b.state]);
  return out;
}
