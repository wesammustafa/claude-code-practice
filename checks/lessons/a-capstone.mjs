// The Advanced capstone: add CI review your team can share, as
// capstone/advanced-brief.md asks, in a new copy of the template. It reuses
// the Advanced lessons' items with the capstone's own files: the worktree
// listing and the review script's run, both saved under .practice/; the
// saved workflow, which must start a finding agent and a checking one; and
// the review workflow, which runs on pull requests and is read from the
// history, so the check passes before and after the teardown. Lesson 7's
// item holds the review script to a spend cap that the saved run came in
// under. The brief states problems, so the items accept any sound way to
// meet them: worktrees anywhere, brought in by merge, rebase or squash. Two
// items join the parts: the script and CI run one committed review skill,
// and a new push cancels CI's review of an older one. Choosing which review
// runs where, acting on the CI review, when the sandbox is needed and the
// cost estimates are self-assessed on the capstone page.
import { parseClaudeArgs, scriptCalls } from '../claude-args.mjs';
import { committedIgnore, ignoreHint } from '../ignore.mjs';
import { headText } from '../marketplace.mjs';
import { parseWorktrees } from '../worktrees.mjs';
import { parseYaml } from '../actions.mjs';
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
// such as lesson 5's, never stands in for it. The copy has only the
// credential's secret, saved with `gh secret set`, and no Claude GitHub App.
export const CI = {
  triggers: ['pull_request'],
  file: REVIEW,
  guide: 'part 5 of `capstone/advanced-brief.md`',
  secret: 'the secret you saved with `gh secret set`',
  noToken: 'the action authenticates as the Claude GitHub App, which the capstone doesn\'t set up',
};
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
    const read = chosenWorkflow(repo, CI.triggers, CI)?.file.commit;
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

// A spend cap, as lesson 7's runs have: `--max-budget-usd` in the review
// script's committed `claude -p` call, written as an amount the check can
// read, and the saved run's estimated cost below it. The saved run's other
// fields are the run item's to report.
const AMOUNT = /^(\d+(\.\d*)?|\.\d+)$/;

export const spendCap = {
  text: `the review script's \`claude -p\` call caps spend with \`--max-budget-usd\`, and \`${RUN}\` cost less than that cap`,
  local: true,
  check(repo) {
    const text = headText(repo, SCRIPT);
    if (text === null) return `The check can't read a spend cap without a committed \`${SCRIPT}\` (see the item about the script).`;
    const budgets = scriptCalls(text).map((argv) => parseClaudeArgs(argv)).filter((a) => a.print).map((a) => a.flags.maxBudgetUsd);
    if (!budgets.length) return `The check found no \`claude -p\` call in the committed \`${SCRIPT}\`, so it can't read a spend cap.`;
    const budget = budgets.find((b) => b !== undefined);
    if (budget === undefined) return `The \`claude -p\` call in \`${SCRIPT}\` sets no spend cap. Add \`--max-budget-usd\` with an amount in US dollars, above what one review costs, as lesson 7's script does, and commit.`;
    if (typeof budget !== 'string' || !budget.trim() || budget.startsWith('-')) return '`--max-budget-usd` has no amount after it: write an amount in US dollars, above 0, and commit.';
    if (budget.includes('$')) return `\`--max-budget-usd ${budget}\` gets its amount from a variable the check can't work out: write the number in the script and commit.`;
    if (!AMOUNT.test(budget) || Number(budget) <= 0) return `\`--max-budget-usd ${budget}\` isn't an amount above 0: write a number of US dollars, without a \`$\` sign, and commit.`;
    const cap = Number(budget);
    let run;
    try {
      run = JSON.parse(repo.read(RUN) ?? '');
    } catch {
      return `The check can't read a cost from \`${RUN}\` (see the item about that file).`;
    }
    if (run?.subtype === 'error_max_budget_usd') return `The run in \`${RUN}\` stopped at your spend cap (\`error_max_budget_usd\`), so the cap is below what one review costs. Raise \`--max-budget-usd\` in \`${SCRIPT}\`, commit it, and run the review again.`;
    const cost = run?.total_cost_usd;
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) return `The run in \`${RUN}\` has no cost estimate in \`total_cost_usd\`. Save the JSON \`claude -p\` prints unchanged, and run the review again.`;
    if (cost >= cap) return `The review cost an estimated $${cost} (\`total_cost_usd\`), and your spend cap, \`--max-budget-usd ${budget}\`, isn't above it. Set the cap above what one review costs, with room to spare, commit \`${SCRIPT}\`, and run the review again.`;
    return true;
  },
};

