// Draws a state as exactly `rows` lines, none wider than `cols - 1`. Four
// regions: the header (where am I), the body (what to do now, with how it's
// going at the bottom of the card), and the key bar pinned to the bottom.
import { banner, bannerWidth, burst, confetti, pip } from './art.mjs';
import { C } from './copy.mjs';
import {
  answerKey, authoredTier, beatOf, contentOf, hintAvailable, lessonOf, rungsOf, stepOf, tierOf, tiersOf,
} from './flow.mjs';
import { cut, graphemes, inline, pad, plainText, width, wrapRuns } from './text.mjs';
import { tierLabel, tierPill, TIER_STYLE } from './theme.mjs';
import { mix, PLANNED, ruleTiers, scaleMix } from './tiers.mjs';

export const MIN = { cols: 60, rows: 20 };
// A blank line the layout may drop when the window is short. Inside a card
// it keeps the card's rail.
const spacer = (text = '') => ({ spacer: true, text });
const SPACER = spacer();

export const lessonLabel = (id) => (id.endsWith('capstone') ? 'CAP' : id.replace(/^([a-z])-(\d+)$/, (_, l, n) => `${l.toUpperCase()}${n}`));

export function render(s, size, t) {
  const { cols, rows } = size;
  if (cols < MIN.cols || rows < MIN.rows) return small(cols, rows);
  const W = Math.min(cols - 4, 80);
  const M = Math.floor((cols - W) / 2);
  const ctx = { s, t, W, inner: W - 3, cols, rows };
  const view = VIEWS[s.view](ctx);
  const overlay = s.overlay ? OVERLAYS[s.overlay](ctx) : null;
  const body = overlay?.body ?? view.body;
  const keys = overlay?.keys ?? view.keys;
  const top = rows >= 28 ? [''] : [];
  const head = [...view.head, ''];
  const toast = s.toast ? para(t, `${t.lead(TOASTS[s.toast.kind].emoji)}${TOASTS[s.toast.kind].text(s.toast)}`, W, TOASTS[s.toast.kind].color) : [];
  const room = rows - top.length - head.length - 3 - toast.length;
  let lines = body;
  if (lines.length > room) lines = lines.filter((l) => !l?.spacer);
  if (lines.length > room) lines = [...lines.slice(0, room - 1), t.fg('muted', t.glyph.ellipsis)];
  lines = lines.map((l) => (l?.spacer ? l.text : l));
  const out = [...top, ...head, ...lines];
  while (out.length < rows - 3 - toast.length) out.push('');
  out.push(...toast, '', t.fg('faint', t.glyph.rule.repeat(W)), keybar(t, keys));
  return out.map((l) => (l ? cut(' '.repeat(M) + (t.unicode ? l : ascii(l)), cols - 1, t.unicode ? '…' : '.') : ''));
}

const TOASTS = {
  stray: { emoji: 'wave', color: 'accent', text: () => C.stray },
  save: { emoji: 'broken', color: 'warn', text: (x) => C.saveFailed(x.message) },
};

// ASCII mode: the few symbols in the app's own words and in quotes, spelled
// out; anything else outside ASCII becomes '?'.
const ASCII = { '·': '|', '…': '...', '↑': '^', '↓': 'v', '←': '<-', '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-' };
const ascii = (line) => line.replace(/[^\x00-\x7f]/g, (ch) => ASCII[ch] ?? '?');

function small(cols, rows) {
  const out = Array.from({ length: rows }, () => '');
  const lines = wrapRuns([{ text: C.small }], Math.max(1, cols - 2)).map((l) => l.map((r) => r.text).join(''));
  lines.slice(0, rows).forEach((l, i) => {
    out[Math.max(0, Math.floor((rows - lines.length) / 2)) + i] = cut(` ${l}`, cols - 1);
  });
  return out.slice(0, rows);
}

// ---- pieces ------------------------------------------------------------------
const spread = (left, right, w) => left + ' '.repeat(Math.max(1, w - width(left) - width(right))) + right;
const rule = (t, W) => t.fg('faint', t.glyph.rule.repeat(W));

// Inline Markdown in the given color, wrapped to `w` columns.
function para(t, text, w, color = 'text', { quote = false } = {}) {
  const runs = inline(quote ? `"${text}"` : text);
  return wrapRuns(runs, w).map((line) => line.map((r) => {
    let s = t.fg(r.code ? 'code' : color, r.text);
    if (r.bold) s = t.bold(s);
    if (r.url) s = t.link(s, r.url);
    return s;
  }).join(''));
}

function keybar(t, keys) {
  return keys.filter(Boolean).map((k) => {
    if (k.main) return `${t.pill(k.key, k.bg ?? 'okBg', k.fg ?? 'white')} ${t.bold(t.fg('white', k.label))}`;
    return `${t.fg('key', t.bold(k.key))} ${t.fg('muted', k.label)}`;
  }).join('    ');
}
const key = (k, label) => ({ key: k, label });
const mainKey = (k, label, bg, fg) => ({ key: k, label, main: true, bg, fg });

// The practice copy's folder in a command, quoted when the shell needs it.
export function quotePath(path, win32) {
  if (/^[\w@%+=:,./~\\-]+$/.test(path)) return path;
  return win32 ? `"${path}"` : `'${path.replace(/'/g, "'\\''")}'`;
}
const withRoot = (text, root, win32) => text.replace('<your practice copy>', quotePath(root, win32));

