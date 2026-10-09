// The Advanced checks, run the way a Learner runs them: against their own
// repository with --dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readWorkflow } from '../workflow-script.mjs';
import { parseWorktrees } from '../worktrees.mjs';
import { check, commit, repo, withRepo, write } from './helpers.mjs';

const git = (dir, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const IGNORE = '.practice/\n.claude/worktrees/\n';
const LISTING = '.practice/a-1-worktrees.txt';

// A repository after lesson a-1: worktrees made where `claude --worktree`
// makes them, one commit in each, the listing saved while all of them
// existed, the first two branches merged, and the worktrees removed. The
// options change one step: `gitignore` is committed and `pending` written
// over it afterwards; `exclude` replaces .git/info/exclude; `globalIgnore`
// becomes the repository's excludes file, standing in for a global one;
// `listing` rewrites the saved listing, or drops it by returning null.
function parallelRepo({
  gitignore = IGNORE, pending, exclude, globalIgnore, files = {}, under = '.claude/worktrees',
  names = ['docs-pass', 'test-pass'], saveBefore = false, merge = 'each', keep = [], lock = [], prune = [],
  listing = (text) => text,
} = {}) {
  return () => {
    const dir = repo({ ...(gitignore === null ? {} : { '.gitignore': gitignore }), 'README.md': '# demo\n', ...files });
    if (exclude) write(dir, { '.git/info/exclude': exclude });
    if (globalIgnore) {
      write(dir, { '.git/global-ignore': globalIgnore });
      git(dir, 'config', 'core.excludesFile', join(dir, '.git', 'global-ignore'));
    }
    commit(dir, 'Start');
    if (pending) write(dir, { '.gitignore': pending });
    const branch = (name) => `worktree-${name.replace(/\s+/g, '-')}`;
    const path = (name) => join(dir, under, name);
    for (const name of names) git(dir, 'worktree', 'add', '-q', '-b', branch(name), `${under}/${name}`);
    const save = () => {
      const text = listing(`${git(dir, 'worktree', 'list', '--porcelain')}\n`, dir);
      if (text !== null) write(dir, { [LISTING]: text });
    };
    if (saveBefore) save();
    for (const name of names) {
      write(path(name), { [`work/${branch(name)}.txt`]: `${name}\n` });
      commit(path(name), `Work in ${name}`);
    }
    if (!saveBefore) save();
    const [first, second] = names.map(branch);
    if (merge === 'each') {
      git(dir, 'merge', '-q', '--ff-only', first);
      git(dir, 'merge', '-q', '--no-ff', '--no-edit', second);
    } else if (merge === 'octopus') {
      git(dir, 'merge', '-q', '--no-edit', first, second);
    } else if (merge === 'one') {
      git(dir, 'merge', '-q', '--ff-only', first);
    } else if (merge === 'squash') {
      for (const b of [first, second]) {
        git(dir, 'merge', '-q', '--squash', b);
        git(dir, 'commit', '-q', '-m', `Squash ${b}`);
      }
    }
    for (const name of lock) git(dir, 'worktree', 'lock', `${under}/${name}`);
    for (const name of prune) rmSync(path(name), { recursive: true, force: true });
    for (const name of names) if (![...keep, ...lock, ...prune].includes(name)) git(dir, 'worktree', 'remove', `${under}/${name}`);
    return dir;
  };
}

const a1 = (dir) => check(['a-1', '--dir', dir]);

test('a-1 passes for two worktree branches that split, merged one fast-forward and one with a merge commit, and removed', () => {
  withRepo(parallelRepo(), (dir) => {
    const { code, out } = a1(dir);
    assert.equal(code, 0, out);
  });
});

test('a-1 passes for both branches merged at once', () => {
  withRepo(parallelRepo({ merge: 'octopus' }), (dir) => {
    const { code, out } = a1(dir);
    assert.equal(code, 0, out);
  });
});

test('a-1 accepts the rule written with or without its slashes, or in .claude/.gitignore', () => {
  for (const options of [
    { gitignore: '.practice/\n/.claude/worktrees/\n' },
    { gitignore: '.practice/\n.claude/worktrees\n' },
    { gitignore: '.practice/\n', files: { '.claude/.gitignore': 'worktrees/\n' } },
  ]) {
    withRepo(parallelRepo(options), (dir) => {
      const { code, out } = a1(dir);
      assert.equal(code, 0, `${JSON.stringify(options)}: ${out}`);
    });
  }
});

test('a-1 is not fooled by a global excludes file that ignores .claude/', () => {
  withRepo(parallelRepo({ globalIgnore: '.claude/\n' }), (dir) => {
    const { code, out } = a1(dir);
    assert.equal(code, 0, out);
  });
  withRepo(parallelRepo({ gitignore: '.practice/\n', globalIgnore: '.claude/\n' }), (dir) => {
    const { code, out } = a1(dir);
    assert.equal(code, 1, out);
    assert.match(out, /No committed `\.gitignore` ignores `\.claude\/worktrees\/`/);
    assert.match(out, /global git excludes file doesn't count/);
  });
});

test('a-1 fails when only .git/info/exclude ignores the folder', () => {
  withRepo(parallelRepo({ gitignore: '.practice/\n', exclude: '.practice/\n.claude/worktrees/\n' }), (dir) => {
    const { code, out } = a1(dir);
    assert.equal(code, 1, out);
    assert.match(out, /Only `\.git\/info\/exclude` ignores/);
  });
});

test('a-1 reads the committed .gitignore when a rule in .git/info/exclude shadows it', () => {
  withRepo(parallelRepo({ exclude: '.practice/\n.claude/\n' }), (dir) => {
    const { code, out } = a1(dir);
    assert.equal(code, 0, out);
  });
  withRepo(parallelRepo({ gitignore: '.practice/\n.claude/\n', exclude: '.practice/\n.claude/\n' }), (dir) => {
    const { code, out } = a1(dir);
    assert.equal(code, 1, out);
    assert.match(out, /also ignores `\.claude\/settings\.json`/);
  });
});

test('a-1 fails while the rule is not committed, and says how to commit it', () => {
  withRepo(parallelRepo({ gitignore: '.practice/\n', pending: IGNORE }), (dir) => {
    const { code, out } = a1(dir);
    assert.equal(code, 1, out);
    assert.match(out, /isn't committed\. Run `git add \.gitignore`/);
  });
});

test('a-1 still passes when the committed rule is there and .gitignore has another change pending', () => {
  withRepo(parallelRepo({ pending: `${IGNORE}dist/\n` }), (dir) => {
    const { code, out } = a1(dir);
    assert.equal(code, 0, out);
  });
});

test('a-1 fails for a rule that also ignores the rest of .claude/, quoting it', () => {
  for (const [gitignore, pattern] of [
    ['.practice/\n.claude/\n', '.claude/'],
    ['.practice/\n.claude/*\n', '.claude/*'],
    ['.practice/\n.claude/\n!.claude/settings.json\n', '.claude/'],
    ['.practice/\n.claude/worktrees/\n.claude/*.json\n', '.claude/*.json'],
  ]) {
    withRepo(parallelRepo({ gitignore }), (dir) => {
      const { code, out } = a1(dir);
      assert.equal(code, 1, `${gitignore}: ${out}`);
      assert.ok(out.includes(`\`${pattern}\`, also ignores \`.claude/settings.json\``), out);
      assert.match(out, /Ignore only `\.claude\/worktrees\/`/);
    });
  }
});

test('a-1 says how to save the listing when there is none, and does not pass the cleanup without it', () => {
  withRepo(parallelRepo({ listing: () => null }), (dir) => {
    const { code, out } = a1(dir);
    assert.equal(code, 1, out);
    assert.match(out, /run `git worktree list --porcelain > \.practice\/a-1-worktrees\.txt` from your main checkout/);
    assert.match(out, /FAIL {2}neither of those worktrees still exists/);
    assert.match(out, /There is no `\.practice\/a-1-worktrees\.txt`/);
  });
});

test('a-1 fails for a listing with only the main checkout in it', () => {
  withRepo(parallelRepo({ listing: (text) => `${text.split('\n\n')[0]}\n` }), (dir) => {
    const { code, out } = a1(dir);
    assert.equal(code, 1, out);
    assert.match(out, /lists no worktree under `\.claude\/worktrees\/`/);
    assert.match(out, /claude --worktree <name>/);
  });
});

test('a-1 counts only the worktrees under .claude/worktrees/, and says why', () => {
  withRepo(parallelRepo({ gitignore: `${IGNORE}wt/\n`, under: 'wt' }), (dir) => {
    const { code, out } = a1(dir);
    assert.equal(code, 1, out);
    assert.match(out, /It also lists `[^`]*\/wt\/docs-pass`/);
    assert.match(out, /counts only the worktrees `claude --worktree <name>` makes/);
  });
});

test('a-1 fails for a listing saved before both sessions committed', () => {
  const oneCommitted = (text, dir) => text.replace(git(dir, 'rev-parse', 'worktree-test-pass'), git(dir, 'rev-parse', 'HEAD'));
  for (const options of [{ saveBefore: true }, { listing: oneCommitted }]) {
    withRepo(parallelRepo(options), (dir) => {
      const { code, out } = a1(dir);
      assert.equal(code, 1, out);
      assert.match(out, /saved before both sessions committed/);
    });
  }
});

test('a-1 fails for a listing that names a commit this repository does not have', () => {
  const elsewhere = (text, dir) => text.replace(git(dir, 'rev-parse', 'worktree-docs-pass'), 'f'.repeat(40));
  withRepo(parallelRepo({ listing: elsewhere }), (dir) => {
    const { code, out } = a1(dir);
    assert.equal(code, 1, out);
    assert.match(out, /names commit fffffff, which isn't in this repository/);
  });
});

test('a-1 fails while one branch is not merged, naming it', () => {
  withRepo(parallelRepo({ merge: 'one' }), (dir) => {
    const { code, out } = a1(dir);
    assert.equal(code, 1, out);
    assert.match(out, /`worktree-test-pass` isn't merged into your current branch/);
    assert.match(out, /run `git merge worktree-test-pass`/);
  });
});

test('a-1 fails for squash merges, which copy the commits', () => {
  withRepo(parallelRepo({ merge: 'squash' }), (dir) => {
    const { code, out } = a1(dir);
    assert.equal(code, 1, out);
    assert.match(out, /`worktree-docs-pass` and `worktree-test-pass` aren't merged/);
    assert.match(out, /squash merge/);
  });
});

test('a-1 passes when any two of the listed worktrees split and are merged, and leaves a third one alone', () => {
  withRepo(parallelRepo({ names: ['docs-pass', 'test-pass', 'spare'], keep: ['spare'] }), (dir) => {
    const { code, out } = a1(dir);
    assert.equal(code, 0, out);
  });
});

test('a-1 fails while a worktree still exists, with the command that removes it', () => {
  withRepo(parallelRepo({ keep: ['test-pass'] }), (dir) => {
    const { code, out } = a1(dir);
    assert.equal(code, 1, out);
    assert.match(out, /PASS {2}`\.practice\/a-1-worktrees\.txt` lists two worktrees/);
    assert.match(out, /\/\.claude\/worktrees\/test-pass` still exists: once its branch is merged, run `git worktree remove [^`]*\/\.claude\/worktrees\/test-pass`/);
  });
});

test('a-1 says to unlock a locked worktree first, and to prune one whose folder is gone', () => {
  withRepo(parallelRepo({ lock: ['test-pass'] }), (dir) => {
    const { code, out } = a1(dir);
    assert.equal(code, 1, out);
    assert.match(out, /is locked: run `git worktree unlock [^`]*test-pass`, then `git worktree remove [^`]*test-pass`/);
  });
  withRepo(parallelRepo({ prune: ['test-pass'] }), (dir) => {
    const { code, out } = a1(dir);
    assert.equal(code, 1, out);
    assert.match(out, /whose folder is gone: run `git worktree prune`/);
  });
});

test('a-1 reads a path with spaces, and quotes it in the command it gives', () => {
  withRepo(parallelRepo({ names: ['docs pass', 'test-pass'], keep: ['docs pass'] }), (dir) => {
    const { code, out } = a1(dir);
    assert.equal(code, 1, out);
    assert.match(out, /PASS {2}`\.practice\/a-1-worktrees\.txt` lists two worktrees/);
    assert.match(out, /run `git worktree remove "[^`"]*\/\.claude\/worktrees\/docs pass"`/);
  });
});

// The listing as Windows PowerShell 5.1 saves it: UTF-16 with a byte-order
// mark and CRLF line ends, with Windows paths, plus records for a detached,
// locked worktree outside .claude/worktrees/ and a bare repository.
function fromWindows(text, dir) {
  const head = git(dir, 'rev-parse', 'HEAD');
  const records = text.replaceAll(realpathSync(dir), 'C:/Users/Jo Doe/repo').trimEnd().split('\n')
    .map((line) => (line.startsWith('worktree ') ? line.replace(/\//g, '\\') : line));
  records.push('', 'worktree C:\\Users\\Jo Doe\\review', `HEAD ${head}`, 'detached', 'locked "kept by\\na review tool"', '', 'worktree C:\\Users\\Jo Doe\\mirror.git', 'bare', '');
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(records.join('\r\n'), 'utf16le')]);
}

test('a-1 reads a listing saved by Windows PowerShell, with Windows paths and extra records', () => {
  withRepo(parallelRepo({ listing: fromWindows }), (dir) => {
    const { code, out } = a1(dir);
    assert.equal(code, 0, out);
  });
});

test('the worktree parser keeps each record\'s flags and drops refs/heads/', () => {
  const sha = 'a'.repeat(40);
  const text = [
    `worktree /repo`, `HEAD ${sha}`, 'branch refs/heads/main', '',
    `worktree /repo/.claude/worktrees/x y`, `HEAD ${sha}`, 'detached', 'locked', '',
    `worktree /repo/.claude/worktrees/z`, `HEAD ${sha.toUpperCase()}`, 'branch refs/heads/worktree-z', 'prunable gitdir file points to non-existent location', '',
    'worktree /bare.git', 'bare', '',
  ].join('\r\n');
  const [main, xy, z, bare] = parseWorktrees(text);
  assert.deepEqual(main, { path: '/repo', head: sha, branch: 'main', bare: false, detached: false, locked: false, prunable: false });
  assert.deepEqual(xy, { path: '/repo/.claude/worktrees/x y', head: sha, branch: null, bare: false, detached: true, locked: true, prunable: false });
  assert.equal(z.head, sha);
  assert.equal(z.branch, 'worktree-z');
  assert.equal(z.prunable, true);
  assert.deepEqual([bare.bare, bare.head], [true, null]);
});

test('a-1 fails on an unsolved repository and passes on a solved one, as the template\'s assertions expect', () => {
  withRepo(() => {
    const dir = repo({ '.gitignore': '.practice/\nnode_modules/\n', 'README.md': '# demo\n' });
    commit(dir, 'Start');
    return dir;
  }, (dir) => {
    const { code, out } = check(['a-1', '--assert', 'fail', '--dir', dir]);
    assert.equal(code, 0, out);
  });
  withRepo(parallelRepo(), (dir) => {
    const { code, out } = check(['a-1', '--assert', 'pass', '--dir', dir]);
    assert.equal(code, 0, out);
  });
});

// A repository after lesson a-2: the four choices written down, and the log
// the lesson's SubagentStart hook wrote while job 1 ran as parallel
// subagents, one `agent_id<TAB>agent_type` line per start. The options
// replace a file, or leave it out when null.
const CHOSEN = [
  '1: subagents because three files, one reviewer each, checked once, and only a short list comes back',
  '2: workflow because it covers every file, verifies each finding and reruns before every release',
  '3: main conversation because a typo fix is a quick, targeted change',
  '4: agent team because the investigators must challenge each other until they agree',
  '',
].join('\n');
const STARTS = 'agent-a1\tgeneral-purpose\nagent-a2\tgeneral-purpose\nagent-a3\tExplore\n';
const LOG_HOOK = `jq -r '[.agent_id, .agent_type] | @tsv' >> "$CLAUDE_PROJECT_DIR/.practice/a-2-agents.txt"`;
const HOOK_FILE = JSON.stringify({ hooks: { SubagentStart: [{ hooks: [{ type: 'command', command: LOG_HOOK }] }] } }, null, 2);

function patternRepo({ choices = CHOSEN, log = STARTS, hook = HOOK_FILE } = {}) {
  return () => {
    const dir = repo({ 'README.md': '# demo\n' });
    commit(dir, 'Start');
    for (const [path, text] of [['.practice/a-2-choices.md', choices], ['.practice/a-2-agents.txt', log], ['.practice/a-2-hook.json', hook]]) {
      if (text !== null) write(dir, { [path]: text });
    }
    return dir;
  };
}

const a2 = (dir) => check(['a-2', '--dir', dir]);
const choicesOf = (picks) => picks.map((p, i) => `${i + 1}: ${p} because it fits`).join('\n');

test('a-2 passes for the four patterns that fit and a log with three subagents', () => {
  withRepo(patternRepo(), (dir) => {
    const { code, out } = a2(dir);
    assert.equal(code, 0, out);
    assert.match(out, /2 of 2 passed/);
  });
});

test('a-2 reads the log the lesson\'s hook writes, counting a resumed subagent once', () => {
  withRepo(patternRepo({ log: null }), (dir) => {
    const hook = (id, type) => execFileSync('sh', ['-c', LOG_HOOK], {
      cwd: dir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      input: JSON.stringify({ session_id: 'abc123', cwd: dir, hook_event_name: 'SubagentStart', agent_id: id, agent_type: type }),
    });
    hook('agent-abc123', 'Explore');
    hook('agent-abc123', 'Explore');
    let { code, out } = a2(dir);
    assert.equal(code, 1, out);
    assert.match(out, /It shows one subagent, `agent-abc123`, starting 2 times: a subagent that Claude resumes logs its id again, so it counts once/);
    hook('agent-def456', 'fork');
    ({ code, out } = a2(dir));
    assert.equal(code, 0, out);
  });
});

test('a-2 accepts the choices written as list items, with job labels, bold and other separators', () => {
  const choices = [
    '# My choices',
    '',
    'Job 1 - Subagents, one per file',
    '- **2:** dynamic workflow, since it reruns',
    '3. main session because it is one line',
    '4) Agent teams: they argue it out',
  ].join('\n');
  withRepo(patternRepo({ choices }), (dir) => {
    const { code, out } = a2(dir);
    assert.equal(code, 0, out);
  });
});

test('a-2 accepts a table, task boxes, articles and quoted pattern names', () => {
  for (const choices of [
    '| Job | Pattern | Why |\n|---|---|---|\n| 1 | subagents | few files |\n| 2 | workflow | rerun |\n| 3 | main conversation | quick |\n| 4 | agent team | debate |\n',
    '- [x] 1: `subagents` because few\n- [x] 2: a dynamic workflow because rerun\n- [x] 3: the main conversation because quick\n- [x] 4: an agent team because debate\n',
    '(1) "sub-agents" because few\n(2) Workflow because rerun\n(3) one conversation because quick\n(4) agent-team because debate\n',
  ]) {
    withRepo(patternRepo({ choices }), (dir) => {
      const { code, out } = a2(dir);
      assert.equal(code, 0, `${choices}\n${out}`);
    });
  }
});

test('a-2 skips other lines for a job once one of its lines names a pattern', () => {
  const jobs = '1. Check the three largest source files\n2. Run the same check on every source file\n3. Fix a typo in one error message\n4. Three investigators each test a different theory\n\n';
  withRepo(patternRepo({ choices: `${jobs}${CHOSEN}` }), (dir) => {
    const { code, out } = a2(dir);
    assert.equal(code, 0, out);
  });
});

test('a-2 reads files saved with CRLF line ends, a UTF-8 byte-order mark, or as UTF-16 by Windows PowerShell', () => {
  const utf16 = (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text.replace(/\n/g, '\r\n'), 'utf16le')]);
  for (const options of [
    { choices: CHOSEN.replace(/\n/g, '\r\n'), log: STARTS.replace(/\n/g, '\r\n') },
    { choices: `﻿${CHOSEN}`, log: `﻿${STARTS}` },
    { choices: utf16(CHOSEN), log: utf16(STARTS) },
  ]) {
    withRepo(patternRepo(options), (dir) => {
      const { code, out } = a2(dir);
      assert.equal(code, 0, out);
    });
  }
});

