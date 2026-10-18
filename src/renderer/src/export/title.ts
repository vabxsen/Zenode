// True when the note already opens with "# Its title" (after any front matter).
export function startsWithTitle(text: string, title: string): boolean {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '')
  const first = body.split(/\r?\n/).find((line) => line.trim())
  return !!first && /^#\s/.test(first) && first.replace(/^#\s+/, '').trim().toLowerCase() === title.toLowerCase()
}
