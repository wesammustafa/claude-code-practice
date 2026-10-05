// Keep a session on track (Beginner, lesson 4). Only rewinding leaves file
// state, so the Learner saves git's status just before and just after it.
export const title = 'Keep a session on track';

function changed(text) {
  return (text ?? '').split(/\r?\n/).filter((l) => l.trim() && !l.slice(3).startsWith('.practice/'));
}

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
      if (after === null) return 'After rewinding, run `git status --porcelain > .practice/b-4-after-rewind.txt`.';
      const left = changed(after);
      return left.length ? `Still changed after rewinding: ${left.map((l) => l.slice(3)).join(', ')}. In the rewind menu, choose Restore code, or Restore code and conversation.` : true;
    },
  },
];
