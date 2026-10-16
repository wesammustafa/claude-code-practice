// The detailed Pip (170): the package's half-cell raster on the big-Pip
// screens where the window has rows to spare, the 9x4 glyph Pip elsewhere.
// Where it goes (pipSlot), how the screen holds it, its cells, and the state
// Pip shows for what the app saw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capabilities } from '../../learn/lib/caps.mjs';
import { C } from '../../learn/lib/copy.mjs';
import { createPip, rasterizePip, renderPip, restPose } from '../../learn/lib/pip/pip.mjs';
import { IDLE_MS } from '../../learn/lib/flow.mjs';
import { pipGates, TIMING } from '../../learn/lib/motion.mjs';
import { bootFrame, pipSlot, pipTarget, render } from '../../learn/lib/render.mjs';
import { strip, width } from '../../learn/lib/text.mjs';
import { theme } from '../../learn/lib/theme.mjs';
import { allScreens, course, driver, finishedBefore, playUntil } from './learn-drive.mjs';

const CAPS = {
  full: { tty: true, depth: 8, unicode: true, links: true, win32: false },
  truecolor: { tty: true, depth: 24, unicode: true, links: true, win32: false },
  sixteen: { tty: true, depth: 4, unicode: true, links: false, win32: false },
  noColor: { tty: true, depth: 1, unicode: true, links: false, win32: false },
  ascii: { tty: true, depth: 1, unicode: false, links: false, win32: true },
};
const screens = allScreens();
const screen = (label) => screens.find(([l]) => l === label)[1];
const size = (cols, rows) => ({ cols, rows });
const SIZES = [[60, 20], [80, 24], [100, 30], [120, 40], [200, 50]];
// The detailed Pip as main hands it to render: pipSlot's size, and a pose.
const handed = (s, at, t, pose) => {
  const slot = pipSlot(s, at, t);
  return slot && { size: slot, pose };
};

