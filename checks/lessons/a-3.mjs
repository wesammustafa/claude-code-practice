// Run and save a dynamic workflow (Advanced, lesson 3). The Learner has
// Claude write a migration workflow that fixes until the tests pass, saves the
// run from /workflows as a project command in .claude/workflows/, has it read
// a folder from `args`, commits it, and runs it on two folders, saving each
// report under .practice/ with the folder on its first line and the old
// form's `git grep -E` pattern in .practice/a-3-pattern.txt. The history shows
// the migration: the pattern matched in both folders before and matches in
// neither at HEAD. Whether the tests pass, and what the Learner read in the
// script before approving it, the lesson self-checks. The Advanced capstone
// reuses the script item with its own options.
import { statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { planPaths } from '../paths.mjs';
import { findWorkflows, readWorkflow, STAGES } from '../workflow-script.mjs';

export const title = 'Run and save a dynamic workflow';

const REPORTS = ['.practice/a-3-run1.md', '.practice/a-3-run2.md'];
const PATTERN = '.practice/a-3-pattern.txt';

const and = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0]);
const code = (text) => `\`${text}\``;
const shell = (path) => (/\s/.test(path) ? `"${path}"` : path);
const SAVE = 'When a workflow run finishes, run `/workflows`, select the run, press `s`, keep the project location, `.claude/workflows/`, and press `Enter`. Then commit the `.js` file it saves.';

// Where a misplaced script should go: a .js file directly in the
// .claude/workflows/ folder it sits under.
function placed(path) {
  const at = path.lastIndexOf('.claude/workflows/') + '.claude/workflows/'.length;
  return `${path.slice(0, at)}${posix.basename(path).replace(/\.[^.]+$/, '')}.js`;
}

function scriptHint({ path, result, changed }) {
  const p = code(path);
  const hint = {
    first: () => `${p} doesn't start with \`export const meta\`${result.found ? `: its code starts with ${code(result.found)}` : ''}. Claude Code needs \`export const meta = { ... }\` as the script's first statement. Move it to the top (comments may stay above it) and commit.`,
    literal: () => `Line ${result.line} of ${p}: \`meta\` holds ${result.what}. When \`meta\` holds anything but literal values, Claude Code drops \`/<name>\` from \`/\` autocomplete. Write each value out as a string, number, list or object, and commit.`,
    fields: () => `\`meta\` in ${p} needs ${result.missing.map((f) => `a non-empty \`${f}\` string`).join(' and ')}. Add ${result.missing.length > 1 ? 'them' : 'it'} and commit.`,
    compile: () => `${p} doesn't compile${result.line ? ` (line ${result.line})` : ''}: ${result.message}. Fix it, or ask Claude to, and commit.`,
    args: () => {
      const why = result.declared
        ? `Line ${result.declared} of ${p} declares its own \`args\`, which hides the input Claude passes to the workflow.`
        : result.mentioned
          ? `${p} mentions \`args\` only in a comment, a string or a property name, so it never reads its input.`
          : `${p} never reads \`args\`, so it can't take a folder as input.`;
      return `${why} Run \`/workflow-authoring\`, ask Claude to change the script so it reads the folder from \`args\`, run \`/reload-skills\`, and commit.`;
    },
    agent: () => `${p} never calls \`agent()\`, so it starts no subagent. Have Claude write the workflow for the task again, save the run from \`/workflows\`, and commit.`,
  }[result.problem]();
  const pending = changed ? ` Your copy of ${p} has changes that aren't committed: if they fix this, commit them.` : '';
  return `${hint}${pending}`;
}

function uncommittedHint({ path, rule }) {
  if (!rule) return `${code(path)} isn't committed. Run \`git add ${shell(path)}\` and commit it.`;
  return `${code(path)} isn't committed, and line ${rule.line} of ${code(rule.source)}, ${code(rule.pattern)}, ignores it. Run \`git add -f ${shell(path)}\` and commit it.`;
}

