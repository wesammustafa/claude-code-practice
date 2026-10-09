// Choose an orchestration pattern (Advanced, lesson 2). The Learner picks a
// pattern for each of four queued jobs by what it needs and what it costs,
// writes the choices to a file, and runs job 1 as parallel subagents in a
// session started with a SubagentStart hook that logs each subagent's id and
// type. Naming the pattern for a job of their own is self-checked.

export const title = 'Choose an orchestration pattern';

const CHOICES = '.practice/a-2-choices.md';
const LOG = '.practice/a-2-agents.txt';
const HOOK = '.practice/a-2-hook.json';
const HOOKED = `\`claude --settings ${HOOK}\``;
const FORMAT = '`<job number>: <pattern> because <reason>`';
const NAMES = '`main conversation`, `subagents`, `workflow` or `agent team`';

// What the text after a job number may start with, once an article goes.
const PATTERNS = [
  ['subagents', /^(?:parallel\s+)?sub[\s-]?agents?\b/i],
  ['workflow', /^(?:dynamic\s+)?workflows?\b/i],
  ['main conversation', /^(?:main\s+(?:conversation|session)|(?:single|one)\s+(?:conversation|session))\b/i],
  ['agent team', /^agent[\s-]+teams?\b/i],
];
const LABEL = { 'main conversation': 'the main conversation', subagents: 'subagents', workflow: 'a workflow', 'agent team': 'an agent team' };

// The lesson's chart: its questions in order, and the answers that lead to
// each pattern. Where a wrong pick leaves the right path is the question that
// settles the job.
const QUESTIONS = [
  'Can one conversation do it without filling up?',
  'Must the workers talk to each other?',
  'Does it need many agents, cross-checked findings or a rerun?',
];
const PATH = {
  'main conversation': [true],
  'agent team': [false, true],
  subagents: [false, false, false],
  workflow: [false, false, true],
};

// The four jobs in the lesson's Your turn, and the answer to each question on
// the way to the pattern that fits.
const JOBS = {
  1: { pattern: 'subagents', why: [
    "No: reading three whole files would fill your conversation with text you won't need again, and only one short list needs to come back.",
    'No: each reviewer checks its own file and reports what it found.',
    'No: three files, checked once, with no step that verifies the findings.',
  ] },
  2: { pattern: 'workflow', why: [
    'No: it checks every source file.',
    'No: each finding is verified against the code, not argued out between workers.',
    'Yes: it checks every source file, verifies each finding and reruns before every release, so a script should hold the plan.',
  ] },
  3: { pattern: 'main conversation', why: [
    'Yes: fixing a typo is a quick, targeted change, and each step past one conversation costs more.',
  ] },
  4: { pattern: 'agent team', why: [
    'No: three investigators work at the same time, each on a theory of its own.',
    "Yes: the investigators challenge each other's findings until they agree, and teammates in an agent team message each other directly.",
  ] },
};

const SEPARATOR = '[:.)|\\-\\u2013\\u2014]';
const JOB_LINE = new RegExp(`^(?:job\\s*#?\\s*([1-4])(?!\\d)\\s*${SEPARATOR}*|#?([1-4])(?!\\d)\\s*${SEPARATOR}+)\\s*(.*)$`, 'i');

const and = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0]);

