// Attachments no note or canvas uses. Deliberately cautious: a file counts as
// used if any link resolves to it OR its name appears anywhere in a note or
// canvas (front matter, HTML, a link the index can't resolve).
import { isCanvasPath } from '../index/canvasMeta'
import { baseName, isMarkdown } from '../paths'
import { fileKind } from '../views/fileKinds'

export interface IndexedText {
  path: string
  content: string
}

export function findUnusedAttachments(files: string[], notes: IndexedText[], resolvedLinks: Record<string, Record<string, number>>): string[] {
  const linked = new Set<string>()
  for (const targets of Object.values(resolvedLinks)) for (const t of Object.keys(targets)) linked.add(t)
  const text = notes.map((n) => n.content.toLowerCase()).join('\n')
  return files
    .filter((f) => !isMarkdown(f) && !isCanvasPath(f) && fileKind(f) !== 'text' && !linked.has(f))
    .filter((f) => {
      const name = baseName(f).toLowerCase()
      return !text.includes(name) && !text.includes(encodeURIComponent(name).toLowerCase())
    })
    .sort((a, b) => a.localeCompare(b))
}
