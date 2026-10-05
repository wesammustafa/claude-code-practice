// The check command, run the way a Learner runs it, against a separate git
// repository created in a temporary directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const runner = join(dirname(fileURLToPath(import.meta.url)), '..', 'run.mjs');
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function repo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'practice-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

// The runner gets the environment a Learner's shell has. NODE_TEST_CONTEXT,
// set by `node --test`, would make the `npm test` a check runs skip its tests.
function check(args, env = {}) {
  const { GITHUB_ACTIONS, NODE_TEST_CONTEXT, ...rest } = process.env;
  const result = spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8', env: { ...rest, ...env } });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

test('b-1 passes in another repo, given with --dir, once the version is recorded', () => {
  const dir = repo({ '.practice/version.txt': '2.1.285 (Claude Code)\n' });
  try {
    const { code, out } = check(['b-1', '--dir', dir]);
    assert.equal(code, 0, out);
    assert.match(out, /PASS .*claude --version/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-1 fails, with a hint that names the folder it read, when nothing is recorded', () => {
  const dir = repo();
  try {
    const { code, out } = check(['b-1', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /FAIL .*claude --version/);
    assert.match(out, /claude --version > \.practice\/version\.txt/);
    assert.ok(out.includes(dir), out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-1 fails when the recorded text is not a Claude Code version', () => {
  const dir = repo({ '.practice/version.txt': 'command not found: claude\n' });
  try {
    assert.equal(check(['b-1', '--dir', dir]).code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-1 says what to look at when the version file is empty', () => {
  const dir = repo({ '.practice/version.txt': '' });
  try {
    const { code, out } = check(['b-1', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /is empty/);
    assert.match(out, /isn't found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the progress summary never fails and marks saved-state items as checked locally', () => {
  const dir = repo();
  try {
    const { code, out } = check(['all', '--summary', '--dir', dir], { GITHUB_ACTIONS: 'true' });
    assert.equal(code, 0, out);
    assert.match(out, /\| b-1 \|.*\| checked locally \|/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the assertion mode requires every lesson to fail on an unsolved repo', () => {
  const dir = repo();
  try {
    assert.equal(check(['all', '--assert', 'fail', '--dir', dir]).code, 0);
    assert.equal(check(['all', '--assert', 'pass', '--dir', dir]).code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unknown lesson id is a usage error that lists the known ones', () => {
  const { code, out } = check(['z-9']);
  assert.equal(code, 2);
  assert.match(out, /b-1/);
});

// Some shells drop the `--` in `npm run check -- b-1 --dir <path>`, so npm
// keeps --dir for itself and passes only the path on.
test('a folder given without --dir is refused, not silently ignored', () => {
  const dir = repo();
  try {
    const { code, out } = check(['b-1', dir]);
    assert.equal(code, 2, out);
    assert.match(out, /unexpected argument/);
    assert.match(out, /node checks\/run\.mjs b-1 --dir/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-1 accepts a version file that Windows PowerShell wrote as UTF-16', () => {
  const dir = repo();
  try {
    mkdirSync(join(dir, '.practice'));
    const text = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('2.1.285 (Claude Code)\r\n', 'utf16le')]);
    writeFileSync(join(dir, '.practice', 'version.txt'), text);
    const { code, out } = check(['b-1', '--dir', dir]);
    assert.equal(code, 0, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Neutral paths: the b-2 check reads only these strings, and the lesson's own
// file names here would tell Claude what the check expects.
const planned = {
  '.practice/b-2-before.txt': '',
  '.practice/b-2-plan.txt': 'src/a.js\ntest/a.test.js\n',
  '.practice/b-2-after.txt': ' M src/a.js\n M test/a.test.js\n',
};

test('b-2 passes when nothing changed before approval and only planned files changed after', () => {
  const dir = repo(planned);
  try {
    const { code, out } = check(['b-2', '--dir', dir]);
    assert.equal(code, 0, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-2 fails when files had changed before the plan was approved, and says how to start clean', () => {
  const dir = repo({ ...planned, '.practice/b-2-before.txt': ' M src/a.js\n' });
  try {
    const { code, out } = check(['b-2', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /before you approved/);
    assert.match(out, /git stash push --include-untracked/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-2 fails when a changed file was not in the plan', () => {
  const dir = repo({ ...planned, '.practice/b-2-after.txt': ' M src/a.js\n?? test/b.test.js\n' });
  try {
    const { code, out } = check(['b-2', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /test\/b\.test\.js/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// `git status --porcelain` lists a new, untracked folder as `dir/`, not the
// files inside it.
test('b-2 counts a new folder as planned when the plan names a file inside it', () => {
  const dir = repo({
    ...planned,
    '.practice/b-2-plan.txt': 'src/a.js\ntest/fixtures/a.json\n',
    '.practice/b-2-after.txt': ' M src/a.js\n?? test/fixtures/\n',
  });
  try {
    const { code, out } = check(['b-2', '--dir', dir]);
    assert.equal(code, 0, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-2 fails for a new folder when the plan names nothing inside it', () => {
  const dir = repo({ ...planned, '.practice/b-2-after.txt': ' M src/a.js\n?? notes/\n' });
  try {
    const { code, out } = check(['b-2', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /not in the plan: notes\//);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-2 accepts plan paths written with ./, backslashes or backticks, with Windows line endings', () => {
  const dir = repo({ ...planned, '.practice/b-2-plan.txt': './src/a.js\r\n`test\\a.test.js`\r\n' });
  try {
    const { code, out } = check(['b-2', '--dir', dir]);
    assert.equal(code, 0, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-2 accepts a plan path written as the full path into the repository', () => {
  const dir = repo(planned);
  try {
    writeFileSync(join(dir, '.practice', 'b-2-plan.txt'), `${join(dir, 'src', 'a.js')}\ntest/a.test.js\n`);
    const { code, out } = check(['b-2', '--dir', dir]);
    assert.equal(code, 0, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-2 fails when nothing was recorded after approving', () => {
  const dir = repo({ ...planned, '.practice/b-2-after.txt': '' });
  try {
    assert.equal(check(['b-2', '--dir', dir]).code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A repository with one commit that changes code and its test, like the one
// the Learner makes in lesson b-3, and the commit's sha saved for the check.
function committedRepo({ testScript = 'node -e "process.exit(0)"', files = { 'src/links.js': 'export {}\n', 'test/links.test.js': '// test\n' } } = {}) {
  const dir = repo({ 'package.json': JSON.stringify({ scripts: { test: testScript } }) });
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'start');
  git('add', 'package.json');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'package');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'Check links that have a title');
  mkdirSync(join(dir, '.practice'), { recursive: true });
  writeFileSync(join(dir, '.practice', 'b-3-commit.txt'), `${git('rev-parse', 'HEAD')}\n`);
  writeFileSync(join(dir, '.git', 'info', 'exclude'), '.practice/\n');
  return dir;
}

test('b-3 passes for a commit that changes code and a test, with the tests passing and the tree clean', () => {
  const dir = committedRepo();
  try {
    const { code, out } = check(['b-3', '--dir', dir]);
    assert.equal(code, 0, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-3 fails when the commit changes no test file, and says to amend it and save it again', () => {
  const dir = committedRepo({ files: { 'src/links.js': 'export {}\n' } });
  try {
    const { code, out } = check(['b-3', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /no test file/);
    assert.match(out, /git commit --amend/);
    assert.match(out, /git rev-parse HEAD > \.practice\/b-3-commit\.txt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-3 fails when the commit changes only tests, and says to combine it with the code change', () => {
  const dir = committedRepo({ files: { 'test/links.test.js': '// test\n' } });
  try {
    const { code, out } = check(['b-3', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /only tests/);
    assert.match(out, /combine/);
    assert.match(out, /git rev-parse HEAD > \.practice\/b-3-commit\.txt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-3 counts test files named the pytest, Java and .NET way', () => {
  for (const files of [
    { 'links.py': 'x = 1\n', 'test_links.py': 'def test_x(): pass\n' },
    { 'src/Links.java': 'class Links {}\n', 'src/LinksTest.java': 'class LinksTest {}\n' },
    { 'App/Links.cs': 'class Links {}\n', 'App.Tests/LinksTests.cs': 'class LinksTests {}\n' },
  ]) {
    const dir = committedRepo({ files });
    try {
      const { code, out } = check(['b-3', '--dir', dir]);
      assert.equal(code, 0, out);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('b-3 does not count a file whose name merely ends in "test"', () => {
  const dir = committedRepo({ files: { 'src/Latest.java': 'class Latest {}\n', 'contest.py': 'x = 1\n' } });
  try {
    const { code, out } = check(['b-3', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /no test file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-3 fails when the tests fail', () => {
  const dir = committedRepo({ testScript: 'node -e "process.exit(1)"' });
  try {
    const { code, out } = check(['b-3', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /npm test/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-3 reads a saved exit code when there is no npm test script, and gives the Windows command', () => {
  const dir = committedRepo({ testScript: '' });
  const saved = join(dir, '.practice', 'b-3-tests.txt');
  try {
    let { code, out } = check(['b-3', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /\$LASTEXITCODE > \.practice\/b-3-tests\.txt/);
    writeFileSync(saved, 'True\n');
    ({ code, out } = check(['b-3', '--dir', dir]));
    assert.equal(code, 1, out);
    assert.match(out, /not an exit code/);
    writeFileSync(saved, '0\n');
    ({ code, out } = check(['b-3', '--dir', dir]));
    assert.equal(code, 0, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-3 fails when changes are left uncommitted, and says how to set aside new files too', () => {
  const dir = committedRepo();
  try {
    writeFileSync(join(dir, 'src', 'links.js'), 'export const x = 1\n');
    writeFileSync(join(dir, 'notes.txt'), 'scratch\n');
    const { code, out } = check(['b-3', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /uncommitted: src\/links\.js/);
    assert.match(out, /git stash push --include-untracked/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const rewound = {
  '.practice/b-4-before-rewind.txt': ' M src/cli.js\n',
  '.practice/b-4-after-rewind.txt': '',
};

test('b-4 passes when a change was there before rewinding and gone after', () => {
  const dir = repo(rewound);
  try {
    const { code, out } = check(['b-4', '--dir', dir]);
    assert.equal(code, 0, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-4 fails when no change was saved before rewinding', () => {
  const dir = repo({ ...rewound, '.practice/b-4-before-rewind.txt': '' });
  try {
    assert.equal(check(['b-4', '--dir', dir]).code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-4 fails when the change is still there after rewinding, and says how to recover and save again', () => {
  const dir = repo({ ...rewound, '.practice/b-4-after-rewind.txt': ' M src/cli.js\n' });
  try {
    const { code, out } = check(['b-4', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /Restore code/);
    assert.match(out, /git restore/);
    assert.match(out, /git status --porcelain > \.practice\/b-4-after-rewind\.txt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-4 says rewind cannot undo changes that were there before the edit', () => {
  const dir = repo({
    '.practice/b-4-before-rewind.txt': ' M src/cli.js\n?? notes.txt\n',
    '.practice/b-4-after-rewind.txt': '?? notes.txt\n',
  });
  try {
    const { code, out } = check(['b-4', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /notes\.txt/);
    assert.match(out, /git stash push --include-untracked/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A repository whose committed CLAUDE.md holds a rule, followed by a commit a
// new session made, as in lesson b-5.
function memoryRepo({ claudeMd = '# Project\n\n- Every new source file starts with the line `// Part of linkcheck.`\n', commitClaudeMd = true, header = '// Part of linkcheck.', commitChange = true } = {}) {
  const dir = repo({ 'CLAUDE.md': claudeMd, '.practice/b-5-rule.txt': '// Part of linkcheck.\n' });
  writeFileSync(join(dir, '.git', 'info', 'exclude'), '.practice/\n');
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  if (commitClaudeMd) git('add', 'CLAUDE.md');
  git('commit', '-q', '--allow-empty', '-m', 'Add project instructions');
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'test'), { recursive: true });
  writeFileSync(join(dir, 'src', 'stats.js'), `${header}\nexport function countLinks() { return 0; }\n`);
  writeFileSync(join(dir, 'test', 'stats.test.js'), "import { test } from 'node:test';\n");
  if (commitChange) {
    git('add', 'src', 'test');
    git('commit', '-q', '-m', 'Add countLinks');
  }
  writeFileSync(join(dir, '.practice', 'b-5-commit.txt'), `${git('rev-parse', 'HEAD')}\n`);
  return dir;
}

test('b-5 passes when CLAUDE.md is committed with the rule and the new session followed it', () => {
  const dir = memoryRepo();
  try {
    const { code, out } = check(['b-5', '--dir', dir]);
    assert.equal(code, 0, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-5 fails when CLAUDE.md is not committed', () => {
  const dir = memoryRepo({ commitClaudeMd: false });
  try {
    const { code, out } = check(['b-5', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /not committed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-5 names the saved rule file when the committed CLAUDE.md lacks the rule', () => {
  const dir = memoryRepo({ claudeMd: '# Project\n' });
  try {
    const { code, out } = check(['b-5', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /doesn't contain `\/\/ Part of linkcheck\.`, the line saved in `\.practice\/b-5-rule\.txt`/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-5 fails when a new file does not start with the rule, and says to save a new commit', () => {
  const dir = memoryRepo({ header: '// stats' });
  try {
    const { code, out } = check(['b-5', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /src\/stats\.js/);
    assert.match(out, /new session/);
    assert.match(out, /git rev-parse HEAD > \.practice\/b-5-commit\.txt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('b-5 says when the new file is there but not committed yet', () => {
  const dir = memoryRepo({ commitChange: false });
  try {
    const { code, out } = check(['b-5', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /src\/stats\.js/);
    assert.match(out, /not committed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The reference fix for capstone/beginner-bug.md: each file with its text
// before and after the fix.
const capstoneFix = [
  ['src/check-links.js', '  if (!existsSync(path)) return [];', '  if (!existsSync(path)) throw new Error(`no such file or folder: ${entry}`);'],
  ['src/cli.js', 'const broken = brokenLinks(root, config);', 'let broken;\ntry {\n  broken = brokenLinks(root, config);\n} catch (error) {\n  console.error(`linkcheck: ${error.message}`);\n  process.exit(2);\n}'],
];

// Puts a copied file in the buggy or the fixed state, whichever state it
// arrived in (the solutions branch already holds the fix). If the app no
// longer has either text, the fixture fails loudly instead of testing nothing.
function setFixed(dir, [path, buggy, fixed], fix) {
  const file = join(dir, path);
  const text = readFileSync(file, 'utf8');
  const [from, to] = fix ? [buggy, fixed] : [fixed, buggy];
  if (text.includes(to)) return;
  if (!text.includes(from)) throw new Error(`the capstone fixture no longer matches ${path}`);
  writeFileSync(file, text.replace(from, to));
}

// A copy of this template where the Beginner capstone is done: the solution
// for the bug report, committed, with the snapshots the capstone asks for.
function capstoneRepo({ fix = true, withTest = true, before = '', planned = 'src/check-links.js\nsrc/cli.js\ntest/links.test.js\n' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'practice-cap-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const entry of ['package.json', 'src', 'test', 'samples']) {
    cpSync(join(root, entry), join(dir, entry), { recursive: true });
  }
  for (const change of capstoneFix) setFixed(dir, change, false);
  writeFileSync(join(dir, '.gitignore'), '.practice/\n');
  writeFileSync(join(dir, 'CLAUDE.md'), '# linkcheck\n\n- Run the tests: `npm test`\n');
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  git('add', '-A');
  git('commit', '-q', '-m', 'start');
  if (fix) {
    for (const change of capstoneFix) setFixed(dir, change, true);
    if (withTest) {
      const t = join(dir, 'test', 'links.test.js');
      writeFileSync(t, readFileSync(t, 'utf8') + "\ntest('a missing folder is an error', () => {\n  assert.throws(() => brokenLinks(samples, { files: ['nowhere'], ignore: [] }), /nowhere/);\n});\n");
    }
  }
  git('add', '-A');
  git('commit', '-q', '--allow-empty', '-m', 'Report a missing folder in linkcheck.json');
  mkdirSync(join(dir, '.practice'), { recursive: true });
  writeFileSync(join(dir, '.practice', 'version.txt'), '2.1.285 (Claude Code)\n');
  writeFileSync(join(dir, '.practice', 'capstone-before.txt'), before);
  writeFileSync(join(dir, '.practice', 'capstone-plan.txt'), planned);
  writeFileSync(join(dir, '.practice', 'capstone-commit.txt'), `${git('rev-parse', 'HEAD')}\n`);
  return dir;
}

test('the Beginner capstone passes when every observed Exit statement is met', () => {
  const dir = capstoneRepo();
  try {
    const { code, out } = check(['b-capstone', '--dir', dir]);
    assert.equal(code, 0, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the Beginner capstone fails while the reported bug is still there', () => {
  const dir = capstoneRepo({ fix: false });
  try {
    const { code, out } = check(['b-capstone', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /FAIL .*exit with code 2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the Beginner capstone accepts a plan file written with backslashes and Windows line endings', () => {
  const dir = capstoneRepo({ planned: 'src\\check-links.js\r\nsrc\\cli.js\r\ntest\\links.test.js\r\n' });
  try {
    const { code, out } = check(['b-capstone', '--dir', dir]);
    assert.equal(code, 0, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the Beginner capstone fails when files had changed before approval, and says how to start clean', () => {
  const dir = capstoneRepo({ before: ' M src/cli.js\n' });
  try {
    const { code, out } = check(['b-capstone', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /before you approved the plan: src\/cli\.js/);
    assert.match(out, /git stash push --include-untracked/);
    assert.match(out, /plan mode/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the Beginner capstone fails when the commit changes a file the plan did not name, and says what to fix', () => {
  const dir = capstoneRepo({ planned: 'src/check-links.js\nsrc/cli.js\n' });
  try {
    const { code, out } = check(['b-capstone', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /test\/links\.test\.js/);
    assert.match(out, /add them to `\.practice\/capstone-plan\.txt`/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the Beginner capstone fails when the test is not in the fix commit, and says to commit them together', () => {
  const dir = capstoneRepo({ withTest: false });
  try {
    const { code, out } = check(['b-capstone', '--dir', dir]);
    assert.equal(code, 1, out);
    assert.match(out, /no test file/);
    assert.match(out, /same commit as the fix/);
    assert.match(out, /git rev-parse HEAD > \.practice\/capstone-commit\.txt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// JetBrains IDEs create .idea/ when they open a folder; the checks would
// count it as an uncommitted change.
test('the template keeps the .idea/ folder out of git', () => {
  const dir = repo({ '.gitignore': readFileSync(join(root, '.gitignore'), 'utf8'), '.idea/misc.xml': '<project/>\n' });
  try {
    const empty = join(dir, '.git', 'no-global-config');
    writeFileSync(empty, '');
    const env = { ...process.env, GIT_CONFIG_GLOBAL: empty, GIT_CONFIG_NOSYSTEM: '1' };
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8', env });
    assert.equal(status.trim(), '?? .gitignore');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
