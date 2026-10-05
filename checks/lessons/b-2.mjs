// Permission modes and plan mode (Beginner, lesson 2). The Learner saves
// three snapshots under .practice/: git's status while the plan is on screen,
// the files the plan says it will change, and git's status after approving.

export const title = 'Permission modes and plan mode';

// Paths from `git status --porcelain` lines, without the two status letters.
function changedPaths(text) {
  return text.split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => line.slice(3).split(' -> ').pop().replace(/^"|"$/g, '').trim())
    .filter((path) => !path.startsWith('.practice/'));
}

const SAVE_BEFORE = 'While the plan is on screen, run `git status --porcelain > .practice/b-2-before.txt` in another terminal.';

export const items = [
  {
    text: '`.practice/b-2-before.txt`, saved while the plan was on screen, lists no changed files',
    local: true,
    check(repo) {
      const before = repo.read('.practice/b-2-before.txt');
      if (before === null) return SAVE_BEFORE;
      const changed = changedPaths(before);
      if (changed.length) return `Files had changed before you approved the plan: ${changed.join(', ')}. Start from a clean tree and stay in plan mode until you approve.`;
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
      if (after === null || !changedPaths(after).length) return 'After Claude finishes the edits, run `git status --porcelain > .practice/b-2-after.txt`.';
      const planned = new Set(plan.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
      const extra = changedPaths(after).filter((path) => !planned.has(path));
      if (extra.length) return `Changed but not in the plan: ${extra.join(', ')}. Compare the plan you approved with what Claude changed.`;
      return true;
    },
  },
];