test('a-2 says where to save the choices and in what form when there are none', () => {
  withRepo(patternRepo({ choices: null }), (dir) => {
    const { code, out } = a2(dir);
    assert.equal(code, 1, out);
    assert.match(out, /There is no `\.practice\/a-2-choices\.md`\. Save your choices there, one line per job in the form `<job number>: <pattern> because <reason>`/);
    assert.match(out, /PASS {2}`\.practice\/a-2-agents\.txt`/);
  });
  withRepo(patternRepo({ choices: 'subagents, then a workflow, then the main conversation, then a team\n' }), (dir) => {
    const { code, out } = a2(dir);
    assert.equal(code, 1, out);
    assert.match(out, /has no line that starts with a job number/);
  });
});

test('a-2 names each job that has no line', () => {
  const lines = CHOSEN.split('\n');
  withRepo(patternRepo({ choices: [lines[0], lines[1], lines[3]].join('\n') }), (dir) => {
    const { code, out } = a2(dir);
    assert.equal(code, 1, out);
    assert.match(out, /has no line for job 3\. Add one per job/);
  });
  withRepo(patternRepo({ choices: [lines[0], lines[2]].join('\n') }), (dir) => {
    const { code, out } = a2(dir);
    assert.equal(code, 1, out);
    assert.match(out, /has no line for jobs 2 and 4\./);
  });
});

