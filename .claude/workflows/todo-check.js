export const meta = {
  name: 'todo-check',
  description: 'Find the TODO and FIXME comments in the folder passed as args, check in a few batches whether each still applies to the current code, and report only the ones that do',
  phases: [
    { title: 'Find', detail: 'list the TODO and FIXME comments in the folder' },
    { title: 'Check', detail: 'one agent per batch of comments' },
  ],
}

const folder = typeof args === 'string' ? args.trim().replace(/\/+$/, '') : ''
if (!folder) throw new Error('todo-check: pass the folder to check as args, such as "src"')

const FOUND = {
  type: 'object',
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'line', 'text'],
        properties: { path: { type: 'string' }, line: { type: 'number' }, text: { type: 'string' } },
      },
    },
  },
}

const VERDICTS = {
  type: 'object',
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'line', 'applies', 'why'],
        properties: { path: { type: 'string' }, line: { type: 'number' }, applies: { type: 'boolean' }, why: { type: 'string' } },
      },
    },
  },
}

phase('Find')
const found = await agent(
  `List every TODO and FIXME comment in the files under ${folder}/, searching its subfolders too. For each one, give its path from the repository root, its line number and the comment's text. Don't change any files.`,
  { label: `find:${folder}`, schema: FOUND },
)
const items = (found?.items ?? []).filter((it) => it.path.startsWith(`${folder}/`))
log(`${items.length} TODO and FIXME comments under ${folder}/`)

// A few batches, not one agent per comment, keep the run small.
const BATCH = 5
const batches = []
for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH))

phase('Check')
const checked = await pipeline(batches, (batch) =>
  agent(
    [
      'For each comment below, read its file and the code it describes, and decide whether what it says still applies to the current code.',
      'In `why`, say in one line why it still applies or why it no longer does, without citing any other file or line. Don\'t change any files.',
      ...batch.map((it) => `- ${it.path}:${it.line}: ${it.text}`),
    ].join('\n'),
    { label: `check:${batch[0].path}:${batch[0].line}`, schema: VERDICTS },
  ),
)

return checked
  .filter(Boolean)
  .flatMap((result) => result.verdicts)
  .filter((v) => v.applies)
  .map((v) => `${v.path}:${v.line} - ${v.why}`)
