import { tags } from '@lezer/highlight'
import type { MarkdownConfig } from '@lezer/markdown'

// Obsidian-flavoured additions to the Lezer Markdown grammar:
//   [[target#subpath|alias]] and ![[embed]]   (WikiLink / WikiEmbed)
//   #tag and #nested/tag                       (Hashtag)
//   --- YAML front matter --- at the top       (Frontmatter)
const BANG = 33
const HASH = 35
const OPEN = 91
const CLOSE = 93
const NEWLINE = 10

export const wikiLinkSyntax: MarkdownConfig = {
  defineNodes: [
    { name: 'WikiLink', style: tags.link },
    { name: 'WikiEmbed', style: tags.link },
    { name: 'WikiLinkMark', style: tags.processingInstruction },
    { name: 'WikiLinkTarget' }
  ],
  parseInline: [
    {
      name: 'WikiLink',
      before: 'Link',
      parse(cx, next, pos) {
        const embed = next === BANG
        if (embed ? cx.char(pos + 1) !== OPEN || cx.char(pos + 2) !== OPEN : next !== OPEN || cx.char(pos + 1) !== OPEN) {
          return -1
        }
        const innerStart = pos + (embed ? 3 : 2)
        for (let i = innerStart; i < cx.end; i++) {
          const c = cx.char(i)
          if (c === NEWLINE || (c === OPEN && cx.char(i + 1) === OPEN)) return -1
          if (c === CLOSE && cx.char(i + 1) === CLOSE) {
            if (i === innerStart) return -1
            return cx.addElement(
              cx.elt(embed ? 'WikiEmbed' : 'WikiLink', pos, i + 2, [
                cx.elt('WikiLinkMark', pos, innerStart),
                cx.elt('WikiLinkTarget', innerStart, i),
                cx.elt('WikiLinkMark', i, i + 2)
              ])
            )
          }
        }
        return -1
      }
    }
  ]
}

// Tag characters: letters, digits, underscore, hyphen and "/" for nesting.
const TAG_CHAR = /[\p{L}\p{N}_\-/]/u

export const hashtagSyntax: MarkdownConfig = {
  defineNodes: [{ name: 'Hashtag', style: tags.labelName }],
  parseInline: [
    {
      name: 'Hashtag',
      parse(cx, next, pos) {
        if (next !== HASH) return -1
        const before = pos > cx.offset ? String.fromCharCode(cx.char(pos - 1)) : ' '
        if (!/[\s(,;]/.test(before)) return -1
        let end = pos + 1
        while (end < cx.end && TAG_CHAR.test(String.fromCharCode(cx.char(end)))) end++
        const body = cx.slice(pos + 1, end)
        if (!body || /^[\d/]+$/.test(body)) return -1
        return cx.addElement(cx.elt('Hashtag', pos, end))
      }
    }
  ]
}

export const frontmatterSyntax: MarkdownConfig = {
  defineNodes: [
    { name: 'Frontmatter', block: true, style: tags.meta },
    { name: 'FrontmatterMark', style: tags.processingInstruction }
  ],
  parseBlock: [
    {
      name: 'Frontmatter',
      before: 'HorizontalRule',
      parse(cx, line) {
        // Only a "---" on the very first line of the document opens front matter,
        // and only if a closing line exists (checked up front, since consumed lines can't be given back).
        if (cx.lineStart !== 0 || line.text.trimEnd() !== '---') return false
        const input = (cx as unknown as { input?: { length: number; read(from: number, to: number): string } }).input
        if (!input || !/\n(---|\.\.\.)[ \t]*(\r?\n|$)/.test(input.read(0, Math.min(input.length, 65536)))) return false
        const start = cx.lineStart
        const marks = [cx.elt('FrontmatterMark', start, start + 3)]
        while (cx.nextLine()) {
          if (line.text.trimEnd() === '---' || line.text.trimEnd() === '...') {
            marks.push(cx.elt('FrontmatterMark', cx.lineStart, cx.lineStart + 3))
            const end = cx.lineStart + line.text.length
            cx.nextLine()
            cx.addElement(cx.elt('Frontmatter', start, end, marks))
            return true
          }
        }
        // Not reached in practice (the closing line was found above); keep what was consumed.
        cx.addElement(cx.elt('Frontmatter', start, cx.prevLineEnd(), marks))
        return true
      }
    }
  ]
}