test('a-2 names the chart question that settles each job picked wrongly', () => {
  const Q1 = 'Can one conversation do it without filling up?';
  const Q2 = 'Must the workers talk to each other?';
  const Q3 = 'Does it need many agents, cross-checked findings or a rerun?';
  for (const [picks, expected] of [
    [['main conversation', 'main conversation', 'subagents', 'main conversation'], [
      `Job 1 doesn't call for the main conversation. ${Q1} No: reading three whole files`,
      `Job 2 doesn't call for the main conversation. ${Q1} No: it checks every source file.`,
      `Job 3 doesn't call for subagents. ${Q1} Yes: fixing a typo is a quick, targeted change`,
      `Job 4 doesn't call for the main conversation. ${Q1} No: three investigators work at the same time`,
    ]],
    [['agent team', 'agent team', 'workflow', 'subagents'], [
      `Job 1 doesn't call for an agent team. ${Q2} No: each reviewer checks its own file`,
      `Job 2 doesn't call for an agent team. ${Q2} No: each finding is verified against the code`,
      `Job 3 doesn't call for a workflow. ${Q1} Yes:`,
      `Job 4 doesn't call for subagents. ${Q2} Yes: the investigators challenge each other's findings`,
    ]],
    [['workflow', 'subagents', 'agent team', 'workflow'], [
      `Job 1 doesn't call for a workflow. ${Q3} No: three files, checked once`,
      `Job 2 doesn't call for subagents. ${Q3} Yes: it checks every source file, verifies each finding and reruns before every release`,
      `Job 3 doesn't call for an agent team. ${Q1} Yes:`,
      `Job 4 doesn't call for a workflow. ${Q2} Yes:`,
    ]],
  ]) {
    withRepo(patternRepo({ choices: choicesOf(picks) }), (dir) => {
      const { code, out } = a2(dir);
      assert.equal(code, 1, out);
      for (const text of expected) assert.ok(out.includes(text), `${picks}: missing "${text}" in ${out}`);
      assert.match(out, /It calls for subagents\./);
      assert.match(out, /It calls for a workflow\./);
      assert.match(out, /It calls for the main conversation\./);
      assert.match(out, /It calls for an agent team\./);
    });
  }
});

