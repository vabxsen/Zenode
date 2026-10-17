export interface FuzzyMatch {
  score: number
  // Indices into the text that matched, for highlighting.
  indices: number[]
}

const WORD_BREAK = /[\s/\-_.()[\]]/

// Subsequence match: every query character must appear in order.
// Rewards consecutive runs, word starts and an early first match.
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (!q) return { score: 0, indices: [] }
  // Jumping ahead to word starts can strand later characters; fall back to plain greedy.
  return scan(q, text, true) ?? scan(q, text, false)
}

function scan(q: string, text: string, preferWordStarts: boolean): FuzzyMatch | null {
  const t = text.toLowerCase()
  const indices: number[] = []
  let score = 0
  let ti = 0
  let prev = -2
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    // Prefer the next occurrence that starts a word over a plain hit, unless the plain hit continues a run.
    let found = -1
    for (let i = ti; i < t.length; i++) {
      if (t[i] !== ch) continue
      if (found === -1) found = i
      if (!preferWordStarts) break
      const wordStart = i === 0 || WORD_BREAK.test(t[i - 1])
      if (wordStart && i !== prev + 1) {
        found = i
        break
      }
      if (i === prev + 1) break
    }
    if (found === -1) return null
    const wordStart = found === 0 || WORD_BREAK.test(t[found - 1])
    if (found === prev + 1) score += 6
    if (wordStart) score += 8
    if (found === 0) score += 10
    score -= Math.min(found - ti, 6) * 0.5
    indices.push(found)
    prev = found
    ti = found + 1
  }
  // Shorter texts with the same matches rank higher.
  score -= text.length * 0.05
  return { score, indices }
}

export function highlight(el: HTMLElement, text: string, indices: number[]): void {
  const set = new Set(indices)
  let run = ''
  let inMatch = false
  const flush = (): void => {
    if (!run) return
    if (inMatch) {
      const mark = document.createElement('mark')
      mark.textContent = run
      el.appendChild(mark)
    } else {
      el.appendChild(document.createTextNode(run))
    }
    run = ''
  }
  for (let i = 0; i < text.length; i++) {
    const m = set.has(i)
    if (m !== inMatch) {
      flush()
      inMatch = m
    }
    run += text[i]
  }
  flush()
}
