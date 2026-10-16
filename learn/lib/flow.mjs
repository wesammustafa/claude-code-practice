// Every transition of the app, as a pure function: reduce(state, event)
// returns { state, effects }. Effects ask the wiring in main.mjs to run a
// check, read git status, save progress or quit; their results come back as
// events. Nothing here reads a file, a clock or the terminal.
import { C } from './copy.mjs';
import { effectiveTier, ruleTiers, TIERS } from './tiers.mjs';

export const IDLE_MS = 120_000;
// The longest the reading grace holds ambient motion (motion.mjs).
export const GRACE_MAX_MS = 20_000;
export const HINT_LOCK_MS = 2_000;
export const DEFER_MS = 300;
const SWALLOW_MS = 800;
const TOAST_MS = 5_000;

const clone = (x) => structuredClone(x);
const blankProgress = () => ({ step: null, beat: 0, done: [], answers: {}, levels: [], lessHelp: false, moreHelpAt: null, easedSteps: {}, complete: false, warm: [], recalled: [], stamps: {}, bottomAt: null });
// How many warm-up questions open a lesson that has them.
export const WARMUPS = 2;

export function initialState({ course, saved = null, facts, now = 0 }) {
  const progress = {};
  for (const l of course) {
    const p = saved?.lessons?.[l.id];
    progress[l.id] = { ...blankProgress(), ...(p ?? {}) };
    if (l.content) {
      // Unknown step ids from an older content file start that lesson's place over.
      const pr = progress[l.id];
      pr.warm = pr.warm.filter((id) => l.content.warmup.some((w) => w.id === id));
      pr.recalled = pr.recalled.filter((id) => l.content.warmup.some((w) => w.id === id));
      const steps = playOrder(l.content, pr);
      const ids = new Set(steps.map((s) => s.id));
      pr.done = pr.done.filter((id) => ids.has(id));
      if (!ids.has(pr.moreHelpAt)) pr.moreHelpAt = null;
      const step = steps.find((x) => x.id === pr.step);
      if (!step) Object.assign(pr, { step: null, beat: 0 });
      else if (!(pr.beat >= 0 && pr.beat < step.beats.length)) pr.beat = 0;
    }
  }
  const open = course.find((l) => l.content && progress[l.id].step && !progress[l.id].complete)
    ?? course.find((l) => l.content && !progress[l.id].complete);
  // Every lesson in the app is done: open the map at the next lesson, or
  // where only lessons that run in a new copy are left, at the first of them.
  const next = open ?? course.find((l) => toFinish(progress, l)) ?? course.find((l) => !progress[l.id].complete) ?? course[0];
  const welcomed = Boolean(saved?.welcomed);
  const eased = saved?.eased ?? [];
  // A warm-up the learner quit on with its skill eased was most likely missed
  // just before: its answer was shown, so asking it again recalls nothing.
  const answeredNow = [];
  for (const l of course) {
    const pr = progress[l.id];
    const w = l.content?.warmup.find((x) => x.id === pr.step && pr.warm.includes(x.id));
    if (w && eased.includes(w.beats[pr.beat]?.skill ?? w.skill)) answeredNow.push(`${l.id}.${w.id}`);
  }
  return {
    course, facts, progress, now,
    eased,
    missed: saved?.missed ?? [],
    missedNow: [],
    answeredNow,
    welcomed,
    view: !welcomed ? 'welcome' : !open ? 'map' : progress[open.id].step ? 'resume' : 'intro',
    overlay: null, lesson: next.id, pos: { step: 0, beat: 0 }, beat: null,
    checks: {}, git: null, session: 0, cursor: 0, mapCursor: course.indexOf(next), toast: null,
    held: null, swallowUntil: 0, confirmRestart: false, lastActivity: now,
    // The first card entry the c overlay shows, and the first item the
    // check-only card shows, in memory.
    cardAt: 0, itemsAt: 0,
    // How many times r asked for a run, in memory: each r's number goes out
    // on its effect and comes back on its result (`asked`).
    asks: 0,
    // The motion layer's stamps (stampFx): the first screen appears now.
    fx: { view: now },
  };
}

// ---- lookups -----------------------------------------------------------------
export const lessonOf = (s, id = s.lesson) => s.course.find((l) => l.id === id);
// A lesson's level, from its PATH entry: 'beginner' for b-2.
export const levelOf = (s, id = s.lesson) => lessonOf(s, id)?.level;
// The lessons of a level, in course order, capstone last.
export const levelLessons = (s, level) => s.course.filter((l) => l.level === level);
// The course's levels, in course order.
export const levelsOf = (s) => [...new Set(s.course.map((l) => l.level))];
// A lesson's number within its level, as its page says "Lesson 2 of 8".
export const lessonNumber = (s, id = s.lesson) => levelLessons(s, levelOf(s, id)).findIndex((l) => l.id === id) + 1;
export const contentOf = (s, id = s.lesson) => lessonOf(s, id)?.content;
// A lesson the learner can still finish in this practice copy: not complete,
// and not one that runs in a new copy of the template, whose check never
// runs here. The next lesson the map marks and opens at is one of these.
export const toFinish = (progress, l) => !progress[l.id].complete && !l.newCopy;
// What the check-only card says above a lesson's items.
export const checkOnlyWords = (l) => (l.newCopy ? C.newCopy : C.checkOnly);
// The steps a learner meets, in order: the warm-up questions chosen when the
// lesson started, then the lesson's own steps.
const playOrder = (content, p) => [...p.warm.map((id) => content.warmup.find((w) => w.id === id)).filter(Boolean), ...content.steps];
export const stepsOf = (s, id = s.lesson) => (contentOf(s, id) ? playOrder(contentOf(s, id), s.progress[id]) : []);
export const stepOf = (s) => stepsOf(s)[s.pos.step];
export const beatOf = (s) => stepOf(s).beats[s.pos.beat];

