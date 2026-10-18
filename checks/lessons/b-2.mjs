// Permission modes and plan mode (Beginner, lesson 2). The Learner saves
// three snapshots under .practice/: git's status while the plan is on screen,
// the files the plan says it will change, and git's status after approving.
import { inPlan, planPaths, statusPaths } from '../paths.mjs';

export const title = 'Permission modes and plan mode';

const SAVE_BEFORE = 'While the plan is on screen, run `git status --porcelain > .practice/b-2-before.txt` in another terminal.';

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
];
