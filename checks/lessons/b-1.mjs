// Install, sign in and look around (Beginner, lesson 1).
export const title = 'Install, sign in and look around';

export const items = [
  {
    text: '`.practice/version.txt` holds the output of `claude --version`',
    // Saved state under .practice/ is git-ignored, so only a local run can see it.
    local: true,
    check(repo) {
      const text = repo.read('.practice/version.txt');
      if (text === null) return 'Run `claude --version > .practice/version.txt` in your practice copy (create the folder with `mkdir -p .practice` first).';
      if (!/^\d+\.\d+\.\d+ \(Claude Code\)/m.test(text)) return '`.practice/version.txt` should hold a line such as `2.1.0 (Claude Code)`. Run `claude --version > .practice/version.txt` again.';
      return true;
    },
  },
];
