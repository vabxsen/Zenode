import { Component, el } from './component'
import type { MetadataCache } from './index/metadataCache'
import { baseName, parentDir, stripExt } from './paths'
import type { OpenPosition } from './workspace'

const CONTEXT = 70

// Right-sidebar panel: notes that link to the active note, with the linking text.
export class BacklinksPanel extends Component {
  private target: string | null = null
  private readonly countEl: HTMLElement
  private readonly listEl: HTMLElement
  private timer: number | null = null

  constructor(
    container: HTMLElement,
    private readonly cache: MetadataCache,
    private readonly onOpen: (path: string, pos?: OpenPosition) => void
  ) {
    super()
    const header = el('div', 'zn-panel-header', container)
    el('span', 'zn-panel-title', header, 'Backlinks')
    this.countEl = el('span', 'zn-panel-count', header)
    this.listEl = el('div', 'zn-backlinks', container)
  }

  onload(): void {
    this.register(this.cache.onChange(() => this.renderSoon()))
    this.render()
  }

  setTarget(path: string | null): void {
    this.target = path
    this.render()
  }

  private renderSoon(): void {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.render(), 100)
  }

  private render(): void {
    this.listEl.empty()
    this.countEl.textContent = ''
    if (!this.target) {
      el('div', 'zn-panel-empty', this.listEl, 'Open a note to see what links to it.')
      return
    }
    const backlinks = this.cache.getBacklinks(this.target)
    const total = backlinks.reduce((n, b) => n + b.refs.length, 0)
    this.countEl.textContent = total ? String(total) : ''
    if (!backlinks.length) {
      el('div', 'zn-panel-empty', this.listEl, 'No notes link here yet.')
      return
    }
    for (const { source, refs } of backlinks) {
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
  }
}
