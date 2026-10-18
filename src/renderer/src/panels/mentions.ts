// Unlinked mentions: places where a note's name (or alias) appears as plain
// text in another note that doesn't link to it.

export interface Mention {
  source: string
  start: number
  end: number
  // The matched text as written.
  text: string
  // The line it's on, for showing context.
  line: string
}

export interface MentionNote {
  path: string
  content: string
}

const MAX_PER_NOTE = 5

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Skips front matter, code, and text already inside [[links]], [text](links) or URLs.
function blockedRanges(content: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const fm = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(content)
  if (fm) out.push([0, fm[0].length])
  for (const re of [/```[\s\S]*?```/g, /`[^`\n]*`/g, /!?\[\[[^\]\n]*\]\]/g, /!?\[[^\]\n]*\]\([^)\n]*\)/g, /https?:\/\/\S+/g]) {
    for (const m of content.matchAll(re)) out.push([m.index!, m.index! + m[0].length])
  }
  return out
}

export function findUnlinkedMentions(target: string, names: string[], notes: MentionNote[], linksTo: (source: string) => boolean): Mention[] {
  const wanted = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length)
  if (!wanted.length) return []
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${wanted.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_])`, 'giu')
  const out: Mention[] = []
  for (const note of notes) {
    if (note.path === target || linksTo(note.path)) continue
    const blocked = blockedRanges(note.content)
    let found = 0
    for (const m of note.content.matchAll(re)) {
      const start = m.index!
      const end = start + m[0].length
      if (blocked.some(([a, b]) => start < b && end > a)) continue
      const lineStart = note.content.lastIndexOf('\n', start - 1) + 1
      const lineEndAt = note.content.indexOf('\n', end)
      out.push({ source: note.path, start, end, text: m[0], line: note.content.slice(lineStart, lineEndAt === -1 ? undefined : lineEndAt) })
      if (++found >= MAX_PER_NOTE) break
    }
  }
  return out
}

// The link that replaces a mention: [[Name]] when the text is the link text, else [[Name|text]].
export function mentionLink(linktext: string, text: string): string {
  return text === linktext ? `[[${linktext}]]` : `[[${linktext}|${text}]]`
}
