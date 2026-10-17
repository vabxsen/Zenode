import { Component, el } from '../component'
import type { MetadataCache } from '../index/metadataCache'
import { baseName, parentDir, stripExt } from '../paths'
import type { OpenPosition } from '../workspace'
import { matchNote, parseQuery, type Hit } from './query'

const MAX_NOTES = 200
const LINES_PER_NOTE = 6
const CONTEXT = 60

interface LineGroup {
  lineStart: number
  lineEnd: number
  hits: Hit[]
}

export class SearchPane extends Component {
  private readonly input: HTMLInputElement
  private readonly summaryEl: HTMLElement
  private readonly resultsEl: HTMLElement
  private timer: number | null = null
  private collapsed = new Set<string>()

  constructor(
    container: HTMLElement,
    private readonly cache: MetadataCache,
    private readonly onOpen: (path: string, pos?: OpenPosition) => void
  ) {
    super()
    const box = el('div', 'zn-search-box', container)
    this.input = el('input', 'zn-search-input', box)
    this.input.placeholder = 'Search notes...'
    this.input.spellcheck = false
    el('div', 'zn-search-help', box, 'Use "phrase", -exclude, /regex/, path:, file:, tag:')
    this.summaryEl = el('div', 'zn-search-summary', container)
    this.resultsEl = el('div', 'zn-search-results', container)
  }

  onload(): void {
    this.registerDomEvent(this.input, 'input', () => this.schedule())
    this.registerDomEvent(this.input, 'keydown', (e) => {
      if (e.key === 'Enter') this.run()
      if (e.key === 'Escape') {
        this.input.value = ''
        this.run()
      }
    })
    this.register(this.cache.onChange(() => this.schedule()))
  }

  focus(initial?: string): void {
    if (initial !== undefined) {
      this.input.value = initial
      this.run()
    }
    this.input.focus()
    this.input.select()
  }

  private schedule(): void {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.run(), 150)
  }

  private run(): void {
    this.resultsEl.empty()
    this.summaryEl.textContent = ''
    const query = this.input.value.trim()
    if (!query) return
    const { terms, error } = parseQuery(query)
    if (error) {
      this.summaryEl.textContent = error
      return
    }
    if (!terms.length) return

    const started = performance.now()
    let noteCount = 0
    let hitCount = 0
    const notes = this.cache.allNotes().sort((a, b) => a.path.localeCompare(b.path))
    for (const note of notes) {
      const tags = [...note.meta.tags.map((t) => t.tag), ...note.meta.frontmatterTags]
      const hits = matchNote(terms, { path: note.path, content: note.searchText, tags })
      if (!hits) continue
      noteCount++
      hitCount += hits.length
      if (noteCount <= MAX_NOTES) this.renderNote(note.path, note.searchText, hits)
    }
    const ms = Math.round(performance.now() - started)
    this.summaryEl.textContent = noteCount
      ? `${hitCount.toLocaleString()} matches in ${noteCount.toLocaleString()} notes · ${ms} ms`
      : 'No matches'
  }

  private renderNote(path: string, content: string, hits: Hit[]): void {
    const group = el('div', 'zn-search-note', this.resultsEl)
    const header = el('div', 'zn-search-note-header', group)
    el('span', 'zn-search-note-title', header, stripExt(baseName(path)))
    const folder = parentDir(path)
    if (folder) el('span', 'zn-search-note-folder', header, folder)
    if (hits.length) el('span', 'zn-search-note-count', header, String(hits.length))
    header.addEventListener('click', () => {
      if (!hits.length) return this.onOpen(path)
      if (this.collapsed.has(path)) this.collapsed.delete(path)
      else this.collapsed.add(path)
      lines.style.display = this.collapsed.has(path) ? 'none' : ''
    })
    header.addEventListener('dblclick', () => this.onOpen(path))

    const lines = el('div', 'zn-search-lines', group)
    if (this.collapsed.has(path)) lines.style.display = 'none'
    const groups = groupByLine(content, hits)
    for (const g of groups.slice(0, LINES_PER_NOTE)) {
      const row = el('div', 'zn-search-line', lines)
      renderSnippet(row, content, g)
      // Canvas hits point into the card text, not the file, so just open the canvas.
      const isCanvas = path.toLowerCase().endsWith('.canvas')
      row.addEventListener('click', () => this.onOpen(path, isCanvas ? undefined : { from: g.hits[0].start, to: g.hits[0].end }))
    }
    if (groups.length > LINES_PER_NOTE) {
      el('div', 'zn-search-more', lines, `+${groups.length - LINES_PER_NOTE} more lines`)
    }
    if (!hits.length) group.classList.add('is-name-only')
  }
}

function groupByLine(content: string, hits: Hit[]): LineGroup[] {
  const groups: LineGroup[] = []
  for (const hit of hits) {
    const last = groups[groups.length - 1]
    if (last && hit.start <= last.lineEnd) {
      last.hits.push(hit)
      continue
    }
    const lineStart = content.lastIndexOf('\n', hit.start - 1) + 1
    let lineEnd = content.indexOf('\n', hit.start)
    if (lineEnd === -1) lineEnd = content.length
    groups.push({ lineStart, lineEnd, hits: [hit] })
  }
  return groups
}

function renderSnippet(row: HTMLElement, content: string, g: LineGroup): void {
  const first = g.hits[0]
  const from = Math.max(g.lineStart, first.start - CONTEXT)
  const to = Math.min(g.lineEnd, Math.max(first.end + CONTEXT * 2, from + CONTEXT * 3))
  if (from > g.lineStart) row.appendChild(document.createTextNode('…'))
  let pos = from
  for (const hit of g.hits) {
    if (hit.start < pos || hit.start >= to) continue
    row.appendChild(document.createTextNode(content.slice(pos, hit.start)))
    const mark = document.createElement('mark')
    mark.textContent = content.slice(hit.start, Math.min(hit.end, to))
    row.appendChild(mark)
    pos = Math.min(hit.end, to)
  }
  row.appendChild(document.createTextNode(content.slice(pos, to)))
  if (to < g.lineEnd) row.appendChild(document.createTextNode('…'))
}