test('a-2 fails for a pattern that is not one of the four, or no pattern, and lists the four', () => {
  withRepo(patternRepo({ choices: CHOSEN.replace('1: subagents', '1: delegate to helpers').replace(/^2: .*$/m, '2:') }), (dir) => {
    const { code, out } = a2(dir);
    assert.equal(code, 1, out);
    assert.match(out, /Job 1's line starts with "delegate to helpers", which isn't one of the four patterns\. Right after the job number, write `main conversation`, `subagents`, `workflow` or `agent team`\./);
    assert.match(out, /Job 2's line names no pattern\./);
  });
});

test('a-2 fails for a job with lines that pick different patterns', () => {
  withRepo(patternRepo({ choices: `${CHOSEN}1: workflow because it may grow\n` }), (dir) => {
    const { code, out } = a2(dir);
    assert.equal(code, 1, out);
    assert.match(out, /Job 1 has lines that pick different patterns: subagents and a workflow\. Keep one line per job\./);
  });
});

test('a-2 says how to start the logging session when there is no log, and to save the hook file first', () => {
  withRepo(patternRepo({ log: null }), (dir) => {
    const { code, out } = a2(dir);
    assert.equal(code, 1, out);
    assert.match(out, /There is no `\.practice\/a-2-agents\.txt`\. Start the session with `claude --settings \.practice\/a-2-hook\.json`, then run job 1\./);
  });
  withRepo(patternRepo({ log: null, hook: null }), (dir) => {
    const { code, out } = a2(dir);
    assert.equal(code, 1, out);
    assert.match(out, /Save the hook file from the lesson's Your turn as `\.practice\/a-2-hook\.json`/);
  });
});

test('a-2 points at jq for an empty log, ignoring blank lines', () => {
  for (const log of ['', '\n\n  \n']) {
    withRepo(patternRepo({ log }), (dir) => {
      const { code, out } = a2(dir);
      assert.equal(code, 1, out);
      assert.match(out, /is empty\. The hook's command creates the file before `jq` runs, so check that `jq --version` works/);
    });
  }
});

test('a-2 fails for a log with one subagent, and asks for one subagent per file, in parallel', () => {
  for (const log of ['agent-a1\tgeneral-purpose\n', 'general-purpose\n\n', '\n\nagent-a1\tExplore\n\n']) {
    withRepo(patternRepo({ log }), (dir) => {
      const { code, out } = a2(dir);
      assert.equal(code, 1, out);
      assert.match(out, /needs at least two subagents\. It shows one subagent starting\. In a session started with `claude --settings \.practice\/a-2-hook\.json`, ask for one subagent per file, in parallel\./);
    });
  }
});

test('a-2 counts any agent type, a fork included, and lines from a hook that logs only the type', () => {
  for (const log of ['agent-a1\tfork\n\nagent-a2\tfork\n', 'agent-a1\tExplore\nagent-a2\tmy-reviewer\n', 'general-purpose\ngeneral-purpose\n', '\tgeneral-purpose\n\tExplore\n']) {
    withRepo(patternRepo({ log }), (dir) => {
      const { code, out } = a2(dir);
      assert.equal(code, 0, `${JSON.stringify(log)}: ${out}`);
    });
  }
});

test('a-2 fails on an unsolved repository and passes on a solved one, as the template\'s assertions expect', () => {
  withRepo(patternRepo({ choices: null, log: null, hook: null }), (dir) => {
    const { code, out } = check(['a-2', '--assert', 'fail', '--dir', dir]);
    assert.equal(code, 0, out);
  });
  withRepo(patternRepo(), (dir) => {
    const { code, out } = check(['a-2', '--assert', 'pass', '--dir', dir]);
    assert.equal(code, 0, out);
  });
});

// A repository after lesson a-3: TODO and FIXME comments in two folders, the
// saved workflow committed in .claude/workflows/, and a report from each run
// by name. The options replace a step: `script` (null for none) is saved at
// `path` and committed unless `commitScript` is false; `globalIgnore`
// becomes the repository's excludes file, standing in for a global one;
// each report is text, a Buffer, a function of the folder, or null for none;
// `after` changes the working tree last.
const TODO_CHECK = [
  '// Run with: /todo-check on <folder>',
  'export const meta = {',
  "  name: 'todo-check',",
  "  description: 'Report the TODO and FIXME comments in a folder that still apply to the current code',",
  '  phases: [',
  "    { title: 'Find', detail: 'list every TODO and FIXME comment in the folder' },",
  "    { title: 'Verify', detail: 'one agent per comment checks it against the code' },",
  '  ],',
  '}',
  '',
  'const folder = Array.isArray(args) ? args[0] : args',
  "if (!folder) throw new Error('Name a folder: Run /todo-check on <folder>')",
  '',
  "phase('Find')",
  'const found = await agent(`List every TODO and FIXME comment under ${folder}/, each as a path from the repository root, a line number and the comment.`, {',
  "  schema: { type: 'object', required: ['items'], properties: { items: { type: 'array', items: { type: 'object' } } } },",
  '})',
  '',
  "phase('Verify')",
  'const checked = await pipeline(found.items, (item) =>',
  '  agent(`Does the comment at ${item.path}:${item.line} still apply to the current code? ${item.text}`, {',
  '    label: `${item.path}:${item.line}`,',
  "    schema: { type: 'object', required: ['applies', 'why'], properties: { applies: { type: 'boolean' }, why: { type: 'string' } } },",
  '  }).then((verdict) => verdict && { ...item, ...verdict }),',
  ')',
  '',
  "return checked.filter((c) => c?.applies).map((c) => `${c.path}:${c.line}: ${c.why}`).join('\\n')",
  '',
].join('\n');
const TOTAL = 'export function total(items) {\n  // TODO: round to cents before summing\n  return items.reduce((sum, i) => sum + i.price, 0);\n}\n';
const TOTAL_TEST = "import { test } from 'node:test';\n\n// FIXME: cover an empty list\ntest('total', () => {});\n";
const RUN1 = 'src\n\n- `src/total.js:2`: still applies, the sum is not rounded yet.\n';
const RUN2 = 'test\n\n- test/total.test.js:3: still applies, no test covers an empty list.\n';
const WORKFLOW_PATH = '.claude/workflows/todo-check.js';

function workflowRepo({ script = TODO_CHECK, path = WORKFLOW_PATH, commitScript = true, globalIgnore, reports = [RUN1, RUN2], after } = {}) {
  return () => {
    const dir = repo({ 'README.md': '# demo\n', 'src/total.js': TOTAL, 'test/total.test.js': TOTAL_TEST });
    if (globalIgnore) {
      write(dir, { '.git/global-ignore': globalIgnore });
      git(dir, 'config', 'core.excludesFile', join(dir, '.git', 'global-ignore'));
    }
    commit(dir, 'Start');
    for (const [i, text] of (Array.isArray(script) ? script : [script]).entries()) {
      if (text === null) continue;
      const at = Array.isArray(path) ? path[i] : path;
      write(dir, { [at]: text });
      if (commitScript) commit(dir, `Add ${at}`, [at]);
    }
    for (const [i, report] of reports.entries()) {
      if (report !== null) write(dir, { [`.practice/a-3-run${i + 1}.md`]: typeof report === 'function' ? report(dir) : report });
    }
    after?.(dir);
    return dir;
  };
}

const a3 = (dir) => check(['a-3', '--dir', dir]);
const withMeta = (meta) => TODO_CHECK.replace(/export const meta = \{[\s\S]*?\n\}\n/, `export const meta = ${meta}\n`);

test('a-3 passes for a committed workflow that reads args and two reports on two folders', () => {
  withRepo(workflowRepo(), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 0, out);
    assert.match(out, /3 of 3 passed/);
  });
});

test('a-3 accepts a workflow in a package\'s own .claude/workflows/, and comments before meta', () => {
  const commented = `/*\n * Finds TODO and FIXME comments.\n */\n\n// Run with: /todo-check on src\n${TODO_CHECK}`;
  withRepo(workflowRepo({ script: commented, path: 'packages/web/.claude/workflows/todo-check.js' }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 0, out);
  });
});