// What this learner did with each skill: `steps` holds "k skill" for each
// lesson k where they finished one of its own steps on it (warm-ups aside),
// `finished` those skills, and `recalled` the skills of the warm-ups they
// answered right the first time, in any lesson.
function history(s) {
  const steps = new Set();
  const finished = new Set();
  const recalled = new Set();
  s.course.forEach((l, k) => {
    if (!l.content) return;
    const p = s.progress[l.id];
    for (const step of l.content.steps) {
      if (!p.done.includes(step.id)) continue;
      steps.add(`${k} ${step.skill}`);
      finished.add(step.skill);
    }
    for (const id of p.recalled) {
      const w = l.content.warmup.find((x) => x.id === id);
      for (const b of w?.beats ?? []) recalled.add(b.skill ?? w.skill);
    }
  });
  return { steps, finished, recalled };
}
// Your card (the c overlay): every lesson's card entries, in course order,
// whose skill the learner finished one of that lesson's own steps on, read
// from done. An entry's pill names its lesson, so only that lesson's steps
// count: a skill an earlier lesson also teaches shows nothing early.
export function cardOf(s) {
  const { steps } = history(s);
  return s.course.flatMap((l, k) => (l.content?.card ?? []).filter((e) => steps.has(`${k} ${e.skill}`)).map((e) => ({ ...e, lesson: l.id })));
}
// The entries the next screen asks the learner to recall: this lesson's own
// on the card.
export const recallOf = (s) => cardOf(s).filter((e) => e.lesson === s.lesson);
// The overlays the arrows scroll, each by its entries: one place an entry,
// then the Commands by level link, the last (render.mjs).
const SCROLLED = { card: cardOf, compare: recallOf };
// Where the next screen's enter goes: the next lesson, or null for the map.
export const nextLessonOf = (s) => {
  const id = contentOf(s)?.next;
  return (id && lessonOf(s, id)) || null;
};
// Whether the learner did what the step on screen asks again: finished a
// step on its skill, in any lesson. A capstone step draws on every lesson
// before it, so there it takes a finished step on every skill they teach.
export function doneBefore(s) {
  const { finished } = history(s);
  if (!s.lesson.endsWith('capstone')) return finished.has(stepOf(s).skill);
  const idx = s.course.findIndex((l) => l.id === s.lesson);
  return s.course.slice(0, idx).every((l) => (l.content?.steps ?? []).every((x) => finished.has(x.skill)));
}

// Each step's tier in play order. A warm-up recalls an earlier lesson from
// memory, so it is always CHALLENGE and counts toward no skill's fading.
// Help fades only for what this learner did: an earlier lesson counts toward
// a skill once they finished a step on it there, and every lesson does once a
// warm-up on it was right the first time. g on a level-up and an ease each
// give a step one tier more help, and together still one.
export function tiersOf(s, id = s.lesson) {
  const contents = s.course.map((l) => l.content);
  const idx = s.course.findIndex((l) => l.id === id);
  const p = s.progress[id];
  const h = history(s);
  const rule = ruleTiers(contents, idx, (k, skill) => h.steps.has(`${k} ${skill}`) || h.recalled.has(skill));
  const steps = stepsOf(s, id);
  const more = moreHelp(p, steps);
  return steps.map((step, i) => {
    if (step.part === 'Warm-up') return 'challenge';
    const t = rule[contents[idx].steps.indexOf(step)];
    return effectiveTier(t, { lessHelp: p.lessHelp, eased: more[i] || Boolean(p.easedSteps[step.id]) });
  });
}
// Which steps g on a level-up gives one tier more help: the step it was
// pressed on and every one after it in play order, but the Check.
function moreHelp(p, steps) {
  const from = steps.findIndex((x) => x.id === p.moreHelpAt);
  return steps.map((step, i) => from !== -1 && i >= from && step.part !== 'Check');
}
// Whether g on the level-up on screen gives any step more help. Not on the
// Check, which stays CHALLENGE, nor after an earlier g, which covers every
// step this one would: so g never moves `moreHelpAt` later and takes back
// help already given.
export function moreHelpGives(s) {
  const p = s.progress[s.lesson];
  const step = stepOf(s);
  const easedSteps = Object.fromEntries(Object.entries(p.easedSteps).filter(([id]) => id !== step.id));
  const after = tiersOf({ ...s, progress: { ...s.progress, [s.lesson]: { ...p, moreHelpAt: step.id, easedSteps } } });
  return tiersOf(s).some((t, i) => TIERS.indexOf(after[i]) < TIERS.indexOf(t));
}
export function authoredTier(s) {
  const step = stepOf(s);
  if (step.part === 'Warm-up') return 'challenge';
  const idx = s.course.findIndex((l) => l.id === s.lesson);
  return ruleTiers(s.course.map((l) => l.content), idx)[contentOf(s).steps.indexOf(step)];
}
export const tierOf = (s) => tiersOf(s)[s.pos.step];

// What the wiring should keep an eye on for the beat on screen.
export function watching(s) {
  // A lesson that runs in a new copy has no check to run here.
  if (s.view === 'checkonly') return lessonOf(s).newCopy ? null : { check: { lesson: s.lesson, items: null } };
  if (s.view !== 'step' || !s.beat) return null;
  if (['done', 'already'].includes(s.beat.status)) return null;
  const v = beatOf(s).verify;
  if (v.kind === 'check') return { check: { lesson: s.lesson, items: v.all ? null : v.items } };
  if (v.kind === 'file') return { file: v.path };
  if (v.kind === 'git-clean') return { git: true };
  return null;
}

// ---- hints -------------------------------------------------------------------
// The status the hints and the key bar answer to: while r's run goes, the one
// r put "Checking" over, so an open hint, h and the keys stay as they were.
export const hintStatus = (st) => (st.status === 'opening' && st.before) || st.status;

// Point, then teach, then the exact command after a y/n: the check's own
// question for its FAIL message first, the lesson's words next, the bottom
// line last.
export function rungsOf(s) {
  const beat = beatOf(s);
  const lesson = contentOf(s);
  const st = s.beat;
  const rungs = [];
  let bottom = [];
  const hideRuns = tierOf(s) !== 'guided' && authoredTier(s) === 'guided';
  const runs = beat.lines.filter((l) => l.key === 'run').map((l) => ({ text: l.text, win: l.win }));
  if (hintStatus(st) === 'fail' && st.fail?.item) {
    const ladder = lesson.ladder.find((l) => l.item === st.fail.item);
    const narrow = ladder?.narrow.find((n) => st.fail.hint.includes(n.part));
    if (narrow) rungs.push({ kind: 'ask', text: narrow.question });
    rungs.push({ kind: 'check', text: st.fail.hint });
    for (const h of ladder?.hints ?? []) rungs.push({ kind: 'quote', text: h });
    bottom = ladder?.bottom ?? [];
  }
  for (const h of beat.hints) rungs.push({ kind: 'quote', text: h });
  if (!bottom.length) bottom = [...(hideRuns ? runs : []), ...beat.bottom];
  if (bottom.length) rungs.push({ kind: 'bottom', lines: bottom });
  return rungs;
}

// What the learner tries before h opens a hint at CHALLENGE: r on a beat the
// app checks, a pick on a question with a wrong answer, or nothing (null)
// where nothing can fail, so h answers at once.
export function tryFirst(s) {
  const beat = beatOf(s);
  if (['check', 'file', 'git-clean'].includes(beat.verify.kind)) return 'r';
  const canMiss = beat.options.some((o) => o.kind === 'wrong' || o.kind === 'decoy');
  return beat.ask && beat.kind !== 'predict' && beat.kind !== 'type' && canMiss ? 'pick' : null;
}

