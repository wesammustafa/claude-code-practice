// Every FAIL message family of Advanced lesson 7's check, each from a work
// folder that produces it: `files` to write, or `setup(dir, { write, commit })`.
// Each scenario holds one problem, so its message matches one narrow question.
// The first four items run the committed runner with the check's stand-in
// for `claude`, never Claude Code itself.
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { STUB_SESSION } from '../../stub-claude.mjs';

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const SCRIPT = 'scripts/bounded-run.sh';
const BOUNDS_PATH = '.claude/bounded-run.json';
const SLICE = '.practice/a-7-slice.json';
const CALL = [
  'claude -p "$1" \\',
  '  --setting-sources project \\',
  `  --settings ${BOUNDS_PATH} \\`,
  '  --permission-mode dontAsk \\',
  '  --model sonnet \\',
  '  --max-turns 15 \\',
  '  --max-budget-usd 2 \\',
  '  --output-format json > "$2"',
].join('\n');
// The lesson's runner, as the page saves it.
const RUNNER = [
  '#!/bin/bash',
  `# Runs one unattended task inside the bounds in ${BOUNDS_PATH}.`,
  'set -u',
  'if [ $# -ne 2 ]; then',
  '  echo \'Usage: scripts/bounded-run.sh "<task>" <result.json>\' >&2',
  '  exit 2',
  'fi',
  'before=$(git rev-parse --short HEAD)',
  CALL,
  'status=$?',
  'jq \'{subtype, num_turns, total_cost_usd, denied: [.permission_denials[]? | .tool_input.command // .tool_name]}\' "$2"',
  'echo "HEAD before: $before, after: $(git rev-parse --short HEAD)"',
  'git status --short',
  'exit "$status"',
  '',
].join('\n');
const BOUNDS = {
  permissions: {
    allow: ['Edit(./src/**)', 'Edit(./test/**)', 'Bash(npm test *)'],
    deny: ['Agent', 'Read(./.env)', 'Read(./.env.*)', 'Bash(git commit *)', 'Bash(git push *)'],
  },
  sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: false },
};
const SLICE_RUN = {
  type: 'result', subtype: 'success', is_error: false, num_turns: 9, total_cost_usd: 0.42,
  result: 'Added a test for total(); npm test passes. The commit was denied.',
  session_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', permission_denials: [{ tool_name: 'Bash', tool_input: { command: 'git commit -m "Add a test"' } }],
};

// The runner with each [from, to] replaced.
const runner = (...pairs) => pairs.reduce((text, [from, to]) => {
  if (!text.includes(from)) throw new Error(`the runner has no ${JSON.stringify(from)}`);
  return text.replace(from, () => to);
}, RUNNER);
const boundsWith = (change) => {
  const bounds = structuredClone(BOUNDS);
  change(bounds);
  return bounds;
};

// The finished lesson, with one step changed: `script` (null for none) is
// saved with `mode` and committed unless `commitScript` is false; `bounds`
// (null for none) is committed; `slice` (null for none) is the saved run.
function bounded({ script = RUNNER, mode = 0o755, commitScript = true, bounds = BOUNDS, slice = SLICE_RUN } = {}) {
  return (dir, { write, commit }) => {
    write(dir, { '.gitignore': '.practice/\n', 'README.md': '# demo\n', 'src/total.js': 'export const total = (items) => items.length;\n' });
    commit(dir, 'Start');
    if (bounds !== null) {
      write(dir, { [BOUNDS_PATH]: json(bounds) });
      commit(dir, 'Add the bounds', [BOUNDS_PATH]);
    }
    if (script !== null) {
      write(dir, { [SCRIPT]: script });
      chmodSync(join(dir, SCRIPT), mode);
      if (commitScript) commit(dir, 'Add the bounded runner', [SCRIPT]);
    }
    if (slice !== null) write(dir, { [SLICE]: typeof slice === 'string' ? slice : json(slice) });
  };
}

