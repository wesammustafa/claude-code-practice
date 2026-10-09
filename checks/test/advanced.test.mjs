// The Advanced checks, run the way a Learner runs them: against their own
// repository with --dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { parseClaudeArgs, ruleList } from '../claude-args.mjs';
import { callHints, RESULT, SCRIPT, savedRun, scriptBehavior, scriptCall } from '../lessons/a-4.mjs';
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