// Where the worktrees were: the ones the listing names inside the
// repository must be ignored by a committed rule, which hides nothing else
// of .claude/. With no listing yet, lesson 1's rule for .claude/worktrees/,
// where `claude --worktree` makes them.
export const ignoredWorktrees = {
  text: `a committed \`.gitignore\` keeps the worktrees \`${SNAPSHOT}\` lists inside the repository out of git, and not the rest of \`.claude/\``,
  check(repo) {
    const records = parseWorktrees(repo.read(SNAPSHOT) ?? '');
    if (!records.length) return ignoresWorktrees.check(repo);
    const main = records[0].path.replace(/\/+$/, '');
    const inside = [...new Set(records.slice(1).filter((r) => !r.bare && r.path.startsWith(`${main}/`)).map((r) => r.path.slice(main.length + 1)))];
    for (const path of inside) {
      const found = committedIgnore(repo, `${path}/a-capstone-probe`);
      if (found.problem) return ignoreHint(found, `${path}/`);
    }
    const settings = committedIgnore(repo, '.claude/settings.json');
    if (settings.problem) return true;
    return `Line ${settings.line} of \`${settings.source}\`, \`${settings.pattern}\`, also ignores \`.claude/settings.json\`, so it would hide the settings you share with your team. Ignore only the worktrees' folder, and commit.`;
  },
};

// The `/<name>` a prompt starts with, or null.
const skillOf = (prompt) => (typeof prompt === 'string' ? prompt.trim().match(/^\/([\w:.-]+)/)?.[1] ?? null : null);

// The script and CI run one review: both prompts start with the same
// `/<name>`, a skill committed in .claude/skills/<name>/SKILL.md, which a
// CI checkout loads, unlike a plugin from the repository's marketplace.
export const sameReview = {
  text: 'the review script\'s `claude -p` prompt and the CI workflow\'s `prompt` both run one skill committed in `.claude/skills/`',
  check(repo) {
    const text = headText(repo, SCRIPT);
    if (text === null) return `The check can't compare the reviews without a committed \`${SCRIPT}\` (see the item about the script).`;
    const prompts = scriptCalls(text).map((argv) => parseClaudeArgs(argv)).filter((a) => a.print).map((a) => a.prompt);
    if (!prompts.length) return `The check found no \`claude -p\` call in the committed \`${SCRIPT}\`, so it can't read the review it runs.`;
    const local = skillOf(prompts[0]);
    const c = chosenWorkflow(repo, CI.triggers, CI);
    if (!c) return 'The check can\'t compare the reviews without a committed review workflow (see the item about it).';
    const remote = skillOf(c.step.inputs.prompt?.text);
    if (!local) return `The \`claude -p\` prompt in \`${SCRIPT}\` doesn't run a skill, so its review lives only in the script. Commit the team's review as \`.claude/skills/<name>/SKILL.md\`, and start the prompt with \`/<name>\`.`;
    if (!remote) return `The review workflow's \`prompt\` doesn't run a skill, so CI reviews differently from the script, which runs \`/${local}\`. Make the \`prompt\` \`/${local}\` too.`;
    if (local.toLowerCase() !== remote.toLowerCase()) return `The script runs \`/${local}\` and CI runs \`/${remote}\`. Run one skill in both, so a laptop and CI review the same way.`;
    if (local.includes(':')) return `\`/${local}\` is a plugin skill. A CI checkout was never trusted, so the repository's marketplace doesn't load there: commit the review as \`.claude/skills/<name>/SKILL.md\` and run \`/<name>\` in both.`;
    if (headText(repo, `.claude/skills/${local}/SKILL.md`) === null) return `\`/${local}\` names no skill committed at \`.claude/skills/${local}/SKILL.md\`. Commit the team's review there.`;
    return true;
  },
};

// A key's value in a parsed YAML map, or undefined.
const entry = (node, key) => (node?.type === 'map' ? node.entries.find((e) => e.key === key)?.value : undefined);

// A new push replaces CI's review of an older one: a `concurrency` group,
// for the workflow or for the job that runs the action, with
// `cancel-in-progress: true`.
export const reviewConcurrency = {
  text: 'the CI workflow sets a `concurrency` group with `cancel-in-progress: true`, so a new push cancels the review still running',
  check(repo) {
    const c = chosenWorkflow(repo, CI.triggers, CI);
    if (!c) return 'The check can\'t read a `concurrency` group without a committed review workflow (see the item about it).';
    let doc;
    try {
      doc = parseYaml(c.file.text);
    } catch {
      return `The check can't read \`${c.file.path}\` as a workflow file (see the item about it).`;
    }
    const job = entry(entry(doc, 'jobs'), c.step.job);
    const groups = [entry(doc, 'concurrency'), entry(job, 'concurrency')].filter(Boolean);
    if (!groups.length) return `\`${c.file.path}\` sets no \`concurrency\`, so five quick pushes start five reviews. Add \`concurrency:\` with a \`group\` for the pull request and \`cancel-in-progress: true\`, and commit.`;
    if (groups.some((g) => entry(g, 'cancel-in-progress')?.text === 'true')) return true;
    return `The \`concurrency\` in \`${c.file.path}\` doesn't cancel a review still running: set \`cancel-in-progress: true\` beside its \`group\`, and commit.`;
  },
};

export const items = [
  ignoredWorktrees,
  mergedWorktrees(SNAPSHOT, { anywhere: true }),
  savedWorkflow({ needArgs: false, needAgentCall: true, needCheck: true }),
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
  // After the others, so they keep their places in the app's list of slow
  // items; these read text and start no process.
  spendCap,
  sameReview,
  reviewConcurrency,
];