// The script item. Options as readWorkflow takes them: `needArgs`, the script
// reads its input from `args`; `needAgentCall`, it starts subagents.
export function savedWorkflow(options = {}) {
  const needs = [options.needArgs && 'reads its input from `args`', options.needAgentCall && 'starts subagents with `agent()`'].filter(Boolean);
  return {
    text: `a committed script in \`.claude/workflows/\` has a literal \`export const meta\`, with a \`name\` and a \`description\`, as its first statement${needs.length ? `, and ${and(needs)}` : ''}`,
    check(repo) {
      const { scripts, misplaced, uncommitted } = findWorkflows(repo);
      const results = scripts.map((s) => ({ ...s, result: readWorkflow(s.text, options) }));
      if (results.some((r) => r.result.ok)) return true;
      if (results.length) {
        const rank = (r) => STAGES.indexOf(r.result.problem);
        const other = uncommitted.length ? ` Also, ${uncommittedHint(uncommitted[0])}` : '';
        return `${scriptHint(results.reduce((best, r) => (rank(r) > rank(best) ? r : best)))}${other}`;
      }
      if (misplaced.length) {
        const [path] = misplaced;
        return `${code(path)} is under \`.claude/workflows/\`, but the check reads only \`.js\` files directly in that folder, where \`/workflows\` saves them. Move it to ${code(placed(path))} and commit.`;
      }
      if (uncommitted.length) return uncommittedHint(uncommitted[0]);
      return `There is no workflow script in \`.claude/workflows/\`. ${SAVE}`;
    },
  };
}

const isDir = (dir, path) => {
  try {
    return statSync(join(dir, path)).isDirectory();
  } catch {
    return false;
  }
};

const isFile = (dir, path) => {
  try {
    return statSync(join(dir, path)).isFile();
  } catch {
    return false;
  }
};

// A path as a report writes it, in git's form from the repository's root:
// '' for the root itself, or null when it points outside the repository.
function repoPath(token, dir) {
  const [path = ''] = planPaths(token, dir);
  const normal = posix.normalize(path || '.').replace(/(.)\/+$/, '$1');
  if (normal === '.') return '';
  if (normal === '..' || normal.startsWith('../') || posix.isAbsolute(normal) || /^[A-Za-z]:/.test(normal)) return null;
  return normal;
}

