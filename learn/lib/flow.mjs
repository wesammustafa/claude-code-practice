// Every transition of the app, as a pure function: reduce(state, event)
// returns { state, effects }. Effects ask the wiring in main.mjs to run a
// check, read git status, save progress or quit; their results come back as
// events. Nothing here reads a file, a clock or the terminal.
import { effectiveTier, ruleTiers, TIERS } from './tiers.mjs';

export const IDLE_MS = 120_000;
export const HINT_LOCK_MS = 2_000;
export const DEFER_MS = 300;
const SWALLOW_MS = 800;
const TOAST_MS = 5_000;

const clone = (x) => structuredClone(x);
const blankProgress = () => ({ step: null, beat: 0, done: [], answers: {}, levels: [], lessHelp: false, keepGuided: false, easedSteps: {}, complete: false });

export function initialState({ course, saved = null, facts, now = 0 }) {
  const progress = {};
  for (const l of course) {
    const p = saved?.lessons?.[l.id];
    progress[l.id] = { ...blankProgress(), ...(p ?? {}) };
    if (l.content) {
      // Unknown step ids from an older content file start that lesson's place over.
      const ids = new Set(l.content.steps.map((s) => s.id));
      const pr = progress[l.id];
      pr.done = pr.done.filter((id) => ids.has(id));
      const step = l.content.steps.find((x) => x.id === pr.step);
      if (!step) Object.assign(pr, { step: null, beat: 0 });
      else if (!(pr.beat >= 0 && pr.beat < step.beats.length)) pr.beat = 0;
    }
  }
  const open = course.find((l) => l.content && progress[l.id].step && !progress[l.id].complete)
    ?? course.find((l) => l.content && !progress[l.id].complete);
  // Every lesson in the app is done: open the map at the next lesson.
  const next = open ?? course.find((l) => !progress[l.id].complete) ?? course[0];
  const welcomed = Boolean(saved?.welcomed);
  return {
    course, facts, progress, now,
    eased: saved?.eased ?? [],
    welcomed,
    view: !welcomed ? 'welcome' : !open ? 'map' : progress[open.id].step ? 'resume' : 'intro',
    overlay: null, lesson: next.id, pos: { step: 0, beat: 0 }, beat: null,
    checks: {}, git: null, session: 0, cursor: 0, mapCursor: course.indexOf(next), toast: null,
    held: null, swallowUntil: 0, confirmRestart: false, lastActivity: now,
  };
}

// ---- lookups -----------------------------------------------------------------
export const lessonOf = (s, id = s.lesson) => s.course.find((l) => l.id === id);
export const contentOf = (s, id = s.lesson) => lessonOf(s, id)?.content;
export const stepOf = (s) => contentOf(s).steps[s.pos.step];
export const beatOf = (s) => stepOf(s).beats[s.pos.beat];

export function tiersOf(s, id = s.lesson) {
  const contents = s.course.map((l) => l.content);
  const idx = s.course.findIndex((l) => l.id === id);
  const p = s.progress[id];
  return ruleTiers(contents, idx).map((t, i) => {
    const step = contents[idx].steps[i];
    if (p.keepGuided && step.part !== 'Check') return 'guided';
    return effectiveTier(t, { lessHelp: p.lessHelp, eased: Boolean(p.easedSteps[step.id]) });
  });
}
export const authoredTier = (s) => ruleTiers(s.course.map((l) => l.content), s.course.findIndex((l) => l.id === s.lesson))[s.pos.step];
export const tierOf = (s) => tiersOf(s)[s.pos.step];

// What the wiring should keep an eye on for the beat on screen.
export function watching(s) {
  if (s.view === 'checkonly') return { check: { lesson: s.lesson, items: null } };
  if (s.view !== 'step' || !s.beat) return null;
  if (['done', 'already'].includes(s.beat.status)) return null;
  const v = beatOf(s).verify;
  if (v.kind === 'check') return { check: { lesson: s.lesson, items: v.all ? null : v.items } };
  if (v.kind === 'git-clean') return { git: true };
  return null;
}