// A command on a dark block, one line per `w - 4` columns of the command,
// so a long path is never cut.
function chip(t, cmd, where, w) {
  const prompt = where === 'claude' ? '›' : t.caps.win32 ? '>' : '$';
  const room = Math.max(10, w - 4);
  const parts = [];
  let part = '';
  for (const g of graphemes(cmd)) {
    if (width(part + g) > room) {
      parts.push(part);
      part = '';
    }
    part += g;
  }
  if (part || !parts.length) parts.push(part);
  return parts.map((part, i) => {
    const text = ` ${t.fg('prompt', i ? ' ' : prompt)} ${t.fg('code', part)}`;
    const padded = text + ' '.repeat(Math.max(1, w - width(text)));
    return t.depth > 1 ? t.bg('codeBg', padded) : padded;
  });
}

function trail(ctx) {
  const { s, t } = ctx;
  const steps = contentOf(s).steps;
  const tiers = tiersOf(s);
  const done = new Set(s.progress[s.lesson].done);
  const current = s.view === 'step' || s.view === 'levelup' ? s.pos.step : -1;
  let out = '';
  steps.forEach((step, i) => {
    const style = TIER_STYLE[tiers[i]];
    const isDone = done.has(step.id) && i !== current;
    if (isDone) out += t.fg('ok', t.glyph[style.on]);
    else if (i === current) out += t.bold(t.fg('accent', t.glyph[style.on]));
    else out += t.fg(style.tint, t.glyph[style.off]);
    if (i + 1 < steps.length) {
      if (tiers[i + 1] !== tiers[i]) out += '   ';
      else if (isDone && (done.has(steps[i + 1].id) || i + 1 === current)) out += t.fg('ok', t.glyph.bold.repeat(2));
      else out += t.fg('faint', t.glyph.rule.repeat(2));
    }
  });
  return out;
}

function lessonHead(ctx, right, rightText) {
  const { s, t, W } = ctx;
  const l = lessonOf(s);
  const title = l.content?.title ?? l.title;
  return [
    spread(`${t.pill(lessonLabel(l.id), 'accentBg')}  ${t.bold(t.fg('white', title))}`, right, W),
    spread(l.content ? trail(ctx) : '', t.fg('muted', rightText), W),
    rule(t, W),
  ];
}

function card(ctx, { tint, where, done, rows }) {
  const { t, W } = ctx;
  const rail = t.fg(tint, t.glyph.rail);
  const left = `${t.fg(tint, `${t.glyph.tl}${t.glyph.rule}`)} ${t.pill(where, 'chipBg')}${done ? ` ${t.pill(`${t.glyph.check} ${C.done}`, 'okBg')}` : ''} `;
  const top = left + t.fg(tint, t.glyph.rule.repeat(Math.max(0, W - width(left))));
  const lines = [top, spacer(rail)];
  for (const r of rows) lines.push(r?.spacer || r === '' ? spacer(rail) : `${rail}  ${r}`);
  lines.push(t.fg(tint, `${t.glyph.bl}${t.glyph.rule.repeat(W - 1)}`));
  return lines;
}

const lead = (t, name, s) => `${t.lead(name)}${s}`;
const hintBox = (t, lines) => lines.map((l) => `${t.fg('warn', t.glyph.bar)} ${l}`);

