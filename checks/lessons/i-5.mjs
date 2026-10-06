// Enforce a rule with a hook (Intermediate, lesson 5). The Learner fixes the
// hooks guide's protect-files script so it blocks .env files (but not
// .env.example) and anything in a secrets/ folder, commits it as an
// executable file, and registers it as a PreToolUse hook for Edit and Write.
// The check runs the committed script with the JSON a tool call sends. Seeing
// the hook fire in a session is self-checked.
import { committedMode, editWriteScripts, missingJq, runCommitted } from '../hooks.mjs';

export const title = 'Enforce a rule with a hook';

const HOOK = '.claude/hooks/protect-files.sh';
const SETTINGS = '.claude/settings.json';

// Each path, under the repository, and the exit code the hook must give it.
// The guide's own protections for package-lock.json and .git/ stay.
const CASES = [
  ['.env', 2],
  ['config/.env.local', 2],
  ['.env.example', 0],
  ['secrets/api.key', 2],
  ['src/config.envelope.ts', 0],
  ['src/app.js', 0],
  ['package-lock.json', 2],
  ['.git/config', 2],
];

export const items = [
  {
    text: '`.claude/hooks/protect-files.sh` is committed and executable',
    check(repo) {
      const mode = committedMode(repo, HOOK);
      if (mode === null) return repo.exists(HOOK) ? `${HOOK} is not committed. Run \`git add ${HOOK}\` and commit it.` : `There is no ${HOOK}. Copy the hook from the lesson's Worked example there.`;
      return mode === '100755' ? true : `${HOOK} isn't executable, so Claude Code can't run it. Run \`chmod +x ${HOOK}\`, then \`git add ${HOOK}\` and commit.`;
    },
  },
  {
    text: 'the committed `.claude/settings.json` runs it as a `PreToolUse` hook for Edit and Write',
    check(repo) {
      let text;
      try {
        text = repo.git('show', `HEAD:${SETTINGS}`);
      } catch {
        return `There is no committed ${SETTINGS}. Add the hook's settings from the lesson to it and commit.`;
      }
      let value;
      try {
        value = JSON.parse(text);
      } catch (error) {
        return `The committed ${SETTINGS} is not valid JSON: ${error.message}`;
      }
      return editWriteScripts(value).includes(HOOK) ? true : `${SETTINGS} doesn't run protect-files.sh as a PreToolUse hook with a matcher for Edit and Write, such as \`"matcher": "Edit|Write"\`.`;
    },
  },
  {
    text: 'the committed hook blocks `.env` files, but not `.env.example`, anything in a `secrets/` folder, `package-lock.json` and `.git/`, and allows the rest',
    check(repo) {
      if (committedMode(repo, HOOK) === null) return `Commit ${HOOK}: the check runs the committed script, the one your teammates get.`;
      const wrong = [];
      for (const [path, want] of CASES) {
        const run = runCommitted(repo, HOOK, path, 'Write');
        if (run.error) return `The hook couldn't run: ${run.error.message}`;
        if (missingJq(run)) return 'The hook needs `jq`, which isn\'t installed. Install it and run the check again.';
        if (run.status !== want) wrong.push(`${path} gave exit ${run.status}, expected ${want}`);
        else if (want === 2 && !run.stderr.trim()) wrong.push(`${path} was blocked without a reason on stderr for Claude`);
      }
      return wrong.length ? `${wrong.join('; ')}.` : true;
    },
  },
];
