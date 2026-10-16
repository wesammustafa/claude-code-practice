// What git status lists, for the beats that read it (ticket 88): the whole
// tree clean, or part of it. Main runs git; these decide what its answer
// means. Pure: nothing here reads the disk or starts a process.
import { C } from './copy.mjs';

// `git status --porcelain` read line by line: each path, as npm run check
// reads it (checks/paths.mjs statusPaths, the new name of a rename, the
// checks' own .practice/ left out), and its index column, X. A path is
// staged where X says the index changed it (modified, added, deleted,
// renamed, copied, type changed): ` ` is unchanged there, `?` untracked,
// and `U` a merge conflict not yet resolved.
export function porcelain(text) {
  return (text ?? '').split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => ({ x: line[0], path: line.slice(3).split(' -> ').pop().replace(/^"|"$/g, '').trim() }))
    .filter((e) => !e.path.startsWith('.practice/'));
}
export const isStaged = (e) => 'MADRCT'.includes(e.x);

// A beat on part of the tree has git list each untracked file, not just its
// folder: an untracked .claude/ listed whole can't say whether
// .claude/settings.local.json is in it. A whole-tree git-clean lists what
// `git status` itself shows.
export const eachFile = (verify) => verify.kind !== 'git-clean' || Boolean(verify.paths);

// Whether a path git lists is `scope` or inside it: `secrets/` and `secrets`
// both hold secrets/key.txt, and neither holds secrets-old.txt.
export function under(path, scope) {
  const base = scope.replace(/\/+$/, '');
  return path === base || path.startsWith(`${base}/`);
}

// The listed paths under any of `scopes`.
export const listedUnder = (paths, scopes) => paths.filter((p) => scopes.some((scope) => under(p, scope)));

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
    if (outside.length) return { pass: false, hint: C.changesOutside(outside.length, verify.path, outside.slice(0, 3).join(', ')) };
  }
  if (!hits.length) return { pass: false, hint: C.noChangeUnder(verify.path) };
  return { pass: true, evidence: C.gitShows(...some(hits)) };
}