// ---- views -------------------------------------------------------------------
const VIEWS = {
  welcome(ctx) {
    const { s, t, W } = ctx;
    const done = s.course.filter((l) => s.progress[l.id].complete).length;
    const heat = ['guided', 'guided', 'hinted', 'heat4', 'challenge'];
    const ids = s.course.filter((l) => !l.id.endsWith('capstone'));
    const path = ids.map((l, i) => t.fg(heat[i % heat.length], t.bold(lessonLabel(l.id)))).join(t.fg('faint', ` ${t.glyph.rule.repeat(2)} `))
      + t.fg('faint', ` ${t.glyph.rule.repeat(2)} `) + (t.emoji('cup') || lessonLabel('b-capstone'));
    const p = pip(t, 'happy');
    const body = [
      ` ${p[0]}`,
      ` ${p[1]}   ${lead(t, 'wave', t.bold(t.fg('white', C.hi(s.facts.name))))}`,
      ` ${p[2]}   ${t.fg('text', C.pip1)}`,
      ` ${p[3]}   ${t.fg('text', C.pip2)}`,
      SPACER,
      t.bold(t.fg('white', C.twoWindows)),
      ...windows(ctx),
      SPACER,
      t.bold(t.fg('white', C.openSecond)),
      ...chip(t, `cd ${quotePath(s.facts.root, t.caps.win32)}`, 'terminal', Math.min(W, width(s.facts.root) + 10)),
      t.fg('muted', C.comeBack),
    ];
    if (s.facts.gitError) body.push(SPACER, lead(t, 'broken', t.fg('bad', C.gitBroken(s.facts.gitError))));
    return {
      head: [spread(`${t.pill('LEARN', 'accentBg')}  ${t.bold(t.fg('white', C.appName))}`, t.fg('muted', C.pathLabel(done, s.course.length)), W),
        `${path}${t.fg('muted', `   ${C.pathHint}`)}`, rule(t, W)],
      body,
      keys: [mainKey('enter', C.k.itsOpen), key('q', C.k.quit)],
    };
  },

  resume(ctx) {
    const { s, t } = ctx;
    const content = contentOf(s);
    const p = s.progress[s.lesson];
    const index = Math.max(0, content.steps.findIndex((x) => x.id === p.step));
    const art = pip(t, 'happy');
    return {
      head: lessonHead(ctx, '', C.stepOf(index + 1, content.steps.length)),
      body: [
        ` ${art[0]}`,
        ` ${art[1]}   ${lead(t, 'wave', t.bold(t.fg('white', C.welcomeBack)))}`,
        ` ${art[2]}   ${t.fg('text', C.youreOn(lessonLabel(s.lesson), index + 1, content.steps.length, content.steps[index].title))}`,
        ` ${art[3]}`,
        ...(s.confirmRestart ? [SPACER, `${t.fg('warn', t.glyph.warnMark)} ${t.bold(t.fg('white', C.restartAsk))}`] : []),
      ],
      keys: s.confirmRestart
        ? [mainKey('y', C.k.yesStartOver, 'warn', 'black'), key('n', C.k.keep)]
        : [mainKey('enter', C.k.continue), key('x', C.k.startOver), key('m', C.k.map), key('q', C.k.quit)],
    };
  },

  intro(ctx) {
    const { s, t, W } = ctx;
    const content = contentOf(s);
    const tiers = tiersOf(s);
    const m = mix(tiers);
    const n = s.course.findIndex((l) => l.id === s.lesson) + 1;
    const label = s.lesson.endsWith('capstone') ? C.startCapstone : C.startLesson(n);
    const option = (i, text) => (s.cursor === i
      ? `${t.fg('key', t.bold(t.glyph.pointer))} ${t.inverse(t.fg('key', t.bold(` ${text} `)))}`
      : `  ${t.fg('text', ` ${text}`)}`);
    return {
      head: lessonHead(ctx, t.fg('muted', content.intro.minutes ?? ''), C.steps(content.steps.length)),
      body: [
        lead(t, 'goal', t.bold(t.fg('white', C.youllBeAble))),
        ...content.intro.can.flatMap((c) => para(t, c, W - 6).map((l, i) => `   ${i ? ' ' : t.fg('faint', t.glyph.dotOff)} ${l}`)),
        SPACER,
        t.bold(t.fg('white', C.helpShrinks)),
        SPACER,
        ...staircase(ctx, m, false),
        SPACER,
        option(0, label),
        option(1, C.lessHelp),
      ],
      keys: [key(t.glyph.up, C.k.choose), key('enter', C.k.start), key('m', C.k.map), key('q', C.k.quit)],
    };
  },

  step: stepView,

  levelup(ctx) {
    const { s, t, W } = ctx;
    const tiers = tiersOf(s);
    const rest = tiers.slice(s.pos.step);
    const counts = (k) => rest.filter((x) => x === k).length;
    const toChallenge = s.levelTo === 'challenge';
    const art = pip(t, 'focus');
    const word = banner(t, C.levelUp);
    const fits = t.unicode && W >= 14 + bannerWidth(C.levelUp);
    const top = fits
      ? [` ${art[0]}`, ` ${art[1]}    ${word[0]}`, ` ${art[2]}    ${word[1]}`, ` ${art[3]}    ${word[2]}`]
      : [` ${art[0]}`, ` ${art[1]}    ${t.bold(t.fg('accent', C.levelUp))}`, ` ${art[2]}`, ` ${art[3]}`];
    const lines = toChallenge ? C.toChallenge : C.toHinted;
    return {
      head: lessonHead(ctx, tierPill(t, s.levelTo), C.stepOf(s.pos.step + 1, tiers.length)),
      body: [
        ...top,
        SPACER,
        ` ${tierPill(t, s.levelFrom)}   ${t.fg(TIER_STYLE[s.levelTo].tint, `${t.glyph.bold.repeat(8)}${t.glyph.right}`)}   ${tierPill(t, s.levelTo)}`,
        SPACER,
        ` ${t.bold(t.fg('white', lines[0]))}`,
        ` ${t.fg('text', lines[1])}`,
        SPACER,
        ` ${lead(t, 'level', t.bold(t.fg(TIER_STYLE[s.levelTo].tint, C.nextCounts(toChallenge ? 0 : counts('hinted'), counts('challenge')))))}`,
      ],
      keys: [mainKey('enter', toChallenge ? C.k.bringIt : C.k.letsGo, TIER_STYLE[s.levelTo].bg, TIER_STYLE[s.levelTo].fgOnBg), toChallenge ? null : key('g', C.k.keepGuided), key('q', C.k.quit)],
    };
  },

  complete(ctx) {
    const { s, t, W } = ctx;
    const content = contentOf(s);
    const art = pip(t, 'party');
    const word = banner(t, C.complete);
    const fits = t.unicode && W >= 14 + bannerWidth(C.complete);
    const n = s.course.findIndex((l) => l.id === s.lesson) + 1;
    const label = s.lesson.endsWith('capstone') ? 'The capstone' : `Lesson ${n}`;
    return {
      head: lessonHead(ctx, t.pill(`${C.complete} ${t.glyph.check}`, 'okBg'), `${content.steps.length} of ${content.steps.length}`),
      body: [
        confetti(t, W),
        SPACER,
        ...(fits
          ? [` ${art[0]}`, ` ${art[1]}    ${word[0]}`, ` ${art[2]}    ${word[1]}`, ` ${art[3]}    ${word[2]}`]
          : [` ${art[0]}`, ` ${art[1]}    ${t.bold(t.fg('ok', C.complete))}`, ` ${art[2]}`, ` ${art[3]}`]),
        SPACER,
        lead(t, 'party', t.bold(t.fg('white', C.lessonDone(label)))),
        ...content.intro.can.flatMap((c) => para(t, c, W - 8).map((l, i) => `   ${i ? '  ' : `${t.fg('ok', t.glyph.check)} `}${l}`)),
        ...(content.badge ? [SPACER, lead(t, 'badge', t.bold(t.fg('gold', C.badge(content.badge))))] : []),
      ],
      keys: [mainKey('enter', C.k.whatsNext), key('q', C.k.quit)],
    };
  },

  next(ctx) {
    const { s, t, W } = ctx;
    const content = contentOf(s);
    const results = s.checks[s.lesson]?.items;
    const answered = content.steps.flatMap((st) => st.beats.map((b, i) => [st, b, i]))
      .filter(([, b]) => b.ask && b.kind !== 'predict').length;
    const nextLesson = content.next ? lessonOf(s, content.next) : null;
    const body = [];
    if (results) body.push(lead(t, 'verified', t.fg('ok', C.checkedSummary(results.filter((r) => r.pass).length, results.length))));
    body.push(lead(t, 'claude', t.fg('text', C.answeredSummary(answered))), SPACER, t.bold(t.fg('white', C.yourClimb)), SPACER,
      ...staircase(ctx, mix(ruleTiers(s.course.map((l) => l.content), s.course.findIndex((l) => l.id === s.lesson))), true));
    if (nextLesson) {
      body.push(SPACER, `${t.fg('accent', t.glyph.right)} ${t.fg('muted', C.nextUp)}  ${t.pill(lessonLabel(nextLesson.id), 'accentBg')}  ${t.bold(t.fg('white', nextLesson.title))}`,
        `   ${mixBar(ctx, nextLesson, 12)}  ${t.fg('muted', C.notchHarder)}`);
    }
    body.push(SPACER, t.fg('muted', C.savedBreak));
    return {
      head: lessonHead(ctx, t.pill(`${C.complete} ${t.glyph.check}`, 'okBg'), `${content.steps.length} of ${content.steps.length}`),
      body,
      keys: [nextLesson ? mainKey('enter', C.k.startN(lessonLabel(nextLesson.id))) : mainKey('enter', C.k.map), key('m', C.k.map), key('q', C.k.quit)],
    };
  },

  map(ctx) {
    const { s, t, W } = ctx;
    const done = s.course.filter((l) => s.progress[l.id].complete).length;
    const total = s.course.length;
    const pct = Math.round((done / total) * 100);
    const barW = W - 6;
    const filled = Math.round((done / total) * barW);
    const nextIdx = s.course.findIndex((l) => !s.progress[l.id].complete);
    const legend = ['guided', 'hinted', 'challenge'].map((k) => `${t.fg(TIER_STYLE[k].tint, t.glyph[TIER_STYLE[k].on])} ${t.fg('text', C.mapLegend[k])}`).join('   ');
    const titleW = Math.min(Math.max(...s.course.map((l) => l.title.length)), W - 33);
    const rows = s.course.flatMap((l, i) => {
      const p = s.progress[l.id];
      const sel = i === s.mapCursor;
      const mark = `${sel ? t.fg('key', t.bold(t.glyph.pointer)) : ' '} ${p.complete ? t.fg('ok', t.glyph.check) : t.fg('faint', t.glyph.dotOff)}`;
      const pillBg = sel ? 'accentBg' : p.complete ? 'okBg' : 'dimBg';
      const name = sel ? t.bold(t.fg('key', l.title)) : t.fg(p.complete ? 'text' : 'muted', l.title);
      const state = p.complete ? t.fg('ok', C.mapDone) : i === nextIdx ? t.fg('accent', t.bold(C.mapNext)) : '';
      const medal = l.id.endsWith('capstone') ? t.emoji('cup') : p.complete && l.content?.badge ? t.emoji('badge') : '';
      const fitTitle = pad(cut(name, titleW + 1), titleW + 1);
      const line = `${mark} ${t.pill(pad(lessonLabel(l.id), 3), pillBg, sel || p.complete ? 'white' : 'dimText')} ${fitTitle} ${mixBar(ctx, l, 12)}  ${pad(state, 5)}${medal ? ` ${medal}` : ''}`;
      return i ? [SPACER, line] : [line];
    });
    return {
      head: [spread(`${t.lead('map')}${t.pill(C.map, 'accentBg')}  ${t.bold(t.fg('white', 'Beginner path'))}`, t.fg('muted', C.ofDone(done, total)), W),
        `${t.fg('ok', t.glyph.bold.repeat(filled))}${t.fg('faint', t.glyph.rule.repeat(barW - filled))} ${t.fg('ok', `${pct}%`)}`, rule(t, W)],
      body: [`${t.fg('muted', C.help)}  ${legend}`, SPACER, ...rows, SPACER, t.fg('muted', C.mapFooter)],
      keys: [key(t.glyph.up, C.k.choose), key('enter', C.k.open), key('m', C.k.back), key('q', C.k.quit)],
    };
  },

  checkonly(ctx) {
    const { s, t, W } = ctx;
    const l = lessonOf(s);
    const results = s.checks[l.id];
    const items = l.items.map((text, index) => {
      const r = results?.items?.find((x) => x.index === index);
      const mark = !r ? t.fg('faint', t.glyph.dotOff) : r.pass ? t.fg('ok', t.glyph.check) : t.fg('warn', t.glyph.warnMark);
      const lines = para(t, text, ctx.inner - 4);
      return lines.map((x, i) => `${i ? ' ' : mark} ${x}`);
    }).flat();
    const rows = [
      t.fg('text', C.checkOnly[0]),
      t.fg('text', C.checkOnly[1]),
      SPACER,
      ...para(t, l.url, ctx.inner, 'key').map((x) => t.link(x, l.url)),
      SPACER,
      ...items,
    ];
    if (results?.error) rows.push(SPACER, lead(t, 'broken', t.fg('bad', C.broken(results.error))));
    return {
      head: lessonHead(ctx, '', l.minutes),
      body: card(ctx, { tint: 'muted', where: `${t.lead('terminal')}${C.where.terminal}`, rows }),
      keys: [key('r', C.k.checkNow), key('p', C.k.page), key('m', C.k.map), key('q', C.k.quit)],
    };
  },
};