test('a-3 says how to save a workflow when there is none', () => {
  withRepo(workflowRepo({ script: null }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 1, out);
    assert.match(out, /There is no workflow script in `\.claude\/workflows\/`\. When a workflow run finishes, run `\/workflows`, select the run, press `s`/);
  });
});

test('a-3 says to commit a workflow that is only in the working tree, naming the rule that ignores it', () => {
  withRepo(workflowRepo({ commitScript: false }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 1, out);
    assert.match(out, /`\.claude\/workflows\/todo-check\.js` isn't committed\. Run `git add \.claude\/workflows\/todo-check\.js` and commit it\./);
  });
  withRepo(workflowRepo({ commitScript: false, globalIgnore: '.claude/\n' }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 1, out);
    assert.match(out, /isn't committed, and line 1 of `[^`]*global-ignore`, `\.claude\/`, ignores it\. Run `git add -f \.claude\/workflows\/todo-check\.js` and commit it\./);
  });
});

test('a-3 reads only .js files directly in .claude/workflows/, and says where to move another', () => {
  for (const path of ['.claude/workflows/todo-check.mjs', '.claude/workflows/team/todo-check.js']) {
    withRepo(workflowRepo({ path }), (dir) => {
      const { code, out } = a3(dir);
      assert.equal(code, 1, `${path}: ${out}`);
      assert.ok(out.includes(`\`${path}\` is under \`.claude/workflows/\`, but the check reads only \`.js\` files directly in that folder`), out);
      assert.match(out, /Move it to `\.claude\/workflows\/todo-check\.js` and commit\./);
    });
  }
});

