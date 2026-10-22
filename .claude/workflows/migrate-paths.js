// Run with: /migrate-paths on <folder>
export const meta = {
  name: 'migrate-paths',
  description: 'Build paths from import.meta.dirname instead of import.meta.url in a folder, then fix until npm test passes',
  phases: [
    { title: 'Migrate', detail: 'agents migrate the files in batches of five' },
    { title: 'Fix', detail: 'run npm test and fix until it passes or two rounds make no progress' },
  ],
}

const folder = Array.isArray(args) ? args[0] : args
if (!folder) throw new Error('Name a folder: Run /migrate-paths on <folder>')

phase('Migrate')
const found = await agent(`List every file under ${folder}/ that builds a path from import.meta.url, each as a path from the repository root.`, {
  schema: { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } },
})
const batches = []
for (let i = 0; i < found.files.length; i += 5) batches.push(found.files.slice(i, i + 5))
const changed = await pipeline(batches, (batch) =>
  agent(`In ${batch.join(', ')}, build each path from import.meta.dirname instead of import.meta.url, and drop imports left unused. List each file you changed as path:line of its first change.`, { label: batch[0] }),
)

phase('Fix')
let failing = Infinity
let stalled = 0
while (stalled < 2) {
  const run = await agent('Run npm test. If it fails, fix the failures. Reply with the number of tests that failed before your fixes.', {
    schema: { type: 'object', required: ['failing'], properties: { failing: { type: 'number' } } },
  })
  if (!run || run.failing === 0) break
  stalled = run.failing < failing ? 0 : stalled + 1
  failing = run.failing
}

return changed.filter(Boolean).join('\n')
