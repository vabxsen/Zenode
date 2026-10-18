// Inserting a template into a note. The template's body goes at the cursor;
// its front matter (properties) goes at the top of the note: as the note's
// front matter if it has none, otherwise only the properties it lacks.
import type { TextEdit } from '../paneTypes'

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

interface Property {
  key: string
  // The key line and any indented or list lines under it.
  text: string
}

// Top-level properties of a front matter block.
function properties(yaml: string): Property[] {
  const out: Property[] = []
  for (const line of yaml.split(/\r?\n/)) {
    const key = /^([^\s#-][^:]*):/.exec(line)
    if (key) out.push({ key: key[1].trim().toLowerCase(), text: line })
    else if (out.length && line.trim()) out[out.length - 1].text += `\n${line}`
  }
  return out
}

export function templateEdit(doc: string, cursor: number, template: string): TextEdit {
  const t = FRONT_MATTER.exec(template)
  const d = FRONT_MATTER.exec(doc)
  // Never put the body inside the note's front matter.
  const at = d && cursor < d[0].length ? d[0].length : cursor
  if (!t) return { changes: [{ from: at, insert: template }], cursor: at + template.length }

  const body = template.slice(t[0].length)
  let head: { from: number; insert: string } | null = null
  if (!d) {
    head = { from: 0, insert: t[0].endsWith('\n') ? t[0] : `${t[0]}\n` }
  } else {
    const have = new Set(properties(d[1]).map((p) => p.key))
    const extra = properties(t[1]).filter((p) => !have.has(p.key))
    if (extra.length) {
      const yamlStart = d[0].indexOf('\n') + 1
      const yamlEnd = yamlStart + d[1].length
      head = { from: yamlEnd, insert: `${d[1].trim() ? '\n' : ''}${extra.map((p) => p.text).join('\n')}` }
    }
  }
  const changes = head ? [head, { from: at, insert: body }] : [{ from: at, insert: body }]
  const shift = head && head.from <= at ? head.insert.length : 0
  return { changes, cursor: at + shift + body.length }
}

// Applies a TextEdit to a string (what the editor does), for tests and files that aren't open.
export function applyTextEdit(doc: string, edit: TextEdit): string {
  let out = ''
  let pos = 0
  for (const c of [...edit.changes].sort((a, b) => a.from - b.from)) {
    out += doc.slice(pos, c.from) + c.insert
    pos = c.to ?? c.from
  }
  return out + doc.slice(pos)
}
