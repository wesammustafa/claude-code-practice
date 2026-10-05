// Read-only access to the repository a check inspects: its files, its config
// and its git state. Checks never run Claude Code or read its replies.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function openRepo(dir) {
  return {
    dir,
    exists: (path) => existsSync(join(dir, path)),
    read: (path) => (existsSync(join(dir, path)) ? readFileSync(join(dir, path), 'utf8') : null),
    git: (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(),
  };
}