export function hintAvailable(s) {
  if (s.view !== 'step' || !s.beat || ['done', 'already'].includes(s.beat.status)) return false;
  if (beatOf(s).kind === 'type') return false;
  const rungs = rungsOf(s);
  if (!rungs.length || s.beat.rung >= rungs.length - 1) return false;
  // A FAIL, r, a first wrong pick or two quiet minutes set `unlocked`.
  if (tierOf(s) === 'challenge' && tryFirst(s)) return s.beat.unlocked;
  return true;
}

// ---- moving through a lesson -------------------------------------------------
function openBeat(s, effects) {
  const step = stepOf(s);
  const beat = beatOf(s);
  const p = s.progress[s.lesson];
  p.step = step.id;
  p.beat = s.pos.beat;
  markEased(s, s.pos.step);
  s.beat = { status: 'waiting', rung: -1, lockUntil: 0, confirm: false, wrongs: [], answer: null, revealed: false, typed: '', typedWrong: 0, feedback: null, idle: false, unlocked: false, explicit: false, ended: false, opened: s.now, eased: Boolean(p.easedSteps[step.id]) };
  s.lastActivity = s.now;
  // Nothing is picked until the learner picks: an Enter meant for the screen
  // before can't answer a question.
  s.cursor = beat.ask && beat.options.length ? -1 : 0;
  if (beat.codespace && s.facts.codespace) {
    s.beat.status = 'already';
    s.beat.codespace = true;
  } else if (beat.verify.kind === 'check') {
    s.beat.status = 'opening';
    effects.push({ type: 'check', lesson: s.lesson, items: beat.verify.all ? null : beat.verify.items, evidence: beat.evidence ?? null });
  } else if (beat.verify.kind === 'file') {
    s.beat.status = 'opening';
    effects.push({ type: 'file', path: beat.verify.path });
  } else if (beat.verify.kind === 'git-clean') {
    s.beat.status = 'opening';
    effects.push({ type: 'git' });
  }
  effects.push({ type: 'save' });
}

// A fresh check compares its file with how it was when its step opened (or
// the step it names): ask for that file's state now, once.
function stampFresh(s, effects) {
  const step = stepOf(s);
  const stamps = s.progress[s.lesson].stamps;
  for (const other of stepsOf(s)) {
    other.beats.forEach((b, i) => {
      const key = `${other.id}.${i}`;
      if (b.verify.fresh && (b.verify.since ?? other.id) === step.id && !(key in stamps)) effects.push({ type: 'stamp', key, path: b.evidence });
    });
  }
}

// A skill that needed the bottom rung, or a missed warm-up, comes back one
// tier easier, once: at the next step that asks for it where the ease changes
// the help.
function markEased(s, index) {
  const step = stepsOf(s)[index];
  if (!s.eased.includes(step.skill) || !easeLands(s, index)) return;
  s.progress[s.lesson].easedSteps[step.id] = true;
  s.eased = s.eased.filter((k) => k !== step.skill);
}

// Whether an ease waiting on step `index`'s skill would give it more help. Not
// on a warm-up, which is always from memory, a finished step, the rest of the
// step whose bottom rung set it, a step already eased, a step g already gives
// one tier more help, or a GUIDED step, which shows every command anyway:
// there the ease waits for the next step.
export function easeLands(s, index, tiers = tiersOf(s)) {
  const steps = stepsOf(s);
  const step = steps[index];
  const p = s.progress[s.lesson];
  if (step.part === 'Warm-up' || p.done.includes(step.id) || p.bottomAt === step.id || p.easedSteps[step.id]) return false;
  if (moreHelp(p, steps)[index]) return false;
  return tiers[index] !== 'guided';
}

function openStep(s, index, effects) {
  markEased(s, index);
  const tiers = tiersOf(s);
  const steps = stepsOf(s);
  const prev = index > 0 ? tiers[index - 1] : null;
  const p = s.progress[s.lesson];
  s.pos = { step: index, beat: 0 };
  stampFresh(s, effects);
  // Less help than the step before. A level-up says the help stays lower from
  // here on, so it shows only when no later step of the lesson gets more help;
  // a step that is harder on its own gets a line on its card instead.
  const { harder, stays } = climb(s, index, tiers, steps);
  if (harder && stays && !p.levels.includes(tiers[index])) {
    s.view = 'levelup';
    s.levelTo = tiers[index];
    s.levelFrom = prev;
    s.beat = null;
    p.step = stepOf(s).id;
    p.beat = 0;
    effects.push({ type: 'save' });
    return;
  }
  s.view = 'step';
  openBeat(s, effects);
}

// Whether step `index` gives less help than the one before, and whether the
// help stays that low for the rest of the lesson. An ease still pending for a
// later step's skill counts where it will land: that step comes back one tier
// easier.
function climb(s, index, tiers = tiersOf(s), steps = stepsOf(s)) {
  const rank = (t) => TIERS.indexOf(t);
  const prev = index > 0 ? tiers[index - 1] : null;
  const harder = Boolean(prev) && rank(tiers[index]) > rank(prev);
  const pending = new Set(s.eased);
  const stays = steps.slice(index + 1).every((step, k) => {
    if (step.part === 'Warm-up') return true;
    let r = rank(tiers[index + 1 + k]);
    if (pending.has(step.skill) && easeLands(s, index + 1 + k, tiers)) {
      pending.delete(step.skill);
      r -= 1;
    }
    return r >= rank(tiers[index]);
  });
  return { harder, stays };
}

// The line a step that is harder on its own shows instead of a level-up:
// its tier, or null.
export function stepNote(s) {
  if (s.view !== 'step' || !s.beat || stepOf(s).part === 'Warm-up') return null;
  const { harder, stays } = climb(s, s.pos.step);
  return harder && !stays ? tierOf(s) : null;
}

// What the intro's enter clears, so a play starts its help from the plan.
function startPlay(p) {
  p.stamps = {};
  p.bottomAt = null;
  p.easedSteps = {};
  p.recalled = [];
  p.moreHelpAt = null;
}
// The state as the intro's enter will leave the lesson, so the intro shows
// the help the play will give, not the eases and recalls of an earlier play.
export function asStarted(s) {
  const p = { ...s.progress[s.lesson] };
  startPlay(p);
  return { ...s, progress: { ...s.progress, [s.lesson]: p } };
}

export function startLesson(s, id, effects) {
  s.lesson = id;
  s.overlay = null;
  const l = lessonOf(s, id);
  if (!l.content) {
    s.view = 'checkonly';
    s.itemsAt = 0;
    if (!l.newCopy) effects.push({ type: 'check', lesson: id, items: null });
    return;
  }
  const p = s.progress[id];
  const steps = stepsOf(s, id);
  const at = steps.findIndex((x) => x.id === p.step);
  if (at !== -1 && !p.complete) {
    s.pos = { step: at, beat: p.beat >= 0 && p.beat < steps[at].beats.length ? p.beat : 0 };
    s.view = 'step';
    openBeat(s, effects);
  } else {
    s.view = 'intro';
    s.cursor = 0;
  }
}

