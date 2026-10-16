// The terminal: the alternate screen, a hidden cursor, bracketed paste, and
// one write per frame, none for a frame already on screen. leave() restores
// everything and is safe to call twice.
import { writeSync } from 'node:fs';

export const ENTER = '\x1b[?1049h\x1b[?25l\x1b[?2004h\x1b[2J';
export const LEAVE = '\x1b[?2004l\x1b[?25h\x1b[?1049l';

// One frame: synchronized output, home, each line cleared to its end.
export const frame = (lines) => `\x1b[?2026h\x1b[H${lines.map((l) => `${l}\x1b[0m\x1b[K`).join('\r\n')}\x1b[J\x1b[?2026l`;

// Only the rows that changed, each moved to and cleared on its own (`rows`
// holds 0-based indexes). A line opens its own colors, so a row stands alone.
export const rowFrame = (lines, rows) => `\x1b[?2026h${rows.map((i) => `\x1b[${i + 1};1H${lines[i]}\x1b[0m\x1b[K`).join('')}\x1b[?2026l`;

// A full frame at least this often, even when nothing changed, so a screen
// that stray output damaged repairs itself.
const REFRESH_MS = 10_000;
// The write budget, guesses for ticket 126 to tune. TTY writes are
// synchronous on POSIX, so a slow terminal shows as a slow write() call: 3 of
// the last 10 motion frames over 12 ms stop motion for the sitting.
const SLOW_WRITE_MS = 12;
const SLOW_OF_LAST = [3, 10];
// On Windows they are asynchronous, so a slow terminal shows as a slow
// 'drain' instead: two over 100 ms within 10 s do the same. One false write
// alone does not: a frame is a few KB, far under the 16 KB high-water mark.
const SLOW_DRAIN_MS = 100;
const SLOW_DRAINS = [2, 10_000];

// `clock` times the writes (main.mjs passes performance.now). With `motion`,
// a frame after a full one rewrites only the rows that changed, unless more
// than half did; without it, every frame is full, as it always was. The first
// frame, the one after clear() and one every 10 s are full in every mode.
export function openScreen(stdout, { clock, motion = false }) {
  let open = true;
  // Whether each of the last motion frames was slow, newest last.
  const slow = [];
  // When each slow drain of the last 10 s ended.
  let drains = [];
  // What the terminal shows now, as the lines of the last frame written, and
  // when the last full frame went out.
  let shown = null;
  let fullAt = -Infinity;
  // A write came back false: until 'drain', only the newest frame is kept.
  let pending = false;
  let pendingFrom = 0;
  let newest = null;
  stdout.write(ENTER);
  const screen = {
    // Writes the frame unless the terminal already shows it; true if it wrote.
    draw(lines) {
      if (!open) return false;
      if (pending) {
        newest = lines;
        return false;
      }
      const at = clock();
      const changed = shown?.length === lines.length ? lines.flatMap((l, i) => (l === shown[i] ? [] : [i])) : null;
      const due = at - fullAt >= REFRESH_MS;
      if (changed?.length === 0 && !due) return false;
      const full = !changed || !motion || changed.length > lines.length / 2 || due;
      shown = lines;
      const began = clock();
      if (!stdout.write(full ? frame(lines) : rowFrame(lines, changed))) {
        pending = true;
        pendingFrom = began;
        stdout.once('drain', drained);
      }
      const took = clock() - began;
      if (full) fullAt = at;
      if (motion) {
        slow.push(took > SLOW_WRITE_MS);
        if (slow.length > SLOW_OF_LAST[1]) slow.shift();
        if (slow.filter(Boolean).length >= SLOW_OF_LAST[0]) motion = false;
      }
      return true;
    },
    // False once the write budget turned motion off.
    get motion() {
      return motion;
    },
    // The terminal may show anything now (a resize): the next frame is full.
    clear() {
      shown = null;
    },
    leave() {
      if (!open) return;
      open = false;
      // Synchronously: stdout may be asynchronous (Windows, pipes), and this
      // must land before the process exits.
      try {
        if (typeof stdout.fd === 'number') writeSync(stdout.fd, LEAVE);
        else stdout.write(LEAVE);
      } catch {
        stdout.write(LEAVE);
      }
    },
  };
  function drained() {
    pending = false;
    const at = clock();
    if (motion && at - pendingFrom > SLOW_DRAIN_MS) {
      drains = [...drains.filter((t) => at - t < SLOW_DRAINS[1]), at];
      if (drains.length >= SLOW_DRAINS[0]) motion = false;
    }
    const lines = newest;
    newest = null;
    if (lines) screen.draw(lines);
  }
  return screen;
}
