// Extracts the link graph and outline from a note. Pure and dependency-free
// so it can run inside the indexer worker.

export interface LinkRef {
  // Target path as written, without subpath or alias ("Folder/Note").
  link: string
  // "#Heading" or "#^block", or "" when absent.
  subpath: string
  // Text shown instead of the target, if any.
  alias: string
  // The full source text, e.g. "[[Note#Heading|alias]]".
  original: string
  embed: boolean
  kind: 'wiki' | 'markdown' | 'canvas'
  start: number
  end: number
  line: number
  // Set for links found inside a canvas: the card they belong to and a line of its text.
  canvasNode?: string
  context?: string
}

export interface Heading {
  text: string
  level: number
  line: number
}

export interface TagRef {
  tag: string
  line: number
  start: number
  end: number
}

export interface NoteMeta {
  links: LinkRef[]
  headings: Heading[]
  tags: TagRef[]
  frontmatterTags: string[]
  aliases: string[]
}

const WIKI = /(!?)\[\[([^[\]\n]+?)\]\]/g
const MDLINK = /(!?)\[([^\]\n]*)\]\(([^)\n]+)\)/g
const TAG = /(^|[\s(,;])#([\p{L}\p{N}_\-/]+)/gu
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

export function splitLinktext(inner: string): { link: string; subpath: string; alias: string } {
  const pipe = inner.indexOf('|')
  const target = pipe === -1 ? inner : inner.slice(0, pipe)
  const alias = pipe === -1 ? '' : inner.slice(pipe + 1).trim()
  const hash = target.indexOf('#')
  return {
    link: (hash === -1 ? target : target.slice(0, hash)).trim(),
    subpath: hash === -1 ? '' : target.slice(hash).trim(),
    alias
  }
}

function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  return starts
}

function lineAt(starts: number[], offset: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}

// Replace everything that must not be scanned (front matter, code) with spaces,
// keeping offsets identical to the original text.
function mask(text: string): { masked: string; frontmatter: string | null } {
  const chars = text.split('')
  let frontmatter: string | null = null
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to; i++) if (chars[i] !== '\n') chars[i] = ' '
  }

  if (text.startsWith('---\n') || text.startsWith('---\r\n')) {
    const close = /\n---[ \t]*(\r?\n|$)/g
    close.lastIndex = 3
    const m = close.exec(text)
    if (m) {
      frontmatter = text.slice(text.indexOf('\n') + 1, m.index)
      blank(0, m.index + m[0].length)
    }
  }

  // Fenced code blocks.
  const lines = text.split('\n')
  let offset = 0
  let fence: string | null = null
  let fenceStart = 0
  for (const line of lines) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fence === null && m) {
      fence = m[1][0].repeat(m[1].length)
      fenceStart = offset
    } else if (fence !== null && m && m[1][0] === fence[0] && m[1].length >= fence.length) {
      blank(fenceStart, offset + line.length)
      fence = null
    }
    offset += line.length + 1
  }
  if (fence !== null) blank(fenceStart, text.length)

  // Inline code spans.
  const partial = chars.join('')
  const code = /(`+)[^`\n][\s\S]*?\1/g
  let c: RegExpExecArray | null
  while ((c = code.exec(partial))) blank(c.index, c.index + c[0].length)

  return { masked: chars.join(''), frontmatter }
}

function yamlList(frontmatter: string, key: string): string[] {
  const out: string[] = []
  const lines = frontmatter.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = new RegExp(`^${key}\\s*:\\s*(.*)$`, 'i').exec(lines[i])
    if (!m) continue
    const inline = m[1].trim()
    if (inline.startsWith('[')) {
      out.push(...inline.replace(/^\[|\]$/g, '').split(','))
    } else if (inline) {
      out.push(...inline.split(','))
    } else {
      for (let j = i + 1; j < lines.length && /^\s*-\s+/.test(lines[j]); j++) {
        out.push(lines[j].replace(/^\s*-\s+/, ''))
      }
    }
  }
  return out.map((v) => v.trim().replace(/^["']|["']$/g, '').replace(/^#/, '')).filter(Boolean)
}

export function parseNote(text: string): NoteMeta {
  const { masked, frontmatter } = mask(text)
  const starts = lineStarts(text)
  const links: LinkRef[] = []
  const taken: Array<[number, number]> = []

  let m: RegExpExecArray | null
  WIKI.lastIndex = 0
  while ((m = WIKI.exec(masked))) {
    const parts = splitLinktext(m[2])
    if (!parts.link && !parts.subpath) continue
    links.push({
      ...parts,
      original: text.slice(m.index, m.index + m[0].length),
      embed: m[1] === '!',
      kind: 'wiki',
      start: m.index,
      end: m.index + m[0].length,
      line: lineAt(starts, m.index)
    })
    taken.push([m.index, m.index + m[0].length])
  }

  MDLINK.lastIndex = 0
  while ((m = MDLINK.exec(masked))) {
    const start = m.index
    if (taken.some(([a, b]) => start < b && start + m![0].length > a)) continue
    let target = m[3].trim().replace(/\s+"[^"]*"$/, '')
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1)
    if (!target || SCHEME.test(target)) continue
    let decoded = target
    try {
      decoded = decodeURI(target)
    } catch {
      // Keep the raw target if it isn't valid URI encoding.
    }
    const hash = decoded.indexOf('#')
    links.push({
      link: hash === -1 ? decoded : decoded.slice(0, hash),
      subpath: hash === -1 ? '' : decoded.slice(hash),
      alias: m[2],
      original: text.slice(start, start + m[0].length),
      embed: m[1] === '!',
      kind: 'markdown',
      start,
      end: start + m[0].length,
      line: lineAt(starts, start)
    })
    taken.push([start, start + m[0].length])
  }
  links.sort((a, b) => a.start - b.start)

  const headings: Heading[] = []
  const maskedLines = masked.split('\n')
  const textLines = text.split('\n')
  for (let i = 0; i < maskedLines.length; i++) {
    const h = HEADING.exec(maskedLines[i])
    if (h) {
      const clean = textLines[i].replace(/^#{1,6}[ \t]+/, '').replace(/[ \t]*#*[ \t]*\r?$/, '')
      headings.push({ level: h[1].length, text: clean, line: i })
    }
  }

  const tags: TagRef[] = []
  TAG.lastIndex = 0
  while ((m = TAG.exec(masked))) {
    const start = m.index + m[1].length
    const end = start + 1 + m[2].length
    if (taken.some(([a, b]) => start < b && end > a)) continue
    if (/^[\d/]+$/.test(m[2])) continue
    const lineNo = lineAt(starts, start)
    if (headings.some((h) => h.line === lineNo) && text.slice(starts[lineNo], start).trim() === '') continue
    tags.push({ tag: `#${m[2]}`, line: lineNo, start, end })
  }

  return {
    links,
    headings,
    tags,
    frontmatterTags: frontmatter ? yamlList(frontmatter, 'tags').map((t) => `#${t}`) : [],
    aliases: frontmatter ? yamlList(frontmatter, 'aliases') : []
  }
}