function windows(ctx) {
  const { t, W } = ctx;
  const box = (title, lines, inner, color) => {
    const top = `${t.fg(color, `${t.glyph.tl}${t.glyph.rule}`)} ${t.bold(t.fg('white', title))} ${t.fg(color, `${t.glyph.rule.repeat(Math.max(0, inner - width(title) - 3))}${t.glyph.tr}`)}`;
    return [top, ...lines.map((l) => `${t.fg(color, t.glyph.rail)}${pad(l, inner)}${t.fg(color, t.glyph.rail)}`), t.fg(color, `${t.glyph.bl}${t.glyph.rule.repeat(inner)}${t.glyph.br}`)];
  };
  const left = box(C.thisWindow, [`  ${t.fg('code', 'npm run learn')}`, ...C.thisWindowLines.map((l) => `  ${t.fg('text', l)}`)], 26, 'accent');
  const right = box(C.otherWindow, C.otherWindowLines.map((l) => `  ${t.fg('text', l)}`), 27, 'key');
  if (W >= 66) return left.map((l, i) => `${l}${i === 2 ? t.fg('faint', `  ${t.glyph.rule.repeat(2)}${t.glyph.right}   `) : ' '.repeat(8)}${right[i]}`);
  return [...left, ...right];
}

function staircase(ctx, m, done) {
  const { t } = ctx;
  const [g, h, c] = m;
  const glyphs = (tier, n) => t.fg(done ? 'ok' : TIER_STYLE[tier].tint, t.glyph[TIER_STYLE[tier].on].repeat(n));
  const row = (indent, tier, n) => `${' '.repeat(indent)}${glyphs(tier, n)}   ${tierPill(t, tier)}   ${t.fg('muted', C.stair[tier])}`;
  const out = [];
  if (c) out.push(row(g + h + 4, 'challenge', c));
  if (h) out.push(row(g + 2, 'hinted', h));
  if (g) out.push(row(0, 'guided', g));
  return out;
}