// ---- hints -------------------------------------------------------------------
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
  if (st.status === 'fail' && st.fail?.item) {
    const ladder = lesson.ladder.find((l) => l.item === st.fail.item);
    const narrow = ladder?.narrow.find((n) => st.fail.hint.includes(n.part));
    if (narrow) rungs.push({ kind: 'ask', text: narrow.question });
    rungs.push({ kind: 'check', text: st.fail.hint });
    for (const h of ladder?.hints ?? []) rungs.push({ kind: 'quote', text: h });
    bottom = ladder?.bottom ?? [];
  }
  for (const h of beat.hints) rungs.push({ kind: 'quote', text: h });
  if (!bottom.length) bottom = [...(hideRuns ? runs : []), ...beat.bottom.map((text) => ({ text }))];
  if (bottom.length) rungs.push({ kind: 'bottom', lines: bottom });
  return rungs;
}

export function hintAvailable(s) {
  if (s.view !== 'step' || !s.beat || ['done', 'already'].includes(s.beat.status)) return false;
  if (beatOf(s).kind === 'type') return false;
  const rungs = rungsOf(s);
  if (!rungs.length || s.beat.rung >= rungs.length - 1) return false;
  if (tierOf(s) === 'challenge') return s.beat.status === 'fail' || s.beat.unlocked;
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
  s.cursor = 0;
  if (beat.codespace && s.facts.codespace) {
    s.beat.status = 'already';
    s.beat.codespace = true;
  } else if (beat.verify.kind === 'check') {
    s.beat.status = 'opening';
    effects.push({ type: 'check', lesson: s.lesson, items: beat.verify.all ? null : beat.verify.items, evidence: beat.evidence ?? null });
  } else if (beat.verify.kind === 'git-clean') {
    s.beat.status = 'opening';
    effects.push({ type: 'git' });
  }
  effects.push({ type: 'save' });
}

// A skill that needed the bottom rung comes back one tier easier, once: at
// the next step that asks for it.
function markEased(s, index) {
  const step = contentOf(s).steps[index];
  const p = s.progress[s.lesson];
  if (s.eased.includes(step.skill) && !p.easedSteps[step.id] && !p.done.includes(step.id)) {
    p.easedSteps[step.id] = true;
    s.eased = s.eased.filter((k) => k !== step.skill);
  }
}

