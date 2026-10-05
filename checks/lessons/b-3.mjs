// Your first change, from request to commit (Beginner, lesson 3). The Learner
// saves the sha of the commit they made; the check reads that commit, runs
// the tests and looks for anything left uncommitted.
import { spawnSync } from 'node:child_process';

export const title = 'Your first change, from request to commit';

const TEST_FILE = /(^|\/)(tests?|spec|__tests__)\/|[._-](test|spec)\.[a-z0-9]+$/i;

function savedCommit(repo) {
  const text = repo.read('.practice/b-3-commit.txt');
  if (text === null || !text.trim()) return { error: 'After you commit, run `git rev-parse HEAD > .practice/b-3-commit.txt`.' };
  const sha = text.trim().split(/\s+/)[0];
  try {
    repo.git('cat-file', '-e', `${sha}^{commit}`);
  } catch {
    return { error: `\`.practice/b-3-commit.txt\` names ${sha}, which is not a commit in this repository.` };
  }
  return { sha };
}

export const items = [
  {
    text: 'the commit named in `.practice/b-3-commit.txt` changes a test file and at least one other file',
    local: true,
    check(repo) {
      const { sha, error } = savedCommit(repo);
      if (error) return error;
      const files = repo.git('show', '--name-only', '--format=', sha).split('\n').filter(Boolean);
      const tests = files.filter((f) => TEST_FILE.test(f));
      if (!tests.length) return `The commit changes no test file (${files.join(', ')}). Ask Claude to add a test for the change, then commit again.`;
      if (tests.length === files.length) return 'The commit changes only tests. Commit the code change together with its test.';
      return true;
    },
  },
  {
    text: 'the tests pass',
    check(repo) {
      const pkg = repo.read('package.json');
      let hasScript = false;
      try { hasScript = Boolean(pkg && JSON.parse(pkg).scripts?.test); } catch { /* not JSON */ }
      if (hasScript) {
        const run = spawnSync('npm', ['test', '--silent'], { cwd: repo.dir, encoding: 'utf8', shell: process.platform === 'win32', timeout: 120_000 });
        return run.status === 0 ? true : '`npm test` fails. Run it, read the first failure, and ask Claude to fix the code, not the test.';
      }
      const saved = repo.read('.practice/b-3-tests.txt');
      if (saved === null) return 'This repository has no `npm test` script. Run your tests, then save their exit code: `<your test command>; echo $? > .practice/b-3-tests.txt`.';
      return saved.trim() === '0' ? true : `\`.practice/b-3-tests.txt\` says the tests exited with ${saved.trim()}, not 0.`;
    },
  },
  {
    text: 'nothing is left uncommitted',
    check(repo) {
      const status = repo.git('status', '--porcelain').split('\n').filter((l) => l && !l.slice(3).startsWith('.practice/'));
      return status.length ? `These changes are uncommitted: ${status.map((l) => l.slice(3)).join(', ')}. Commit them or set them aside with \`git stash\`.` : true;
    },
  },
];
