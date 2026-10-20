// Permission modes and plan mode (Beginner, lesson 2). Your turn works the
// ticket in practice/b-2/ticket.md, whose last request (make the CLI exit 0
// on broken links) is planted scope creep to send back before approving.
// The Learner saves three snapshots under .practice/: git's status while the
// plan is on screen, the files the plan says it will change, and git's
// status after approving. The snapshots, not the live tree, prove the plan:
// lesson 3 sets this change aside, and the solutions branch is committed.
// The tool's behaviour the check runs itself, on lesson 2's change: the
// working tree, or the stash lesson 3 makes of it (`-m b-2`) once it exists.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inPlan, planPaths, statusPaths } from '../paths.mjs';

export const title = 'Permission modes and plan mode';

const SAVE_BEFORE = 'While the plan is on screen, run `git status --porcelain > .practice/b-2-before.txt` in another terminal.';

// Lesson 3's "You need" sets this lesson's change aside with
// `git stash push --include-untracked -m b-2`, which git records as
// "On <branch>: b-2". The newest such stash, or null.
function b2Stash(repo) {
  let list;
  try {
    list = repo.gitLocal('stash', 'list', '--format=%gd%x09%s');
  } catch {
    return null;
  }
  for (const line of list.split('\n')) {
    const [ref, subject = ''] = line.split('\t');
    if (/^On .*: b-2$/.test(subject)) return ref;
  }
  return null;
}

// Writes the stash's package.json and src/ into `into`: its tracked files,
// then the untracked ones `--include-untracked` keeps in its third parent.
function writeStash(repo, ref, into) {
  const git = (...args) => execFileSync('git', args, { cwd: repo.dir, env: { ...process.env, GIT_NO_LAZY_FETCH: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const trees = [ref];
  try {
    git('rev-parse', '--verify', '--quiet', `${ref}^3`);
    trees.push(`${ref}^3`);
  } catch {
    // No untracked files were stashed.
  }
  for (const tree of trees) {
    for (const path of git('ls-tree', '-r', '-z', '--name-only', tree, '--', 'package.json', 'src').toString().split('\0').filter(Boolean)) {
      mkdirSync(dirname(join(into, path)), { recursive: true });
      writeFileSync(join(into, path), git('show', `${tree}:${path}`));
    }
  }
}

// Only the practice template's own tool is run: `--dir` pointed at another
// repository must not execute that repository's src/cli.js.
function notTemplate(repo) {
  try {
    if (JSON.parse(repo.read('package.json') ?? '').name === 'claude-code-practice') return null;
  } catch {
    // Not JSON: not the template either.
  }
  return 'This runs the practice template\'s linkcheck tool, so run the check in your copy of the template: `npm run check -- b-2`.';
}

// Runs lesson 2's CLI on a scratch folder holding `files`, and says where the
// CLI came from.
function runTool(repo, files) {
  const work = mkdtempSync(join(tmpdir(), 'b-2-'));
  try {
    const stash = b2Stash(repo);
    let cli = join(repo.dir, 'src', 'cli.js');
    if (stash) {
      writeStash(repo, stash, join(work, 'tool'));
      cli = join(work, 'tool', 'src', 'cli.js');
    }
    const docs = join(work, 'docs');
    mkdirSync(docs);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(docs, name), text);
    const run = spawnSync(process.execPath, [cli, docs], { encoding: 'utf8', timeout: 30_000 });
    return { ...run, where: stash ? 'lesson 2\'s change (the `b-2` stash)' : 'your working tree' };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export const items = [
  {
    text: '`.practice/b-2-before.txt`, saved while the plan was on screen, lists no changed files',
    local: true,
    check(repo) {
      const before = repo.read('.practice/b-2-before.txt');
      if (before === null) return SAVE_BEFORE;
      const changed = statusPaths(before);
      if (changed.length) return `Files had changed before you approved the plan: ${changed.join(', ')}. Start from a clean tree (commit them, or set them aside with \`git stash push --include-untracked\`) and stay in plan mode until you approve.`;
      return true;
    },
  },
  {
    text: 'every file in `.practice/b-2-after.txt` is listed in `.practice/b-2-plan.txt`',
    local: true,
    check(repo) {
      const plan = repo.read('.practice/b-2-plan.txt');
      const after = repo.read('.practice/b-2-after.txt');
      if (plan === null || !plan.trim()) return 'Write the files the plan will change into `.practice/b-2-plan.txt`, one path per line, before you approve.';
      if (after === null) return 'After Claude finishes the edits, run `git status --porcelain > .practice/b-2-after.txt`.';
      // An empty snapshot is git seeing no edit yet, not a missing save: the
      // learner ran the command, so repeating it reads as stuck (190). It
      // keeps step 7's "or No" so it never says to approve every request,
      // and stays five lines in a 60x20 hint box so the card keeps its Goal
      // and border.
      if (!statusPaths(after).length) return '`.practice/b-2-after.txt` lists no changed file yet. Approve the plan (Yes, manually approve edits), then read each request: plain Yes, or No if it does more than the plan needs. Once `git status` lists changes, save it again.';
      const planned = planPaths(plan, repo.dir);
      const extra = statusPaths(after).filter((path) => !inPlan(planned, path));
      if (extra.length) return `Changed but not in the plan: ${extra.join(', ')}. Compare the plan you approved with what Claude changed.`;
      return true;
    },
  },
  {
    text: 'An unknown key in `linkcheck.json`, such as `ignores`, makes the tool exit with code 2 and name the key',
    // A stash and an uncommitted tree never reach GitHub's progress run.
    local: true,
    check(repo) {
      const refused = notTemplate(repo);
      if (refused) return refused;
      const run = runTool(repo, { 'linkcheck.json': '{ "files": ["."], "ignores": ["vendor/"] }\n' });
      if (run.status !== 2) return `With \`"ignores"\` in \`linkcheck.json\`, the tool in ${run.where} exited with code ${run.status}, not 2. Read the ticket's first request again: \`practice/b-2/ticket.md\`.`;
      if (!`${run.stderr}${run.stdout}`.includes('ignores')) return 'The tool exits with code 2 but its error doesn\'t name the key, `ignores`. The ticket asks for an error that names it.';
      return true;
    },
  },
  {
    text: 'A broken link still makes the tool exit with code 1 and report the link',
    local: true,
    check(repo) {
      const refused = notTemplate(repo);
      if (refused) return refused;
      const run = runTool(repo, { 'notes.md': 'See [the setup](missing.md).\n' });
      if (run.status !== 1) return `With a broken link, the tool in ${run.where} exited with code ${run.status}, not 1, so CI would pass with broken links. That part of the ticket goes back: the \`ignore\` list already skips links into \`vendor/\`.`;
      // Node also exits with 1 when the CLI crashes, so the report must be there.
      if (!run.stdout.includes('broken link to missing.md')) return `With a broken link, the tool in ${run.where} exited with code 1 but didn't report \`broken link to missing.md\`, so it failed for another reason: ${run.stderr.split('\n').find((line) => /Error/.test(line))?.trim() ?? 'it printed no error'}`;
      return true;
    },
  },
];
