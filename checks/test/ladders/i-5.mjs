// Every FAIL message of Intermediate lesson 5's check, each from a work
// folder that produces it: `files` to write, or `setup(dir, { write, commit })`.
// Each scenario holds one problem, so its message matches one narrow question.
// The scripts read their input without jq, so a machine without jq still gets
// each scenario's own message.
import { chmodSync } from 'node:fs';
import { join } from 'node:path';

const HOOK = '.claude/hooks/protect-files.sh';
const SETTINGS = '.claude/settings.json';

const entry = (matcher, script) => ({ matcher, hooks: [{ type: 'command', command: `\${CLAUDE_PROJECT_DIR}/${script}`, args: [] }] });
const settings = (matcher = 'Edit|Write', script = HOOK) => `${JSON.stringify({ permissions: { allow: ['Bash(npm test)'] }, hooks: { PreToolUse: [entry(matcher, script)] } }, null, 2)}\n`;

// A hook that blocks every path the check expects it to block, with a reason
// on stderr, and lets the rest through.
const FINISHED = [
  '#!/bin/bash',
  'INPUT=$(cat)',
  'case "$INPUT" in',
  '  *\'/.env.example"\'*) exit 0 ;;',
  '  *\'/.env"\'* | *\'/.env.\'* | *\'/secrets/\'* | *\'/package-lock.json"\'* | *\'/.git/\'*)',
  '    echo "Blocked: this file is protected" >&2',
  '    exit 2',
  '    ;;',
  'esac',
  'exit 0',
  '',
].join('\n');

// `FINISHED` with one change each, for item 2's scenarios.
const ONLY_GUIDE = FINISHED.replace(/\*'\/\.env"'\* \| \*'\/\.env\.'\* \| \*'\/secrets\/'\* \| /, '');
const TOO_BROAD = FINISHED.replace(/^ {2}\*'\/\.env\.example"'\*\) exit 0 ;;\n/m, '');
const STDOUT = FINISHED.replace(' >&2', '');
const NO_JQ = ['#!/bin/bash', 'INPUT=$(cat)', 'echo "$INPUT" | PATH=/nonexistent jq -r \'.tool_input.file_path\'', 'exit 0', ''].join('\n');
const FLOOD = ['#!/bin/bash', 'cat > /dev/null', 'head -c 2000000 /dev/zero', 'exit 0', ''].join('\n');
// The guide's protect-files.sh as the Worked example downloads it, matching
// the whole input rather than jq's file path: a substring match on .env,
// package-lock.json and .git/. It blocks
// .env.example and src/config.envelope.ts and lets secrets/ through, so its
// message holds rows that expected 0 and a row that expected 2, and ends on
// one that expected 0: it matches the "expected 0" narrow, which asks about
// both, and not the "expected 2." one, which only a message whose last row
// expected 2 ends with.
const GUIDE = [
  '#!/bin/bash',
  'INPUT=$(cat)',
  'for pattern in ".env" "package-lock.json" ".git/"; do',
  '  if [[ "$INPUT" == *"$pattern"* ]]; then',
  '    echo "Blocked: matches protected pattern \'$pattern\'" >&2',
  '    exit 2',
  '  fi',
  'done',
  'exit 0',
  '',
].join('\n');

// Commits `script` as the executable hook and the settings that run it, as
// Your turn step 4 does, so only the hook's own behavior can fail item 2.
const committed = (script, text = settings()) => (dir, { write, commit }) => {
  write(dir, { [HOOK]: script, [SETTINGS]: text });
  chmodSync(join(dir, HOOK), 0o755);
  commit(dir, 'Protect .env files and secrets', [HOOK, SETTINGS]);
};

export const scenarios = [
  { item: 0, name: 'no hook script', files: { [SETTINGS]: settings() } },
  { item: 0, name: 'the script saved but not committed', files: { [HOOK]: FINISHED, [SETTINGS]: settings() } },
  {
    item: 0,
    name: 'the script committed without its executable bit',
    setup(dir, { write, commit }) {
      write(dir, { [HOOK]: FINISHED, [SETTINGS]: settings() });
      chmodSync(join(dir, HOOK), 0o644);
      commit(dir, 'Protect .env files and secrets', [HOOK, SETTINGS]);
    },
  },
  {
    item: 1,
    name: 'no settings committed at all',
    setup(dir, { write, commit }) {
      write(dir, { [HOOK]: FINISHED });
      chmodSync(join(dir, HOOK), 0o755);
      commit(dir, 'Protect .env files and secrets', [HOOK]);
      write(dir, { [SETTINGS]: settings() });
    },
  },
  {
    item: 1,
    name: 'lesson 4\'s settings committed, the hooks block saved but not committed',
    setup(dir, { write, commit }) {
      write(dir, { [SETTINGS]: `${JSON.stringify({ permissions: { allow: ['Bash(npm test)'] } }, null, 2)}\n` });
      commit(dir, 'Add the team permission rules', [SETTINGS]);
      write(dir, { [HOOK]: FINISHED });
      chmodSync(join(dir, HOOK), 0o755);
      commit(dir, 'Protect .env files and secrets', [HOOK]);
      write(dir, { [SETTINGS]: settings() });
    },
  },
  { item: 1, name: 'a missing comma before the hooks block', setup: committed(FINISHED, settings().replace('},\n  "hooks"', '}\n  "hooks"')) },
  { item: 1, name: 'the hook registered for Bash only', setup: committed(FINISHED, settings('Bash')) },
  { item: 2, name: 'the script saved but not committed', files: { [HOOK]: FINISHED } },
  { item: 2, name: 'a hook whose output is too large to read', setup: committed(FLOOD) },
  { item: 2, name: 'jq not installed', setup: committed(NO_JQ) },
  { item: 2, name: 'only the guide\'s package-lock.json and .git/ blocks', setup: committed(ONLY_GUIDE) },
  { item: 2, name: 'no exception for .env.example', setup: committed(TOO_BROAD) },
  { item: 2, name: 'the guide\'s script committed unchanged', setup: committed(GUIDE) },
  { item: 2, name: 'the reason printed to stdout', setup: committed(STDOUT) },
];