// The folder a report's first line names: the whole line, as in `src/payments`
// or `# src/payments`, or else the first word that names a folder, as in
// `Folder: src/payments`. `root` is true when it names only the repository's
// root.
const unwrap = (s) => s.trim().replace(/^[#>*`"'([\s-]+/, '').replace(/[*`"')\]:,;\s]+$/, '').replace(/(\w)\.$/, '$1');

function folderOf(line, dir) {
  let root = false;
  for (const candidate of new Set([unwrap(line), ...line.split(/\s+/).map(unwrap)])) {
    if (!candidate) continue;
    const path = repoPath(candidate, dir);
    if (path === '') root = true;
    else if (path && isDir(dir, path)) return { folder: path };
  }
  return { root };
}

// The `path:line` citations in a report: `src/a.js:12`, `src/a.js:12:5`,
// `./src/a.js:12`, `src\a.js:12`, a full path into the repository, and a
// link such as `[a.js](src/a.js#L12)`. A URL, `localhost:8080` and a time
// like `10:30` aren't citations: the path must have a folder or an extension.
const COLON = /([^\s`'"()[\]{}<>*|,;]+?):(\d+)(?::\d+)?/g;
const ANCHOR = /([^\s`'"()[\]{}<>*|,;#]+)#L(\d+)/g;
const PATHLIKE = /[/\\]|\.[A-Za-z][\w-]*$/;

function citations(text, dir) {
  const found = new Map();
  for (const pattern of [COLON, ANCHOR]) {
    for (const [, match, number] of text.matchAll(pattern)) {
      if (match.includes('://') || match.startsWith('//')) continue;
      // A word glued on with a colon, as in `at:src/a.js:12`, isn't part of
      // the path; a Windows drive letter is.
      const raw = /^[A-Za-z]:[\\/]/.test(match) ? match : match.split(':').pop();
      if (!PATHLIKE.test(raw)) continue;
      const path = repoPath(raw, dir);
      const line = Number(number);
      const key = `${path ?? raw}:${line}`;
      if (!found.has(key)) found.set(key, { raw: `${raw}:${line}`, path, line, cited: path ? `${path}:${line}` : `${raw}:${line}` });
    }
  }
  return [...found.values()];
}

function readReport(repo, path) {
  const text = repo.read(path);
  if (text === null || !text.trim()) return { path, text };
  const first = text.split(/\r?\n/).find((l) => l.trim()).trim();
  return { path, text, first, ...folderOf(first, repo.dir), cites: citations(text, repo.dir) };
}

const inside = (path, folder) => path.startsWith(`${folder}/`);
const some = (list) => `${and(list.slice(0, 3).map(code))}${list.length > 3 ? ` and ${list.length - 3} more` : ''}`;

export const twoFolderReports = {
  text: '`.practice/a-3-run1.md` and `.practice/a-3-run2.md` name two different folders on their first lines, and each cites at least one `path:line` inside its folder',
  local: true,
  check(repo) {
    const reports = REPORTS.map((path) => readReport(repo, path));
    const missing = reports.filter((r) => r.text === null);
    if (missing.length === 2) return `There are no reports yet. Run your saved workflow by name on a folder, then ask Claude to save the report to \`${REPORTS[0]}\` with the folder on its first line. Do the same on a second folder for \`${REPORTS[1]}\`.`;
    const problems = [];
    for (const r of reports) {
      if (r.text === null) problems.push(`There is no ${code(r.path)}. Run your saved workflow by name on a different folder, then ask Claude to save that report there, with the folder on its first line.`);
      else if (!r.first) problems.push(`${code(r.path)} is empty. Ask Claude to save the report there again, with the folder on its first line.`);
      else if (r.root) problems.push(`The first line of ${code(r.path)} names the repository's root. Run the workflow on a folder inside it, and put that folder on the first line.`);
      else if (!r.folder) problems.push(`The first line of ${code(r.path)}, "${r.first.length > 60 ? `${r.first.slice(0, 60)}...` : r.first}", names no folder in this repository. Put the folder you ran the workflow on, such as \`src\`, on the first line, as a path from the repository's root.`);
    }
    const [a, b] = reports;
    if (a.folder && a.folder === b.folder) problems.push(`Both reports name ${code(a.folder)}. Run your saved workflow on a second, different folder, and save that report as \`${REPORTS[1]}\`.`);
    for (const r of reports.filter((x) => x.folder)) {
      const outside = r.cites.filter((c) => c.path && isFile(repo.dir, c.path) && !inside(c.path, r.folder)).map((c) => c.cited);
      const named = r.cites.filter((c) => c.path && inside(c.path, r.folder));
      const within = named.filter((c) => isFile(repo.dir, c.path));
      const fromFolder = r.cites.find((c) => c.path && !isFile(repo.dir, c.path) && isFile(repo.dir, `${r.folder}/${c.path}`));
      if (outside.length) {
        problems.push(`${code(r.path)} cites ${some(outside)}, outside ${code(`${r.folder}/`)}, the folder on its first line. Check that the workflow reads the folder from \`args\` and reports only on files inside it, then run it again.`);
      } else if (!within.length && fromFolder) {
        problems.push(`${code(r.path)} cites ${code(fromFolder.raw)}, a path from inside ${code(`${r.folder}/`)}. Each \`path:line\` must start at the repository's root, as ${code(`${r.folder}/${fromFolder.path}:${fromFolder.line}`)} does: start \`claude\` at the root, or ask Claude to write the paths from there, and run the workflow again.`);
      } else if (!within.length && named.length) {
        problems.push(`${code(r.path)} cites ${some(named.map((c) => c.cited))}, but ${code(`${r.folder}/`)} holds no such file. Cite the files the migration changed, as they are now, and save the report again.`);
      } else if (!within.length) {
        problems.push(`${code(r.path)} cites no \`path:line\`${r.cites.length ? ` inside ${code(`${r.folder}/`)}` : ''}. Each file the report lists needs one, from the repository's root, such as ${code(`${r.folder}/<file>:<line>`)}.`);
      }
    }
    return problems.length ? problems.join(' ') : true;
  },
};

// The pattern's first non-blank line, without the backticks or quotes a
// Learner may have kept around it.
function readPattern(repo) {
  const text = repo.read(PATTERN);
  if (text === null) return { missing: true };
  const line = text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? '';
  const quoted = line.match(/^(`|'|")(.+)\1$/);
  return { pattern: quoted ? quoted[2] : line };
}

// Whether `git grep -E` finds the pattern in `folder` at the trees `revs`, or
// in the working tree's tracked files when `revs` is empty: true, false, or
// git's own error for a pattern it can't read.
function grep(repo, pattern, folder, revs = []) {
  try {
    repo.gitLocal('grep', '-q', '-E', '-e', pattern, ...revs, '--', folder);
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    return { error: `${error.stderr ?? error.message}`.trim().split('\n')[0] };
  }
}

// The commits that changed `folder`: each state the folder was ever in is
// the tree of one of them.
function changes(repo, folder) {
  try {
    return repo.gitLocal('rev-list', '--max-count=1000', 'HEAD', '--', folder).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export const migratedFolders = {
  text: `the \`git grep -E\` pattern in \`${PATTERN}\` matched inside both folders at an earlier commit, and matches inside neither at \`HEAD\``,
  local: true,
  check(repo) {
    const { missing, pattern } = readPattern(repo);
    if (missing) return `There is no ${code(PATTERN)}. Save the \`git grep -E\` pattern that finds the old form there, on one line, such as \`import\\.meta\\.url\`.`;
    if (!pattern) return `${code(PATTERN)} is empty. Save the \`git grep -E\` pattern that finds the old form there, on one line.`;
    const folders = [...new Set(REPORTS.map((path) => readReport(repo, path)).map((r) => r.folder).filter(Boolean))];
    if (folders.length < 2) return 'The check reads the two folders from the reports\' first lines. Save the reports as the item above says.';
    const shown = code(pattern);
    const problems = [];
    for (const folder of folders) {
      const now = grep(repo, pattern, folder, ['HEAD']);
      if (now?.error) return `git can't use the pattern in ${code(PATTERN)}, ${shown}: ${now.error}. Write it as \`git grep -E\` reads it, and test it with \`git grep -n -E '<pattern>' -- <folder>\`.`;
      if (now) {
        const tree = grep(repo, pattern, folder);
        problems.push(tree === false
          ? `${code(`${folder}/`)} is migrated in your working tree, but ${shown} still matches there at \`HEAD\`. Review the changes and commit them.`
          : `${shown} still matches inside ${code(`${folder}/`)} at \`HEAD\`: \`git grep -n -E '${pattern}' -- ${shell(folder)}\` lists the lines. Run the workflow on that folder again, review its changes and commit them.`);
        continue;
      }
      const revs = changes(repo, folder);
      if (!revs.length || grep(repo, pattern, folder, revs) !== true) {
        problems.push(`${shown} matches nothing inside ${code(`${folder}/`)} in any commit, so the check can't see a migration there. Write the pattern for the old form, and test it on a commit from before the run: \`git grep -n -E '<pattern>' <commit> -- ${shell(folder)}\` should list the old form.`);
      }
    }
    return problems.length ? problems.join(' ') : true;
  },
};

export const items = [savedWorkflow({ needArgs: true }), twoFolderReports, migratedFolders];
