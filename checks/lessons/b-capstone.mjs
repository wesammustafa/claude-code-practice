// The Beginner capstone: fix the bug in capstone/beginner-bug.md from plan to
// commit. It checks the parts of the Beginner Exit statements B1, B2, B3 and
// B5 that a script can see in files and git. The rest, B4 and the new-session
// half of B5 included, is self-assessed on the capstone page.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { versionSaved } from './b-1.mjs';
import { testsPass, nothingUncommitted } from './b-3.mjs';
import { isTestFile, planPaths, statusPaths } from '../paths.mjs';

export const title = 'Beginner capstone';

const lines = (text) => (text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const SAVE_COMMIT = '`git rev-parse HEAD > .practice/capstone-commit.txt`';

export const items = [
  versionSaved,
  {
    text: '`.practice/capstone-before.txt`, saved while the plan was on screen, lists no changed files',
    local: true,
    check(repo) {
      const before = repo.read('.practice/capstone-before.txt');
      if (before === null) return 'While the plan is on screen, run `git status --porcelain > .practice/capstone-before.txt`.';
      const changed = statusPaths(before);
      return changed.length ? `Files had changed before you approved the plan: ${changed.join(', ')}. Start from a clean tree (commit them, or set them aside with \`git stash push --include-untracked\`), stay in plan mode until you approve, and save this file while the plan is on screen.` : true;
    },
  },
  {
    text: 'the commit in `.practice/capstone-commit.txt` changes only files listed in `.practice/capstone-plan.txt`, including a test',
    local: true,
    check(repo) {
      const plan = planPaths(repo.read('.practice/capstone-plan.txt'), repo.dir);
      if (!plan.size) return 'Save the files the plan will change, one per line, to `.practice/capstone-plan.txt` before you approve.';
      const sha = lines(repo.read('.practice/capstone-commit.txt'))[0];
      if (!sha) return `After you commit the fix, run ${SAVE_COMMIT}.`;
      let files;
      try {
        files = repo.git('show', '--name-only', '--format=', sha).split('\n').filter(Boolean);
      } catch {
        return `\`.practice/capstone-commit.txt\` names ${sha}, which is not a commit in this repository.`;
      }
      const extra = files.filter((f) => !plan.has(f));
      if (extra.length) return `The commit changes files the plan didn't name: ${extra.join(', ')}. If the plan you approved named them, add them to \`.practice/capstone-plan.txt\`. If not, take them out of the commit, set them aside with \`git stash push --include-untracked\`, and run ${SAVE_COMMIT} again.`;
      return files.some(isTestFile) ? true : `The commit changes no test file. Put the test the bug report asks for in the same commit as the fix, then run ${SAVE_COMMIT} again.`;
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
  testsPass,
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
  nothingUncommitted,
];
