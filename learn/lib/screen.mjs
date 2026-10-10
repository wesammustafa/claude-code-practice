// The terminal: the alternate screen, a hidden cursor, bracketed paste, and
// one write per frame. leave() restores everything and is safe to call twice.
import { writeSync } from 'node:fs';

export const ENTER = '\x1b[?1049h\x1b[?25l\x1b[?2004h\x1b[2J';
export const LEAVE = '\x1b[?2004l\x1b[?25h\x1b[?1049l';

// One frame: synchronized output, home, each line cleared to its end.
export const frame = (lines) => `\x1b[?2026h\x1b[H${lines.map((l) => `${l}\x1b[0m\x1b[K`).join('\r\n')}\x1b[J\x1b[?2026l`;

export function openScreen(stdout) {
  let open = true;
  stdout.write(ENTER);
  return {
    draw(lines) {
      if (open) stdout.write(frame(lines));
    },
    clear() {
      if (open) stdout.write('\x1b[2J');
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
}
