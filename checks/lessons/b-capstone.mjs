// The Beginner capstone: fix the bug in capstone/beginner-bug.md from plan to
// commit. It checks every Beginner Exit statement that leaves state behind:
// B1, B2, B3 and B5. B4 is self-assessed.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { items as b1 } from './b-1.mjs';
import { items as b3 } from './b-3.mjs';

export const title = 'Beginner capstone';

const TEST_FILE = /(^|\/)(tests?|spec|__tests__)\/|[._-](test|spec)\.[a-z0-9]+$/i;
const lines = (text) => (text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const statusPaths = (text) => (text ?? '').split(/\r?\n/).filter((l) => l.trim())
  .map((l) => l.slice(3).split(' -> ').pop().replace(/^"|"$/g, '').trim())
  .filter((p) => !p.startsWith('.practice/'));

export const items = [
  b1[0],
  {
    text: '`.practice/capstone-before.txt`, saved while the plan was on screen, lists no changed files',
    local: true,
    check(repo) {
      const before = repo.read('.practice/capstone-before.txt');
      if (before === null) return 'While the plan is on screen, run `git status --porcelain > .practice/capstone-before.txt`.';
      const changed = statusPaths(before);
      return changed.length ? `Files had changed before you approved the plan: ${changed.join(', ')}.` : true;
    },
  },
  {
    text: 'the commit in `.practice/capstone-commit.txt` changes only files listed in `.practice/capstone-plan.txt`, including a test',
    local: true,
    check(repo) {
      const plan = new Set(lines(repo.read('.practice/capstone-plan.txt')));
      if (!plan.size) return 'Save the files the plan will change, one per line, to `.practice/capstone-plan.txt` before you approve.';
      const sha = lines(repo.read('.practice/capstone-commit.txt'))[0];
      if (!sha) return 'After you commit the fix, run `git rev-parse HEAD > .practice/capstone-commit.txt`.';
      let files;
      try {
        files = repo.git('show', '--name-only', '--format=', sha).split('\n').filter(Boolean);
      } catch {
        return `\`.practice/capstone-commit.txt\` names ${sha}, which is not a commit in this repository.`;
      }
      const extra = files.filter((f) => !plan.has(f));
      if (extra.length) return `The commit changes files the plan didn't name: ${extra.join(', ')}.`;
      return files.some((f) => TEST_FILE.test(f)) ? true : 'The commit changes no test file. Add the test the bug report asks for.';
    },
  },
  {
    text: 'the reported bug is fixed: a missing folder in `linkcheck.json` makes the tool exit with code 2',
    check(repo) {
      const dir = mkdtempSync(join(tmpdir(), 'linkcheck-'));
      try {
        writeFileSync(join(dir, 'linkcheck.json'), '{ "files": ["docs"] }\n');
        const run = spawnSync(process.execPath, [join(repo.dir, 'src', 'cli.js'), dir], { encoding: 'utf8', timeout: 30_000 });
        return run.status === 2 ? true : `The tool exited with code ${run.status}, not 2. Read capstone/beginner-bug.md again.`;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  b3[1],
  {
    text: 'a committed CLAUDE.md names the test command, `npm test`',
    check(repo) {
      for (const path of ['CLAUDE.md', '.claude/CLAUDE.md']) {
        try {
          return repo.git('show', `HEAD:${path}`).includes('npm test') ? true : 'The committed CLAUDE.md doesn\'t mention `npm test`. Add the test command and commit it.';
        } catch { /* not committed at this path */ }
      }
      return 'There is no committed CLAUDE.md. Run `/init` in a session, check the file, and commit it.';
    },
  },
  b3[2],
];
