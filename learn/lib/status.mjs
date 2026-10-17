// What git status lists, for the beats that read it (ticket 88): the whole
// tree clean, or part of it. Main runs git; these decide what its answer
// means. Pure: nothing here reads the disk or starts a process.
import { GIT } from './content.mjs';
import { C } from './copy.mjs';

// A `git status --porcelain` entry (checks/paths.mjs statusEntries) is staged
// where its index column, X, says the index changed it (modified, added,
// deleted, renamed, copied, type changed): ` ` is unchanged there, `?`
// untracked, and `U` a merge conflict not yet resolved.
export const isStaged = (e) => 'MADRCT'.includes(e.xy[0]);

// What a look at part of the tree lists, relative to the work folder. git
// names paths from the top of the repository, and the folder may be inside
// it: `prefix` is where, as `git rev-parse --show-prefix` says (`proj/`, or
// empty at the top). A path outside the folder is left out. A rename or
// copy lists both its names, so a file moved out of `secrets/` is a change
// there; `staged` names it once, by its new name where that is here.
export function listing(entries, prefix = '') {
  const here = (path) => (path !== undefined && path.startsWith(prefix) ? [path.slice(prefix.length)] : []);
  return {
    paths: entries.flatMap((e) => [...here(e.from), ...here(e.path)]),
    staged: entries.filter(isStaged).flatMap((e) => here(e.path).concat(here(e.from)).slice(0, 1)),
  };
}

// A beat on part of the tree has git list each untracked file, not just its
// folder: an untracked .claude/ listed whole can't say whether
// .claude/settings.local.json is in it. A whole-tree git-clean lists what
// `git status` itself shows.
export const eachFile = (verify) => verify.kind !== 'git-clean' || Boolean(verify.paths);

// A beat that needs git status to list something: git-changed, git-only,
// git-staged. A git-clean beat needs it to list nothing.
export const needsChange = (verify) => GIT.has(verify.kind) && verify.kind !== 'git-clean';

// Whether a path git lists is `scope` or inside it: `secrets/` and `secrets`
// both hold secrets/key.txt, and neither holds secrets-old.txt.
export function under(path, scope) {
  const base = scope.replace(/\/+$/, '');
  return path === base || path.startsWith(`${base}/`);
}

// The listed paths under any of `scopes`.
export const listedUnder = (paths, scopes) => paths.filter((p) => scopes.some((scope) => under(p, scope)));

// What a git-clean beat counts: what is listed under its paths, where it
// names some, or all of it.
export const cleanListed = (verify, paths) => (verify.paths ? listedUnder(paths, verify.paths) : paths);

// Up to three paths, and how many more.
const some = (paths) => [paths.slice(0, 3).join(', '), Math.max(0, paths.length - 3)];

// Whether what git status lists passes a beat that needs something to
// happen (git-changed, git-only, git-staged), with the evidence a pass shows
// or the not-yet line a miss gets. `paths` lists each untracked file, and
// `staged` the paths whose index column says staged.
export function judgeGit(verify, { paths, staged = [] }) {
  if (verify.kind === 'git-staged') return staged.length ? { pass: true, evidence: C.stagedShows(...some(staged)) } : { pass: false, hint: C.nothingStaged };
  const hits = listedUnder(paths, [verify.path]);
  if (verify.kind === 'git-only') {
    if (!paths.length) return { pass: false, hint: C.noChange };
    const outside = paths.filter((p) => !hits.includes(p));
    if (outside.length) return { pass: false, hint: C.changedOutside(outside.length, verify.path, outside.slice(0, 3).join(', ')) };
  }
  if (!hits.length) return { pass: false, hint: C.noChangeUnder(verify.path) };
  return { pass: true, evidence: C.changedShows(...some(hits)) };
}
