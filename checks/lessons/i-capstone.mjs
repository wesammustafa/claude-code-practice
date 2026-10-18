// The Intermediate capstone: get the practice repository ready for a new
// teammate, as capstone/intermediate-brief.md asks. It checks what each
// Intermediate Exit statement leaves in files and git; picking a model and
// effort, and seeing each piece work in a session, are self-assessed on the
// capstone page.
import { frontmatter } from '../frontmatter.mjs';
import { committedMode, editWriteScripts, missingJq, runCommitted } from '../hooks.mjs';
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

function committedFile(repo, path) {
  try {
    return frontmatter(repo.git('show', `HEAD:${path}`));
  } catch {
    return null;
  }
}

const words = (text) => String(text ?? '').split(/\s+/).filter((w) => w && w !== 'TODO').length;

// The brief's skill runs the link checker: `npm run linkcheck` or src/cli.js.
const LINKCHECK = /npm run linkcheck|src\/cli\.js/;

const skill = {
  text: 'a committed project skill that runs the link checker by name and can load on its own',
  check(repo) {
    const ok = committedFiles(repo, '.claude/skills', '/SKILL.md').some((path) => {
      const file = committedFile(repo, path);
      const f = file?.fields;
      return f && LINKCHECK.test(file.body) && words(f.description) >= 8 && String(f['disable-model-invocation']) !== 'true' && String(f['user-invocable']) !== 'false';
    });
    return ok ? true : 'Commit a skill in `.claude/skills/<name>/SKILL.md` whose instructions run the link checker (`npm run linkcheck -- <folder>`), with a description of what it does and when to use it, and without `disable-model-invocation: true`, as in lesson 1.';
  },
};

const reviewer = {
  text: 'a committed reviewer subagent with only read-only tools',
  check(repo) {
    const ok = committedFiles(repo, '.claude/agents', '.md').some((path) => {
      const f = committedFile(repo, path)?.fields;
      const tools = list(f?.tools);
      return f?.name && /review/i.test(`${f.name} ${f.description}`) && words(f.description) >= 5 && tools.length && tools.every((t) => READ_ONLY.has(t));
    });
    return ok ? true : 'Commit a reviewer in `.claude/agents/`: a subagent whose name or description says it reviews changes, with a `tools` list of read-only tools only, such as `Read, Grep, Glob`, as in lesson 6.';
  },
};

function committedSettings(repo) {
  try {
    return JSON.parse(repo.git('show', 'HEAD:.claude/settings.json'));
  } catch {
    return null;
  }
}

const hook = {
  text: 'a committed, executable `PreToolUse` hook for Edit and Write blocks `samples/` and nothing else',
  check(repo) {
    const scripts = editWriteScripts(committedSettings(repo)).filter((s) => committedMode(repo, s) === '100755');
    if (!scripts.length) return 'Commit an executable script in `.claude/hooks/` and run it from `.claude/settings.json` as a `PreToolUse` hook with the matcher `Edit|Write`, as in lesson 5, to keep Claude out of samples/.';
    const samples = scripts.map((s) => runCommitted(repo, s, 'samples/guide.md'));
    const source = scripts.map((s) => runCommitted(repo, s, 'src/cli.js'));
    if ([...samples, ...source].some(missingJq)) return 'A hook needs `jq`, which isn\'t installed. Install it and run the check again.';
    if (!samples.some((r) => r?.status === 2)) return 'No Edit|Write hook exits with 2 for `samples/guide.md`, so Claude can still edit samples/.';
    return source.every((r) => r?.status === 0) ? true : 'An Edit|Write hook also blocks `src/cli.js`: block samples/ only.';
  },
};

// The brief puts the sandbox in the team's committed settings.
const sandbox = {
  text: 'the committed `.claude/settings.json` turns the sandbox on, and `.claude/settings.local.json` stays out of git',
  check(repo) {
    if (repo.git('ls-files', '--', '.claude/settings.local.json')) return '.claude/settings.local.json is committed, but it holds your own settings. Run `git rm --cached .claude/settings.local.json`, commit, and add it to `.gitignore`.';
    return committedSettings(repo)?.sandbox?.enabled === true ? true : 'The committed .claude/settings.json doesn\'t turn the sandbox on. Add `"sandbox": {"enabled": true}` to it and commit: `/sandbox` saves to your local file, which teammates don\'t get.';
  },
};

// An item reused from a lesson sends the learner back to that lesson's page
// when its file is missing or lacks what the lesson adds; here the capstone
// asks for it. Each swap is a [from, to] pair of message text. The wrapper
// shows the reused check's source, so the tests that read a check's code
// (its ways to fail, and whether it starts a process) still read that check.
function asCapstone(item, ...swaps) {
  const check = (repo) => {
    const outcome = item.check(repo);
    return typeof outcome === 'string' ? swaps.reduce((text, [from, to]) => text.replace(from, to), outcome) : outcome;
  };
  check.toString = () => item.check.toString();
  return { ...item, check };
}

const pinnedServer = asCapstone(mcp[0],
  ['Save the partial file from the lesson\'s Your turn there.', 'Write the one the capstone asks for there, as in lesson 7.'],
  ['Add it under `mcpServers`, as in the lesson.', 'Add it under `mcpServers`, as in lesson 7.']);
const setupPlugin = asCapstone(plugins[0], ['Add the `enabledPlugins` entry from the lesson and commit it.', 'Add the `enabledPlugins` entry the capstone asks for and commit it, as in lesson 8.']);
const teamRules = asCapstone(scopes[0], ['Save the partial file from the lesson\'s Your turn there.', 'Write the team settings the capstone asks for there, as in lesson 4.']);
const imports = asCapstone(memory[0], ['Commit the one you organize in this lesson.', 'Commit the one the capstone asks for, as in lesson 2.']);

export const items = [skill, hook, reviewer, pinnedServer, setupPlugin, teamRules, sandbox, imports, memory[1], testsPass, nothingUncommitted];
