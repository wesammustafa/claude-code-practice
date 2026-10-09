// The Advanced capstone: add CI review your team can share, as
// capstone/advanced-brief.md asks, in a new copy of the template. It reuses
// the Advanced lessons' items with the capstone's own files: the worktree
// listing and the review script's run, both saved under .practice/; the
// saved workflow, which must start subagents; and the review workflow, which
// runs on pull requests and is read from the history, so the check passes
// before and after the teardown. Running both sessions at once, choosing a
// workflow over subagents, reading the CI review and the cost estimates are
// self-assessed on the capstone page.
import { ignoresWorktrees, mergedWorktrees } from './a-1.mjs';
import { savedWorkflow } from './a-3.mjs';
import { committedScript, savedRun, SCRIPT, scriptBehavior, scriptCall } from './a-4.mjs';
import { boundedWorkflow, chosenWorkflow } from './a-5.mjs';
import { marketplaceItem, settingsItem } from './a-6.mjs';
import { testsPass, nothingUncommitted } from './b-3.mjs';

export const title = 'Advanced capstone';

export const SNAPSHOT = '.practice/a-capstone-worktrees.txt';
export const RUN = '.practice/a-capstone-run.json';
export const REVIEW = '.github/workflows/claude-review.yml';
// The brief's review runs on each pull request; a workflow started by hand,
// such as lesson 5's, never stands in for it.
export const CI = { triggers: ['pull_request'], file: REVIEW, guide: 'part 5 of `capstone/advanced-brief.md`' };
// Where the brief describes the review script and the team's plugin, for the
// hints of the lessons' items, which name the lessons' own sections.
const SCRIPT_GUIDE = 'part 2 of `capstone/advanced-brief.md`';
const PLUGIN_GUIDE = 'part 3 of `capstone/advanced-brief.md`';
const PLUGIN = {
  marketplace: `Put a marketplace with one plugin of yours in \`team-marketplace/\`, as ${PLUGIN_GUIDE} describes`,
  settings: `as ${PLUGIN_GUIDE} describes`,
};

// A Claude API key or OAuth token written out, as lesson 5's check spots one
// in a workflow file. checks/ holds the checks' own made-up keys.
const KEY = 'sk-ant-[A-Za-z0-9_-]{20,}';
const OWN = ':(exclude)checks/';

const short = (sha) => sha.slice(0, 7);

// Where `commit` holds a key, each `{ path, line }`, by path. The key itself
// is never kept, so no hint can print it.
function keysAt(repo, commit) {
  let out;
  try {
    out = repo.gitLocal('grep', '--no-color', '-I', '-n', '-z', '-E', KEY, commit, '--', '.', OWN);
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
  return out.split('\n').filter(Boolean).map((record) => {
    const [where, line] = record.split('\0');
    return { path: where.slice(commit.length + 1), line: Number(line) };
  });
}

function headCommit(repo) {
  try {
    return repo.git('rev-parse', '--verify', '--quiet', 'HEAD^{commit}');
  } catch {
    return null;
  }
}

export const noCommittedKey = {
  text: 'no Claude API key or token is committed, at `HEAD` or in the commit the workflow item reads',
  check(repo) {
    const head = headCommit(repo);
    if (!head) return true;
    const read = chosenWorkflow(repo, CI.triggers)?.file.commit;
    for (const commit of [head, read].filter((c, i, all) => c && all.indexOf(c) === i)) {
      const found = keysAt(repo, commit);
      if (!found.length) continue;
      const places = found.slice(0, 3).map((f) => `line ${f.line} of \`${f.path}\``);
      const more = found.length > 3 ? `, and ${found.length - 3} more` : '';
      const where = commit === head ? 'At `HEAD`' : `In commit ${short(commit)}, where the check reads your workflow`;
      return `${where}, ${places.join(', ')}${more} ${found.length > 1 ? 'hold' : 'holds'} what looks like a Claude API key or token. Treat it as leaked, because removing it from the file doesn't take it out of your history: delete an API key in the Claude Console now (for a \`claude setup-token\` token, read the warning on the capstone page), and keep the credential only in a repository secret.`;
    }
    return true;
  },
};

export const items = [
  ignoresWorktrees,
  mergedWorktrees(SNAPSHOT),
  savedWorkflow({ needArgs: false, needAgentCall: true }),
  committedScript(SCRIPT, SCRIPT_GUIDE),
  scriptCall(SCRIPT),
  scriptBehavior(SCRIPT),
  savedRun(RUN, SCRIPT),
  boundedWorkflow(CI),
  noCommittedKey,
  marketplaceItem(PLUGIN),
  settingsItem(PLUGIN),
  testsPass,
  nothingUncommitted,
];
