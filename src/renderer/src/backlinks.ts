import { Component, el } from './component'
import type { MetadataCache } from './index/metadataCache'
import { findUnlinkedMentions, type Mention } from './panels/mentions'
import { baseName, parentDir, stripExt } from './paths'
import type { OpenPosition } from './workspace'

// Linking notes drawn at a time.
const PAGE = 100
const CONTEXT = 70

// Right-sidebar panel: notes that link to the active note, with the linking text.
export class BacklinksPanel extends Component {
  private target: string | null = null
  private readonly countEl: HTMLElement
  private readonly listEl: HTMLElement
  private readonly mentionsEl: HTMLElement
  // Unlinked mentions are only searched for while their section is open.
  private mentionsOpen = false
  // The note the shown mentions were found for (they're found again only on request).
  private mentionsFor: string | null = null
  // Notes the shown mentions are in: a change to one of them finds mentions again.
  private mentionSources = new Set<string>()
  // Notes linking to the target when last drawn, and how many of them are shown.
  private sources = new Set<string>()
  private shown = PAGE
  private timer: number | null = null

  constructor(
    container: HTMLElement,
    private readonly cache: MetadataCache,
    private readonly onOpen: (path: string, pos?: OpenPosition) => void,
    // Turn a mention into a link to the target note.
    private readonly onLinkMention: (mention: Mention, target: string) => Promise<void>
  ) {
    super()
    const header = el('div', 'zn-panel-header', container)
    el('span', 'zn-panel-title', header, 'Backlinks')
    this.countEl = el('span', 'zn-panel-count', header)
    this.listEl = el('div', 'zn-backlinks', container)
    this.mentionsEl = el('div', 'zn-mentions', container)
  }

  onload(): void {
    this.register(
      this.cache.onChange((path) => {
        // Only changes that can affect this note's backlinks redraw them.
        const t = this.target
        if (path === null || path === t || this.sources.has(path) || (t && this.cache.resolvedLinks[path]?.[t])) this.renderSoon()
        if (path !== null && this.mentionsOpen && this.mentionSources.has(path)) {
          this.mentionsFor = null
          this.renderSoon()
        }
      })
    )
    this.refresh()
  }

  setTarget(path: string | null): void {
    if (path !== this.target) this.shown = PAGE
    this.target = path
    this.refresh()
  }