// The mapping study's room per screen (build/pipmap/layout.md): small
// (20x10) needs 6 spare rows, standard (32x16) 12, and hero is not used.
// Each screen is measured at its busiest: with a toast, and on resume with
// the y/n to start over.
test('pipSlot: a raster only on boot, welcome, resume, level-up and complete, the biggest that fits, never hero', () => {
  const t = theme(CAPS.full);
  const boot = null;
  const welcome = driver().state;
  const broken = driver({ facts: { gitError: 'spawn git ENOENT' } }).state;
  const expected = [
    // Boot: 9 spare rows at 60x20, 13 at 80x24, 28 at 120x40.
    [boot, 60, 20, 'small'], [boot, 80, 24, 'standard'], [boot, 120, 40, 'standard'], [boot, 200, 50, 'standard'],
    // The welcome: none spare at 60x20, 2 at 80x24, 7 at 100x30 less a
    // toast's row; with a git error 4 at 100x30 and 14 at 120x40.
    [welcome, 60, 20, null], [welcome, 80, 24, null], [welcome, 100, 30, 'small'], [broken, 100, 30, null], [broken, 120, 40, 'standard'],
    // Resume, with the y/n and a toast: 6 spare at 60x20 less the toast's
    // two rows; 11 at 80x24 less one.
    [screen('resume'), 60, 20, null], [screen('resume'), 80, 24, 'small'], [screen('resume'), 120, 40, 'standard'],
    // Level-up: none spare at 60x20, 6 at 80x24 less a toast's row, 11 at 100x30.
    [screen('level up hinted'), 60, 20, null], [screen('level up hinted'), 80, 24, null], [screen('level up hinted'), 100, 30, 'small'], [screen('level up challenge'), 120, 40, 'standard'],
    // Complete: 2 or 3 spare at 80x24, 8 at 100x30, 18 at 120x40.
    [screen('complete'), 80, 24, null], [screen('complete'), 100, 30, 'small'], [screen('complete'), 120, 40, 'standard'],
  ];
  for (const [s, cols, rows, slot] of expected) assert.equal(pipSlot(s, size(cols, rows), t), slot, `${s?.view ?? 'boot'}${s?.facts.gitError ? ' (git error)' : ''} at ${cols}x${rows}`);
  // Pip keeps its size while a screen is up: a stray key's toast, or the
  // y/n to start over, leaves it as it was.
  const stray = { kind: 'stray', until: Infinity };
  for (const [cols, rows] of SIZES) {
    for (const [label, s] of [['welcome', welcome], ['resume', screen('resume')], ['level up hinted', screen('level up hinted')], ['complete', screen('complete')]]) {
      const plain = pipSlot(s, size(cols, rows), t);
      assert.equal(pipSlot({ ...s, toast: stray }, size(cols, rows), t), plain, `${label} at ${cols}x${rows}, a toast`);
      if (s.view === 'resume') assert.equal(pipSlot(screen('resume confirm'), size(cols, rows), t), plain, `${label} at ${cols}x${rows}, the y/n`);
    }
  }
  // The boot frame's Pip is no bigger than the next screen's: none where the
  // welcome has none, small where resume has small.
  for (const [cols, rows] of SIZES) {
    const at = size(cols, rows);
    for (const next of [welcome, screen('resume'), screen('intro')]) {
      const own = pipSlot(null, at, t);
      const cap = pipSlot(next, at, t);
      assert.equal(pipSlot(null, at, t, next), cap && (own === 'small' ? 'small' : cap), `boot before ${next.view} at ${cols}x${rows}`);
    }
  }
  // No big Pip, no raster: every other screen, and every overlay.
  for (const [label, s] of screens) {
    if (!['welcome', 'resume', 'levelup', 'complete'].includes(s.view) || s.overlay) assert.equal(pipSlot(s, size(200, 50), t), null, label);
  }
  // Only with Unicode and 256 colors or more.
  for (const caps of ['sixteen', 'noColor', 'ascii']) assert.equal(pipSlot(null, size(200, 50), theme(CAPS[caps])), null, caps);
  assert.equal(pipSlot(null, size(200, 50), theme(CAPS.truecolor)), 'standard');
  // Below the smallest window, the app draws no screen.
  assert.equal(pipSlot(null, size(59, 50), t), null);
});

// Each level-up and the complete screen of a lesson, played on the path from
// its start by a learner who finished every lesson before it.
function celebrations(id) {
  const d = driver({ course, saved: { format: 1, welcomed: true, lessons: finishedBefore(id) } });
  const out = [];
  playUntil(d, (s) => {
    if (s.lesson === id && ['levelup', 'complete'].includes(s.view) && out.at(-1)?.[1] !== s) out.push([`${id} ${s.view === 'levelup' ? `level up ${s.levelTo}` : 'complete'}`, s]);
    return s.lesson === id && s.view === 'complete';
  });
  return out;
}
// The package's sizes, from its README: small 20x10, standard 32x16.
const TALL = { small: 10, standard: 16 };
const toast = { kind: 'save', message: 'EACCES: permission denied, open .practice/learn.json' };
const BIG = [
  ...screens.filter(([, s]) => ['welcome', 'resume', 'levelup', 'complete'].includes(s.view) && !s.overlay),
  ...course.filter((l) => l.content).flatMap((l) => celebrations(l.id)),
  ['welcome, git error', driver({ facts: { gitError: 'spawn git ENOENT' } }).state],
  ['welcome, a toast', { ...driver().state, toast }],
  ['complete, a toast', { ...screen('complete'), toast }],
];
const flat = (lines) => strip(lines.join('')).replace(/[^A-Za-z0-9]/g, '');
const blank = (l) => strip(l).trim() === '';