function finishStep(s, effects) {
  const step = stepOf(s);
  const p = s.progress[s.lesson];
  if (!p.done.includes(step.id)) {
    p.done.push(step.id);
    s.session += 1;
  }
  const steps = stepsOf(s);
  if (s.pos.step + 1 >= steps.length) {
    p.complete = true;
    p.step = null;
    s.view = 'complete';
    s.beat = null;
    effects.push({ type: 'save' });
    return;
  }
  openStep(s, s.pos.step + 1, effects);
}

function advance(s, effects) {
  if (s.pos.beat + 1 < stepOf(s).beats.length) {
    s.pos.beat += 1;
    openBeat(s, effects);
  } else finishStep(s, effects);
}

function back(s, effects) {
  if (s.pos.beat > 0) {
    s.pos.beat -= 1;
    openBeat(s, effects);
  } else if (s.pos.step > 0) {
    s.pos = { step: s.pos.step - 1, beat: stepsOf(s)[s.pos.step - 1].beats.length - 1 };
    s.view = 'step';
    openBeat(s, effects);
  }
}

// Picks the lesson's warm-up questions as it starts: questions on a skill the
// learner missed before come first, then skills whose help hasn't faded for
// them (no step finished on it in an earlier lesson, and not recalled), then
// the rest, each in the file's order. While the pool has other skills, no
// two questions ask the same one.
export function pickWarmups(s, id = s.lesson) {
  const h = history(s);
  const idx = s.course.findIndex((l) => l.id === id);
  const met = (skill) => h.recalled.has(skill) || s.course.some((_, k) => k < idx && h.steps.has(`${k} ${skill}`));
  const rank = (w) => (s.missed.includes(w.skill) ? 0 : met(w.skill) ? 2 : 1);
  const ranked = [...contentOf(s, id).warmup].sort((a, b) => rank(a) - rank(b));
  const picked = [];
  for (const w of ranked) if (picked.length < WARMUPS && !picked.some((x) => x.skill === w.skill)) picked.push(w);
  for (const w of ranked) if (picked.length < WARMUPS && !picked.includes(w)) picked.push(w);
  return picked.map((w) => w.id);
}
function chooseWarmups(s) {
  s.progress[s.lesson].warm = pickWarmups(s);
}

// A question answered wrong, or shown, marks its skill for a warm-up later;
// a warm-up on that skill answered right at once clears the mark, unless it
// was missed again in this sitting. A beat may name the skill it recalls.
// A warm-up is recall from memory, so its first answer in a play also sets
// the help: a miss eases the skill, and a right answer at once cancels a
// waiting ease and joins the lesson's `recalled`, so the skill's help fades
// on the course plan. Asked again (gone back to, or after a quit), it is not.
const skillOf = (s) => beatOf(s).skill ?? stepOf(s).skill;
const warmKey = (s) => `${s.lesson}.${stepOf(s).id}`;
function firstAnswer(s) {
  const p = s.progress[s.lesson];
  if (stepOf(s).part !== 'Warm-up' || s.answeredNow.includes(warmKey(s))) return false;
  // On a first play the done list holds only this play's steps; a lesson
  // played again keeps its old ticks, so there it tells nothing.
  return p.complete || !p.done.includes(stepOf(s).id);
}
function answered(s) {
  if (stepOf(s).part === 'Warm-up' && !s.answeredNow.includes(warmKey(s))) s.answeredNow.push(warmKey(s));
}
function missed(s, effects) {
  const skill = skillOf(s);
  if (!s.missed.includes(skill)) s.missed.push(skill);
  if (firstAnswer(s) && !s.eased.includes(skill)) s.eased.push(skill);
  if (!s.missedNow.includes(skill)) s.missedNow.push(skill);
  answered(s);
  effects.push({ type: 'save' });
}
function recalled(s) {
  const st = s.beat;
  const skill = skillOf(s);
  const first = firstAnswer(s);
  answered(s);
  if (!first || st.wrongs.length || st.typedWrong || s.missedNow.includes(skill)) return;
  s.missed = s.missed.filter((k) => k !== skill);
  s.eased = s.eased.filter((k) => k !== skill);
  const p = s.progress[s.lesson];
  if (!p.recalled.includes(stepOf(s).id)) p.recalled.push(stepOf(s).id);
}

// ---- questions ---------------------------------------------------------------
export const answerKey = (s) => `${stepOf(s).id}.${s.pos.beat}`;
const questionOf = (beat) => (beat.ask ? beat : null);

function pick(s, index, effects) {
  const beat = beatOf(s);
  const st = s.beat;
  const opt = beat.options[index];
  if (!opt || st.answer) return;
  const p = s.progress[s.lesson];
  if (beat.kind === 'predict') {
    st.answer = { index, kind: opt.kind };
    p.answers[answerKey(s)] = opt.text;
    st.status = 'done';
    effects.push({ type: 'save' });
    return;
  }
  if (opt.kind === 'right' || opt.kind === 'option' || opt.kind === 'other') {
    st.answer = { index, kind: opt.kind };
    st.feedback = opt.kind === 'right' ? { kind: 'right' } : { kind: opt.kind, because: opt.because };
    st.status = 'done';
    if (opt.kind === 'right') recalled(s);
    effects.push({ type: 'save' });
    return;
  }
  // Saying it went wrong is a try too, so hints may open.
  if (opt.kind === 'stuck') {
    st.feedback = { kind: 'stuck', because: opt.because };
    st.unlocked = true;
    return;
  }
  // A wrong pick or a decoy: explain once, reveal on the second. It is a
  // try, so hints may open.
  if (!st.wrongs.includes(index)) st.wrongs.push(index);
  st.unlocked = true;
  missed(s, effects);
  if (st.wrongs.length >= 2) return reveal(s, effects);
  st.feedback = { kind: 'wrong', because: opt.because, point: beat.point };
}

function reveal(s, effects) {
  const beat = beatOf(s);
  const st = s.beat;
  st.revealed = true;
  missed(s, effects);
  st.answer = { index: beat.options.findIndex((o) => o.kind === 'right'), kind: 'revealed' };
  st.feedback = { kind: 'revealed' };
  st.status = 'done';
  effects.push({ type: 'save' });
}