test('a-3 fails when meta is not the script\'s first statement', () => {
  withRepo(workflowRepo({ script: `const folder = args\n${TODO_CHECK}` }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 1, out);
    assert.match(out, /doesn't start with `export const meta`: its code starts with `const folder = args`\. Claude Code needs `export const meta = \{ \.\.\. \}` as the script's first statement/);
  });
});

test('a-3 fails for a meta with anything but literal values, naming it and the line', () => {
  for (const [meta, what] of [
    ["{\n  ...base,\n  name: 'todo-check',\n  description: 'Report TODOs',\n}", 'Line 3 of `.claude/workflows/todo-check.js`: `meta` holds a spread, `...`.'],
    ["{\n  name: 'todo-check',\n  description: describe('todo'),\n}", '`meta` holds a function call, `describe(...)`.'],
    ["{\n  name: NAME,\n  description: 'Report TODOs',\n}", '`meta` holds a variable, `NAME`.'],
    ["{\n  name,\n  description: 'Report TODOs',\n}", '`meta` holds a variable, `name`.'],
    ["{\n  name: 'todo-check',\n  description: `Report ${KIND}`,\n}", '`meta` holds a template string with `${...}`.'],
    ["{\n  name: 'todo-' + 'check',\n  description: 'Report TODOs',\n}", '`meta` holds an expression, `+`.'],
    ["{\n  name: 'todo-check',\n  description: () => 'Report TODOs',\n}", 'Line 4 of `.claude/workflows/todo-check.js`: `meta` holds a function.'],
    ["makeMeta('todo-check')", '`meta` holds something other than an object literal.'],
  ]) {
    withRepo(workflowRepo({ script: withMeta(meta) }), (dir) => {
      const { code, out } = a3(dir);
      assert.equal(code, 1, `${meta}: ${out}`);
      assert.ok(out.includes(what), `${meta}: missing "${what}" in ${out}`);
      assert.match(out, /Claude Code drops `\/<name>` from `\/` autocomplete/);
    });
  }
});

test('a-3 fails for a meta without a name or a description', () => {
  withRepo(workflowRepo({ script: withMeta("{ name: 'todo-check' }") }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 1, out);
    assert.match(out, /`meta` in `\.claude\/workflows\/todo-check\.js` needs a non-empty `description` string\. Add it and commit\./);
  });
  withRepo(workflowRepo({ script: withMeta("{ name: '', description: 42 }") }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 1, out);
    assert.match(out, /needs a non-empty `name` string and a non-empty `description` string\. Add them and commit\./);
  });
});