// The glyph screen `g` and the raster screen `r` of one state: the rows
// above Pip are the same, the words beside Pip are the same, and below Pip
// every row is the same, in order, with only the padding rows over the key
// bar fewer, by the rows the raster adds.
function keepsEveryRow(g, r, tall, where) {
  const show = `${where}\n${g.map(strip).join('\n')}\n----\n${r.map(strip).join('\n')}`;
  const start = g.findIndex((l) => strip(l).includes('╭───┴───╮')) - 1;
  assert.ok(start >= 0, `no Pip in the glyph screen: ${show}`);
  assert.deepEqual(r.slice(0, start), g.slice(0, start), `the rows above Pip: ${show}`);
  let gEnd = start + 4;
  while (gEnd < g.length && !blank(g[gEnd])) gEnd += 1;
  let rEnd = start + tall;
  while (rEnd < r.length && !blank(r[rEnd])) rEnd += 1;
  assert.equal(flat(r.slice(start, rEnd)), flat(g.slice(start, gEnd)), `the words beside Pip: ${show}`);
  const extra = (rEnd - start) - (gEnd - start);
  let i = g.length - 1;
  let j = r.length - 1;
  while (j >= rEnd && g[i] === r[j]) [i, j] = [i - 1, j - 1];
  let skipped = 0;
  while (skipped < extra && i >= gEnd && g[i] === '') [i, skipped] = [i - 1, skipped + 1];
  while (j >= rEnd && g[i] === r[j]) [i, j] = [i - 1, j - 1];
  assert.deepEqual([i, j, skipped], [gEnd - 1, rEnd - 1, extra], `the rows below Pip: ${show}`);
}

test('the raster takes only rows the screen pads with: every row the 9x4 Pip\'s screen shows is still there, at every size', () => {
  const t = theme(CAPS.full);
  const drawn = new Set();
  for (const [cols, rows] of SIZES) {
    const at = size(cols, rows);
    const cases = [['boot', null, (pose) => bootFrame(0, at, t, undefined, pose && handed(null, at, t, pose)), 'working'], ...BIG.map(([label, s]) => [label, s, (pose) => render(s, at, t, undefined, pose && handed(s, at, t, pose)), s.view === 'complete' ? 'success' : 'ready'])];
    for (const [label, s, draw, state] of cases) {
      const slot = pipSlot(s, at, t);
      const where = `${label} at ${cols}x${rows} (${slot})`;
      const g = draw(null);
      const r = draw(restPose(state));
      assert.equal(r.length, rows, where);
      r.forEach((l, k) => assert.ok(width(l) <= cols - 1, `${where}, line ${k + 1} is ${width(l)} wide`));
      if (!slot) {
        assert.deepEqual(r, g, `${where}: no slot, the 9x4 Pip`);
        continue;
      }
      drawn.add(`${s?.view ?? 'boot'} ${slot}`);
      keepsEveryRow(g, r, TALL[slot], where);
    }
  }
  // Every big-Pip screen drew both sizes somewhere.
  for (const view of ['boot', 'welcome', 'resume', 'levelup', 'complete']) for (const slot of ['small', 'standard']) assert.ok(drawn.has(`${view} ${slot}`), `${view} ${slot}`);
});

// A line's cells, each with the colors it is drawn in: its SGR foreground
// and background parameters, null for the terminal's own.
function cellsOf(line) {
  const cells = [];
  let fg = null;
  let bg = null;
  for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
    const m = part.match(/^\x1b\[([0-9;]*)m$/);
    if (!m) {
      for (const ch of part) cells.push({ ch, fg, bg });
      continue;
    }
    const p = m[1].split(';');
    for (let k = 0; k < p.length; k++) {
      if (p[k] === '0' || p[k] === '') [fg, bg] = [null, null];
      else if (p[k] === '39') fg = null;
      else if (p[k] === '49') bg = null;
      else if (p[k] === '38' || p[k] === '48') {
        const n = p[k + 1] === '5' ? 3 : 5;
        const code = p.slice(k, k + n).join(';');
        if (p[k] === '38') fg = code;
        else bg = code;
        k += n - 1;
      } else if (/^(3[0-7]|9[0-7])$/.test(p[k])) fg = p[k];
    }
  }
  return cells;
}
// Pip's eyes are #F2CC60 (the package's README): 221 in 256 colors.
const EYES = '38;5;221';
// The raster row Pip's eyes are on: the one with the most inked cells in
// the eyes' yellow (the antenna's tip is yellow too, but smaller).
const eyesRow = (lines, from, tall) => {
  const yellow = lines.slice(from, from + tall).map((l) => cellsOf(l).filter((c) => c.ch !== ' ' && (c.fg === EYES || c.bg === EYES.replace('38', '48'))).length);
  return from + yellow.indexOf(Math.max(...yellow));
};

