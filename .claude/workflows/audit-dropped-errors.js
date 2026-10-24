// Run with: /audit-dropped-errors on <folder>
export const meta = {
  name: 'audit-dropped-errors',
  description: 'Find errors that are caught and then ignored in a folder, and report only the findings a second agent confirms',
  phases: [
    { title: 'Find', detail: 'one agent lists each place that drops an error' },
    { title: 'Check', detail: 'one agent per finding tries to refute it against the code' },
  ],
}

const folder = Array.isArray(args) ? args[0] : args
if (!folder) throw new Error('Name a folder: Run /audit-dropped-errors on <folder>')

phase('Find')
const found = await agent(`Read every file under ${folder}/ and list each place where an error is caught and then ignored: an empty catch, a catch that only logs and carries on, or a rejected promise nobody handles. Change no file.`, {
  schema: {
    type: 'object', required: ['findings'],
    properties: { findings: { type: 'array', items: { type: 'object', required: ['where', 'what'], properties: { where: { type: 'string' }, what: { type: 'string' } } } } },
  },
})

phase('Check')
const confirmed = await pipeline(found.findings, async (finding) => {
  const verdict = await agent(`Try to refute this finding, and change no file: at ${finding.where}, ${finding.what}. Read the code around it and its callers. Reply confirmed only if the error is really dropped and nothing upstream handles it.`, {
    label: finding.where,
    schema: { type: 'object', required: ['confirmed', 'reason'], properties: { confirmed: { type: 'boolean' }, reason: { type: 'string' } } },
  })
  return verdict?.confirmed ? `${finding.where}: ${finding.what}` : null
})

return confirmed.filter(Boolean).join('\n') || 'No confirmed findings.'
