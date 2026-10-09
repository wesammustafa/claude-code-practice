// The Advanced checks, run the way a Learner runs them: against their own
// repository with --dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { claudeArgWords, parseYaml, readWorkflow as readActions } from '../actions.mjs';
import { parseClaudeArgs, ruleList } from '../claude-args.mjs';
import { callHints, RESULT, SCRIPT, savedRun, scriptBehavior, scriptCall } from '../lessons/a-4.mjs';
import { chosenWorkflow, dispatchedRun, pinnedWorkflow, RUNS, WORKFLOW, workflowLimits } from '../lessons/a-5.mjs';
import { openRepo } from '../repo.mjs';
import { runStubbed, STUB_SESSION } from '../stub-claude.mjs';
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

// A repository after lesson a-4: the review script committed and executable,
// and the JSON of one real run saved. The options replace a step: `script`
// (null for none) is saved with `mode` and committed unless `commitScript`
// is false; `result` (null for none) is the saved run, as an object, text or
// a Buffer; `after` changes the working tree last. The items run the script
// with a stand-in for `claude`, never Claude Code itself.
const PROMPT = 'Review this staged diff for bugs and missing tests. List each problem as file:line and one sentence, or say there are none.';
const FLAGS = '--output-format json --permission-mode dontAsk --allowedTools "Read,Grep,Glob" --max-turns 5';
const CALL = `claude -p "${PROMPT}" \\\n  ${FLAGS}`;
const REVIEW = [
  '#!/usr/bin/env bash',
  '# Review the staged diff with Claude Code and save the JSON result.',
  'set -uo pipefail',
  'out="${1:-.practice/a-4-result.json}"',
  'if git diff --cached --quiet; then echo "Nothing is staged." >&2; exit 2; fi',
  'mkdir -p "$(dirname "$out")"',
  `git diff --cached | ${CALL} > "$out"`,
  'status=$?',
  'jq -r \'.result // empty\' "$out"',
  'if [ "$status" -ne 0 ] || [ "$(jq -r \'.is_error\' "$out")" != "false" ]; then',
  '  echo "The review failed: $(jq -r \'.subtype\' "$out")" >&2; exit 1',
  'fi',
  '',
].join('\n');
const REAL_RUN = {
  type: 'result', subtype: 'success', is_error: false, num_turns: 3,
  result: 'src/total.js:2: the sum is not rounded to cents, and no test covers it.',
  session_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', total_cost_usd: 0.01, permission_denials: [],
};

// The review script with each `[from, to]` replaced.
function edited(...pairs) {
  return pairs.reduce((text, [from, to]) => {
    assert.ok(text.includes(from), `the review script has no ${JSON.stringify(from)}`);
    return text.replace(from, () => to);
  }, REVIEW);
}
const withFlags = (flags) => edited([FLAGS, flags]);
const withCall = (call) => edited([CALL, call]);

function reviewRepo({ script = REVIEW, mode = 0o755, commitScript = true, result = REAL_RUN, after } = {}) {
  return () => {
    const dir = repo({ 'README.md': '# demo\n', 'src/total.js': TOTAL });
    commit(dir, 'Start');
    if (script !== null) {
      write(dir, { [SCRIPT]: script });
      chmodSync(join(dir, SCRIPT), mode);
      if (commitScript) commit(dir, 'Add the review script', [SCRIPT]);
    }
    if (result !== null) write(dir, { [RESULT]: typeof result === 'string' || Buffer.isBuffer(result) ? result : JSON.stringify(result, null, 2) });
    after?.(dir);
    return dir;
  };
}

const a4 = (dir) => check(['a-4', '--dir', dir]);
// One item on its own, which runs only what that item needs.
const callHint = (dir) => scriptCall(SCRIPT).check(openRepo(dir));
const behaviorHint = (dir) => scriptBehavior(SCRIPT).check(openRepo(dir));
const runHint = (dir) => savedRun(RESULT, SCRIPT).check(openRepo(dir));

test('a-4 passes for the lesson\'s script, committed and executable, and a real run saved', () => {
  withRepo(reviewRepo(), (dir) => {
    const { code, out } = a4(dir);
    assert.equal(code, 0, out);
    assert.match(out, /4 of 4 passed/);
  });
});