// Where things sit does not depend on the pose: each screen here draws Pip
// awake, in its ready pose, to find its eyes.
test('beside the raster, text starts on the row of Pip\'s eyes, and the banner sits around it where it fits, else the plain word on it', () => {
  const t = theme(CAPS.full);
  const awake = restPose('ready');
  // The raster's first row is the 9x4 Pip's, on the screen without it.
  const pipTop = (lines) => lines.findIndex((l) => strip(l).includes('╭───┴───╮')) - 1;
  const check = (label, draw, slot, beside) => {
    const top = pipTop(draw(null));
    const lines = draw({ size: slot, pose: awake });
    const face = eyesRow(lines, top, TALL[slot]);
    const plain = lines.map(strip);
    const where = `${label} (${slot})\n${plain.join('\n')}`;
    assert.ok(face > top + 1, where);
    // Only Pip's rows: the complete screen's header says COMPLETE too.
    beside(plain.map((l, k) => (k >= top && k < top + TALL[slot] ? l : '')), face, where);
  };
  const startsAt = (text) => (plain, face, where) => assert.equal(plain.findIndex((l) => l.includes(text)), face, where);
  for (const [cols, rows] of [[60, 20], [80, 24], [120, 40], [200, 50]]) {
    const at = size(cols, rows);
    if (pipSlot(null, at, t)) check(`boot at ${cols}x${rows}`, (pip) => bootFrame(0, at, t, undefined, pip), pipSlot(null, at, t), startsAt(C.askingGit));
    const resume = screen('resume');
    if (pipSlot(resume, at, t)) check(`resume at ${cols}x${rows}`, (pip) => render(resume, at, t, undefined, pip), pipSlot(resume, at, t), startsAt(C.welcomeBack));
  }
  // The welcome's greeting, three to five rows, fits under the face row of either size.
  for (const [cols, rows] of [[120, 40], [200, 50], [60, 50]]) {
    const s = driver().state;
    check(`welcome at ${cols}x${rows}`, (pip) => render(s, size(cols, rows), t, undefined, pip), pipSlot(s, size(cols, rows), t), startsAt(C.hi('Sam').split(' ').slice(0, 2).join(' ')));
  }
  // The banners, in block letters, on the three rows around the face; at
  // 60 columns beside standard Pip they do not fit, and the word is on it.
  const banner = (word) => (plain, face, where) => {
    const rowsOf = plain.flatMap((l, k) => (l.includes('█') ? [k] : []));
    assert.deepEqual(rowsOf, [face - 1, face, face + 1], where);
    assert.ok(!plain.some((l) => l.includes(word)), where);
  };
  const word = (text) => (plain, face, where) => assert.equal(plain.findIndex((l) => l.includes(text)), face, where);
  for (const [label, text] of [['level up hinted', C.levelUp], ['complete', C.complete]]) {
    const s = screen(label);
    for (const [cols, rows, has] of [[120, 40, banner], [200, 50, banner], [60, 50, word]]) {
      const at = size(cols, rows);
      assert.equal(pipSlot(s, at, t), 'standard', `${label} at ${cols}x${rows}`);
      check(`${label} at ${cols}x${rows}`, (pip) => render(s, at, t, undefined, pip), 'standard', has(text));
    }
    assert.equal(pipSlot(s, size(100, 30), t), 'small', `${label} at 100x30`);
    check(`${label} at 100x30`, (pip) => render(s, size(100, 30), t, undefined, pip), 'small', banner(text));
  }
});

