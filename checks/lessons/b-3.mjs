// Your first change, from request to commit (Beginner, lesson 3). The Learner
// saves the sha of the commit they made; the check reads that commit, runs
// the tests and looks for anything left uncommitted.
import { spawnSync } from 'node:child_process';
import { isTestFile, TEST_NAMES } from '../paths.mjs';

export const title = 'Your first change, from request to commit';

const SAVE_COMMIT = '`git rev-parse HEAD > .practice/b-3-commit.txt`';

function savedCommit(repo) {
  const text = repo.read('.practice/b-3-commit.txt');
  if (text === null || !text.trim()) return { error: `After you commit, run ${SAVE_COMMIT}.` };
  const sha = text.trim().split(/\s+/)[0];
  try {
    repo.git('cat-file', '-e', `${sha}^{commit}`);
  } catch {
    return { error: `\`.practice/b-3-commit.txt\` names ${sha}, which is not a commit in this repository.` };
  }
  return { sha };
}

export const testsPass = {
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
    const save = '`<your test command>; echo $? > .practice/b-3-tests.txt` (Windows: `<your test command>; $LASTEXITCODE > .practice/b-3-tests.txt`)';
    if (saved === null) return `This repository has no \`npm test\` script. Run your tests, then save their exit code: ${save}.`;
    const code = saved.trim();
    if (code === '0') return true;
    // In PowerShell, `$?` is True or False rather than an exit code.
    if (!/^-?\d+$/.test(code)) return `\`.practice/b-3-tests.txt\` holds "${code}", not an exit code. Save it again: ${save}.`;
    return `\`.practice/b-3-tests.txt\` says the tests exited with ${code}, not 0.`;
  },
};

export const nothingUncommitted = {
  text: 'nothing is left uncommitted',
  check(repo) {
    const status = repo.git('status', '--porcelain').split('\n').filter((l) => l && !l.slice(3).startsWith('.practice/'));
    // Plain `git stash` leaves new, untracked files behind.
    return status.length ? `These changes are uncommitted: ${status.map((l) => l.slice(3)).join(', ')}. Commit them, or set them aside with \`git stash push --include-untracked\`.` : true;
  },
};

export const items = [
  {
    text: 'the commit named in `.practice/b-3-commit.txt` changes a test file and at least one other file',
    local: true,
    check(repo) {
      const { sha, error } = savedCommit(repo);
      if (error) return error;
      const files = repo.git('show', '--name-only', '--format=', sha).split('\n').filter(Boolean);
      const tests = files.filter(isTestFile);
      if (!tests.length) return `The commit changes no test file (${files.join(', ')}); the check counts ${TEST_NAMES}. Ask Claude to add the test and amend the commit with \`git commit --amend\`, then save it again: ${SAVE_COMMIT}.`;
      if (tests.length === files.length) return `The commit changes only tests (${files.join(', ')}). If the code change is in an earlier commit, ask Claude to combine the two commits into one, then save it again: ${SAVE_COMMIT}.`;
      return true;
    },
  },
  testsPass,
  nothingUncommitted,
];
