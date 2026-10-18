// The part of a note an embed or a link points at: "#Heading" (the heading and
// everything under it) or "#^block-id" (the paragraph or list item ending in ^block-id).

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
}

// Without front matter, as Obsidian shows an embedded note.
export function stripFrontmatter(text: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text)
  return m ? text.slice(m[0].length) : text
}

export function extractSection(text: string, subpath: string): string | null {
  if (!subpath || subpath === '#') return stripFrontmatter(text)
  const lines = text.split(/\r?\n/)
  if (subpath.startsWith('#^')) {
    const id = subpath.slice(2)
    const at = lines.findIndex((l) => new RegExp(`\\s\\^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`).test(l))
    if (at === -1) return null
    let start = at
    while (start > 0 && lines[start - 1].trim() && !/^\s*[-*+]\s|^\s*\d+\.\s/.test(lines[start])) start--
    const block = lines.slice(start, at + 1).join('\n')
    return block.replace(/\s\^[\w-]+\s*$/, '')
  }
  // "#A#B" means heading B under heading A; the last part is what we look for.
  const wanted = normalize(subpath.slice(1).split('#').pop() ?? '')
  let inCode = false
  let start = -1
  let level = 0
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) inCode = !inCode
    if (inCode) continue
    const m = HEADING.exec(lines[i])
    if (!m) continue
    if (start === -1) {
      if (normalize(m[2]) === wanted) {
        start = i
        level = m[1].length
      }
    } else if (m[1].length <= level) {
      return lines.slice(start, i).join('\n').trimEnd()
    }
  }
  return start === -1 ? null : lines.slice(start).join('\n').trimEnd()
}