// The package paints every pixel it leaves empty in its backdrop, #1E1E1E
// (README): 234 in 256 colors. It softens each edge toward that backdrop.
test('the raster\'s cells: the package\'s pixels two to a cell, its backdrop and its soft edges the terminal\'s own background, in 256 colors or 24-bit where the terminal reports it', () => {
  const cases = [
    ['boot at 60x20', 'small', 'working', (t, pip) => bootFrame(0, size(60, 20), t, undefined, pip)],
    ['complete at 120x40', 'standard', 'success', (t, pip) => render(screen('complete'), size(120, 40), t, undefined, pip)],
  ];
  for (const [label, slot, state, draw] of cases) {
    const [cols, tall] = { small: [20, 10], standard: [32, 16] }[slot];
    // Over black and over white: how much of each pixel is Pip, 0 to 1.
    const over = (background) => rasterizePip(restPose(state), { columns: cols, rows: tall, palette: { background } }).pixels;
    const [dark, light] = [over('#000000'), over('#FFFFFF')];
    const at3 = (row, col, under) => ((row * 2 + under) * cols + col) * 3;
    const cover = (row, col, under) => 1 - [0, 1, 2].reduce((n, k) => n + light[at3(row, col, under) + k] - dark[at3(row, col, under) + k], 0) / 765;
    const ink = (row, col, under) => cover(row, col, under) >= 0.5;
    const whole = (row, col, under) => cover(row, col, under) === 1;
    let soft = 0;
    for (const depth of [8, 24]) {
      const t = theme({ ...CAPS.full, depth });
      const lines = draw(t, { size: slot, pose: restPose(state) });
      const where = `${label}, depth ${depth}`;
      // The raster's top left is the 9x4 Pip's, on the screen without it.
      const glyph = draw(t, null).map(strip);
      const top = glyph.findIndex((l) => l.includes('╭───┴───╮')) - 1;
      const left = glyph[top + 1].indexOf('╭');
      // The package's own cells at this depth, each with both halves'
      // colors, the backdrop's too: its color picks.
      const own = renderPip(restPose(state), { size: slot, depth }).map(cellsOf);
      let spaces = 0;
      for (let r = 0; r < tall; r++) {
        const cells = cellsOf(lines[top + r]).slice(left, left + cols);
        assert.equal(cells.length, cols, `${where}, row ${r}`);
        cells.forEach((c, k) => {
          const at = `${where}, row ${r} cell ${k}: ${JSON.stringify(c)}`;
          for (const code of [c.fg, c.bg].filter(Boolean)) assert.match(code, depth === 24 ? /^[34]8;2;/ : /^[34]8;5;/, at);
          // A space keeps the terminal's background; an ink half alone is
          // over the terminal's background; two are both colors. A pixel
          // less than half Pip is background.
          if (!ink(r, k, 0) && !ink(r, k, 1)) {
            assert.deepEqual([c.ch, c.bg], [' ', null], at);
            spaces += 1;
          } else if (!ink(r, k, 1)) assert.deepEqual([c.ch, c.bg], ['▀', null], at);
          else if (!ink(r, k, 0)) assert.deepEqual([c.ch, c.bg], ['▄', null], at);
          else assert.equal(c.ch, '▀', at);
          soft += [0, 1].filter((u) => ink(r, k, u) && !whole(r, k, u)).length;
          // Where a pixel is all Pip, its color is the package's pick.
          const { fg, bg } = own[r][k];
          if (c.ch === '▀' && whole(r, k, 0)) assert.equal(c.fg, fg, at);
          if (c.ch === '▀' && ink(r, k, 1) && whole(r, k, 1)) assert.equal(c.bg, bg, at);
          if (c.ch === '▄' && whole(r, k, 1)) assert.equal(c.fg, bg.replace(/^48/, '38'), at);
          // A soft edge is Pip's own color, not darkened toward the
          // package's backdrop: Pip's colors all have a channel of 0xCE or more.
          if (depth === 24) for (const code of [c.fg, c.bg].filter(Boolean)) assert.ok(Math.max(...code.split(';').slice(2).map(Number)) >= 0xCE, at);
        });
        // The row is exactly the raster's width: nothing after it but text, three cells on.
        const rest = cellsOf(lines[top + r]).slice(left + cols);
        assert.ok(rest.slice(0, 3).every((c) => c.ch === ' ' && c.bg === null), `${where}, row ${r}: ${strip(lines[top + r])}`);
      }
      // Nothing of the raster above or before it.
      assert.ok(lines.slice(0, top).every((l) => !/[▀▄]/.test(l)), where);
      // No backdrop anywhere: not a rectangle, not a cell.
      const all = lines.join('\n');
      assert.doesNotMatch(all, depth === 24 ? /[34]8;2;30;30;30m/ : /[34]8;5;234\b/, where);
      assert.ok(spaces > 0, where);
      // Pip's eyes, #F2CC60, where they are open: working narrows them.
      if (state !== 'working') assert.ok(lines.slice(top, top + tall).some((l) => l.includes(depth === 24 ? '8;2;242;204;96' : '8;5;221')), where);
    }
    assert.ok(soft > 0, `${label}: some soft edges are drawn`);
  }
});