function mixBar(ctx, lesson, cells) {
  const { s, t } = ctx;
  const idx = s.course.findIndex((l) => l.id === lesson.id);
  const real = lesson.content ? mix(ruleTiers(s.course.map((l) => l.content), idx)) : null;
  const m = scaleMix(real ?? PLANNED[lesson.id] ?? [0, 0, 1], cells);
  return ['guided', 'hinted', 'challenge'].map((k, i) => t.fg(TIER_STYLE[k].tint, t.glyph[TIER_STYLE[k].on].repeat(m[i]))).join('');
}

// ---- the step card -----------------------------------------------------------
function stepView(ctx) {
  const { s, t, inner } = ctx;
  const content = contentOf(s);
  const step = stepOf(s);
  const beat = beatOf(s);
  const st = s.beat;
  const tier = tierOf(s);
  const authored = authoredTier(s);
  const style = TIER_STYLE[tier];
  const done = ['done', 'already'].includes(st.status);
  const isLastBeat = s.pos.beat === step.beats.length - 1;
  const hideRuns = tier !== 'guided' && authored === 'guided';
  const inlineBottom = tier === 'guided' && authored !== 'guided';
  const rows = [t.bold(t.fg('white', beat.kind === 'type' ? C.lastQuestion : step.title))];
  const quoted = (text, color = 'muted') => para(t, text, inner, color, { quote: true });

  if (beat.kind === 'self') rows.push(...para(t, beat.self, inner - 3, 'white').map((l, i) => (i ? `   ${l}` : lead(t, 'self', l))));
  if (beat.kind === 'predict') {
    for (const l of beat.lines) if (l.key === 'note') rows.push(...quoted(l.text, 'text'));
  } else {
    beat.lines.forEach((l, i) => {
      const prevRun = beat.lines[i - 1]?.key === 'run';
      const nextRun = beat.lines[i + 1]?.key === 'run';
      if (l.key === 'run') {
        if (hideRuns) return;
        if (!prevRun && i > 0) rows.push(SPACER);
        const cmd = (t.caps.win32 && l.win) || withRoot(l.text, s.facts.root, t.caps.win32);
        const cw = chipWidth(ctx, beat);
        const long = cw + 22 <= inner;
        const tick = l.tick === 'practice-dir' && s.facts.practiceDir && !done ? `  ${t.fg('ok', long ? `${t.glyph.check} .practice/ exists` : t.glyph.check)}` : done ? `  ${t.fg('ok', t.glyph.check)}` : '';
        const lines = chip(t, cmd, beat.where, cw);
        rows.push(lines[0] + tick, ...lines.slice(1));
        if (!nextRun && i < beat.lines.length - 1) rows.push(SPACER);
      } else if (l.key === 'goal') {
        const lines = para(t, l.text, tier === 'challenge' ? inner - 3 : inner, 'white');
        rows.push(...(tier === 'challenge' ? lines.map((x, i) => (i ? `   ${x}` : lead(t, 'goal', x))) : lines));
      } else if (l.key === 'say' || l.key === 'do') rows.push(...para(t, l.text, inner, 'text'));
      else if (l.key === 'note') rows.push(...quoted(l.text));
      else if (l.key === 'rule') rows.push(...para(t, l.text, inner - 3, 'text', { quote: true }).map((x, i) => (i ? `   ${x}` : lead(t, 'safety', x))));
      else if (l.key === 'after') rows.push(...para(t, l.text, inner - 2, 'text').map((x, i) => `${i ? ' ' : t.fg('accent', t.glyph.arrow)} ${x}`));
      else if (l.key === 'expect') {
        if (beat.verify.kind === 'check') rows.push(...para(t, `${C.doneWhen}${l.text}`, inner, 'muted'));
        else rows.push(...quoted(l.text));
      }
    });
    if (inlineBottom) {
      for (const b of beat.bottom) rows.push(...(b.includes('`') ? para(t, b, inner, 'text') : chip(t, b, beat.where, chipWidth(ctx, beat))));
    }
    if (tier === 'challenge' && step.part === 'Your turn' && s.pos.beat === 0) rows.push(SPACER, t.fg('muted', C.noCommands));
    if (hideRuns && beat.lines.some((l) => l.key === 'run') && !done) rows.push(t.fg('muted', C.pressH));
  }
  if (beat.winNote && t.caps.win32) rows.push(...quoted(beat.winNote));

  // The question, if this beat asks one.
  if (beat.kind === 'type') {
    rows.push(...para(t, beat.ask, inner, 'white').map((x) => t.bold(x)), t.fg('muted', C.typeIt), SPACER,
      `  ${t.fg('muted', '›')} ${t.fg('code', st.status === 'done' && st.revealed ? '' : st.typed)}${st.status === 'done' ? '' : t.inverse(' ')}`);
    if (st.status !== 'done') rows.push(SPACER, t.fg('muted', C.emptyShows));
  } else if (beat.ask) {
    const recall = beat.recall ? Object.entries(s.progress[s.lesson].answers).find(([k]) => k.startsWith(`${beat.recall}.`)) : null;
    rows.push(SPACER);
    if (recall) rows.push(t.fg('muted', C.youGuessed(plainText(recall[1]))));
    const prefix = beat.kind === 'predict' && beat.safety ? `${t.lead('safety')}${C.safetyChoice} ` : t.lead('guess');
    rows.push(...para(t, beat.ask, inner - width(prefix), 'white').map((x, i) => (i ? `${' '.repeat(width(prefix))}${t.bold(x)}` : `${prefix}${t.bold(x)}`)));
    rows.push(SPACER, ...options(ctx, beat));
    if (beat.kind === 'predict' && !st.answer) rows.push(SPACER, t.fg('muted', C.anyAnswer));
  }

  const footer = footerRows(ctx, { beat, step, content, isLastBeat });
  if (footer.length) rows.push(SPACER, ...footer);

  const whereKey = beat.kind === 'do' ? beat.where : beat.kind;
  const whereEmoji = { terminal: 'terminal', claude: 'claude', predict: 'guess', ask: 'guess', type: 'goal', self: 'self' }[whereKey];
  const where = `${t.lead(whereEmoji)}${C.where[whereKey]}`;
  const tint = done ? 'ok' : style.tint;
  return {
    head: lessonHead(ctx, tierPill(t, tier), C.stepOf(s.pos.step + 1, content.steps.length)),
    body: card(ctx, { tint, where, done: done && (beat.verify.kind === 'check' || beat.verify.kind === 'git-clean'), rows }),
    keys: stepKeys(ctx, { beat, step, content, done, isLastBeat }),
  };
}