// The choice lines in the file, by job number. `1: subagents because ...`,
// `Job 1 - Subagents`, `- **2:** dynamic workflow`, `3. main session`,
// `4) agent teams` and a table row `| 4 | agent team | ... |` all count. A
// line's pattern is null when its text starts with none of the four, and
// `start` keeps that text's first words for the hint.
export function readChoices(text) {
  const jobs = new Map([1, 2, 3, 4].map((n) => [n, []]));
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[*_`]/g, '')
      .replace(/^\s*(?:[-+>|(]\s*|#{1,6}\s+|\[[ xX]\]\s*)*/, '')
      .replace(/^\d+[.)]\s+(?=job\b)/i, '')
      .trim();
    const match = line.match(JOB_LINE);
    if (!match) continue;
    const rest = match[3].replace(/^["'([\s]+/, '').replace(/^(?:an?|the)\s+/i, '');
    const found = PATTERNS.find(([, pattern]) => pattern.test(rest));
    const start = rest.replace(/\s+because\b.*$/i, '').split(/\s+/).filter(Boolean).slice(0, 4).join(' ');
    jobs.get(Number(match[1] ?? match[2])).push({ pattern: found ? found[0] : null, start });
  }
  return jobs;
}

function wrongPick(n, chosen) {
  const { pattern, why } = JOBS[n];
  const at = PATH[chosen].findIndex((answer, i) => answer !== PATH[pattern][i]);
  return `Job ${n} doesn't call for ${LABEL[chosen]}. ${QUESTIONS[at]} ${why[at]} It calls for ${LABEL[pattern]}.`;
}

// Subagent starts in the hook's log, one per line: `agent_id<TAB>agent_type`.
// A resumed subagent logs its id again, so each id counts once. A line with no
// id, from a hook that logs only the type, counts as a start of its own.
export function startedAgents(text) {
  const ids = new Map();
  let unnamed = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const tab = line.indexOf('\t');
    const id = tab === -1 ? '' : line.slice(0, tab).trim();
    if (id) ids.set(id, (ids.get(id) ?? 0) + 1);
    else unnamed += 1;
  }
  return { ids, count: ids.size + unnamed };
}

export const fittingPatterns = {
  text: `\`${CHOICES}\` picks the cheapest pattern that fits each job`,
  local: true,
  check(repo) {
    const text = repo.read(CHOICES);
    if (text === null) return `There is no \`${CHOICES}\`. Save your choices there, one line per job in the form ${FORMAT}, where each pattern is ${NAMES}.`;
    const jobs = readChoices(text);
    if ([...jobs.values()].every((lines) => !lines.length)) return `\`${CHOICES}\` has no line that starts with a job number. Write one line per job in the form ${FORMAT}, where each pattern is ${NAMES}.`;
    const missing = [...jobs].filter(([, lines]) => !lines.length).map(([n]) => n);
    const problems = missing.length ? [`\`${CHOICES}\` has no line for job${missing.length > 1 ? 's' : ''} ${and(missing)}. Add one per job in the form ${FORMAT}.`] : [];
    for (const [n, lines] of jobs) {
      if (!lines.length) continue;
      const picked = [...new Set(lines.map((l) => l.pattern).filter(Boolean))];
      if (!picked.length) {
        const { start } = lines[0];
        problems.push(start ? `Job ${n}'s line starts with "${start}", which isn't one of the four patterns. Right after the job number, write ${NAMES}.` : `Job ${n}'s line names no pattern. Right after the job number, write ${NAMES}.`);
      } else if (picked.length > 1) {
        problems.push(`Job ${n} has lines that pick different patterns: ${and(picked.map((p) => LABEL[p]))}. Keep one line per job.`);
      } else if (picked[0] !== JOBS[n].pattern) {
        problems.push(wrongPick(n, picked[0]));
      }
    }
    return problems.length ? problems.join(' ') : true;
  },
};

export const parallelSubagents = {
  text: `\`${LOG}\` shows at least two subagents starting for job 1`,
  local: true,
  check(repo) {
    const text = repo.read(LOG);
    if (text === null) {
      return repo.exists(HOOK)
        ? `There is no \`${LOG}\`. Start the session with ${HOOKED}, then run job 1.`
        : `There is no \`${LOG}\`. Save the hook file from the lesson's Your turn as \`${HOOK}\`, start the session with ${HOOKED}, then run job 1.`;
    }
    const { ids, count } = startedAgents(text);
    if (count >= 2) return true;
    if (count === 0) return `\`${LOG}\` is empty. The hook's command creates the file before \`jq\` runs, so check that \`jq --version\` works, then run job 1 again in a session started with ${HOOKED}.`;
    const [[id, times] = []] = ids;
    const seen = times > 1 ? ` It shows one subagent, \`${id}\`, starting ${times} times: a subagent that Claude resumes logs its id again, so it counts once.` : ' It shows one subagent starting.';
    return `\`${LOG}\` needs at least two subagents.${seen} In a session started with ${HOOKED}, ask for one subagent per file, in parallel.`;
  },
};

export const items = [fittingPatterns, parallelSubagents];
