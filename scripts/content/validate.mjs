import { loadEntries } from './lib.mjs'

const { entries, errors } = await loadEntries()
if (entries.length === 0) errors.push('knowledge base must contain at least one entry')
if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Validated ${entries.length} knowledge entries.`)
}