// Chips in a beat share one width: room for the longest command, up to the
// card's width. A live tick beside a chip shortens to a mark when it won't fit.
const chipWidth = (ctx, beat) => {
  const longest = Math.max(...beat.lines.filter((l) => l.key === 'run').map((l) => Math.max(width(withRoot(l.text, ctx.s.facts.root, ctx.t.caps.win32)), width(l.win ?? ''))), ...beat.bottom.map((b) => width(b)), 10);
  return Math.min(ctx.inner - 2, Math.max(longest + 4, 30));
};

function options(ctx, beat) {
  const { s, t, inner } = ctx;
  const st = s.beat;
  return beat.options.map((o, i) => {
    const chosen = st.answer?.index === i;
    const wrong = st.wrongs.includes(i);
    const right = st.answer && o.kind === 'right' && (st.revealed || chosen || (beat.kind === 'predict' && !beat.revealAt));
    const cursor = !st.answer && s.cursor === i;
    const mark = right ? t.fg('ok', t.glyph.check) : wrong ? t.fg('warn', t.glyph.warnMark) : cursor ? t.fg('key', t.bold(t.glyph.pointer)) : chosen ? t.fg('key', t.glyph.pointer) : ' ';
    const num = cursor ? t.inverse(t.fg('key', t.bold(` ${i + 1} `))) : t.fg('muted', ` ${i + 1} `);
    const color = right ? 'ok' : wrong || o.kind === 'other' ? 'muted' : cursor ? 'key' : 'text';
    const text = para(t, o.text, inner - 10, color);
    const tag = wrong && st.wrongs.at(-1) === i && !st.answer ? `  ${t.fg('warn', `${t.unicode ? '←' : '<-'} not this one`)}` : '';
    return text.map((x, k) => (k ? `       ${x}` : ` ${mark} ${num}  ${cursor ? t.bold(x) : x}${tag}`));
  }).flat();
}