// What Pip shows is what the app saw (the ticket's map): git still
// answering at boot is working; the welcome, resume and level-up ready; the
// complete screen success. The app has no AI, so never thinking; nothing
// waits on the learner that the other states don't say, so never waiting.
test('pipTarget: Pip\'s state for each big-Pip screen, a new reaction only for a new level-up or complete screen, and none for one already over', () => {
  assert.deepEqual(pipTarget(null, 5_000), { state: 'working' });
  for (const label of ['welcome', 'resume', 'resume confirm']) {
    const s = screen(label);
    // A change of state is timed from the screen's arrival.
    assert.deepEqual(pipTarget(s, s.now + 40), { state: 'ready', since: s.fx.view }, label);
  }
  const d = driver({ course, saved: { format: 1, welcomed: true, lessons: finishedBefore('b-2') } });
  const seen = [];
  playUntil(d, (s) => {
    if (s.lesson === 'b-2' && ['levelup', 'complete'].includes(s.view) && seen.at(-1)?.view !== s.view + s.levelTo) seen.push({ view: s.view + s.levelTo, s });
    return s.lesson === 'b-2' && s.view === 'complete';
  });
  const [hinted, challenge, complete] = seen.map((x) => x.s);
  assert.deepEqual([hinted.levelTo, challenge.levelTo, complete.view], ['hinted', 'challenge', 'complete']);
  for (const [s, state] of [[hinted, 'ready'], [challenge, 'ready'], [complete, 'success']]) {
    const now = pipTarget(s, s.fx.view + 40);
    assert.equal(now.state, state);
    assert.equal(now.since, s.fx.view);
    assert.equal(now.immediate, false, `${s.view}: it just arrived`);
    assert.equal(typeof now.eventId, 'string');
    // The same arrival at every draw, not the draw's time.
    assert.equal(pipTarget(s, s.fx.view + 400).eventId, now.eventId);
    // Over (the level-up's 0.8 s, the complete screen's 1.2 s): no replay.
    assert.deepEqual(pipTarget(s, s.fx.view + 5_000), { ...now, immediate: true });
  }
  assert.notEqual(hinted.fx.view, challenge.fx.view);
  assert.notEqual(pipTarget(hinted, hinted.fx.view).eventId, pipTarget(challenge, challenge.fx.view).eventId, 'each level-up is a new one');
  // With the package's controller, as main uses it: drawn as the screen
  // arrives, Pip hops with sparks; first drawn once the screen's moment is
  // over (after a resize, say), it shows success still.
  const drawnAt = (at) => {
    const pip = createPip({ at: complete.now - 10_000 });
    const { state, since, ...event } = pipTarget(complete, at);
    pip.setState(state, { at: since, ...event });
    return pip.pose(at + 400, { ambient: false });
  };
  assert.ok(drawnAt(complete.fx.view).spark > 0.5, 'a hop with sparks');
  assert.deepEqual(drawnAt(complete.fx.view + 5_000), restPose('success'));
});