  private renderSoon(): void {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.refresh(), 100)
  }

  private refresh(): void {
    this.render()
    // Mentions need a scan of the whole vault: only when the note changes or on request.
    if (this.mentionsFor !== this.target) this.renderMentions()
  }

  private renderMentions(): void {
    this.mentionsEl.replaceChildren()
    const target = this.target
    this.mentionsFor = target
    this.mentionSources.clear()
    if (!target || !target.toLowerCase().endsWith('.md')) return
    const head = el('div', 'zn-mentions-head', this.mentionsEl)
    const toggle = el('button', 'zn-mentions-toggle', head, `${this.mentionsOpen ? '▾' : '▸'} Unlinked mentions`)
    toggle.setAttribute('aria-expanded', String(this.mentionsOpen))
    toggle.addEventListener('click', () => {
      this.mentionsOpen = !this.mentionsOpen
      this.renderMentions()
    })
    if (!this.mentionsOpen) return
    const again = el('button', 'zn-mentions-refresh', head, '↻')
    again.title = 'Look again'
    again.setAttribute('aria-label', 'Look for unlinked mentions again')
    again.addEventListener('click', () => this.renderMentions())
    const names = [stripExt(baseName(target)), ...(this.cache.getNote(target)?.meta.aliases ?? [])]
    const notes = this.cache
      .allNotes()
      .filter((n) => n.path.toLowerCase().endsWith('.md'))
      .map((n) => ({ path: n.path, content: n.content }))
    const mentions = findUnlinkedMentions(target, names, notes, (source) => !!this.cache.resolvedLinks[source]?.[target])
    if (!mentions.length) {
      el('div', 'zn-panel-empty', this.mentionsEl, 'No unlinked mentions.')
      return
    }
    for (const m of mentions) {
      this.mentionSources.add(m.source)
      const row = el('div', 'zn-mention', this.mentionsEl)
      const head = el('div', 'zn-mention-head', row)
      el('span', 'zn-backlink-title', head, stripExt(baseName(m.source)))
      const link = el('button', 'zn-btn zn-mention-link', head, 'Link')
      link.addEventListener('click', (e) => {
        e.stopPropagation()
        link.disabled = true
        void this.onLinkMention(m, target)
      })
      const line = el('div', 'zn-backlink-line', row)
      const at = m.line.toLowerCase().indexOf(m.text.toLowerCase())
      line.appendChild(document.createTextNode(m.line.slice(0, at)))
      el('mark', '', line, m.line.slice(at, at + m.text.length))
      line.appendChild(document.createTextNode(m.line.slice(at + m.text.length)))
      row.addEventListener('click', () => this.onOpen(m.source, { from: m.start, to: m.end }))
    }
  }

  private render(): void {
    this.listEl.empty()
    this.countEl.textContent = ''
    if (!this.target) {
      el('div', 'zn-panel-empty', this.listEl, 'Open a note to see what links to it.')
      return
    }
    const backlinks = this.cache.getBacklinks(this.target)
    this.sources = new Set(backlinks.map((b) => b.source))
    const total = backlinks.reduce((n, b) => n + b.refs.length, 0)
    this.countEl.textContent = total ? String(total) : ''
    if (!backlinks.length) {
      el('div', 'zn-panel-empty', this.listEl, 'No notes link here yet.')
      return
    }
    // A note many others link to shows them a page at a time.
    for (const { source, refs } of backlinks.slice(0, this.shown)) {
      const note = this.cache.getNote(source)
      if (!note) continue
      const group = el('div', 'zn-backlink-note', this.listEl)
      const header = el('div', 'zn-backlink-header', group)
      el('span', 'zn-backlink-title', header, stripExt(baseName(source)))
      const folder = parentDir(source)
      if (folder) el('span', 'zn-backlink-folder', header, folder)
      header.addEventListener('click', () => this.onOpen(source))
      for (const ref of refs) {
        const row = el('div', 'zn-backlink-line', group)
        if (ref.context !== undefined) {
          // A link from a canvas: show the card text it sits in.
          const at = ref.original ? ref.context.indexOf(ref.original) : -1
          if (at === -1) row.appendChild(document.createTextNode(ref.context))
          else {
            row.appendChild(document.createTextNode(ref.context.slice(0, at)))
            el('mark', '', row, ref.original)
            row.appendChild(document.createTextNode(ref.context.slice(at + ref.original.length)))
          }
          row.addEventListener('click', () => this.onOpen(source))
          continue
        }
        const content = note.content
        const lineStart = content.lastIndexOf('\n', ref.start - 1) + 1
        let lineEnd = content.indexOf('\n', ref.end)
        if (lineEnd === -1) lineEnd = content.length
        const from = Math.max(lineStart, ref.start - CONTEXT)
        const to = Math.min(lineEnd, ref.end + CONTEXT)
        if (from > lineStart) row.appendChild(document.createTextNode('…'))
        row.appendChild(document.createTextNode(content.slice(from, ref.start)))
        el('mark', '', row, content.slice(ref.start, ref.end))
        row.appendChild(document.createTextNode(content.slice(ref.end, to)))
        if (to < lineEnd) row.appendChild(document.createTextNode('…'))
        row.addEventListener('click', () => this.onOpen(source, { from: ref.start, to: ref.end }))
      }
    }
    const rest = backlinks.length - this.shown
    if (rest > 0) {
      const more = el('button', 'zn-btn zn-backlinks-more', this.listEl, `Show ${Math.min(rest, PAGE)} more of ${rest}`)
      more.addEventListener('click', () => {
        this.shown += PAGE
        this.render()
      })
    }
  }
}