function footerRows(ctx, { beat, step, content, isLastBeat }) {
  const { s, t, inner } = ctx;
  const st = s.beat;
  const rows = [];
  const quoted = (text, color = 'text') => para(t, text, inner - 2, color, { quote: true });
  const stepNumber = (id) => content.steps.findIndex((x) => x.id === id) + 1;
  const celebrate = (lines) => {
    const count = s.session + (s.progress[s.lesson].done.includes(step.id) ? 0 : 1);
    rows.push(...burst(t, [t.bold(t.fg('ok', C.stepDone(s.pos.step + 1))), ...lines, lead(t, 'fire', t.bold(t.fg('challenge', C.session(count))))]));
  };

  if (st.status === 'opening') rows.push(t.fg('key', C.checking));
  else if (st.status === 'broken') rows.push(...para(t, `${t.lead('broken')}${C.broken(st.error)}`, inner, 'bad'));
  else if (st.status === 'already') {
    if (st.codespace) rows.push(...para(t, `${t.lead('verified')}"${beat.codespace}"`, inner, 'ok'));
    else rows.push(...para(t, `${t.lead('verified')}${C.already}`, inner, 'ok'));
  }
  if (beat.verify.all && ['done', 'already'].includes(st.status) && s.checks[s.lesson]?.items) {
    const items = s.checks[s.lesson].items;
    rows.push(`${t.fg('ok', t.glyph.check)} ${t.fg('code', `npm run check -- ${s.lesson}`)} ${t.fg('ok', C.checkPasses(items.filter((x) => x.pass).length, items.length)[0])}`, t.fg('muted', C.runItToo));
  } else if (st.status === 'done' && beat.verify.kind === 'check') {
    const ev = st.evidence ? [`${t.fg('code', beat.evidence)}${t.fg('text', ' holds ')}${t.fg('code', st.evidence)}`] : [];
    if (isLastBeat) celebrate(ev.length ? ev : [t.fg('text', C.beatDone)]);
    else rows.push(lead(t, 'verified', t.fg('ok', C.beatDone)));
  } else if (st.status === 'done' && beat.verify.kind === 'git-clean') {
    if (isLastBeat) celebrate([t.fg('text', C.cleanCopy)]);
    else rows.push(lead(t, 'verified', t.fg('ok', C.cleanCopy)));
  } else if (st.status === 'done') {
    const f = st.feedback;
    if (beat.kind === 'predict') {
      if (beat.revealAt) rows.push(t.fg('ok', C.findOutAt(stepNumber(beat.revealAt))));
      else {
        rows.push(t.fg('ok', st.answer.kind === 'right' ? `${t.glyph.check} ${C.guessRight}` : C.nowYouKnow));
        if (beat.reveal) rows.push(...quoted(beat.reveal));
      }
    } else if (f?.kind === 'right') {
      rows.push(t.bold(t.fg('ok', `${t.glyph.check} ${C.right}`)));
      if (beat.reveal) rows.push(...quoted(beat.reveal));
    } else if (f?.kind === 'revealed') {
      rows.push(t.fg('ok', C.theAnswer));
      if (beat.reveal) rows.push(...quoted(beat.reveal));
      else rows.push(t.fg('text', C.theAnswerIs(st.answer.index + 1)));
    } else if (f) {
      rows.push(t.fg('ok', f.kind === 'other' ? C.otherFine : `${t.glyph.check} ${C.answered}`));
      if (f.because) rows.push(...quoted(f.because));
      if (beat.reveal) rows.push(...quoted(beat.reveal));
      if (f.kind === 'other') rows.push(t.fg('muted', C.stillStuck));
    }
  } else if (st.status === 'waiting' && beat.verify.kind === 'check') {
    const [a, what, b] = C.watching(beat.watching ?? 'your files');
    rows.push(lead(t, 'watch', `${t.fg('muted', a)}${t.fg('code', what)}${t.fg('muted', b)}`));
  } else if (beat.verify.kind === 'git-clean' && (st.status === 'waiting' || st.status === 'fail')) {
    const paths = s.git?.paths ?? [];
    if (st.status === 'fail' || paths.length) {
      const shown = (st.fail?.paths ?? paths).slice(0, 3).join(', ');
      rows.push(...para(t, `${st.status === 'fail' ? `${C.notYet} ` : ''}${C.gitDirty((st.fail?.paths ?? paths).length)} ${shown}`, inner - 2, 'warn').map((x, i) => (i ? `  ${x}` : `${t.fg('warn', t.glyph.warnMark)} ${x}`)));
      if (st.status === 'fail') rows.push(`  ${t.fg('muted', C.gitFailAfter)}`);
    } else rows.push(lead(t, 'watch', `${t.fg('muted', C.watchingGit)}${t.fg('code', 'git status')}${t.fg('muted', ':')} ${t.fg('ok', `${t.glyph.check} ${C.gitClean}`)}`));
  } else if (st.status === 'fail' && st.fail?.hint) {
    rows.push(...para(t, `${C.notYet} ${diagnosis(st.fail.hint)}`, inner - 2, 'text').map((x, i) => (i ? `  ${x}` : `${t.fg('warn', t.bold(t.glyph.warnMark))} ${x}`)));
  }

  // Feedback on a pick that wasn't right, before the answer.
  if (st.status !== 'done' && st.feedback) {
    const f = st.feedback;
    if (f.kind === 'wrong') {
      const box = [];
      if (f.because) {
        box.push(`${t.bold(t.fg('warn', C.notQuite))} ${t.fg('text', C.trueOfElse)}`, ...quoted(f.because));
        if (f.point) box.push(`${t.lead('hint')}${t.fg('text', C.lookFor)} ${para(t, f.point, inner - 14, 'warn', { quote: true })[0]}`);
      } else if (f.hint) box.push(`${t.bold(t.fg('warn', C.notQuite))}`, ...quoted(f.hint));
      else box.push(`${t.bold(t.fg('warn', C.notQuite))} ${t.fg('text', C.lookAgain)}`);
      rows.push(...hintBox(t, box));
    } else if (f.kind === 'stuck') rows.push(...hintBox(t, [t.fg('warn', C.fixFirst), ...quoted(f.because), t.fg('muted', C.fixThenPick)]));
  }

  // The hint box: one rung at a time, the y/n before the exact command.
  if (!['done', 'already'].includes(st.status)) {
    if (st.confirm) rows.push(...hintBox(t, [`${t.lead('hint')}${t.fg('warn', C.showExact)}`]));
    else if (st.rung >= 0) {
      const rungs = rungsOf(s);
      const r = rungs[st.rung] ?? { kind: 'quote', text: '' };
      const box = [];
      if (r.kind === 'ask') box.push(...para(t, r.text, inner - 5, 'warn'));
      else if (r.kind === 'check') box.push(t.fg('muted', C.checkSays), ...para(t, r.text, inner - 5, 'text'));
      else if (r.kind === 'quote') box.push(...para(t, r.text, inner - 5, 'warn', { quote: true }));
      else box.push(...r.lines.flatMap((b) => {
        const text = (t.caps.win32 && b.win) || withRoot(b.text, s.facts.root, t.caps.win32);
        return text.includes('`') ? para(t, text, inner - 5, 'text') : chip(t, text, beat.where, Math.min(chipWidth(ctx, beat), inner - 5));
      }));
      const more = st.rung < rungs.length - 1;
      const lines = box.map((x, i) => (i ? `   ${x}` : `${t.lead('hint')}${x}`));
      if (more) lines.push(`   ${t.fg('muted', C.pressHAgain)}`);
      rows.push(...hintBox(t, lines));
    } else if (st.status === 'fail' && hintAvailable(s)) rows.push(`  ${t.fg('muted', C.pressH)}`);
    else if (st.idle && hintAvailable(s)) rows.push(t.fg('warn', C.stuckOffer));
  }
  if (st.eased && !['done', 'already'].includes(st.status) && s.pos.beat === 0) rows.push(t.fg('muted', C.eased));
  return rows;
}

