// Project memory with CLAUDE.md (Beginner, lesson 5). The Learner commits a
// CLAUDE.md with a rule a script can see in files, saves that rule's line,
// and records the commit a new session made.
export const title = 'Project memory with CLAUDE.md';

const TEST_FILE = /(^|\/)(tests?|spec|__tests__)\/|[._-](test|spec)\.[a-z0-9]+$/i;

function rule(repo) {
  const text = repo.read('.practice/b-5-rule.txt');
  const line = (text ?? '').split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  return line ?? null;
}

function committedMemory(repo) {
  for (const path of ['CLAUDE.md', '.claude/CLAUDE.md']) {
    try {
      return repo.git('show', `HEAD:${path}`);
    } catch { /* not in the last commit */ }
  }
  return null;
}

export const items = [
  {
    text: 'a committed CLAUDE.md holds the rule saved in `.practice/b-5-rule.txt`',
    local: true,
    check(repo) {
      const line = rule(repo);
      if (!line) return 'Save the rule\'s exact line, for example `echo \'// Part of linkcheck.\' > .practice/b-5-rule.txt`.';
      const memory = committedMemory(repo);
      if (memory === null) return 'CLAUDE.md is not committed. Run `git add CLAUDE.md` and commit it.';
      return memory.includes(line) ? true : `The committed CLAUDE.md doesn't contain \`${line}\`. Add the rule, then commit CLAUDE.md again.`;
    },
  },
  {
    text: 'every new file in the commit named in `.practice/b-5-commit.txt`, apart from tests and Markdown, starts with that rule',
    local: true,
    check(repo) {
      const line = rule(repo);
      const saved = repo.read('.practice/b-5-commit.txt');
      if (!line || !saved?.trim()) return 'After the new session commits its change, run `git rev-parse HEAD > .practice/b-5-commit.txt`.';
      const sha = saved.trim().split(/\s+/)[0];
      let added;
      try {
        added = repo.git('show', '--diff-filter=A', '--name-only', '--format=', sha).split('\n').filter(Boolean);
      } catch {
        return `\`.practice/b-5-commit.txt\` names ${sha}, which is not a commit in this repository.`;
      }
      const sources = added.filter((f) => !TEST_FILE.test(f) && !/\.md$/i.test(f));
      if (!sources.length) return 'That commit adds no new source file. Ask the new session for a change that creates one.';
      const wrong = sources.filter((f) => repo.git('show', `${sha}:${f}`).replace(/^\uFEFF/, '').split(/\r?\n/)[0].trim() !== line);
      return wrong.length ? `These new files don't start with \`${line}\`: ${wrong.join(', ')}. Check that the rule is in CLAUDE.md and that you started a new session after committing it.` : true;
    },
  },
];