test('a-4 says to write the script, commit it or make it executable', () => {
  withRepo(reviewRepo({ script: null }), (dir) => {
    const { code, out } = a4(dir);
    assert.equal(code, 1, out);
    assert.match(out, /There is no `scripts\/review-staged\.sh`\. Write it as the lesson's Your turn describes, then commit it\./);
    assert.match(out, /Commit `scripts\/review-staged\.sh` first: the check runs the committed script\./);
  });
  withRepo(reviewRepo({ commitScript: false }), (dir) => {
    const { code, out } = a4(dir);
    assert.equal(code, 1, out);
    assert.match(out, /`scripts\/review-staged\.sh` isn't committed\. Run `git add scripts\/review-staged\.sh` and commit it\./);
  });
  withRepo(reviewRepo({ mode: 0o644 }), (dir) => {
    const { code, out } = a4(dir);
    assert.equal(code, 1, out);
    assert.match(out, /isn't executable\. Run `chmod \+x scripts\/review-staged\.sh`, then `git add scripts\/review-staged\.sh` and commit\. On Windows, run `git update-index --chmod=\+x scripts\/review-staged\.sh`/);
    assert.match(out, /3 of 4 passed/);
  });
});

test('a-4 runs the committed script, not the working copy, and points out uncommitted changes', () => {
  withRepo(reviewRepo({ script: withFlags(FLAGS.replace('--output-format json ', '')), after: (dir) => write(dir, { [SCRIPT]: REVIEW }) }), (dir) => {
    const hint = callHint(dir);
    assert.match(String(hint), /It doesn't ask for JSON/);
    assert.match(String(hint), /Your copy of `scripts\/review-staged\.sh` has changes that aren't committed: if they fix this, commit them\./);
  });
  withRepo(reviewRepo({ after: (dir) => write(dir, { [SCRIPT]: withFlags('--max-turns 5') }) }), (dir) => {
    assert.equal(callHint(dir), true);
  });
});

// The arguments a shell passes for `flags`, written with double quotes only.
const argvOf = (flags) => [...flags.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
const flagHints = (flags, prompt = ['-p', PROMPT]) => callHints([...prompt, ...argvOf(flags)]).join(' ');

test('a-4 accepts the flags written in other forms, and the prompt after -p wherever -p is', () => {
  for (const flags of [
    FLAGS.replace('--max-turns 5', '--max-turns=5'),
    FLAGS.replace('--permission-mode dontAsk', '--permission-mode=dontAsk'),
    FLAGS.replace('--allowedTools "Read,Grep,Glob"', '--allowed-tools Read Grep Glob'),
    FLAGS.replace('"Read,Grep,Glob"', '"Read Grep Glob"'),
    FLAGS.replace('"Read,Grep,Glob"', '"Read, Grep, Glob"'),
    FLAGS.replace('"Read,Grep,Glob"', 'Read --allowedTools "Grep,Glob"'),
    FLAGS.replace('"Read,Grep,Glob"', '"Read(./src/**)" Grep'),
    FLAGS.replace('--max-turns 5', '--max-turns 10'),
    `--model sonnet ${FLAGS} --max-budget-usd 1`,
  ]) {
    assert.equal(flagHints(flags), '', flags);
  }
  assert.equal(flagHints(FLAGS, ['--print', PROMPT]), '');
  assert.equal(flagHints(FLAGS, ['--model', 'sonnet', '-p', PROMPT]), '');
  // The same, end to end: the stand-in records the call the script makes.
  for (const script of [
    withFlags('--max-turns=5 --permission-mode=dontAsk --output-format json --allowed-tools Read Grep Glob'),
    withCall(`claude --model sonnet -p "${PROMPT}" ${FLAGS}`),
  ]) {
    withRepo(reviewRepo({ script }), (dir) => {
      assert.equal(callHint(dir), true, script);
    });
  }
});

test('a-4 names each flag the call lacks or gets wrong', () => {
  for (const [flags, hint] of [
    [FLAGS.replace('--output-format json ', ''), /It doesn't ask for JSON: add `--output-format json`\./],
    [FLAGS.replace('--output-format json', '--output-format text'), /It asks for `--output-format text`: use `json`/],
    [FLAGS.replace('--permission-mode dontAsk ', ''), /It sets no permission mode: add `--permission-mode dontAsk`, so every call that would ask for permission is denied\./],
    [FLAGS.replace('dontAsk', 'dontask'), /Write `dontAsk` as Claude Code spells it, not `dontask`\./],
    [FLAGS.replace('dontAsk', 'acceptEdits'), /It runs in `acceptEdits` mode: use `--permission-mode dontAsk`/],
    [FLAGS.replace('dontAsk', 'bypassPermissions'), /It runs in `bypassPermissions` mode/],
    [`${FLAGS} --dangerously-skip-permissions`, /Drop `--dangerously-skip-permissions`: it is the same as `--permission-mode bypassPermissions`\./],
    [FLAGS.replace('"Read,Grep,Glob"', '"Read,Grep,Glob,Bash"'), /`--allowedTools` lists `Bash`, which is not `Read`, `Grep` or `Glob`\./],
    [FLAGS.replace('"Read,Grep,Glob"', '"Edit Write Read"'), /lists `Edit` and `Write`, which are not `Read`, `Grep` or `Glob`/],
    [FLAGS.replace('"Read,Grep,Glob"', '"Read,Bash(git diff *)"'), /lists `Bash\(git diff \*\)`, which is not/],
    [FLAGS.replace('"Read,Grep,Glob"', 'read,grep,glob'), /Write `Read` as Claude Code spells the tool, not `read`\./],
    [FLAGS.replace('--allowedTools "Read,Grep,Glob" ', ''), /It pre-approves no tools: add `--allowedTools "Read,Grep,Glob"`\./],
    [FLAGS.replace('"Read,Grep,Glob"', '""'), /`--allowedTools` lists no tool/],
    [FLAGS.replace('--max-turns 5', '--max-turns 0'), /`--max-turns 0` is below 1: use a number from 1 to 10\./],
    [FLAGS.replace('--max-turns 5', '--max-turns 11'), /`--max-turns 11` is above 10: use a number from 1 to 10\./],
    [FLAGS.replace('--max-turns 5', '--max-turns five'), /`--max-turns five` isn't a whole number/],
    [FLAGS.replace(' --max-turns 5', ''), /It sets no turn cap: add `--max-turns` with a number from 1 to 10\./],
    [FLAGS.replace('--max-turns', '--max_turns'), /Claude Code doesn't know `--max_turns`, so it stops with an error before the run starts: write `--max-turns`\./],
    [FLAGS.replace(' 5', ''), /`--max-turns` has no number after it/],
  ]) {
    assert.match(flagHints(flags), hint, flags);
  }
  // End to end, a misspelt flag the stand-in captured.
  withRepo(reviewRepo({ script: withFlags(FLAGS.replace('--allowedTools', '--allowedtools')) }), (dir) => {
    assert.match(String(callHint(dir)), /It pre-approves no tools: add `--allowedTools "Read,Grep,Glob"`\. Claude Code doesn't know `--allowedtools`, so it stops with an error before the run starts: write `--allowedTools`\./);
  });
});

test('a-4 fails a prompt that isn\'t right after -p, naming a word the tool list took', () => {
  withRepo(reviewRepo({ script: withCall(`claude -p --output-format json --permission-mode dontAsk --max-turns 5 --allowedTools "Read,Grep,Glob" "${PROMPT}"`) }), (dir) => {
    const hint = String(callHint(dir));
    assert.match(hint, /`--output-format` comes right after `-p`\. Write the prompt right after `-p`, as in `claude -p "<prompt>" --output-format json \.\.\.`\./);
    assert.match(hint, /`this` isn't a read-only tool: list only `Read`, `Grep` and `Glob` after `--allowedTools`, and write the prompt right after `-p`\./);
    assert.doesNotMatch(hint, /lists `Review`/);
  });
  const last = flagHints(`${FLAGS} "${PROMPT}"`, ['-p']);
  assert.match(last, /`--output-format` comes right after `-p`/);
  assert.doesNotMatch(last, /read-only tool/);
  assert.match(flagHints(`${FLAGS} -p`, []), /Nothing follows `-p`\. Write the prompt right after it/);
  assert.match(flagHints(FLAGS, ['-p', ' ']), /The prompt after `-p` is empty/);
});

test('a-4 fails a script that runs claude without -p, or never runs it, and says how it ended', () => {
  withRepo(reviewRepo({ script: withCall(`claude "${PROMPT}" ${FLAGS}`) }), (dir) => {
    assert.match(String(callHint(dir)), /With a staged change, `scripts\/review-staged\.sh` ran `claude` without `-p` \(or `--print`\), which starts an interactive session\./);
  });
  withRepo(reviewRepo({ script: edited([`git diff --cached | ${CALL} > "$out"`, 'echo "Claude is off today." >&2; exit 3']) }), (dir) => {
    assert.match(String(callHint(dir)), /never ran `claude -p`, so the check couldn't see its flags\. It exited with 3: Claude is off today\./);
  });
});

test('a-4 checks that the script pipes in the staged diff and nothing else', () => {
  for (const [script, hint] of [
    [edited([`git diff --cached | ${CALL}`, `git diff | ${CALL}`]), /What it piped into `claude -p` doesn't hold the staged change\. Pipe the staged diff in: `git diff --cached \| claude -p "<prompt>" \.\.\.`\./],
    [edited([`git diff --cached | ${CALL}`, `git diff HEAD | ${CALL}`]), /The diff it piped into `claude -p` also holds a change that isn't staged\. Pipe `git diff --cached`/],
    [edited([`git diff --cached | ${CALL}`, `claude -p "${PROMPT} $(git diff --cached)" ${FLAGS}`]), /It puts the diff in the prompt\. Pipe it in instead/],
  ]) {
    withRepo(reviewRepo({ script }), (dir) => {
      assert.match(String(behaviorHint(dir)), hint);
    });
  }
});

test('a-4 checks where the script saves the JSON, and that it prints the review', () => {
  withRepo(reviewRepo({ script: edited(['out="${1:-.practice/a-4-result.json}"', 'out=".practice/a-4-result.json"']) }), (dir) => {
    assert.match(String(behaviorHint(dir)), /It saved the JSON to `\.practice\/a-4-result\.json`, though its first argument named another path\. Save the output of `claude -p` to the path in the first argument, or to `\.practice\/a-4-result\.json` without one: `out="\$\{1:-\.practice\/a-4-result\.json\}"`, then `> "\$out"`\./);
  });
  withRepo(reviewRepo({ script: edited(['out="${1:-.practice/a-4-result.json}"', 'out="$1"']) }), (dir) => {
    assert.match(String(behaviorHint(dir)), /Run without an argument, it didn't save the JSON to `\.practice\/a-4-result\.json` \(it exited with 1: .*unbound variable\)\. Use that path when there is no argument/);
  });
  withRepo(reviewRepo({ script: edited([`> "$out"\nstatus=$?\njq -r '.result // empty' "$out"`, `| tee /dev/stderr | jq -r .result > "$out"\nstatus=$?\ncat "$out"`]) }), (dir) => {
    assert.match(String(behaviorHint(dir)), /The file at the path in its first argument isn't the JSON `claude -p` printed\. Save that output unchanged\./);
  });
  withRepo(reviewRepo({ script: edited(['jq -r \'.result // empty\' "$out"\n', '']) }), (dir) => {
    assert.match(String(behaviorHint(dir)), /It didn't print the review\. Print the JSON's `result`, as `jq -r '\.result'` does\./);
  });
});

test('a-4 checks both exit rules apart: claude exiting non-zero, and is_error', () => {
  withRepo(reviewRepo({ script: edited(['> "$out"\nstatus=$?', '> "$out" || true\nstatus=$?'], ['if [ "$status" -ne 0 ] || [ "$(jq -r \'.is_error\' "$out")" != "false" ]; then', 'if [ "$(jq -r \'.is_error\' "$out")" = "true" ]; then']) }), (dir) => {
    const hint = String(behaviorHint(dir));
    assert.match(hint, /When `claude -p` exits non-zero and prints no JSON, as it does for a flag it can't read, it exited 0\. Exit non-zero whenever `claude -p` does\./);
    assert.doesNotMatch(hint, /is_error/);
  });
  withRepo(reviewRepo({ script: edited(['if [ "$status" -ne 0 ] || [ "$(jq -r \'.is_error\' "$out")" != "false" ]; then', 'if [ "$status" -ne 0 ]; then']) }), (dir) => {
    const hint = String(behaviorHint(dir));
    assert.match(hint, /When the JSON says `"is_error": true` and `claude -p` exits 0, it exited 0\. Exit non-zero whenever `is_error` is `true`/);
    assert.doesNotMatch(hint, /prints no JSON/);
  });
});

test('a-4 fails a script that calls Claude, exits 0 or says nothing when nothing is staged', () => {
  withRepo(reviewRepo({ script: edited(['if git diff --cached --quiet; then echo "Nothing is staged." >&2; exit 2; fi\n', '']) }), (dir) => {
    const hint = String(behaviorHint(dir));
    assert.match(hint, /With nothing staged, it still ran `claude -p`\. Test for a staged change first, as `git diff --cached --quiet` does/);
    assert.match(hint, /With nothing staged, it exited 0\./);
  });
  withRepo(reviewRepo({ script: edited(['if git diff --cached --quiet;', 'if git diff --quiet;']) }), (dir) => {
    assert.match(String(behaviorHint(dir)), /With nothing staged, it still ran `claude -p`/);
  });
  withRepo(reviewRepo({ script: edited(['then echo "Nothing is staged." >&2; exit 2; fi', 'then exit 0; fi']) }), (dir) => {
    const hint = String(behaviorHint(dir));
    assert.match(hint, /With nothing staged, it exited 0\. Exit non-zero, so whatever runs it can tell that no review ran\./);
    assert.match(hint, /With nothing staged, it printed nothing\. Say that nothing is staged\./);
    assert.doesNotMatch(hint, /still ran/);
  });
});

test('a-4 wants one claude -p call, and lets the script ask for the version first', () => {
  withRepo(reviewRepo({ script: edited(['status=$?\n', `status=$?\ngit diff --cached | ${CALL} > /dev/null\n`]) }), (dir) => {
    assert.match(String(behaviorHint(dir)), /With one staged change, it ran `claude -p` 2 times\. Run it once/);
  });
  withRepo(reviewRepo({ script: edited(['set -uo pipefail\n', 'set -uo pipefail\nclaude --version > /dev/null || { echo "Install Claude Code first." >&2; exit 1; }\n']) }), (dir) => {
    const { code, out } = a4(dir);
    assert.equal(code, 0, out);
  });
});

test('a-4 refuses to run a script that could reach the real Claude Code, and runs nothing', () => {
  const outside = mkdtempSync(join(tmpdir(), 'a4-ran-'));
  const ran = join(outside, 'ran');
  try {
    for (const [script, why] of [
      [withCall(`/usr/local/bin/claude -p "${PROMPT}" ${FLAGS}`), /calls Claude Code by its path, `\/usr\/local\/bin\/claude`/],
      [withCall(`"$HOME"/.local/bin/claude -p "${PROMPT}" ${FLAGS}`), /calls Claude Code by its path, `\/\.local\/bin\/claude`/],
      [withCall(`npx @anthropic-ai/claude-code -p "${PROMPT}" ${FLAGS}`), /runs Claude Code through `npx`/],
      [withCall(`bunx claude -p "${PROMPT}" ${FLAGS}`), /runs Claude Code through `bunx`/],
      [edited(['set -uo pipefail\n', 'set -uo pipefail\nexport PATH="$HOME/.local/bin:$PATH"\n']), /changes `PATH`/],
    ]) {
      const marked = script.replace('set -uo pipefail\n', () => `set -uo pipefail\ntouch "${ran}"\n`);
      withRepo(reviewRepo({ script: marked }), (dir) => {
        const { code, out } = a4(dir);
        assert.equal(code, 1, out);
        assert.match(out, why);
        assert.match(out, /which the stand-in can't replace, so the check didn't run it\. Call `claude` by name, leave `PATH` as it is, and commit\./);
        assert.equal(existsSync(ran), false, `the check ran ${script}`);
      });
    }
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
  withRepo(reviewRepo({ script: edited(['set -uo pipefail\n', 'set -uo pipefail\n# Not /usr/local/bin/claude: the check stands in for claude on PATH.\n']) }), (dir) => {
    assert.equal(callHint(dir), true);
  });
});

test('a-4 fails a script with Windows line ends, and points at jq when it is missing', () => {
  withRepo(reviewRepo({ script: REVIEW.replace(/\n/g, '\r\n') }), (dir) => {
    const { code, out } = a4(dir);
    assert.equal(code, 1, out);
    assert.match(out, /The committed `scripts\/review-staged\.sh` has Windows line ends \(CRLF\), which bash can't run\./);
  });
  withRepo(reviewRepo({ script: edited(['jq -r \'.result // empty\' "$out"', 'echo "scripts/review-staged.sh: line 9: jq: command not found" >&2; exit 127']) }), (dir) => {
    assert.equal(behaviorHint(dir), 'The script needs `jq`, which isn\'t installed. Install it and run the check again.');
  });
});

test('a-4 reads the saved run, and says what is wrong with it', () => {
  const utf16 = (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text.replace(/\n/g, '\r\n'), 'utf16le')]);
  for (const result of [{ ...REAL_RUN, num_turns: 6 }, utf16(JSON.stringify(REAL_RUN, null, 2)), `﻿${JSON.stringify(REAL_RUN)}`]) {
    withRepo(reviewRepo({ result }), (dir) => {
      assert.equal(runHint(dir), true);
    });
  }
  for (const [result, hint] of [
    [null, /There is no `\.practice\/a-4-result\.json` yet: stage a change and run `scripts\/review-staged\.sh`, which saves the JSON there\./],
    ['Looks good to me.\n', /`\.practice\/a-4-result\.json` isn't JSON\./],
    [{ ...REAL_RUN, type: 'assistant' }, /isn't the result of a `claude -p` run with `--output-format json`/],
    [{ ...REAL_RUN, session_id: STUB_SESSION }, /holds the check's stand-in reply, not a real run/],
    [{ ...REAL_RUN, subtype: 'error_max_turns', is_error: true, result: undefined }, /stopped early \(`error_max_turns`\) and holds no review\. Raise the cap, up to 10, or narrow the prompt\. Then stage a change and run `scripts\/review-staged\.sh` again\./],
    [{ ...REAL_RUN, is_error: true, result: 'Not logged in · Please run /login' }, /The run in `\.practice\/a-4-result\.json` failed: "Not logged in · Please run \/login"\. Fix what it says\./],
    [{ ...REAL_RUN, result: '  ' }, /holds no review in `result`/],
    [{ ...REAL_RUN, num_turns: 7 }, /took 7 turns, more than `--max-turns 5` allows, so it ran with a higher cap\./],
  ]) {
    withRepo(reviewRepo({ result }), (dir) => {
      assert.match(String(runHint(dir)), hint, JSON.stringify(result));
    });
  }
  // Without a script to read the cap from, the cap is 10.
  withRepo(reviewRepo({ script: null, result: { ...REAL_RUN, num_turns: 11 } }), (dir) => {
    assert.equal(runHint(dir), true);
  });
});

test('the stand-in records each call\'s arguments and stdin as they were, and answers --version', () => {
  const script = '#!/usr/bin/env bash\nv=$(claude --version)\nprintf \'staged\\n\' | claude -p "$(printf \'two\\nlines\')" --model "x y" > "$1"\necho "$v"\n';
  withRepo(reviewRepo({ script }), (dir) => {
    const run = runStubbed(openRepo(dir), SCRIPT, { args: (out) => [join(out, 'reply.json')], reply: { type: 'result', session_id: STUB_SESSION } });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(run.calls.map((c) => c.argv), [['--version'], ['-p', 'two\nlines', '--model', 'x y']]);
    assert.equal(run.calls[1].stdin, 'staged\n');
    assert.equal(JSON.parse(run.saved['out/reply.json']).session_id, STUB_SESSION);
    assert.match(run.stdout, /\(Claude Code\)/);
  });
});

test('the stand-in runs the script without the sign-in variables, with a HOME of its own', () => {
  const script = '#!/usr/bin/env bash\nprintf "%s|%s|%s|%s|%s|%s" "${ANTHROPIC_API_KEY-unset}" "${ANTHROPIC_AUTH_TOKEN-unset}" "${CLAUDE_CODE_OAUTH_TOKEN-unset}" "${ANTHROPIC_BASE_URL-unset}" "$HOME" "$CLAUDE_CONFIG_DIR" > "$1"\n';
  const fake = { ANTHROPIC_API_KEY: 'not-a-key', ANTHROPIC_AUTH_TOKEN: 'not-a-token', CLAUDE_CODE_OAUTH_TOKEN: 'not-a-token', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' };
  const before = Object.fromEntries(Object.keys(fake).map((k) => [k, process.env[k]]));
  withRepo(reviewRepo({ script }), (dir) => {
    let run;
    try {
      Object.assign(process.env, fake);
      run = runStubbed(openRepo(dir), SCRIPT, { args: (out) => [join(out, 'env.txt')] });
    } finally {
      for (const [k, v] of Object.entries(before)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    const [key, auth, token, url, home, config] = run.saved['out/env.txt'].split('|');
    assert.deepEqual([key, auth, token, url], ['unset', 'unset', 'unset', 'unset']);
    assert.match(home, /stub-claude-[^/]+\/home$/);
    assert.match(config, /stub-claude-[^/]+\/config$/);
  });
});

test('the stand-in stops a script at the time limit, with whatever the script left running', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'a4-beat-'));
  const beat = join(outside, 'beat');
  const dir = reviewRepo({ script: '#!/usr/bin/env bash\n( while :; do date > "$1"; sleep 0.1; done ) &\nsleep 30\n' })();
  try {
    const started = Date.now();
    const run = runStubbed(openRepo(dir), SCRIPT, { args: () => [beat], timeout: 1000 });
    assert.equal(run.timedOut, true);
    assert.ok(Date.now() - started < 10_000, 'the run went on past the time limit');
    const last = statSync(beat).mtimeMs;
    await wait(600);
    assert.equal(statSync(beat).mtimeMs, last, 'the background loop is still running');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('the argv reader takes values and lists as Claude Code does', () => {
  const p = (...argv) => parseClaudeArgs(argv);
  // A list keeps taking arguments until the next option, so it takes a
  // prompt written after it; the = form takes one value.
  assert.deepEqual(p('-p', '--allowedTools', 'Read', 'Say hi').flags.allowedTools, ['Read', 'Say hi']);
  assert.equal(p('-p', '--allowedTools', 'Read', 'Say hi').promptFirst, false);
  assert.equal(p('--allowedTools=Read', 'Say hi', '-p').prompt, 'Say hi');
  // Short flags combine; what follows -p in the same token comes next.
  assert.equal(p('-cp', 'Say hi').promptFirst, true);
  assert.deepEqual([p('-pc', 'Say hi').promptFirst, p('-pc', 'Say hi').next], [false, '-c']);
  // An optional value is the next argument unless that is an option; a
  // value is the next argument, whatever it starts with.
  assert.equal(p('-p', '--debug', 'Say hi').prompt, undefined);
  assert.equal(p('--debug', '-p', 'Say hi').prompt, 'Say hi');
  assert.equal(p('-p', 'x', '--append-system-prompt', '-be brief').flags.appendSystemPrompt, '-be brief');
  assert.equal(p('-p', 'x', '-rabc').flags.resume, 'abc');
  // Aliases share a name, a list adds up, and the last value wins.
  const r = p('-p', 'x', '--allowed-tools', 'Read', '--allowedTools', 'Grep', '--max-turns', '3', '--max-turns=5', '--max-budget-usd');
  assert.deepEqual([r.flags.allowedTools, r.flags.maxTurns, r.flags.maxBudgetUsd], [['Read', 'Grep'], '5', null]);
  assert.deepEqual(p('-p', 'x', '--allowedtools', 'Read').unknown, ['--allowedtools']);
  assert.deepEqual(p('-p', '--', '-x').operands, ['-x']);
  assert.deepEqual(ruleList(['Read, Grep', 'Bash(git diff *) Glob', ' ']), ['Read', 'Grep', 'Bash(git diff *)', 'Glob']);
});

test('a-4 fails on an unsolved repository and passes on a solved one, as the template\'s assertions expect', () => {
  withRepo(reviewRepo({ script: null, result: null }), (dir) => {
    const { code, out } = check(['a-4', '--assert', 'fail', '--dir', dir]);
    assert.equal(code, 0, out);
  });
  withRepo(reviewRepo(), (dir) => {
    const { code, out } = check(['a-4', '--assert', 'pass', '--dir', dir]);
    assert.equal(code, 0, out);
  });
});

// A repository after lesson a-5, in a copy of the template: the link check
// report workflow on a commit of its own, and the saved list of its runs, one
// run on that commit. The options change a step: `workflow` (null for none) is
// written at `path` and committed unless `commitWorkflow` is false;
// `teardown` deletes it in a later commit; `runs` builds the saved list from
// the workflow's commit (null for none; text or a Buffer as it is);
// `origin` is the remote (null for none); `after` changes the repository
// last. The checks never run gh, so no run happens.
const PIN = 'fd1c128679612beff4ca259c78021c506e8aa7a7';
const ORIGIN = 'git@github.com:learner/claude-actions-practice.git';
const RUN_AT = 'https://github.com/learner/claude-actions-practice/actions/runs/123456789';
const PROMPT_LINES = [
  '          prompt: |',
  '            Run `npm run linkcheck -- samples`. For each broken link it reports, explain in one sentence why it is broken.',
  "            Don't change any files.",
];
const ARGS = '--model sonnet --max-turns 8 --allowedTools "Bash(npm run linkcheck *)"';
const LINKCHECK_REPORT = [
  'name: Link check report',
  '',
  'on:',
  '  workflow_dispatch:',
  '',
  'permissions:',
  '  contents: read',
  '',
  'jobs:',
  '  report:',
  '    runs-on: ubuntu-latest',
  '    timeout-minutes: 10',
  '    steps:',
  '      - uses: actions/checkout@v7',
  '      - uses: actions/setup-node@v7',
  '        with:',
  '          node-version: lts/*',
  `      - uses: anthropics/claude-code-action@${PIN} # v1.0.237`,
  '        with:',
  '          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}',
  '          github_token: ${{ github.token }}',
  ...PROMPT_LINES,
  `          claude_args: ${ARGS}`,
  '',
].join('\n');
// Quick setup's interactive workflow, cut down: no prompt, @claude events.
const CLAUDE_YML = [
  'name: Claude Code',
  'on:',
  '  issue_comment:',
  '    types: [created]',
  '  issues:',
  '    types: [opened, assigned]',
  'jobs:',
  '  claude:',
  "    if: contains(github.event.comment.body, '@claude')",
  '    runs-on: ubuntu-latest',
  '    permissions:',
  '      contents: read',
  '      id-token: write',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '      - uses: anthropics/claude-code-action@v1',
  '        with:',
  '          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}',
  '',
].join('\n');

const runOf = (sha, extra = {}) => ({ databaseId: 123456789, status: 'completed', conclusion: 'success', event: 'workflow_dispatch', headSha: sha, url: RUN_AT, workflowName: 'Link check report', ...extra });

// The lesson's workflow with each `[from, to]` replaced.
function reportWith(...pairs) {
  return pairs.reduce((text, [from, to]) => {
    assert.ok(text.includes(from), `the workflow has no ${JSON.stringify(from)}`);
    return text.replace(from, () => to);
  }, LINKCHECK_REPORT);
}
const withArgs = (args) => reportWith([`claude_args: ${ARGS}`, `claude_args: ${args}`]);

function actionsRepo({ workflow = LINKCHECK_REPORT, path = WORKFLOW, commitWorkflow = true, teardown = false, runs = (sha) => [runOf(sha)], origin = ORIGIN, after } = {}) {
  return () => {
    const dir = repo({ 'README.md': '# demo\n', 'samples/guide.md': '[setup](setup.md)\n' });
    if (origin) git(dir, 'remote', 'add', 'origin', origin);
    const start = commit(dir, 'Start');
    let added = start;
    if (workflow !== null) {
      write(dir, { [path]: workflow });
      if (commitWorkflow) added = commit(dir, 'Add the link check report workflow', [path]);
    }
    if (teardown) {
      git(dir, 'rm', '-q', path);
      commit(dir, 'Tear down the Claude workflow', []);
    }
    if (runs !== null) {
      const saved = typeof runs === 'function' ? runs(added, start) : runs;
      write(dir, { [RUNS]: typeof saved === 'string' || Buffer.isBuffer(saved) ? saved : JSON.stringify(saved, null, 2) });
    }
    after?.(dir, { added, start });
    return dir;
  };
}

const a5 = (dir) => check(['a-5', '--dir', dir]);
// One item on its own.
const setupHint = (dir, options) => pinnedWorkflow(options).check(openRepo(dir));
const limitsHint = (dir, options) => workflowLimits(options).check(openRepo(dir));
const runsHint = (dir) => dispatchedRun().check(openRepo(dir));

test('a-5 passes for the lesson\'s workflow, committed, and a saved manual run on its commit', () => {
  withRepo(actionsRepo(), (dir) => {
    const { code, out } = a5(dir);
    assert.equal(code, 0, out);
    assert.match(out, /3 of 3 passed/);
  });
});

test('a-5 still passes after the teardown deletes the workflow, since it reads the history', () => {
  withRepo(actionsRepo({ teardown: true }), (dir) => {
    assert.equal(existsSync(join(dir, WORKFLOW)), false);
    const { code, out } = a5(dir);
    assert.equal(code, 0, out);
  });
  // The same with quick setup's workflow beside it, both deleted.
  withRepo(actionsRepo({
    teardown: true,
    after: (dir) => {
      write(dir, { '.github/workflows/claude.yml': CLAUDE_YML });
      commit(dir, 'Add claude.yml', ['.github/workflows/claude.yml']);
      git(dir, 'rm', '-q', '.github/workflows/claude.yml');
      commit(dir, 'Remove claude.yml', []);
    },
  }), (dir) => {
    const { code, out } = a5(dir);
    assert.equal(code, 0, out);
  });
});

test('a-5 accepts the workflow written in other ways', () => {
  const steps = LINKCHECK_REPORT.split('\n');
  const atStepsIndent = steps.map((l, i) => (i > 12 ? l.replace(/^ {2}/, '') : l)).join('\n');
  for (const workflow of [
    withArgs(ARGS.replace('--allowedTools', '--allowed-tools')),
    withArgs('|\n            --model sonnet\n            # One command, and a cap.\n            --max-turns 8\n            --allowedTools "Bash(npm run linkcheck *)"'),
    withArgs('>-\n            --model sonnet --max-turns 8\n            --allowedTools "Bash(npm run linkcheck *)"'),
    withArgs(`'--max-turns 8 --allowedTools "Bash(npm run linkcheck *)"'`),
    withArgs(`"--max-turns 8 --allowedTools \\"Bash(npm run linkcheck *)\\""`),
    withArgs("--max-turns 8 --allowedTools 'Bash(npm run linkcheck *)' Read"),
    withArgs('--max-turns 8 --allowedTools=Bash(npm\\ run\\ linkcheck\\ *)'),
    withArgs('--max-turns 10 --allowedTools "Bash(npm run linkcheck *),Read"'),
    reportWith([`anthropics/claude-code-action@${PIN} # v1.0.237`, '"anthropics/claude-code-action@v1.0.237"']),
    reportWith([`anthropics/claude-code-action@${PIN} # v1.0.237`, `'anthropics/claude-code-action@${PIN}'`]),
    reportWith(['${{ github.token }}', '${{ secrets.GITHUB_TOKEN }}']),
    reportWith(['anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}', 'claude_code_oauth_token: ${{secrets.CLAUDE_CODE_OAUTH_TOKEN}}']),
    reportWith(['permissions:\n  contents: read\n\n', ''], ['    timeout-minutes: 10\n', '    timeout-minutes: 10\n    permissions:\n      contents: read\n      id-token: write\n']),
    reportWith(['permissions:\n  contents: read', 'permissions: read-all']),
    reportWith(['permissions:\n  contents: read', 'permissions: {}']),
    reportWith(['    timeout-minutes: 10\n', ''], ['        with:\n          anthropic_api_key', '        timeout-minutes: 15\n        with:\n          anthropic_api_key']),
    reportWith(['on:\n  workflow_dispatch:', 'on: workflow_dispatch']),
    reportWith(['on:\n  workflow_dispatch:', 'on: [push, workflow_dispatch]']),
    reportWith(['on:\n  workflow_dispatch:', '"on":\n  workflow_dispatch:\n    inputs:\n      folder:\n        default: samples']),
    reportWith([PROMPT_LINES.join('\n'), '          prompt: Run `npm run linkcheck -- samples` and explain\n            why each broken link is broken. Change no files.']),
    atStepsIndent,
  ]) {
    withRepo(actionsRepo({ workflow }), (dir) => {
      assert.equal(setupHint(dir), true, workflow);
      assert.equal(limitsHint(dir), true, workflow);
    });
  }
  // A .yaml file, and Windows line ends, end to end.
  for (const options of [{ path: '.github/workflows/linkcheck-report.yaml' }, { workflow: LINKCHECK_REPORT.replace(/\n/g, '\r\n') }]) {
    withRepo(actionsRepo(options), (dir) => {
      const { code, out } = a5(dir);
      assert.equal(code, 0, `${JSON.stringify(options)}: ${out}`);
    });
  }
});

test('a-5 names what the first item finds wrong, in the file and on its line', () => {
  const KEY_TEXT = `sk-ant-api03-${'Xy9_'.repeat(8)}`;
  for (const [workflow, hint] of [
    [reportWith([`@${PIN} # v1.0.237`, '@v1']), /`@v1` on line 18 can move to a new release, which changes the Claude Code version on the runner without a commit of yours\. Pin a release tag \(`@vX\.Y\.Z`\) or that release's full commit SHA\./],
    [reportWith([`@${PIN} # v1.0.237`, '@main']), /`@main` on line 18 can move to a new release/],
    [reportWith([`@${PIN} # v1.0.237`, '@fd1c128']), /`@fd1c128` on line 18 is a short commit SHA\. Write the full 40-character SHA\./],
    [reportWith([`@${PIN} # v1.0.237`, '']), /Line 18 runs `anthropics\/claude-code-action` without a version\./],
    [reportWith([PROMPT_LINES.join('\n') + '\n', '']), /The step on line 18 has no `prompt`, so Claude waits for `@claude` in an issue or pull request \(interactive mode\)\. Add a `prompt` under `with:`/],
    [reportWith([PROMPT_LINES.join('\n'), '          prompt: ""']), /The `prompt` on line 22 is empty\./],
    [reportWith(['${{ secrets.ANTHROPIC_API_KEY }}', KEY_TEXT]), /Line 20 holds what looks like a Claude API key or token\. Treat it as leaked: delete the key in the Claude Console now, because removing it from the file doesn't take it out of your history\./],
    [reportWith(['name: Link check report', `name: Link check report # was ${KEY_TEXT}`]), /Line 1 holds what looks like a Claude API key or token/],
    [reportWith(['${{ secrets.ANTHROPIC_API_KEY }}', '${{ env.CLAUDE_KEY }}']), /`anthropic_api_key` on line 20 isn't read from a secret\. Write `anthropic_api_key: \$\{\{ secrets\.<NAME> \}\}`/],
    [reportWith(['          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}\n', '']), /The step on line 18 passes no credential\. Add `anthropic_api_key: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}` under `with:`/],
    [reportWith(['  workflow_dispatch:', '  workflow_dispatch:\n  pull_request_target:']), /Remove `pull_request_target` from `on:`\. GitHub warns that running untrusted code on it can grant unintended access to write privileges or secrets\./],
  ]) {
    withRepo(actionsRepo({ workflow }), (dir) => {
      const got = String(setupHint(dir));
      assert.match(got, /^`\.github\/workflows\/linkcheck-report\.yml`: /, workflow);
      assert.match(got, hint, workflow);
      assert.doesNotMatch(got, /sk-ant-/, 'the hint repeats the key');
      assert.doesNotMatch(got, /undefined|null/, workflow);
    });
  }
});

test('a-5 names each limit the second item finds missing or too loose', () => {
  const longKey = '--max-turns 8 --allowedTools "Bash(npm run linkcheck *)"';
  for (const [workflow, hint] of [
    [withArgs(ARGS.replace('--max-turns 8', '--max-turns 50')), /`--max-turns 50` is above 10: use a number from 1 to 10\./],
    [withArgs(ARGS.replace('--max-turns 8', '--max-turns 0')), /`--max-turns 0` is below 1/],
    [withArgs(ARGS.replace('--max-turns 8', '--max-turns eight')), /`--max-turns eight` isn't a whole number/],
    [withArgs(ARGS.replace(' --max-turns 8', '')), /`claude_args` sets no turn limit: add `--max-turns` with a number from 1 to 10\./],
    [withArgs(ARGS.replace('--max-turns 8', '--max-turns=8')), /Write `--max-turns 8` with a space, not `--max-turns=8`: the action reads `claude_args` word by word, so it doesn't take `--max-turns=8` as the turn limit\./],
    [withArgs(ARGS.replace('--max-turns 8', '--max-turns=20')), /Write `--max-turns` with a space and a number from 1 to 10, not `--max-turns=20`/],
    [withArgs(ARGS.replace('--max-turns 8', '--max_turns 8')), /sets no turn limit: .* Claude Code doesn't know `--max_turns`: write `--max-turns`\./],
    [withArgs('--allowedTools "Bash(npm run linkcheck *)" --max-turns'), /`--max-turns` has no number after it/],
    [withArgs(ARGS.replace('"Bash(npm run linkcheck *)"', 'Bash')), /`--allowedTools` lists `Bash`, which lets Claude run any command\. Name only the command it needs, as in `Bash\(<command> \*\)`\./],
    [withArgs(ARGS.replace('"Bash(npm run linkcheck *)"', '"Read,Bash(*)"')), /lists `Bash\(\*\)`, which lets Claude run any command/],
    [withArgs(ARGS.replace('"Bash(npm run linkcheck *)"', '"Bash(:*)"')), /lists `Bash\(:\*\)`/],
    [withArgs(ARGS.replace('"Bash(npm run linkcheck *)"', '"Bash( *)"')), /lists `Bash\( \*\)`/],
    [withArgs(ARGS.replace('"Bash(npm run linkcheck *)"', 'Bash(npm run linkcheck *)')), /`--allowedTools` gets `Bash\(npm`, `run`, `linkcheck` and `\*\)` as separate words, because the action splits `claude_args` at spaces outside quotes\. Put each rule in quotes, as in `--allowedTools "Bash\(npm run linkcheck \*\)"`\./],
    [withArgs(ARGS.replace(' --allowedTools "Bash(npm run linkcheck *)"', '')), /`claude_args` pre-approves no tool: add `--allowedTools` naming only the command Claude needs, as in `--allowedTools "Bash\(<command> \*\)"`\./],
    [withArgs(ARGS.replace('--allowedTools', '--allowedtools')), /Claude Code doesn't know `--allowedtools`: write `--allowedTools`\./],
    [withArgs(ARGS.replace('"Bash(npm run linkcheck *)"', '""')), /`--allowedTools` lists no tool/],
    [withArgs(`|\n            --model sonnet # the cheaper model\n            ${longKey}`), /: An unquoted `#` in `claude_args` starts a comment that, for the action, runs to the end of the value, so it never reads `--max-turns` and `--allowedTools`\. Move that comment to a line of its own, above `claude_args`\.$/],
    [reportWith([`          claude_args: ${ARGS}\n`, '']), /The step on line 18 has no `claude_args`, so nothing limits the run\./],
    [reportWith(['    timeout-minutes: 10\n', '']), /The job `report` sets no `timeout-minutes`, so only GitHub's default limit stops a run that hangs\. Add `timeout-minutes` with a number from 1 to 30 to the job\./],
    [reportWith(['timeout-minutes: 10', 'timeout-minutes: 90']), /`timeout-minutes: 90` on line 12 is above 30: use a number from 1 to 30\./],
    [reportWith(['timeout-minutes: 10', 'timeout-minutes: ${{ inputs.minutes }}']), /`timeout-minutes: \$\{\{ inputs\.minutes \}\}` on line 12 isn't a whole number/],
    [reportWith(['permissions:\n  contents: read\n', '']), /Neither the workflow nor the job `report` sets `permissions`, so the job token gets the repository's default access, which can include write access\. Add `permissions:` with `contents: read`\./],
    [reportWith(['contents: read', 'contents: write']), /`contents: write` on line 7 gives the job token write access, and this job only reads\. Make it `read`, or remove it\./],
    [reportWith(['contents: read', 'contents: read\n  issues: write\n  pull-requests: write']), /`issues: write` and `pull-requests: write` on lines 8 and 9 give the job token write access/],
    [reportWith(['permissions:\n  contents: read', 'permissions: write-all']), /`permissions: write-all` on line 6 gives the job token write access to everything\. Use `contents: read`\./],
    [reportWith(['          github_token: ${{ github.token }}\n', '']), /The step on line 18 passes no `github_token`, so Claude acts as the Claude GitHub App, which can write to the repository\. Add `github_token: \$\{\{ github\.token \}\}` under `with:`/],
    [reportWith(['${{ github.token }}', '${{ secrets.MY_TOKEN }}']), /`github_token` on line 21 isn't this job's own token, so the job's `permissions` don't limit it\./],
  ]) {
    withRepo(actionsRepo({ workflow }), (dir) => {
      const got = String(limitsHint(dir));
      assert.match(got, /^`\.github\/workflows\/linkcheck-report\.yml`: /, workflow);
      assert.match(got, hint, workflow);
      assert.doesNotMatch(got, /undefined|null/, workflow);
    });
  }
  // A job's own permissions replace the workflow's.
  withRepo(actionsRepo({ workflow: reportWith(['permissions:\n  contents: read', 'permissions: write-all'], ['    timeout-minutes: 10\n', '    timeout-minutes: 10\n    permissions:\n      contents: read\n']) }), (dir) => {
    assert.equal(limitsHint(dir), true);
  });
  // Four problems at once: three are named, then how many more.
  withRepo(actionsRepo({ workflow: reportWith([`          claude_args: ${ARGS}\n`, ''], ['    timeout-minutes: 10\n', ''], ['contents: read', 'contents: write'], ['          github_token: ${{ github.token }}\n', '']) }), (dir) => {
    assert.match(String(limitsHint(dir)), /And 1 more: fix these and run the check again\.$/);
  });
});

test('a-5 says to commit a workflow that is only in the working tree, and points out uncommitted fixes', () => {
  withRepo(actionsRepo({ commitWorkflow: false }), (dir) => {
    const { code, out } = a5(dir);
    assert.equal(code, 1, out);
    assert.match(out, /`\.github\/workflows\/linkcheck-report\.yml` isn't committed\. Run `git add \.github\/workflows\/linkcheck-report\.yml`, commit it, and push\. GitHub starts a workflow by hand only once its file is on the default branch\./);
    assert.match(out, /There is no committed workflow that starts on `workflow_dispatch` and runs `anthropics\/claude-code-action`, so the check can't read its limits\./);
  });
  withRepo(actionsRepo({ workflow: reportWith([`@${PIN} # v1.0.237`, '@v1']), after: (dir) => write(dir, { [WORKFLOW]: LINKCHECK_REPORT }) }), (dir) => {
    assert.match(String(setupHint(dir)), /`@v1` on line 18 can move.* Your copy of `\.github\/workflows\/linkcheck-report\.yml` has changes that aren't committed: if they fix this, commit them\./);
  });
  withRepo(actionsRepo({ workflow: 'name: Placeholder\non: workflow_dispatch\njobs: {}\n', after: (dir) => write(dir, { [WORKFLOW]: LINKCHECK_REPORT }) }), (dir) => {
    assert.match(String(setupHint(dir)), /Your copy of `\.github\/workflows\/linkcheck-report\.yml` runs `anthropics\/claude-code-action`, but that change isn't committed\. Commit it, and push\./);
  });
});

test('a-5 says the @claude workflow is not the one the lesson asks for, and names the events of one that starts otherwise', () => {
  withRepo(actionsRepo({ workflow: CLAUDE_YML, path: '.github/workflows/claude.yml' }), (dir) => {
    assert.match(String(setupHint(dir)), /`\.github\/workflows\/claude\.yml` has no `prompt`, so it waits for `@claude` \(interactive mode\)\. You need a second workflow, `\.github\/workflows\/linkcheck-report\.yml`, that starts with `on: workflow_dispatch` and has a `prompt`\. Write it as Your turn describes, then commit and push it\./);
  });
  withRepo(actionsRepo({ workflow: reportWith(['on:\n  workflow_dispatch:', 'on:\n  push:\n    branches: [main]']) }), (dir) => {
    assert.match(String(setupHint(dir)), /`\.github\/workflows\/linkcheck-report\.yml` runs Claude with a `prompt`, but starts on `push`\. Start it with `on: workflow_dispatch`, then commit and push\./);
  });
  withRepo(actionsRepo({ workflow: null }), (dir) => {
    assert.match(String(setupHint(dir)), /^There is no committed workflow that runs `anthropics\/claude-code-action`\. Write `\.github\/workflows\/linkcheck-report\.yml` as Your turn describes, then commit and push it\./);
  });
});

test('a-5 reads the newest commit that holds a manual workflow, and a later pull_request workflow never stands in for it', () => {
  const review = reportWith(['on:\n  workflow_dispatch:', 'on:\n  pull_request:'], [`@${PIN} # v1.0.237`, '@v1']);
  const later = (dir) => {
    write(dir, { '.github/workflows/claude-review.yml': review });
    commit(dir, 'Add the review workflow', ['.github/workflows/claude-review.yml']);
  };
  withRepo(actionsRepo({ after: later }), (dir) => {
    const { code, out } = a5(dir);
    assert.equal(code, 0, out);
    // The capstone's builder, limited to pull_request, reads the later one.
    const capstone = { triggers: ['pull_request'], file: '.github/workflows/claude-review.yml', guide: 'the brief' };
    assert.match(String(setupHint(dir, capstone)), /^`\.github\/workflows\/claude-review\.yml`: `@v1` on line 18 can move/);
    assert.equal(chosenWorkflow(openRepo(dir), ['pull_request']).file.path, '.github/workflows/claude-review.yml');
    assert.equal(chosenWorkflow(openRepo(dir), ['workflow_dispatch']).file.path, WORKFLOW);
  });
  // The newest version of the workflow counts, whichever way it changed.
  const edit = (text) => (dir) => {
    write(dir, { [WORKFLOW]: text });
    commit(dir, 'Change the workflow', [WORKFLOW]);
  };
  withRepo(actionsRepo({ after: edit(reportWith([`@${PIN} # v1.0.237`, '@v1'])) }), (dir) => {
    assert.match(String(setupHint(dir)), /`@v1` on line 18/);
  });
  withRepo(actionsRepo({ workflow: reportWith([`@${PIN} # v1.0.237`, '@v1']), after: edit(LINKCHECK_REPORT) }), (dir) => {
    assert.equal(setupHint(dir), true);
  });
  // After the teardown, a hint names the commit it read.
  withRepo(actionsRepo({ workflow: reportWith([`@${PIN} # v1.0.237`, '@v1']), teardown: true }), (dir) => {
    const added = git(dir, 'rev-parse', '--short=7', 'HEAD~1');
    assert.match(String(setupHint(dir)), new RegExp(`^\`\\.github/workflows/linkcheck-report\\.yml\` \\(as committed in ${added}\\): \`@v1\``));
  });
});

test('a-5 picks the workflow with a prompt and the fewest problems among those of one commit', () => {
  const broken = reportWith([`@${PIN} # v1.0.237`, '@v1']);
  withRepo(actionsRepo({ after: (dir) => { write(dir, { '.github/workflows/a-broken.yml': broken }); commit(dir, 'Add another', ['.github/workflows/a-broken.yml']); } }), (dir) => {
    assert.equal(setupHint(dir), true);
  });
  const noPrompt = reportWith([PROMPT_LINES.join('\n') + '\n', '']);
  withRepo(actionsRepo({ workflow: broken, after: (dir) => { write(dir, { '.github/workflows/a-dispatch.yml': noPrompt }); commit(dir, 'Add another', ['.github/workflows/a-dispatch.yml']); } }), (dir) => {
    assert.match(String(setupHint(dir)), /^`\.github\/workflows\/linkcheck-report\.yml`: `@v1`/);
  });
});

test('a-5 reads the saved runs, and says what is wrong with them', () => {
  const utf16 = (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text.replace(/\n/g, '\r\n'), 'utf16le')]);
  for (const options of [
    { runs: (sha) => utf16(JSON.stringify([runOf(sha)], null, 2)) },
    { runs: (sha) => `﻿${JSON.stringify([runOf(sha)])}` },
    { runs: (sha) => runOf(sha) },
    { runs: (sha) => [runOf(sha, { status: 'in_progress', conclusion: '', databaseId: 2 }), runOf(sha)] },
    { runs: (sha) => [runOf(sha, { url: 'https://github.com/Learner/Claude-Actions-Practice/actions/runs/123456789' })] },
    { origin: 'https://github.com/learner/claude-actions-practice' },
    { origin: 'ssh://git@github.com/learner/claude-actions-practice.git' },
    { origin: null, runs: (sha) => [runOf(sha, { url: 'https://github.com/someone/else/actions/runs/1' })] },
    { origin: 'https://gitlab.com/learner/claude-actions-practice.git', runs: (sha) => [runOf(sha, { url: undefined })] },
  ]) {
    withRepo(actionsRepo(options), (dir) => {
      assert.equal(runsHint(dir), true, String(options.runs ?? options.origin));
    });
  }
  const SAVE = '`gh run list --workflow linkcheck-report\\.yml --json databaseId,status,conclusion,event,headSha,url,workflowName > \\.practice\\/a-5-runs\\.json`';
  for (const [runs, hint] of [
    [null, new RegExp(`^There is no \`\\.practice/a-5-runs\\.json\` yet\\. Start the workflow with \`gh workflow run linkcheck-report\\.yml\`, wait for it to finish, then save the list: ${SAVE}\\.$`)],
    ['completed  success  Link check report\n', /`\.practice\/a-5-runs\.json` isn't JSON\. Save the list with `--json`, unchanged:/],
    [[], /`\.practice\/a-5-runs\.json` lists no runs\. Start the workflow with `gh workflow run linkcheck-report\.yml`/],
    [[{ name: 'Link check report' }], /doesn't hold the fields the check reads\. Save the list with them:/],
    [(sha) => [runOf(sha, { status: 'in_progress', conclusion: '' })], /Run 123456789 hasn't finished: its `status` is `in_progress`\. Wait for it with `gh run watch 123456789`, then save the list again:/],
    [(sha) => [runOf(sha, { conclusion: 'failure' })], /Run 123456789 ended with `failure`\. See why with `gh run view 123456789 --log-failed`, fix the workflow, commit and push it, run it again with `gh workflow run linkcheck-report\.yml`, then save the list again:/],
    [(sha) => [runOf(sha, { conclusion: 'cancelled' })], /Run 123456789 ended with `cancelled`\. Run the workflow again with `gh workflow run linkcheck-report\.yml`/],
    [(sha) => [runOf(sha, { event: 'issues' }), runOf(sha, { event: 'issue_comment' })], /`\.practice\/a-5-runs\.json` lists only runs that `@claude` started \(`issues` and `issue_comment`\)\. Start your workflow by hand with `gh workflow run linkcheck-report\.yml`/],
    [(sha) => [runOf(sha, { event: 'push' })], /lists no run started by hand \(`workflow_dispatch`\), only `push`\./],
    [(sha) => [runOf(sha, { url: 'https://github.com/someone/else/actions/runs/1' })], /Run 123456789 ran in `someone\/else`, but this repository's `origin` is `learner\/claude-actions-practice`\. Save the list in the copy you made for this lesson, and run the check there\./],
    [(sha) => [runOf(sha, { url: undefined })], /Run 123456789 in `\.practice\/a-5-runs\.json` has no GitHub run URL/],
    [(sha) => [runOf(sha, { headSha: undefined })], /Run 123456789 has no `headSha`/],
    [() => [runOf('0123456789abcdef0123456789abcdef01234567')], /Run 123456789 ran on commit 0123456, which this repository doesn't have\. Run `git pull` to fetch it, then run the check again\./],
    [(sha, start) => [runOf(start)], /ran on commit [0-9a-f]{7}, where no workflow runs `anthropics\/claude-code-action` with a `prompt`\. Once your workflow is pushed, run it with `gh workflow run linkcheck-report\.yml`/],
    [(sha) => [runOf(sha, { event: 'issues' }), runOf(sha, { conclusion: 'failure', databaseId: 7 })], /Run 7 ended with `failure`/],
  ]) {
    withRepo(actionsRepo({ runs }), (dir) => {
      assert.match(String(runsHint(dir)), hint, String(runs));
    });
  }
  // A run on a commit that holds only the @claude workflow, which has no prompt.
  withRepo(actionsRepo({
    runs: null,
    after: (dir) => {
      write(dir, { '.github/workflows/claude.yml': CLAUDE_YML });
      const sha = commit(dir, 'Add claude.yml', ['.github/workflows/claude.yml']);
      git(dir, 'rm', '-q', WORKFLOW);
      const without = commit(dir, 'Drop the report', []);
      write(dir, { [RUNS]: JSON.stringify([runOf(without)]) });
      assert.ok(sha);
    },
  }), (dir) => {
    assert.match(String(runsHint(dir)), /where no workflow runs `anthropics\/claude-code-action` with a `prompt`/);
  });
});

test('the workflow reader takes the forms workflow files use, without a YAML library', () => {
  const read = (text) => readActions(text);
  assert.deepEqual(read('on: {workflow_dispatch: {}, push: {branches: [main]}}\njobs: {}\n').triggers, ['workflow_dispatch', 'push']);
  assert.deepEqual(read('on:\n  - push\n  - workflow_dispatch # by hand\njobs: {}\n').triggers, ['push', 'workflow_dispatch']);
  assert.deepEqual(read("'on': [ \"push\" ]\n").triggers, ['push']);
  const steps = read([
    'on: workflow_dispatch',
    'jobs:',
    '  a:',
    '    steps:',
    '      # - uses: anthropics/claude-code-action@v1',
    '      - name: Ask Claude',
    '        uses: Anthropics/Claude-Code-Action@v1.0.237 # pinned',
    '        with:',
    '          prompt: |',
    '            # Not a comment: part of the prompt.',
    '            Say hi.',
    '          claude_args: "--max-turns 2 --allowedTools \\"Read\\""',
    '  b:',
    '    steps:',
    '      - uses: anthropics/claude-code-action/base-action@v1',
    '',
  ].join('\n')).steps;
  assert.equal(steps.length, 1);
  assert.equal(steps[0].ref, 'v1.0.237');
  assert.equal(steps[0].line, 7);
  assert.equal(steps[0].inputs.prompt.text, '# Not a comment: part of the prompt.\nSay hi.');
  assert.equal(steps[0].inputs.claude_args.text, '--max-turns 2 --allowedTools "Read"');
  assert.equal(parseYaml('a: "one\n  two"\n').entries[0].value.text, 'one two');
  assert.equal(parseYaml('a: >\n  one\n  two\n\n  three\n').entries[0].value.text, 'one two\nthree');
  // claude_args as the action reads it: comment lines go, an inline # ends it.
  assert.deepEqual(claudeArgWords('# note\n--max-turns 3\n  --allowedTools "Bash(npm run linkcheck *)" \'Read\''), { words: ['--max-turns', '3', '--allowedTools', 'Bash(npm run linkcheck *)', 'Read'], comment: null });
  assert.deepEqual(claudeArgWords('--model sonnet # cheap\n--max-turns 3'), { words: ['--model', 'sonnet'], comment: '# cheap\n--max-turns 3' });
  assert.deepEqual(claudeArgWords('a#b "c#d"').words, ['a']);
  assert.deepEqual(claudeArgWords('--allowedTools Bash(npm\\ run\\ *) ""').words, ['--allowedTools', 'Bash(npm run *)', '']);
});

test('a-5 fails on an unsolved repository and passes on a solved one, as the template\'s assertions expect', () => {
  withRepo(actionsRepo({ workflow: null, runs: null }), (dir) => {
    const { code, out } = check(['a-5', '--assert', 'fail', '--dir', dir]);
    assert.equal(code, 0, out);
  });
  // The solutions branch: the workflow added, then torn down, so no branch
  // head carries a live Claude workflow, and a run record on the add commit.
  withRepo(actionsRepo({ teardown: true }), (dir) => {
    const { code, out } = check(['a-5', '--assert', 'pass', '--dir', dir]);
    assert.equal(code, 0, out);
  });
});
