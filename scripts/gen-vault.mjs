// Generates a synthetic vault for benchmarks: notes in nested folders with
// front matter, headings, #tags, [[links]] (some to missing notes), tasks and
// code, plus a few canvases. Deterministic for a given count.
// Usage: node scripts/gen-vault.mjs <count> <folder>
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const count = Number(process.argv[2] ?? 10000)
const root = process.argv[3]
if (!root || !Number.isInteger(count) || count < 1) {
  console.error('Usage: node scripts/gen-vault.mjs <count> <folder>')
  process.exit(1)
}

// Small seeded PRNG so every run makes the same vault.
let seed = 0x5eed
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const pick = (list) => list[Math.floor(rand() * list.length)]

const WORDS = 'alpha beta gamma delta signal vector lattice orbit quiet ember harbor cipher meadow prism ledger tide relay summit fable copper drift pixel atlas node kernel thread garden river canyon lantern'.split(' ')
const TAGS = ['project', 'idea', 'reading', 'meeting', 'research', 'draft', 'todo', 'work/launch', 'work/ops', 'personal']
const FOLDERS = 100

const title = (i) => `Note ${String(i).padStart(5, '0')}`
const folder = (i) => `Area ${String(i % FOLDERS).padStart(2, '0')}/Topic ${(i >> 3) % 8}`
const sentence = () => {
  const n = 8 + Math.floor(rand() * 12)
  const words = Array.from({ length: n }, () => pick(WORDS))
  words[0] = words[0][0].toUpperCase() + words[0].slice(1)
  return `${words.join(' ')}.`
}

rmSync(root, { recursive: true, force: true })
for (let i = 0; i < count; i++) {
  const links = Array.from({ length: 3 + Math.floor(rand() * 5) }, () =>
    rand() < 0.05 ? `[[Missing ${Math.floor(rand() * 500)}]]` : `[[${title(Math.floor(rand() * count))}]]`
  )
  const tags = [pick(TAGS), pick(TAGS)]
  const body = [
    '---',
    `tags: [${tags.join(', ')}]`,
    `created: 2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
    '---',
    `# ${title(i)}`,
    '',
    `${sentence()} ${sentence()} See ${links.slice(0, 2).join(' and ')}.`,
    '',
    '## Notes',
    '',
    `${sentence()} #${pick(TAGS)} ${sentence()} ${sentence()}`,
    '',
    `- [ ] ${sentence()}`,
    `- [x] ${sentence()} ${links.slice(2).join(', ')}`,
    '',
    '## Details',
    '',
    `${sentence()} ${sentence()} ${sentence()} ${sentence()}`,
    '',
    i % 10 === 0 ? '```js\nconst x = 1\n```\n' : ''
  ].join('\n')
  const dir = join(root, folder(i))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${title(i)}.md`), body)
}
for (let c = 0; c < Math.max(1, Math.floor(count / 1000)); c++) {
  const nodes = Array.from({ length: 20 }, (_, k) => ({ id: `n${k}`, type: 'text', text: `Card [[${title(Math.floor(rand() * count))}]]`, x: k * 300, y: 0, width: 260, height: 120 }))
  writeFileSync(join(root, `Board ${c}.canvas`), JSON.stringify({ nodes, edges: [] }))
}
console.log(`Wrote ${count} notes to ${root}`)