export const scenarios = [
  // Item 0: the runner, committed and executable, and its one call.
  { item: 0, name: 'no runner', setup: bounded({ script: null }) },
  { item: 0, name: 'the runner not committed', setup: bounded({ commitScript: false }) },
  { item: 0, name: 'the runner not executable', setup: bounded({ mode: 0o644 }) },
  { item: 0, name: 'no permission mode', setup: bounded({ script: runner(['  --permission-mode dontAsk \\\n', '']) }) },
  { item: 0, name: 'no JSON output', setup: bounded({ script: runner(['  --output-format json > "$2"', '  > "$2"']) }) },
  { item: 0, name: 'no settings file', setup: bounded({ script: runner([`  --settings ${BOUNDS_PATH} \\\n`, '']) }) },
  { item: 0, name: 'the task without quotes', setup: bounded({ script: runner(['claude -p "$1"', 'claude -p $1']) }) },
  { item: 0, name: 'the JSON saved to the slice path', setup: bounded({ script: runner(['--output-format json > "$2"', `--output-format json > ${SLICE}`]) }) },
  { item: 0, name: 'claude run without -p', setup: bounded({ script: runner(['claude -p "$1"', 'claude "$1"']) }) },

  // Item 1: the turn and spend limits.
  { item: 1, name: 'no turn limit', setup: bounded({ script: runner(['  --max-turns 15 \\\n', '']) }) },
  { item: 1, name: 'no spend limit', setup: bounded({ script: runner(['  --max-budget-usd 2 \\\n', '']) }) },
  { item: 1, name: 'a turn limit that is no whole number', setup: bounded({ script: runner(['--max-turns 15', '--max-turns abc']) }) },
  { item: 1, name: 'a turn limit below 1', setup: bounded({ script: runner(['--max-turns 15', '--max-turns 0']) }) },
  { item: 1, name: 'a spend limit with a dollar sign', setup: bounded({ script: runner(['--max-budget-usd 2', '--max-budget-usd \'$2\'']) }) },
  { item: 1, name: 'a spend limit of 0', setup: bounded({ script: runner(['--max-budget-usd 2', '--max-budget-usd 0']) }) },

  // Item 2: narrow allow rules, and deny rules that stop commit and push.
  { item: 2, name: 'a bare Bash allow rule', setup: bounded({ bounds: boundsWith((b) => { b.permissions.allow = ['Edit(./src/**)', 'Bash']; }) }) },
  { item: 2, name: 'every npm command allowed', setup: bounded({ bounds: boundsWith((b) => { b.permissions.allow = ['Edit(./src/**)', 'Bash(npm *)']; }) }) },
  { item: 2, name: 'edits allowed in every folder', setup: bounded({ bounds: boundsWith((b) => { b.permissions.allow = ['Edit(./**)', 'Bash(npm test *)']; }) }) },
  { item: 2, name: 'no deny rule for git push', setup: bounded({ bounds: boundsWith((b) => { b.permissions.deny = b.permissions.deny.filter((r) => r !== 'Bash(git push *)'); }) }) },
  { item: 2, name: 'no deny rule for git commit', setup: bounded({ bounds: boundsWith((b) => { b.permissions.deny = b.permissions.deny.filter((r) => r !== 'Bash(git commit *)'); }) }) },
  { item: 2, name: 'a deny rule for the bare git push only', setup: bounded({ bounds: boundsWith((b) => { b.permissions.deny = b.permissions.deny.map((r) => (r === 'Bash(git push *)' ? 'Bash(git push)' : r)); }) }) },
  { item: 2, name: 'no allow rule of its own', setup: bounded({ bounds: boundsWith((b) => { delete b.permissions.allow; }) }) },

  // Item 3: the strict sandbox.
  { item: 3, name: 'no sandbox block', setup: bounded({ bounds: boundsWith((b) => { delete b.sandbox; }) }) },
  { item: 3, name: 'no failIfUnavailable', setup: bounded({ bounds: boundsWith((b) => { delete b.sandbox.failIfUnavailable; }) }) },
  { item: 3, name: 'auto-allow left on', setup: bounded({ bounds: boundsWith((b) => { b.sandbox.autoAllowBashIfSandboxed = true; }) }) },
  { item: 3, name: 'the unsandboxed retry left on', setup: bounded({ bounds: boundsWith((b) => { delete b.sandbox.allowUnsandboxedCommands; }) }) },
  { item: 3, name: 'no settings file passed', setup: bounded({ script: runner([`  --settings ${BOUNDS_PATH} \\\n`, '']) }) },

  // Item 4: the saved slice run.
  { item: 4, name: 'no saved slice', setup: bounded({ slice: null }) },
  { item: 4, name: 'the summary text saved', setup: bounded({ slice: 'Added a test for total(). npm test passes.\n' }) },
  { item: 4, name: 'a stream that never finished', setup: bounded({ slice: `${JSON.stringify({ type: 'system', subtype: 'init' })}\n${JSON.stringify({ type: 'assistant', message: { content: [] } })}\n` }) },
  { item: 4, name: 'no result message', setup: bounded({ slice: { ...SLICE_RUN, type: 'assistant' } }) },
  { item: 4, name: 'the check\'s stand-in reply', setup: bounded({ slice: { ...SLICE_RUN, session_id: STUB_SESSION } }) },
  { item: 4, name: 'the slice stopped at the spend limit', setup: bounded({ slice: { ...SLICE_RUN, subtype: 'error_max_budget_usd', is_error: true } }) },
  { item: 4, name: 'the slice stopped at the turn limit', setup: bounded({ slice: { ...SLICE_RUN, subtype: 'error_max_turns', is_error: true } }) },
  { item: 4, name: 'the slice ended in another error', setup: bounded({ slice: { ...SLICE_RUN, subtype: 'error_during_execution', is_error: true } }) },
  { item: 4, name: 'the slice run failed', setup: bounded({ slice: { ...SLICE_RUN, is_error: true, result: 'Not logged in' } }) },
  { item: 4, name: 'no cost estimate', setup: bounded({ slice: { ...SLICE_RUN, total_cost_usd: undefined } }) },
  { item: 4, name: 'no turn count', setup: bounded({ slice: { ...SLICE_RUN, num_turns: undefined } }) },
  { item: 4, name: 'no spend limit to compare with', setup: bounded({ script: runner(['  --max-budget-usd 2 \\\n', '']) }) },
  { item: 4, name: 'the slice cost more than the limit', setup: bounded({ slice: { ...SLICE_RUN, total_cost_usd: 2.37 } }) },
];
