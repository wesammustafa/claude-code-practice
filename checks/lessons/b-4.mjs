// Keep a session on track (Beginner, lesson 4). Only rewinding leaves file
// state, so the Learner saves git's status just before and just after it.
export const title = 'Keep a session on track';

function changed(text) {
  return (text ?? '').split(/\r?\n/).filter((l) => l.trim() && !l.slice(3).startsWith('.practice/'));
}

const SAVE_AFTER = '`git status --porcelain > .practice/b-4-after-rewind.txt`';

export const items = [
  {
    text: '`.practice/b-4-before-rewind.txt` lists the file Claude changed',
    local: true,
    check(repo) {
      const before = repo.read('.practice/b-4-before-rewind.txt');
      if (before === null) return 'After approving the edit, run `git status --porcelain > .practice/b-4-before-rewind.txt`.';
      return changed(before).length ? true : 'It lists no changed file. Save it after you approve the edit and before you rewind.';
    },
  },
  {
    text: '`.practice/b-4-after-rewind.txt` lists no changed files',
    local: true,
    check(repo) {
      const after = repo.read('.practice/b-4-after-rewind.txt');
      if (after === null) return `After rewinding, run ${SAVE_AFTER}.`;
      const left = changed(after);
      if (!left.length) return true;
      const names = left.map((l) => l.slice(3)).join(', ');
      // The edit itself is gone, and only what was already there stays.
      const before = changed(repo.read('.practice/b-4-before-rewind.txt'));
      if (before.some((l) => !left.includes(l)) && left.every((l) => before.includes(l))) {
        return `Still changed after rewinding: ${names}. The rewind worked, but it can't undo changes made before the lesson: commit them or set them aside with \`git stash push --include-untracked\`, then run ${SAVE_AFTER} again.`;
      }
      return `Still changed after rewinding: ${names}. Rewind that prompt with Restore code, or Restore code and conversation, then run ${SAVE_AFTER} again. If no option restores code (Claude used a command, or you chose Restore conversation), run \`git restore\` on the file and redo the edit, the before file and the rewind.`;
    },
  },
];
