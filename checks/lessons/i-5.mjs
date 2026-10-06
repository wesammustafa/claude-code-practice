// Enforce a rule with a hook (Intermediate, lesson 5). The Learner fixes the
// hooks guide's protect-files script so it blocks .env files (but not
// .env.example) and anything in a secrets/ folder, commits it as an
// executable file, and registers it as a PreToolUse hook for Edit and Write.
// The check runs the script with the JSON a tool call sends. Seeing the hook
// fire in a session is self-checked.
import { spawnSync } from 'node:child_process';
import { join, posix } from 'node:path';

export const title = 'Enforce a rule with a hook';

const HOOK = '.claude/hooks/protect-files.sh';
const SETTINGS = '.claude/settings.json';

// Each path, under the repository, and the exit code the hook must give it.
const CASES = [
  ['.env', 2],
  ['config/.env.local', 2],
  ['.env.example', 0],
  ['secrets/api.key', 2],
  ['src/config.envelope.ts', 0],
  ['src/app.js', 0],
];

function committedMode(repo) {
  const line = repo.git('ls-files', '-s', '--', HOOK);
  return line ? line.split(/\s+/)[0] : null;
}

function registered(value) {
  const groups = value?.hooks?.PreToolUse;
  if (!Array.isArray(groups)) return false;
  return groups.some((g) => {
    const m = g?.matcher ?? '';
    const matches = m === '' || m === '*' || (/\bEdit\b/.test(m) && /\bWrite\b/.test(m));
    return matches && (g.hooks ?? []).some((h) => typeof h?.command === 'string' && (h.command.includes('protect-files.sh') || (h.args ?? []).some((a) => String(a).includes('protect-files.sh'))));
  });
}

export const items = [
  {
    text: '`.claude/hooks/protect-files.sh` is committed and executable',
    check(repo) {
      const mode = committedMode(repo);
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
      return registered(value) ? true : `${SETTINGS} doesn't run protect-files.sh as a PreToolUse hook with a matcher for Edit and Write, such as \`"matcher": "Edit|Write"\`.`;
    },
  },
  {
    text: 'the hook blocks `.env` files, but not `.env.example`, and anything in a `secrets/` folder, and allows the rest',
    check(repo) {
      if (!repo.exists(HOOK)) return `There is no ${HOOK}.`;
      const wrong = [];
      for (const [path, want] of CASES) {
        const filePath = posix.join(repo.dir.replace(/\\/g, '/'), path);
        const run = spawnSync('bash', [join(repo.dir, HOOK)], {
          cwd: repo.dir,
          input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: filePath } }),
          encoding: 'utf8',
          timeout: 10_000,
        });
        if (run.error) return `The hook couldn't run: ${run.error.message}`;
        if (/jq: (command )?not found/.test(run.stderr)) return 'The hook needs `jq`, which isn\'t installed. Install it and run the check again.';
        if (run.status !== want) wrong.push(`${path} gave exit ${run.status}, expected ${want}`);
        else if (want === 2 && !run.stderr.trim()) wrong.push(`${path} was blocked without a reason on stderr for Claude`);
      }
      return wrong.length ? `${wrong.join('; ')}.` : true;
    },
  },
];