test('a-3 prints a compile error with its line, and never runs the script', () => {
  const broken = `${TODO_CHECK}const late = await agent(\nlet x = 1\n`;
  const lines = broken.split('\n').length - 1;
  withRepo(workflowRepo({ script: broken }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 1, out);
    assert.ok(out.includes(`doesn't compile (line ${lines}): missing ) after argument list`), out);
  });
  const touches = "export const meta = { name: 'x', description: 'Touches a file' }\nrequire('node:fs').writeFileSync('ran.txt', 'ran')\nreturn args\n";
  withRepo(workflowRepo({ script: touches }), (dir) => {
    a3(dir);
    assert.equal(execFileSync('ls', [dir], { encoding: 'utf8' }).includes('ran.txt'), false);
  });
});

test('a-3 fails when the script never reads the args global, saying why', () => {
  const noArgs = TODO_CHECK.replace('const folder = Array.isArray(args) ? args[0] : args', "const folder = 'src'");
  for (const [script, why] of [
    [noArgs, /never reads `args`, so it can't take a folder as input/],
    [noArgs.replace("const folder = 'src'", "// TODO: read the folder from args\nconst folder = 'args'"), /mentions `args` only in a comment, a string or a property name/],
    [noArgs.replace("const folder = 'src'", "const folder = options.args\nconst options = { args: 'src' }"), /mentions `args` only in a comment, a string or a property name/],
    [noArgs.replace("const folder = 'src'", "const args = 'src'\nconst folder = args"), /Line 11 of `\.claude\/workflows\/todo-check\.js` declares its own `args`/],
  ]) {
    withRepo(workflowRepo({ script }), (dir) => {
      const { code, out } = a3(dir);
      assert.equal(code, 1, out);
      assert.match(out, why);
      assert.match(out, /Run `\/workflow-authoring`, ask Claude to change the script so it reads the folder from `args`, run `\/reload-skills`, and commit\./);
    });
  }
});

test('a-3 counts args read in a template, a ternary, a call or an object shorthand', () => {
  for (const read of ['const folder = `${args}`', 'const folder = args ? args : "src"', 'const folder = String(args)', 'const { folder } = { folder: args }', 'const input = { args }; const folder = input.args']) {
    withRepo(workflowRepo({ script: TODO_CHECK.replace('const folder = Array.isArray(args) ? args[0] : args', read) }), (dir) => {
      const { code, out } = a3(dir);
      assert.equal(code, 0, `${read}: ${out}`);
    });
  }
});

test('a-3 points out uncommitted changes to a committed script that fails', () => {
  const noArgs = TODO_CHECK.replace('const folder = Array.isArray(args) ? args[0] : args', "const folder = 'src'");
  withRepo(workflowRepo({ script: noArgs, after: (dir) => write(dir, { [WORKFLOW_PATH]: TODO_CHECK }) }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 1, out);
    assert.match(out, /never reads `args`/);
    assert.match(out, /Your copy of `\.claude\/workflows\/todo-check\.js` has changes that aren't committed: if they fix this, commit them\./);
  });
});

test('a-3 passes when any committed script meets the item, and otherwise speaks of the one that got furthest', () => {
  const noArgs = TODO_CHECK.replace('const folder = Array.isArray(args) ? args[0] : args', "const folder = 'src'");
  const paths = ['.claude/workflows/a-first.js', '.claude/workflows/b-second.js'];
  withRepo(workflowRepo({ script: [`const x = 1\n${TODO_CHECK}`, TODO_CHECK], path: paths }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 0, out);
  });
  withRepo(workflowRepo({ script: [`const x = 1\n${TODO_CHECK}`, noArgs], path: paths }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 1, out);
    assert.match(out, /`\.claude\/workflows\/b-second\.js` never reads `args`/);
    assert.doesNotMatch(out, /a-first/);
  });
  withRepo(workflowRepo({ script: noArgs, after: (dir) => write(dir, { '.claude/workflows/fixed.js': TODO_CHECK }) }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 1, out);
    assert.match(out, /never reads `args`.* Also, `\.claude\/workflows\/fixed\.js` isn't committed\. Run `git add \.claude\/workflows\/fixed\.js` and commit it\./);
  });
});

test('a-3 says where to save the reports when there are none, and which one is missing', () => {
  withRepo(workflowRepo({ reports: [null, null] }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 1, out);
    assert.match(out, /There are no reports yet\. Run your saved workflow by name on a folder, then ask Claude to save the report to `\.practice\/a-3-run1\.md` with the folder on its first line/);
    assert.match(out, /There are no reports to read yet/);
  });
  withRepo(workflowRepo({ reports: [RUN1, null] }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 1, out);
    assert.match(out, /There is no `\.practice\/a-3-run2\.md`\. Run your saved workflow by name on a different folder/);
    assert.match(out, /PASS {2}every cited `path:line` exists/);
  });
  withRepo(workflowRepo({ reports: [RUN1, '\n  \n'] }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 1, out);
    assert.match(out, /`\.practice\/a-3-run2\.md` is empty/);
  });
});

test('a-3 finds the folder on a heading, in backticks, with ./ or a trailing slash, or after a label', () => {
  for (const first of ['# src', '## `src/`', './src', 'src\\', '**Folder:** `src/`', 'TODO and FIXME report for src.']) {
    withRepo(workflowRepo({ reports: [RUN1.replace(/^src/, first), RUN2] }), (dir) => {
      const { code, out } = a3(dir);
      assert.equal(code, 0, `${first}: ${out}`);
    });
  }
  withRepo(workflowRepo({ reports: [(dir) => RUN1.replace(/^src/, `${dir}/src`), RUN2] }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 0, out);
  });
});

test('a-3 fails when both reports name the same folder, however it is written', () => {
  withRepo(workflowRepo({ reports: [RUN1, RUN1.replace(/^src/, './src/')] }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 1, out);
    assert.match(out, /Both reports name `src`\. Run your saved workflow on a second, different folder/);
  });
});

