// Search query language (a practical subset of Obsidian's):
//   word other        both words must appear (in the note or its name)
//   "exact phrase"    phrase match
//   -word             exclude notes containing the word
//   /regex/flags      regular expression on the note's text
//   path:x file:x     filter by folder path / file name
//   tag:#x            notes with tag #x (or a nested #x/child)

export type TermKind = 'text' | 'regex' | 'path' | 'file' | 'tag'

export interface Term {
  kind: TermKind
  value: string
  negate: boolean
  regex?: RegExp
}

export interface Hit {
  start: number
  end: number
}

export function parseQuery(input: string): { terms: Term[]; error?: string } {
  const terms: Term[] = []
  let i = 0
  const s = input
  const readQuotedOrWord = (): string => {
    if (s[i] === '"') {
      const end = s.indexOf('"', i + 1)
      const value = s.slice(i + 1, end === -1 ? s.length : end)
      i = end === -1 ? s.length : end + 1
      return value
    }
    const start = i
    while (i < s.length && !/\s/.test(s[i])) i++
    return s.slice(start, i)
  }
  while (i < s.length) {
    if (/\s/.test(s[i])) {
      i++
      continue
    }
    let negate = false
    if (s[i] === '-' && i + 1 < s.length && !/\s/.test(s[i + 1])) {
      negate = true
      i++
    }
    const op = /^(path|file|tag):/i.exec(s.slice(i))
    if (op) {
      i += op[0].length
      const value = readQuotedOrWord()
      if (value) terms.push({ kind: op[1].toLowerCase() as TermKind, value, negate })
      continue
    }
    if (s[i] === '/') {
      let j = i + 1
      while (j < s.length && (s[j] !== '/' || s[j - 1] === '\\')) j++
      if (j < s.length) {
        const pattern = s.slice(i + 1, j)
        const flagsMatch = /^[a-z]*/i.exec(s.slice(j + 1))!
        i = j + 1 + flagsMatch[0].length
        try {
          const flags = new Set(['g', 'm', ...flagsMatch[0].replace(/[gm]/g, '')])
          terms.push({ kind: 'regex', value: pattern, negate, regex: new RegExp(pattern, [...flags].join('')) })
        } catch (e) {
          return { terms, error: `Invalid regular expression: ${(e as Error).message}` }
        }
        continue
      }
    }
    const value = readQuotedOrWord()
    if (value) terms.push({ kind: 'text', value, negate })
  }
  return { terms }
}

function findAll(haystack: string, needle: string, limit: number): Hit[] {
  const hits: Hit[] = []
  if (!needle) return hits
  let from = 0
  while (hits.length < limit) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) break
    hits.push({ start: at, end: at + needle.length })
    from = at + needle.length
  }
  return hits
}

function regexHits(re: RegExp, text: string, limit: number): Hit[] {
  const hits: Hit[] = []
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while (hits.length < limit && (m = re.exec(text))) {
    if (m[0] === '') {
      re.lastIndex++
      continue
    }
    hits.push({ start: m.index, end: m.index + m[0].length })
  }
  return hits
}

export interface SearchableNote {
  path: string
  content: string
  tags: string[]
}

const HIT_LIMIT = 200

// Returns the content hits if the note matches every term, or null if it doesn't.
export function matchNote(terms: Term[], note: SearchableNote, lowerContent = note.content.toLowerCase()): Hit[] | null {
  const lowerPath = note.path.toLowerCase()
  const fileName = lowerPath.slice(lowerPath.lastIndexOf('/') + 1).replace(/\.md$/, '')
  const hits: Hit[] = []
  for (const term of terms) {
    let matched: boolean
    let termHits: Hit[] = []
    const v = term.value.toLowerCase()
    switch (term.kind) {
      case 'path':
        matched = lowerPath.includes(v)
        break
      case 'file':
        matched = fileName.includes(v)
        break
      case 'tag': {
        const tag = v.startsWith('#') ? v : `#${v}`
        matched = note.tags.some((t) => {
          const lt = t.toLowerCase()
          return lt === tag || lt.startsWith(`${tag}/`)
        })
        break
      }
      case 'regex':
        termHits = regexHits(term.regex!, note.content, HIT_LIMIT)
        matched = termHits.length > 0
        break
      default:
        termHits = findAll(lowerContent, v, HIT_LIMIT)
        matched = termHits.length > 0 || fileName.includes(v)
    }
    if (matched === term.negate) return null
    if (!term.negate) hits.push(...termHits)
  }
  return hits.sort((a, b) => a.start - b.start).slice(0, HIT_LIMIT)
}