// The first clause of a check's FAIL message: what is wrong, before how to fix it.
export function diagnosis(hint) {
  let code = false;
  for (let i = 0; i < hint.length; i++) {
    if (hint[i] === '`') code = !code;
    if (!code && (hint.startsWith(': ', i) || hint.startsWith('. ', i))) return hint.slice(0, i + (hint[i] === '.' ? 1 : 0));
  }
  return hint;
}

function stepKeys(ctx, { beat, step, content, done, isLastBeat }) {
  const { s, t } = ctx;
  const st = s.beat;
  const tier = tierOf(s);
  const style = TIER_STYLE[tier];
  if (st.confirm) return [mainKey('y', C.k.yes, 'warn', 'black'), key('n', C.k.no)];
  if (done) {
    const next = isLastBeat ? content.steps[s.pos.step + 1] : null;
    const label = next ? C.k.nextTo(next.title) : C.k.next;
    return [mainKey('enter', label), key('b', C.k.back), key('m', C.k.map), key('q', C.k.quit)];
  }
  if (beat.kind === 'type') return [key('enter', C.k.answer), key('esc', C.k.clear), key('ctrl+c', C.k.quit)];
  const hint = hintAvailable(s) ? key('h', st.rung >= 0 ? C.k.moreHelp : st.status === 'fail' ? C.k.help : C.k.hint) : null;
  if (beat.ask && !st.answer) {
    return [key(t.glyph.up, C.k.choose), key('enter', C.k.answer), st.wrongs.length && beat.kind !== 'predict' ? key('s', C.k.showAnswer) : null, hint, key('q', C.k.quit)];
  }
  const v = beat.verify.kind;
  const why = beat.why.length ? key('w', C.k.why) : null;
  if (v === 'self' || v === 'none' || beat.kind === 'self' || (v === 'git-clean' && beat.doneLabel)) {
    const k = v === 'none' ? 'enter' : 'space';
    return [mainKey(k, beat.doneLabel ?? C.k.next, style.bg, style.fgOnBg), hint, why, key('m', C.k.map), key('q', C.k.quit)];
  }
  const r = st.status === 'fail' ? key('r', C.k.checkAgain) : key('r', C.k.checkNow);
  return [hint, r, why, key('m', C.k.map), hint ? null : key('?', C.k.more), key('q', C.k.quit)];
}

// ---- overlays ----------------------------------------------------------------
const OVERLAYS = {
  why(ctx) {
    const { s, t, inner } = ctx;
    return {
      body: [t.bold(t.fg('white', C.why)), SPACER, ...beatOf(s).why.flatMap((w) => para(t, w, inner, 'text', { quote: true }))],
      keys: [key('w', C.k.close), key('q', C.k.close)],
    };
  },
  help(ctx) {
    const { t } = ctx;
    return {
      body: [t.bold(t.fg('white', C.keysTitle)), SPACER, ...C.keyHelp.map(([k, label]) => `  ${t.fg('key', t.bold(pad(k, 10)))}${t.fg('text', label)}`)],
      keys: [key('?', C.k.close), key('q', C.k.close)],
    };
  },
  page(ctx) {
    const { s, t, inner } = ctx;
    const l = lessonOf(s);
    const anchor = s.view === 'step' ? `#${stepOf(s).part.toLowerCase().replace(/ /g, '-')}` : '';
    const url = `${l.url}${anchor}`;
    const stuck = l.content?.stuck ?? l.stuck;
    return {
      body: [t.bold(t.fg('white', C.pageTitle)), ...para(t, url, inner, 'key').map((x) => t.link(x, url)), SPACER,
        t.fg('text', C.stuckLink), ...para(t, stuck, inner, 'key').map((x) => t.link(x, stuck))],
      keys: [key('p', C.k.close), key('q', C.k.close)],
    };
  },
};