test('a-3 fails for a first line that names no folder, or the repository\'s root', () => {
  withRepo(workflowRepo({ reports: [RUN1.replace(/^src/, '# TODO report'), RUN2] }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 1, out);
    assert.match(out, /The first line of `\.practice\/a-3-run1\.md`, "# TODO report", names no folder in this repository/);
  });
  withRepo(workflowRepo({ reports: [RUN1.replace(/^src/, '.'), RUN2] }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 1, out);
    assert.match(out, /The first line of `\.practice\/a-3-run1\.md` names the repository's root/);
  });
});

test('a-3 reads citations in backticks, with ./, with backslashes, as a full path, with a column and as a link, and skips URLs and times', () => {
  const forms = (dir) => [
    '# src',
    '',
    '- `src/total.js:2`',
    '- ./src/total.js:2: rounds',
    '- src\\total.js:2',
    `- ${dir}/src/total.js:2`,
    '- **src/total.js:2:5**',
    '- [total.js](src/total.js#L2)',
    '- at:src/total.js:2',
    '',
    'Served at http://localhost:8080 and localhost:3000 at 10:30, see https://example.com/src/a.js#L40.',
  ].join('\n');
  withRepo(workflowRepo({ reports: [forms, RUN2] }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 0, out);
  });
});

test('a-3 fails for a cited file outside the report\'s folder', () => {
  withRepo(workflowRepo({ reports: [`${RUN1}- test/total.test.js:3: also applies\n`, RUN2] }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 1, out);
    assert.match(out, /`\.practice\/a-3-run1\.md` cites `test\/total\.test\.js:3`, outside `src\/`, the folder on its first line\. Check that the workflow reads the folder from `args`/);
  });
});

test('a-3 fails for a report with no citation, and for paths written from inside the folder', () => {
  withRepo(workflowRepo({ reports: ['src\n\nNothing in this folder still applies.\n', RUN2] }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 1, out);
    assert.match(out, /`\.practice\/a-3-run1\.md` cites no `path:line`\. Each item the workflow reports needs one, from the repository's root, such as `src\/<file>:<line>`\./);
  });
  withRepo(workflowRepo({ reports: ['src\n\n- total.js:2: still applies\n', RUN2] }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 1, out);
    assert.match(out, /cites `total\.js:2`, a path from inside `src\/`\. Each `path:line` must start at the repository's root, as `src\/total\.js:2` does/);
    assert.match(out, /`total\.js:2` is a path from inside `src\/`; from the root it's `src\/total\.js:2`/);
  });
});

test('a-3 fails when a cited line moved after an edit, and says to run the workflow again', () => {
  withRepo(workflowRepo({ after: (dir) => write(dir, { 'src/total.js': `// Sums prices.\n${TOTAL}` }) }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 1, out);
    assert.match(out, /PASS {2}`\.practice\/a-3-run1\.md` and `\.practice\/a-3-run2\.md` name two different folders/);
    assert.match(out, /`src\/total\.js:2` holds no `TODO` or `FIXME`\. If the code changed after the run, run the workflow again and save a new report/);
  });
});

test('a-3 names up to three cited lines that fail, a missing file and a line past the end among them', () => {
  const bad = 'src\n\n- src/total.js:2\n- src/gone.js:4\n- src/total.js:40\n- src/total.js:1\n- src/total.js:3\n- src/total.js:0\n';
  withRepo(workflowRepo({ reports: [bad, RUN2] }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 1, out);
    assert.match(out, /There is no `src\/gone\.js` for `src\/gone\.js:4`; `src\/total\.js:40` is past the end of `src\/total\.js`, which has 4 lines; `src\/total\.js:1` holds no `TODO` or `FIXME`; and 2 more\./);
  });
  withRepo(workflowRepo({ reports: [`${RUN1}- src/total.js:0\n`, RUN2] }), (dir) => {
    const { code, out } = a3(dir);
    assert.equal(code, 1, out);
    assert.match(out, /`src\/total\.js:0` names line 0, but lines start at 1\./);
  });
});

test('a-3 reads reports saved with CRLF line ends, a UTF-8 byte-order mark, or as UTF-16 by Windows PowerShell', () => {
  const utf16 = (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text.replace(/\n/g, '\r\n'), 'utf16le')]);
  for (const reports of [[RUN1.replace(/\n/g, '\r\n'), RUN2.replace(/\n/g, '\r\n')], [`\uFEFF${RUN1}`, `\uFEFF${RUN2}`], [utf16(RUN1), utf16(RUN2)]]) {
    withRepo(workflowRepo({ reports }), (dir) => {
      const { code, out } = a3(dir);
      assert.equal(code, 0, out);
    });
  }
});

test('the workflow reader can require an agent() call, as the Advanced capstone does', () => {
  const noArgs = TODO_CHECK.replace('const folder = Array.isArray(args) ? args[0] : args', "const folder = 'src'");
  assert.equal(readWorkflow(noArgs, { needAgentCall: true }).ok, true);
  assert.equal(readWorkflow(noArgs, { needArgs: true }).problem, 'args');
  const meta = "export const meta = { name: 'review', description: 'Review each file' }\n";
  for (const body of ['return args', "return tools.agent('x')", 'function agent() {}\nreturn 1', "// agent('x')\nconst s = \"agent('y')\""]) {
    assert.equal(readWorkflow(`${meta}${body}\n`, { needAgentCall: true }).problem, 'agent', body);
  }
  assert.equal(readWorkflow(`${meta}return parallel([() => agent('a'), () => agent('b')])\n`, { needAgentCall: true }).ok, true);
  assert.deepEqual(readWorkflow(`${meta}return 1\n`).meta, { name: 'review', description: 'Review each file' });
});

test('a-3 fails on an unsolved repository and passes on a solved one, as the template\'s assertions expect', () => {
  withRepo(workflowRepo({ script: null, reports: [null, null] }), (dir) => {
    const { code, out } = check(['a-3', '--assert', 'fail', '--dir', dir]);
    assert.equal(code, 0, out);
  });
  withRepo(workflowRepo(), (dir) => {
    const { code, out } = check(['a-3', '--assert', 'pass', '--dir', dir]);
    assert.equal(code, 0, out);
  });
});