function openStep(s, index, effects) {
  markEased(s, index);
  const tiers = tiersOf(s);
  const prev = index > 0 ? tiers[index - 1] : null;
  const p = s.progress[s.lesson];
  s.pos = { step: index, beat: 0 };
  if (prev && TIERS.indexOf(tiers[index]) > TIERS.indexOf(prev) && !p.levels.includes(tiers[index])) {
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

export function startLesson(s, id, effects) {
  s.lesson = id;
  s.overlay = null;
  const l = lessonOf(s, id);
  if (!l.content) {
    s.view = 'checkonly';
    effects.push({ type: 'check', lesson: id, items: null });
    return;
  }
  const p = s.progress[id];
  const at = l.content.steps.findIndex((x) => x.id === p.step);
  if (at !== -1 && !p.complete) {
    s.pos = { step: at, beat: p.beat >= 0 && p.beat < l.content.steps[at].beats.length ? p.beat : 0 };
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
  const steps = contentOf(s).steps;
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
    s.pos = { step: s.pos.step - 1, beat: contentOf(s).steps[s.pos.step - 1].beats.length - 1 };
    s.view = 'step';
    openBeat(s, effects);
  }
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
    effects.push({ type: 'save' });
    return;
  }
  if (opt.kind === 'stuck') {
    st.feedback = { kind: 'stuck', because: opt.because };
    return;
  }
  // A wrong pick or a decoy: explain once, reveal on the second.
  if (!st.wrongs.includes(index)) st.wrongs.push(index);
  if (st.wrongs.length >= 2) return reveal(s, effects);
  st.feedback = { kind: 'wrong', because: opt.because, point: beat.point };
}

function reveal(s, effects) {
  const beat = beatOf(s);
  const st = s.beat;
  st.revealed = true;
  st.answer = { index: beat.options.findIndex((o) => o.kind === 'right'), kind: 'revealed' };
  st.feedback = { kind: 'revealed' };
  st.status = 'done';
  effects.push({ type: 'save' });
}

export const normalize = (text) => text.trim().toLowerCase().replace(/\s+/g, '').replace(/^\//, '');

function submitTyped(s, effects) {
  const beat = beatOf(s);
  const st = s.beat;
  const typed = normalize(st.typed);
  if (!typed) return reveal(s, effects);
  if (beat.accept.some((a) => normalize(a) === typed)) {
    st.status = 'done';
    st.feedback = { kind: 'right' };
    effects.push({ type: 'save' });
    return;
  }
  st.typedWrong += 1;
  if (st.typedWrong >= 2) return reveal(s, effects);
  const known = beat.options.find((o) => o.kind === 'wrong' && normalize(o.text) === typed);
  st.feedback = known ? { kind: 'wrong', because: known.because } : { kind: 'wrong', hint: beat.hints[0] };
  st.typed = '';
}

// ---- checks and git ----------------------------------------------------------
function onCheck(s, ev, effects) {
  s.checks[ev.lesson] = { items: ev.items, evidence: ev.evidence ?? null, error: null };
  if (s.view !== 'step' || ev.lesson !== s.lesson || !s.beat) return;
  const beat = beatOf(s);
  if (beat.verify.kind !== 'check') return;
  const st = s.beat;
  if (['done', 'already'].includes(st.status)) return;
  const indexes = beat.verify.all ? lessonOf(s).items.map((_, i) => i) : beat.verify.items;
  const wanted = indexes.map((i) => ev.items.find((it) => it.index === i));
  // A result that doesn't cover every item, or a slow item left for r, decides nothing.
  if (wanted.some((it) => !it || it.slow)) return;
  const explicit = st.explicit;
  st.explicit = false;
  st.error = null;
  const failing = wanted.find((it) => !it.pass);
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
    st.fail = { item: failing.text, hint: failing.hint };
    st.unlocked = true;
    st.idle = false;
    s.lastActivity = s.now;
  } else st.status = 'waiting';
}

function onGit(s, ev, effects) {
  s.git = { paths: ev.paths, error: null };
  if (s.view !== 'step' || !s.beat || beatOf(s).verify.kind !== 'git-clean') return;
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
  switch (ev.type) {
    case 'check':
      onCheck(s, ev, effects);
      break;
    case 'check-error':
      s.checks[ev.lesson] = { ...(s.checks[ev.lesson] ?? {}), error: ev.message };
      if (s.view === 'step' && s.beat && beatOf(s).verify.kind === 'check' && !['done', 'already'].includes(s.beat.status)) {
        Object.assign(s.beat, { status: 'broken', error: ev.message, rung: -1, confirm: false });
      }
      break;
    case 'git':
      onGit(s, ev, effects);
      break;
    case 'git-error':
      s.git = { paths: [], error: ev.message };
      if (s.view === 'step' && s.beat && beatOf(s).verify.kind === 'git-clean' && !['done', 'already'].includes(s.beat.status)) {
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
  return { state: s, effects };
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
  if (typingAnswer(s) || s.overlay) {
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
    if (['escape', 'enter', 'q', '?', 'p', 'w'].includes(name)) s.overlay = null;
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
      // A finished lesson played again keeps its badge and its ticks.
      s.progress[s.lesson].lessHelp = s.cursor === 1;
      openStep(s, 0, effects);
    } else return false;
    return true;
  },
  levelup(s, { name }, effects) {
    const p = s.progress[s.lesson];
    if (name === 'enter' || name === 'g') {
      if (!p.levels.includes(s.levelTo)) p.levels.push(s.levelTo);
      if (name === 'g') p.keepGuided = true;
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
      if (w.check) effects.push({ type: 'check', lesson: w.check.lesson, items: w.check.items, evidence: beat.evidence ?? null, slow: true });
      if (w.git) {
        if (beat.doneLabel) st.ended = st.ended || st.status === 'fail';
        effects.push({ type: 'git' });
      }
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
      if (name === 'up') s.cursor = (s.cursor + n - 1) % n;
      else if (name === 'down') s.cursor = (s.cursor + 1) % n;
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
    if (name !== 'enter') return false;
    const nextId = contentOf(s)?.next;
    if (nextId && lessonOf(s, nextId)) startLesson(s, nextId, effects);
    else s.view = 'map';
    return true;
  },
  map(s, { name }, effects) {
    const n = s.course.length;
    if (name === 'up') s.mapCursor = (s.mapCursor + n - 1) % n;
    else if (name === 'down') s.mapCursor = (s.mapCursor + 1) % n;
    else if (name === 'enter') startLesson(s, s.course[s.mapCursor].id, effects);
    else return false;
    return true;
  },
  checkonly(s, { name }, effects) {
    if (name === 'r') {
      effects.push({ type: 'check', lesson: s.lesson, items: null, slow: true });
      return true;
    }
    return false;
  },
};