// Case, spaces, a leading slash and the + or - between keys don't matter, and
// Escape is Esc.
export const normalize = (text) => text.trim().toLowerCase().replace(/[+\-\s]+/g, '').replace(/^\//, '').replace(/^escape$/, 'esc');

function submitTyped(s, effects) {
  const beat = beatOf(s);
  const st = s.beat;
  const typed = normalize(st.typed);
  if (!typed) return reveal(s, effects);
  if (beat.accept.some((a) => normalize(a) === typed)) {
    st.status = 'done';
    st.feedback = { kind: 'right' };
    recalled(s);
    effects.push({ type: 'save' });
    return;
  }
  st.typedWrong += 1;
  missed(s, effects);
  if (st.typedWrong >= 2) return reveal(s, effects);
  const known = beat.options.find((o) => o.kind === 'wrong' && normalize(o.text) === typed);
  st.feedback = known ? { kind: 'wrong', because: known.because } : { kind: 'wrong', hint: beat.hints[0] };
  st.typed = '';
}

// ---- checks and git ----------------------------------------------------------
const RESULTS = ['check', 'check-error', 'file', 'git', 'git-error'];

function onCheck(s, ev, effects, rRuns) {
  s.checks[ev.lesson] = { items: keptSlow(s, ev), evidence: ev.evidence ?? null, error: null };
  checkOnlyDone(s, ev, effects);
  if (rRuns || s.view !== 'step' || ev.lesson !== s.lesson || !s.beat) return;
  const beat = beatOf(s);
  if (beat.verify.kind !== 'check') return;
  const st = s.beat;
  if (['done', 'already'].includes(st.status)) return;
  const indexes = beat.verify.all ? lessonOf(s).items.map((_, i) => i) : beat.verify.items;
  const wanted = indexes.map((i) => ev.items.find((it) => it.index === i));
  // A result that doesn't cover every item decides nothing.
  if (wanted.some((it) => !it)) return;
  const failing = wanted.find((it) => !it.slow && !it.pass);
  // Everything else passes, and a slow item waits for r: say so, in place of
  // any message about the items that pass now. A FAIL about a slow item stays
  // with its hints: a run without that item can't tell whether it passes now.
  if (!failing && wanted.some((it) => it.slow)) {
    if (st.status === 'fail' && wanted.some((it) => it.slow && it.text === st.fail?.item)) {
      st.slowWait = true;
      return;
    }
    if (st.baseline === undefined) st.baseline = null;
    Object.assign(st, { status: 'waiting', slowWait: true, fail: null, error: null, rung: -1, confirm: false, explicit: false });
    return;
  }
  st.slowWait = false;
  decide(s, ev, effects, failing && { item: failing.text, hint: failing.hint });
}

// On a lesson with no lesson file, a slow item a run left out keeps what the
// last run that had it found, so a poll changes no row of its card.
function keptSlow(s, ev) {
  if (lessonOf(s, ev.lesson)?.content) return ev.items;
  const before = s.checks[ev.lesson]?.items ?? [];
  return ev.items.map((it) => (it.slow ? before.find((b) => b.index === it.index && !b.slow) ?? it : it));
}

// A lesson with no lesson file is complete once a full check passes: every
// item passed, slow ones too (r runs those; a run that left one out marks it
// not passing). It stays complete.
function checkOnlyDone(s, ev, effects) {
  const l = lessonOf(s, ev.lesson);
  const p = s.progress[ev.lesson];
  if (!l || l.content || p.complete) return;
  if (!l.items.every((_, i) => ev.items.some((it) => it.index === i && it.pass))) return;
  p.complete = true;
  effects.push({ type: 'save' });
}

// A file no check item covers: done once it holds a line.
function onFile(s, ev, effects, rRuns) {
  if (rRuns || s.view !== 'step' || !s.beat) return;
  const v = beatOf(s).verify;
  if (v.kind !== 'file' || ev.path !== v.path || ['done', 'already'].includes(s.beat.status)) return;
  // A list shows its first line and how many more, so a short list shows.
  const more = (ev.lines ?? 1) - 1;
  decide(s, { ...ev, evidence: ev.line && more > 0 ? C.andMore(ev.line, more) : ev.line }, effects, ev.line ? null : { hint: C.fileEmpty(ev.path) });
}

// Turns a result into the beat's status. `failing` is null when it passes.
function decide(s, ev, effects, failing) {
  const beat = beatOf(s);
  const st = s.beat;
  // A fresh check also needs its evidence file to have changed since its
  // step opened; a result about another file decides nothing.
  let stale = false;
  if (beat.verify.fresh) {
    // null: the file couldn't be read just now, so nothing is known yet.
    if (ev.path !== beat.evidence || ev.stamp === null) return;
    const stamps = s.progress[s.lesson].stamps;
    const key = answerKey(s);
    if (!(key in stamps)) {
      stamps[key] = ev.stamp ?? '';
      effects.push({ type: 'save' });
    }
    stale = (ev.stamp ?? '') === stamps[key];
  }
  const explicit = st.explicit;
  st.explicit = false;
  st.error = null;
  if (!failing && stale) {
    if (st.baseline === undefined) st.baseline = null;
    st.status = 'waiting';
    st.stale = true;
    return;
  }
  st.stale = false;
  if (!failing) {
    st.status = st.baseline === undefined ? 'already' : 'done';
    st.evidence = ev.evidence ?? null;
    st.feedback = null;
    st.rung = -1;
    st.confirm = false;
    effects.push({ type: 'save' });
    return;
  }
  // The first answer is what the learner starts from: no "not yet" for it.
  if (st.baseline === undefined) {
    st.baseline = failing.hint;
    if (!explicit) {
      st.status = 'waiting';
      return;
    }
  }
  // Once a fail is on screen it follows the check; before that, a fail that
  // only repeats the first answer means nothing changed yet.
  if (st.status === 'fail' || failing.hint !== st.baseline || explicit) {
    if (st.fail?.hint !== failing.hint) {
      st.rung = -1;
      st.confirm = false;
    }
    st.status = 'fail';
    st.fail = failing;
    st.unlocked = true;
    st.idle = false;
    s.lastActivity = s.now;
  } else st.status = 'waiting';
}

function onGit(s, ev, effects, rRuns) {
  s.git = { paths: ev.paths, error: null };
  if (rRuns || s.view !== 'step' || !s.beat || beatOf(s).verify.kind !== 'git-clean') return;
  const beat = beatOf(s);
  const st = s.beat;
  if (['done', 'already'].includes(st.status)) return;
  const clean = ev.paths.length === 0;
  // With a done-label, the tree decides only after the learner says the
  // session has ended; before that it is shown live.
  if (beat.doneLabel && !st.ended) {
    if (st.status === 'opening') st.status = 'waiting';
    return;
  }
  st.error = null;
  if (clean) {
    st.status = 'done';
    st.rung = -1;
    st.confirm = false;
    effects.push({ type: 'save' });
    return;
  }
  st.status = 'fail';
  st.unlocked = true;
  st.fail = { paths: ev.paths };
  st.explicit = false;
}

// ---- the reducer -------------------------------------------------------------
export function reduce(prev, ev) {
  const s = clone({ ...prev, course: null });
  s.course = prev.course;
  const effects = [];
  if (ev.now !== undefined) s.now = ev.now;
  if (s.toast && s.now >= s.toast.until) s.toast = null;
  // r's run goes until its own result lands: the one that carries the latest
  // r's number, wherever the learner is by then. A poll's result, or an
  // earlier r's, that lands first decides nothing for the beat.
  const result = RESULTS.includes(ev.type);
  if (result && s.beat?.asked && ev.asked === s.beat.asked) s.beat.asked = 0;
  const rRuns = result && Boolean(s.beat?.asked);
  // One check child runs at a time, so its result means the run that
  // reported has ended: the count goes with it.
  if ((ev.type === 'check' || ev.type === 'check-error') && s.beat?.running) s.beat.running = null;
  switch (ev.type) {
    case 'check':
      onCheck(s, ev, effects, rRuns);
      break;
    case 'running': {
      // The check child starts its nth item of m. Only the run the card says
      // "Checking" for counts: this beat's check (its lesson and its items,
      // so a run the beat before asked for, still going, is not it), asked
      // by the latest r, or by the beat opening when no r is out.
      const w = watching(s)?.check;
      if (s.beat?.status === 'opening' && (ev.asked ?? 0) === (s.beat.asked || 0) && w?.lesson === ev.lesson && sameJson(ev.items ?? null, w.items)) s.beat.running = { n: ev.n, m: ev.m };
      break;
    }
    case 'check-error':
      s.checks[ev.lesson] = { ...(s.checks[ev.lesson] ?? {}), error: ev.message };
      if (!rRuns && s.view === 'step' && s.beat && beatOf(s).verify.kind === 'check' && !['done', 'already'].includes(s.beat.status)) {
        Object.assign(s.beat, { status: 'broken', error: ev.message, rung: -1, confirm: false });
      }
      break;
    case 'git':
      onGit(s, ev, effects, rRuns);
      break;
    case 'file':
      onFile(s, ev, effects, rRuns);
      break;
    case 'stamp': {
      const stamps = s.progress[s.lesson]?.stamps;
      if (stamps && !(ev.key in stamps) && ev.stamp !== null) {
        stamps[ev.key] = ev.stamp ?? '';
        effects.push({ type: 'save' });
      }
      break;
    }
    case 'git-error':
      s.git = { paths: [], error: ev.message };
      if (!rRuns && s.view === 'step' && s.beat && beatOf(s).verify.kind === 'git-clean' && !['done', 'already'].includes(s.beat.status)) {
        Object.assign(s.beat, { status: 'broken', error: ev.message, rung: -1, confirm: false });
      }
      break;
    case 'tick':
    case 'flush':
      // A held letter with nothing typed after it is a key press after all.
      if (s.held && s.now - s.held.at >= DEFER_MS) {
        const held = s.held;
        s.held = null;
        onKey(s, held, effects);
      }
      if (ev.type === 'tick' && s.view === 'step' && s.beat && !['done', 'already'].includes(s.beat.status) && s.now - s.lastActivity >= IDLE_MS) {
        s.beat.idle = true;
        s.beat.unlocked = true;
      }
      break;
    case 'facts':
      Object.assign(s.facts, ev.facts);
      break;
    case 'notice':
      s.toast = { kind: ev.kind, message: ev.message, until: s.now + TOAST_MS * 2 };
      break;
    case 'activity':
      // A file changed or git moved: the learner is working, so no "stuck?" offer.
      s.lastActivity = s.now;
      if (s.beat) s.beat.idle = false;
      break;
    case 'paste':
      if (s.view === 'step' && s.beat && beatOf(s).kind === 'type' && s.beat.status !== 'done') {
        s.beat.typed = (s.beat.typed + ev.text.replace(/[\r\n].*$/s, '')).slice(0, 40);
      } else onPaste(s);
      break;
    case 'key':
      s.lastActivity = s.now;
      if (s.beat) s.beat.idle = false;
      guardKey(s, ev, effects);
      break;
    default:
      break;
  }
  stampFx(prev, s, ev);
  return { state: s, effects };
}

// When the screen changed, and how, for the motion layer (motion.mjs). Each
// stamp is the event's own `now`; `s.fx` lives in memory and is never saved.
export const isDone = (st) => ['done', 'already'].includes(st?.status);
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function stampFx(prev, s, ev) {
  const fx = s.fx;
  const t = s.now;
  if (ev.type === 'key' || ev.type === 'paste') fx.key = t;
  if (ev.type === 'run-start') fx.run = t;
  if (s.view !== prev.view) fx.view = t;
  const st = s.beat;
  const was = prev.beat;
  const opened = Boolean(st) && (!was || st.opened !== was.opened || s.lesson !== prev.lesson || !sameJson(s.pos, prev.pos));
  if (opened) fx.open = t;
  if (st?.status === 'opening' && (opened || was.status !== 'opening')) fx.check = t;
  // New text on the same card: a "Not yet" line, a rung, feedback, a reveal.
  if (st && was && !opened && s.view === prev.view) {
    const notYet = st.status === 'fail' && (was.status !== 'fail' || !sameJson(st.fail, was.fail));
    const rung = st.rung >= 0 && st.rung !== was.rung;
    const feedback = Boolean(st.feedback) && !sameJson(st.feedback, was.feedback);
    if (notYet || rung || feedback || (st.revealed && !was.revealed)) fx.text = t;
    if (isDone(st) && !isDone(was)) {
      // A pass: the beat on screen turned done by a result or a right
      // answer, not by a guess or a shown answer.
      if (!st.revealed && beatOf(s).kind !== 'predict') fx.pass = t;
      // `passLast`: the step's last beat turned done, by any route. The step
      // is done all the same, so it cheers all the same.
      if (s.pos.beat === stepOf(s).beats.length - 1) fx.passLast = t;
    }
  }
  // A look: a result for what the screen watched, and whether it differs
  // from the last one. A new thing to watch starts the comparison over,
  // after the look that ended the old one.
  const w = watching(prev);
  const looked = (ev.type === 'check' && w?.check?.lesson === ev.lesson) || (ev.type === 'file' && w?.file === ev.path) || (ev.type === 'git' && w?.git);
  if (looked) {
    const seen = JSON.stringify(ev.type === 'check' ? [ev.items, ev.evidence ?? null] : ev.type === 'file' ? [ev.line, ev.lines] : ev.paths);
    fx.changed = fx.seen !== undefined && fx.seen !== seen;
    if (fx.changed) fx.changedAt = t;
    fx.seen = seen;
    fx.look = t;
  }
  if (!sameJson(w, watching(s))) delete fx.seen;
  if (ev.type === 'activity' && w) fx.activity = t;
  // On the check-only card, the items a result finds passing that the
  // result before it, for the same lesson, found not passing or left out.
  if (ev.type === 'check' && s.view === 'checkonly' && ev.lesson === s.lesson) {
    const before = prev.checks[ev.lesson]?.items ?? [];
    const started = s.checks[ev.lesson].items.filter((it) => it.pass && before.some((b) => b.index === it.index && !b.pass)).map((it) => it.index);
    if (started.length) Object.assign(fx, { itemPass: t, itemsPassed: started });
  }
  // The looks the look marker counts (motion.mjs): `from`, the newest stamp
  // that can hold it back or start it again (the stamps quietFrom and
  // sweepFrom read there); how many came since; and the times of those in
  // the 20 s after it, as long as that hold can last.
  const from = Math.max(...['key', 'view', 'open', 'text', 'activity', 'changedAt'].map((k) => fx[k] ?? -Infinity));
  if (fx.looks?.from !== from) fx.looks = { from, n: 0, early: [] };
  if (looked) {
    fx.looks.n += 1;
    if (t - from <= GRACE_MAX_MS) fx.looks.early.push(t);
  }
}

function onPaste(s) {
  s.held = null;
  s.toast = { kind: 'stray', until: s.now + TOAST_MS };
}

const DIGIT = /^[1-9]$/;
const typingAnswer = (s) => s.view === 'step' && s.beat && beatOf(s).kind === 'type' && s.beat.status !== 'done';
const letter = (ev) => Boolean(ev.ch) && /^[\x21-\x7e]$/.test(ev.ch) && !DIGIT.test(ev.ch);

// A command typed into this window instead of the other one must not act:
// its first letter could go back (b), quit (q), or reveal an answer (s), and
// a space could finish a step. So a letter waits DEFER_MS before it acts; a
// second letter or a space inside that time means typing, and every key is
// swallowed until the typing stops.
function guardKey(s, ev, effects) {
  if (ev.name === 'ctrl-c') return effects.push({ type: 'quit' });
  // The comparison's enter goes on, as the next screen's does, so its keys
  // keep the guard.
  if (typingAnswer(s) || (s.overlay && s.overlay !== 'compare')) {
    s.held = null;
    return onKey(s, ev, effects);
  }
  if (s.now < s.swallowUntil) {
    s.swallowUntil = s.now + SWALLOW_MS;
    return;
  }
  if (s.held) {
    if (s.now - s.held.at < DEFER_MS && (letter(ev) || ev.name === 'space' || ev.name === 'enter')) {
      s.held = null;
      s.swallowUntil = s.now + SWALLOW_MS;
      s.toast = { kind: 'stray', until: s.now + TOAST_MS };
      return;
    }
    const held = s.held;
    s.held = null;
    onKey(s, held, effects);
  }
  if (letter(ev)) {
    s.held = { ...ev, at: s.now };
    effects.push({ type: 'later', ms: DEFER_MS + 30 });
    return;
  }
  onKey(s, ev, effects);
}

function onKey(s, ev, effects) {
  const { name, ch } = ev;
  // Typing an answer: every printable key is input.
  if (typingAnswer(s) && !s.overlay) {
    if (name === 'enter') return submitTyped(s, effects);
    if (name === 'backspace') s.beat.typed = s.beat.typed.slice(0, -1);
    else if (name === 'escape') s.beat.typed = '';
    else if (ch && ch >= ' ' && s.beat.typed.length < 40) s.beat.typed += ch;
    return;
  }
  if (s.overlay) {
    // Enter never waits for the comparison: it goes on, as the next screen's.
    if (s.overlay === 'compare' && name === 'enter') {
      s.overlay = null;
      return VIEWS.next(s, ev, effects);
    }
    if (['escape', 'enter', 'q', '?', 'p', 'w', 'c'].includes(name) || (s.overlay === 'compare' && name === 'space')) s.overlay = null;
    // The arrows: one place a press.
    else if (SCROLLED[s.overlay] && (name === 'up' || name === 'down')) s.cardAt = Math.max(0, Math.min(SCROLLED[s.overlay](s).length, s.cardAt + (name === 'down' ? 1 : -1)));
    return;
  }
  if (name === 'q') return effects.push({ type: 'quit' });
  if (name === '?') {
    s.overlay = 'help';
    return;
  }
  if (name === 'p' && s.view !== 'welcome') {
    s.overlay = 'page';
    return;
  }
  if (name === 'c' && s.view !== 'welcome') {
    s.overlay = 'card';
    s.cardAt = 0;
    return;
  }
  if (name === 'm' && s.view !== 'welcome') {
    if (s.view === 'map') return closeMap(s, effects);
    s.mapReturn = s.view;
    s.view = 'map';
    s.mapCursor = Math.max(0, s.course.findIndex((l) => l.id === s.lesson));
    return;
  }
  VIEWS[s.view]?.(s, ev, effects);
}

function closeMap(s, effects) {
  // The map the app opened on has no screen behind it: open its lesson.
  if (!s.mapReturn) return startLesson(s, s.lesson, effects);
  s.view = s.mapReturn;
  if (s.view === 'step' && s.beat) {
    // Re-run what the beat waits on: files may have changed meanwhile.
    const w = watching(s);
    if (w?.check) effects.push({ type: 'check', lesson: w.check.lesson, items: w.check.items, evidence: beatOf(s).evidence ?? null });
    if (w?.file) effects.push({ type: 'file', path: w.file });
    if (w?.git) effects.push({ type: 'git' });
  }
}

const VIEWS = {
  welcome(s, { name }, effects) {
    if (name !== 'enter') return false;
    s.welcomed = true;
    s.view = 'intro';
    s.cursor = 0;
    effects.push({ type: 'save' });
    return true;
  },
  resume(s, { name }, effects) {
    if (s.confirmRestart) {
      if (name === 'y') {
        s.progress[s.lesson] = blankProgress();
        s.view = 'intro';
        s.cursor = 0;
        effects.push({ type: 'save' });
      }
      s.confirmRestart = false;
      return true;
    }
    if (name === 'enter') return startLesson(s, s.lesson, effects), true;
    if (name === 'x') {
      s.confirmRestart = true;
      return true;
    }
    return false;
  },
  intro(s, { name, ch }, effects) {
    if (name === 'up' || name === 'down') s.cursor = s.cursor ? 0 : 1;
    else if (DIGIT.test(ch ?? '') && Number(ch) <= 2) s.cursor = Number(ch) - 1;
    else if (name === 'enter') {
      // A finished lesson played again keeps its badge and its ticks, but
      // every fresh check waits for new work and the help starts from the plan.
      const p = s.progress[s.lesson];
      p.lessHelp = s.cursor === 1;
      startPlay(p);
      s.answeredNow = s.answeredNow.filter((k) => !k.startsWith(`${s.lesson}.`));
      chooseWarmups(s);
      openStep(s, 0, effects);
    } else return false;
    return true;
  },
  levelup(s, { name }, effects) {
    const p = s.progress[s.lesson];
    if (name === 'enter' || name === 'g') {
      if (!p.levels.includes(s.levelTo)) p.levels.push(s.levelTo);
      // g where it gives nothing goes on like enter.
      if (name === 'g' && moreHelpGives(s)) {
        const step = stepOf(s);
        p.moreHelpAt = step.id;
        // g gives this step the help an ease that landed here gave, so the
        // ease waits for a later step.
        if (p.easedSteps[step.id]) {
          delete p.easedSteps[step.id];
          if (!s.eased.includes(step.skill)) s.eased.push(step.skill);
        }
      }
      s.view = 'step';
      openBeat(s, effects);
      return true;
    }
    if (name === 'b') {
      back(s, effects);
      return true;
    }
    return false;
  },
  step(s, ev, effects) {
    const { name, ch } = ev;
    const beat = beatOf(s);
    const st = s.beat;
    const done = ['done', 'already'].includes(st.status);
    if (done && name === 'enter') return advance(s, effects), true;
    // The y/n before the exact command.
    if (st.confirm && !done) {
      if (name === 'y' || name === 'enter') {
        st.confirm = false;
        st.rung = rungsOf(s).length - 1;
        st.lockUntil = s.now + HINT_LOCK_MS;
        if (!s.eased.includes(stepOf(s).skill)) s.eased.push(stepOf(s).skill);
        s.progress[s.lesson].bottomAt = stepOf(s).id;
        effects.push({ type: 'save' });
      } else if (name === 'n' || name === 'escape') st.confirm = false;
      else return false;
      return true;
    }
    if (name === 'b') return back(s, effects), true;
    if (name === 'w' && beat.why.length) {
      s.overlay = 'why';
      return true;
    }
    if (name === 'r') {
      const w = watching(s);
      if (!w) return false;
      st.explicit = true;
      // Asking for a check is a try, whatever the check says.
      st.unlocked = true;
      if (w.git && beat.doneLabel) st.ended = st.ended || st.status === 'fail';
      // Show that r's run is going, until its own result lands: r's number
      // goes out on the effect and comes back on the result. `before` keeps
      // the status "Checking" covers, for the hints and the key bar.
      s.asks += 1;
      Object.assign(st, { status: 'opening', slowWait: false, asked: s.asks, running: null, before: st.status === 'opening' ? st.before : st.status });
      if (w.check) effects.push({ type: 'check', lesson: w.check.lesson, items: w.check.items, evidence: beat.evidence ?? null, slow: true, asked: s.asks });
      if (w.file) effects.push({ type: 'file', path: w.file, asked: s.asks });
      if (w.git) effects.push({ type: 'git', asked: s.asks });
      return true;
    }
    // At CHALLENGE, hints wait for a first try: name it instead of ignoring h.
    if (name === 'h' && !hintAvailable(s) && tierOf(s) === 'challenge' && !done && tryFirst(s) && !st.unlocked && rungsOf(s).length) {
      s.toast = { kind: 'hintsLater', try: tryFirst(s), until: s.now + TOAST_MS };
      return true;
    }
    if (name === 'h' && hintAvailable(s)) {
      if (s.now < st.lockUntil) return true;
      const rungs = rungsOf(s);
      if (st.rung + 1 === rungs.length - 1 && rungs.at(-1).kind === 'bottom') st.confirm = true;
      else {
        st.rung += 1;
        st.lockUntil = s.now + HINT_LOCK_MS;
      }
      return true;
    }
    if (done) return false;
    const q = questionOf(beat);
    if (q && !st.answer) {
      const n = beat.options.length;
      if (name === 'up') s.cursor = s.cursor < 0 ? n - 1 : (s.cursor + n - 1) % n;
      else if (name === 'down') s.cursor = (s.cursor + 1) % n;
      else if (name === 'enter' && s.cursor < 0) s.toast = { kind: 'pickFirst', until: s.now + TOAST_MS };
      else if (DIGIT.test(ch ?? '') && Number(ch) <= n) pick(s, Number(ch) - 1, effects), (s.cursor = Number(ch) - 1);
      else if (name === 'enter') pick(s, s.cursor, effects);
      else if (name === 's' && beat.kind !== 'predict' && beat.options.some((o) => o.kind === 'right')) reveal(s, effects);
      else return false;
      return true;
    }
    // Self, none and "the session has ended" beats.
    const v = beat.verify.kind;
    if ((name === 'space' || name === 'enter') && (v === 'self' || v === 'none' || beat.kind === 'self')) {
      st.status = 'done';
      advance(s, effects);
      return true;
    }
    if ((name === 'space' || name === 'enter') && v === 'git-clean' && beat.doneLabel) {
      st.ended = true;
      st.explicit = true;
      effects.push({ type: 'git' });
      return true;
    }
    return false;
  },
  complete(s, { name }) {
    if (name !== 'enter') return false;
    s.view = 'next';
    return true;
  },
  next(s, { name }, effects) {
    // Recall, then compare: space shows the lesson's card entries.
    if (name === 'space' && recallOf(s).length) {
      s.overlay = 'compare';
      s.cardAt = 0;
      return true;
    }
    if (name !== 'enter') return false;
    const next = nextLessonOf(s);
    if (next) startLesson(s, next.id, effects);
    else s.view = 'map';
    return true;
  },
  // The map shows the level of the lesson under the cursor: up and down
  // move within it, so the cursor is always on a row the map draws; left
  // and right go to the level before or after, round from the last to the
  // first as up and down go round a level, at its next lesson. So each
  // level's first lesson is two keys from Beginner's page.
  map(s, { name }, effects) {
    const at = s.course[s.mapCursor];
    const here = levelLessons(s, levelOf(s, at.id));
    const levels = levelsOf(s);
    const i = here.indexOf(at);
    const to = (l) => (s.mapCursor = s.course.indexOf(l));
    if (name === 'up') to(here[(i + here.length - 1) % here.length]);
    else if (name === 'down') to(here[(i + 1) % here.length]);
    else if (name === 'left' || name === 'right') {
      const level = levels[(levels.indexOf(levelOf(s, at.id)) + (name === 'left' ? levels.length - 1 : 1)) % levels.length];
      const lessons = levelLessons(s, level);
      to(lessons.find((l) => toFinish(s.progress, l)) ?? lessons[0]);
    } else if (name === 'enter') startLesson(s, at.id, effects);
    else return false;
    return true;
  },
  checkonly(s, { name, itemsMax }, effects) {
    // The arrows: one item a press, no further than the card can scroll at
    // the window's size, which main sends with the key (render's itemsMax):
    // where every item fits, they move nothing.
    if (name === 'up' || name === 'down') {
      const max = itemsMax ?? lessonOf(s).items.length - 1;
      s.itemsAt = Math.max(0, Math.min(max, Math.min(s.itemsAt, max) + (name === 'down' ? 1 : -1)));
      return true;
    }
    if (name === 'r' && watching(s)) {
      effects.push({ type: 'check', lesson: s.lesson, items: null, slow: true });
      return true;
    }
    return false;
  },
};
