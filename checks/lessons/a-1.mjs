// Parallel sessions with worktrees (Advanced, lesson 1). The Learner ignores
// .claude/worktrees/ in a committed .gitignore, runs two sessions at once,
// each in a worktree that `claude --worktree <name>` makes there, merges both
// branches and removes the worktrees. A worktree listing saved while both
// existed names the commit each session made. That neither session saw the
// other's uncommitted edits shows only in the sessions, so the lesson
// self-checks it. The Advanced capstone reuses these items with its own
// listing.
import { committedIgnore, ignoreHint } from '../ignore.mjs';
import { claudeWorktrees, liveWorktrees, parseWorktrees } from '../worktrees.mjs';

export const title = 'Parallel sessions with worktrees';

const SNAPSHOT = '.practice/a-1-worktrees.txt';

const save = (snapshot) => `\`git worktree list --porcelain > ${snapshot}\``;
const short = (sha) => sha.slice(0, 7);
const label = (r) => r.branch ?? short(r.head);
const shell = (path) => (/\s/.test(path) ? `"${path}"` : path);

function isCommit(repo, sha) {
  try {
    repo.git('cat-file', '-e', `${sha}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

// `git merge-base --is-ancestor`, remembered: it exits 1 for "no".
function ancestry(repo) {
  const known = new Map();
  return (a, b) => {
    const key = `${a} ${b}`;
    if (!known.has(key)) {
      try {
        repo.git('merge-base', '--is-ancestor', a, b);
        known.set(key, true);
      } catch (error) {
        if (error.status !== 1) throw error;
        known.set(key, false);
      }
    }
    return known.get(key);
  };
}

// What a saved listing shows: the Claude Code worktrees it lists, the two
// whose commits split from each other (a merged pair first, as any two
// pass), and a hint, which is null when both of that pair are merged.
function review(repo, snapshot) {
  const text = repo.read(snapshot);
  if (text === null || !text.trim()) return { worktrees: [], hint: `While both worktree sessions exist, and after each has committed, run ${save(snapshot)} from your main checkout.` };
  const records = parseWorktrees(text);
  if (!records.length) return { worktrees: [], hint: `\`${snapshot}\` isn't a listing from \`git worktree list --porcelain\`. While both worktrees exist, save it again: ${save(snapshot)}.` };
  const worktrees = claudeWorktrees(records);
  if (worktrees.length < 2) {
    const others = records.slice(1).filter((r) => !r.bare && !worktrees.includes(r));
    const elsewhere = others.length ? ` It also lists ${others.map((r) => `\`${r.path}\``).join(', ')}, but the check counts only the worktrees \`claude --worktree <name>\` makes, under \`.claude/worktrees/\`.` : '';
    return { worktrees, hint: `\`${snapshot}\` lists ${worktrees.length ? 'one worktree' : 'no worktree'} under \`.claude/worktrees/\`.${elsewhere} Start each session with \`claude --worktree <name>\`, and save ${save(snapshot)} while both worktrees exist.` };
  }
  const known = worktrees.filter((r) => r.head && isCommit(repo, r.head));
  if (known.length < 2) {
    const missing = worktrees.find((r) => !known.includes(r));
    const what = missing.head ? `commit ${short(missing.head)}, which isn't in this repository` : `\`${missing.path}\` without a commit`;
    return { worktrees, hint: `\`${snapshot}\` names ${what}. Save the listing from this repository's main checkout, while its worktrees exist: ${save(snapshot)}.` };
  }
  const isAncestor = ancestry(repo);
  const pairs = [];
  for (const [i, a] of known.entries()) {
    for (const b of known.slice(i + 1)) {
      if (a.head !== b.head && !isAncestor(a.head, b.head) && !isAncestor(b.head, a.head)) pairs.push([a, b]);
    }
  }
  if (!pairs.length) return { worktrees, hint: `The worktrees in \`${snapshot}\` point at one commit, or one at an earlier commit of the other's, so it was saved before both sessions committed. Save it again after each session commits and before you remove the worktrees: ${save(snapshot)}.` };
  const [{ pair, unmerged }] = pairs
    .map((p) => ({ pair: p, unmerged: p.filter((r) => !isAncestor(r.head, 'HEAD')) }))
    .sort((x, y) => x.unmerged.length - y.unmerged.length);
  if (!unmerged.length) return { worktrees, pair, hint: null };
  const names = unmerged.map(label);
  return { worktrees, pair, hint: `${names.map((n) => `\`${n}\``).join(' and ')} ${names.length > 1 ? "aren't" : "isn't"} merged into your current branch. From your main checkout, run ${names.map((n) => `\`git merge ${n}\``).join(', then ')}. A squash merge or a rebase copies the commits, so the check can't find them in your branch.` };
}

export const ignoresWorktrees = {
  text: 'a committed `.gitignore` ignores `.claude/worktrees/` and not the rest of `.claude/`',
  check(repo) {
    const worktrees = committedIgnore(repo, '.claude/worktrees/a-1-probe/file');
    if (worktrees.problem) return ignoreHint(worktrees, '.claude/worktrees/');
    const settings = committedIgnore(repo, '.claude/settings.json');
    if (settings.problem || settings.source !== worktrees.source) return true;
    return `Line ${settings.line} of \`${settings.source}\`, \`${settings.pattern}\`, also ignores \`.claude/settings.json\`, so it would hide the settings you share with your team. Ignore only \`.claude/worktrees/\`, and commit.`;
  },
};

export function mergedWorktrees(snapshot) {
  return {
    text: `\`${snapshot}\` lists two worktrees under \`.claude/worktrees/\` whose commits split from each other, and both are merged into your branch`,
    local: true,
    check: (repo) => review(repo, snapshot).hint ?? true,
  };
}

export function removedWorktrees(snapshot) {
  return {
    text: 'neither of those worktrees still exists',
    local: true,
    check(repo) {
      const text = repo.read(snapshot);
      if (text === null || !text.trim()) return `There is no \`${snapshot}\`, so the check can't tell which worktrees should be gone. Save it as the item above says.`;
      const { worktrees, pair } = review(repo, snapshot);
      if (!worktrees.length) return `\`${snapshot}\` lists no worktree under \`.claude/worktrees/\`, so the check can't tell which worktrees should be gone. Save it as the item above says.`;
      // Paths as git printed them: one that isn't on this machine was saved elsewhere.
      const live = new Map(liveWorktrees(repo).map((r) => [r.path, r]));
      const left = (pair ?? worktrees).map((r) => live.get(r.path)).filter(Boolean);
      if (!left.length) return true;
      return left.map((r) => {
        const path = shell(r.path);
        if (r.locked) return `\`${r.path}\` still exists and is locked: run \`git worktree unlock ${path}\`, then \`git worktree remove ${path}\`.`;
        if (r.prunable) return `git still lists \`${r.path}\`, whose folder is gone: run \`git worktree prune\`.`;
        return `\`${r.path}\` still exists: once its branch is merged, run \`git worktree remove ${path}\` from your main checkout.`;
      }).join(' ');
    },
  };
}

export const items = [ignoresWorktrees, mergedWorktrees(SNAPSHOT), removedWorktrees(SNAPSHOT)];