// The gates main hands Pip's controller in each draw (ticket 170): its
// ambient life only where the app's own ambient loops may draw.
test('pipGates: no motion with motion off, an overlay or idle; ambient life only where ambientAllowed says, never beside resume\'s y/n, on level-up or on complete; breathing only on a local truecolor terminal', () => {
  const on = { motion: true, truecolor: true, remote: false };
  const welcome = driver().state;
  const late = welcome.now + TIMING.graceMax;
  assert.deepEqual(pipGates(welcome, late, on), { motion: true, ambient: true, breathing: true });
  assert.deepEqual(pipGates(welcome, welcome.now + TIMING.graceMin, on), { motion: true, ambient: false, breathing: false }, 'still reading');
  assert.deepEqual(pipGates(welcome, late, { ...on, truecolor: false }), { motion: true, ambient: true, breathing: false }, '256 colors');
  assert.deepEqual(pipGates(welcome, late, { ...on, remote: true }), { motion: true, ambient: true, breathing: false }, 'remote');
  assert.deepEqual(pipGates(welcome, late, { ...on, motion: false }), { motion: false, ambient: false, breathing: false }, 'motion off');
  assert.deepEqual(pipGates({ ...welcome, overlay: 'help' }, late, on), { motion: false, ambient: false, breathing: false }, 'an overlay');
  // Idle alone stops it: frozen().
  assert.equal(pipGates(welcome, welcome.lastActivity + IDLE_MS, on).motion, false, 'idle');
  assert.equal(pipGates(welcome, welcome.lastActivity + IDLE_MS - 1, on).motion, true);
  // The boot frame: git running, no learner yet.
  assert.deepEqual(pipGates(null, 5_000, on), { motion: true, ambient: false, breathing: false });
  // Screens with no ambient loop of the app's: reactions and changes only.
  for (const label of ['resume', 'resume confirm', 'level up hinted', 'complete']) {
    const s = screen(label);
    for (const ms of [0, 5_000, TIMING.graceMax, 60_000]) assert.deepEqual(pipGates(s, s.now + ms, on), { motion: true, ambient: false, breathing: false }, `${label} at +${ms} ms`);
  }
});

// Breathing redraws the raster every 120 ms: only on a local truecolor
// terminal. Over SSH or in a Codespace the terminal is remote.
test('caps.remote: over SSH (SSH_CONNECTION or SSH_TTY) or in a Codespace, and nothing else changes', () => {
  const tty = { isTTY: true, getColorDepth: () => 24 };
  const env = { TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  const local = capabilities(tty, env, 'linux', []);
  assert.equal(local.remote, false);
  for (const ssh of [{ SSH_CONNECTION: '10.0.0.2 52144 10.0.0.1 22' }, { SSH_TTY: '/dev/pts/3' }]) {
    const remote = capabilities(tty, { ...env, ...ssh }, 'linux', []);
    assert.deepEqual(remote, { ...local, remote: true }, Object.keys(ssh)[0]);
  }
  assert.deepEqual(capabilities(tty, { ...env, CODESPACES: 'true' }, 'linux', []), { ...local, remote: true, codespace: true }, 'a Codespace');
});
