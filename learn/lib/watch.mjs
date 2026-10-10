// Notices file changes in the practice copy: its root, `.practice/` (armed
// again when it appears) and `.git/` for commits and staging. Events only
// speed things up; a poll in main.mjs is the truth where events don't arrive
// (WSL on /mnt/c, network folders).
import { existsSync, watch } from 'node:fs';
import { join } from 'node:path';

export function watchDirs(root, onChange, { debounceMs = 150 } = {}) {
  const watchers = new Map();
  let timer = null;
  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      arm();
      onChange();
    }, debounceMs);
  };
  const arm = () => {
    for (const dir of [root, join(root, '.practice'), join(root, '.git')]) {
      if (watchers.has(dir) || !existsSync(dir)) continue;
      try {
        const w = watch(dir, { persistent: false }, fire);
        w.on('error', () => {
          w.close();
          watchers.delete(dir);
        });
        watchers.set(dir, w);
      } catch {
        // Not watchable here: the poll covers it.
      }
    }
  };
  arm();
  return {
    dirs: () => [...watchers.keys()],
    close() {
      clearTimeout(timer);
      for (const w of watchers.values()) w.close();
      watchers.clear();
    },
    arm,
  };
}
