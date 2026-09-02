import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { loadEntries, outputDir } from './lib.mjs'

const { entries, errors } = await loadEntries()
if (errors.length) throw new Error(errors.join('\n'))

await fs.mkdir(outputDir, { recursive: true })
const version = new Date().toISOString()
const items = entries
  .sort((a, b) => a.module.localeCompare(b.module) || a.order - b.order || a.title.localeCompare(b.title, 'zh-CN'))
  .map(({ markdown, html, source, ...entry }) => entry)
await fs.writeFile(new URL('index.json', outputDir), `${JSON.stringify({ version, items }, null, 2)}\n`)
await fs.writeFile(new URL('entries.json', outputDir), `${JSON.stringify({ version, entries }, null, 2)}\n`)
const search = entries.map(({ id, module, category, title, summary, markdown }) => ({
  id, module, category, title, summary, text: markdown.replace(/[#*_>`|\[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim(),
}))
await fs.writeFile(new URL('search-index.json', outputDir), `${JSON.stringify({ version, items: search }, null, 2)}\n`)
console.log(`Built ${entries.length} entries in ${fileURLToPath(outputDir)}.`)
