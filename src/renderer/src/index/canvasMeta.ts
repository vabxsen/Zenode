// Index a .canvas file like a note: links and tags from text cards, plus file
// cards and group backgrounds as embeds. Each ref remembers its card.
import { canvasRefs, parseCanvas } from '../canvas/model'
import { parseNote, type LinkRef, type NoteMeta, type TagRef } from './parser'

export function isCanvasPath(path: string): boolean {
  return path.toLowerCase().endsWith('.canvas')
}

export function parseCanvasMeta(text: string): { meta: NoteMeta; searchText: string } {
  const empty: NoteMeta = { links: [], headings: [], tags: [], frontmatterTags: [], aliases: [] }
  let refs
  try {
    refs = canvasRefs(parseCanvas(text))
  } catch {
    return { meta: empty, searchText: '' }
  }
  const links: LinkRef[] = []
  const tags: TagRef[] = []
  for (const card of refs.texts) {
    const m = parseNote(card.text)
    const lines = card.text.split('\n')
    for (const l of m.links) links.push({ ...l, canvasNode: card.id, context: lines[l.line] ?? card.text })
    for (const t of m.tags) tags.push({ ...t, line: 0 })
  }
  for (const f of refs.files) {
    links.push({
      link: f.file,
      subpath: f.subpath,
      alias: '',
      original: f.file,
      embed: true,
      kind: 'canvas',
      start: 0,
      end: 0,
      line: 0,
      canvasNode: f.id,
      context: `Card: ${f.file}`
    })
  }
  return {
    meta: { ...empty, links, tags },
    searchText: refs.texts.map((t) => t.text).join('\n\n')
  }
}
