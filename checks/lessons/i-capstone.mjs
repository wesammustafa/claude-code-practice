// The Intermediate capstone: get the practice repository ready for a new
// teammate, as capstone/intermediate-brief.md asks. It checks what each
// Intermediate Exit statement leaves in files and git; picking a model and
// effort, and seeing each piece work in a session, are self-assessed on the
// capstone page.
import { spawnSync } from 'node:child_process';
import { join, posix } from 'node:path';
import { frontmatter } from '../frontmatter.mjs';
import { items as memory } from './i-2.mjs';
import { items as scopes } from './i-4.mjs';
import { items as mcp } from './i-7.mjs';
import { items as plugins } from './i-8.mjs';
import { testsPass, nothingUncommitted } from './b-3.mjs';

export const title = 'Intermediate capstone';

const READ_ONLY = new Set(['Read', 'Grep', 'Glob', 'LSP', 'WebFetch', 'WebSearch']);
const list = (value) => (Array.isArray(value) ? value : String(value ?? '').split(',')).map((t) => t.trim()).filter(Boolean);

function committedFiles(repo, dir, suffix) {
  try {
    return repo.git('ls-tree', '-r', '--name-only', 'HEAD', '--', dir).split('\n').filter((f) => f.endsWith(suffix));
  } catch {
    return [];
  }
}

function committedFields(repo, path) {
  try {
    return frontmatter(repo.git('show', `HEAD:${path}`))?.fields ?? null;
  } catch {
    return null;
  }
}

const words = (text) => String(text ?? '').split(/\s+/).filter((w) => w && w !== 'TODO').length;

const skill = {
  text: 'a committed project skill that runs by name and can load on its own',
  check(repo) {
    const ok = committedFiles(repo, '.claude/skills', '/SKILL.md').some((path) => {
      const f = committedFields(repo, path);
      return f && words(f.description) >= 8 && String(f['disable-model-invocation']) !== 'true' && String(f['user-invocable']) !== 'false';
    });
    return ok ? true : 'Commit a skill in `.claude/skills/<name>/SKILL.md` with a description of what it does and when to use it, and without `disable-model-invocation: true`, as in lesson 1.';
  },
};

const reviewer = {
  text: 'a committed subagent with only read-only tools',
  check(repo) {
    const ok = committedFiles(repo, '.claude/agents', '.md').some((path) => {
      const f = committedFields(repo, path);
      const tools = list(f?.tools);
      return f?.name && words(f.description) >= 5 && tools.length && tools.every((t) => READ_ONLY.has(t));
    });
    return ok ? true : 'Commit a subagent in `.claude/agents/` with a name, a description and a `tools` list of read-only tools only, such as `Read, Grep, Glob`, as in lesson 6.';
  },
};

// The scripts the committed settings run before Edit and Write.
function editHooks(repo) {
  let value;
  try {
    value = JSON.parse(repo.git('show', 'HEAD:.claude/settings.json'));
  } catch {
    return [];
  }
  return (value?.hooks?.PreToolUse ?? [])
    .filter((g) => { const m = g?.matcher ?? ''; return m === '' || m === '*' || (/\bEdit\b/.test(m) && /\bWrite\b/.test(m)); })
    .flatMap((g) => g.hooks ?? [])
    .map((h) => String(h?.command ?? '').replace(/^"?\$\{?CLAUDE_PROJECT_DIR\}?"?\/?/, '').replace(/^\.\//, ''))
    .filter((path) => path.startsWith('.claude/hooks/'));
}

function exitCode(repo, script, path) {
  const run = spawnSync('bash', [join(repo.dir, script)], {
    cwd: repo.dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo.dir },
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: posix.join(repo.dir.replace(/\\/g, '/'), path) } }),
    encoding: 'utf8',
    timeout: 10_000,
  });
  return run.status;
}

const hook = {
  text: 'a committed, executable `PreToolUse` hook for Edit and Write blocks `samples/` and nothing else',
  check(repo) {
    const scripts = editHooks(repo).filter((s) => repo.exists(s) && (repo.git('ls-files', '-s', '--', s).split(/\s+/)[0] === '100755'));
    if (!scripts.length) return 'Commit an executable script in `.claude/hooks/` and run it from `.claude/settings.json` as a `PreToolUse` hook with the matcher `Edit|Write`, as in lesson 5, to keep Claude out of samples/.';
    const blocksSamples = scripts.some((s) => exitCode(repo, s, 'samples/guide.md') === 2);
    const allowsSource = scripts.every((s) => exitCode(repo, s, 'src/cli.js') === 0);
    if (!blocksSamples) return 'No Edit|Write hook exits with 2 for `samples/guide.md`, so Claude can still edit samples/.';
    return allowsSource ? true : 'An Edit|Write hook also blocks `src/cli.js`: block samples/ only.';
  },
};

export const items = [skill, hook, reviewer, mcp[0], plugins[0], scopes[0], scopes[1], memory[0], memory[1], testsPass, nothingUncommitted];
