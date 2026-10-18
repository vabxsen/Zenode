// Outgoing links: what the active note links to, and links to notes that don't exist yet.
import { Component, el } from '../component'
import type { MetadataCache } from '../index/metadataCache'
import { baseName, parentDir, stripExt } from '../paths'

const REFRESH_DELAY = 150

export class OutgoingPanel extends Component {
  private target: string | null = null
  private timer: number | null = null
  private readonly listEl: HTMLElement
  private readonly countEl: HTMLElement

  constructor(
    container: HTMLElement,
    private readonly cache: MetadataCache,
    private readonly onOpen: (path: string) => void,
    // A missing note's link was clicked: create it.
    private readonly onCreate: (link: string) => void
  ) {
    super()
    const header = el('div', 'zn-panel-header', container)
    el('span', 'zn-panel-title', header, 'Outgoing links')
    this.countEl = el('span', 'zn-panel-count', header)
    this.listEl = el('div', 'zn-outgoing', container)
  }

  onload(): void {
    this.register(this.cache.onChange(() => this.renderSoon()))
    this.register(() => {
      if (this.timer !== null) window.clearTimeout(this.timer)
    })
    this.render()
  }

  setTarget(path: string | null): void {
    this.target = path
    this.render()
  }

  private renderSoon(): void {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.render(), REFRESH_DELAY)
  }

  private render(): void {
    this.listEl.replaceChildren()
    this.countEl.textContent = ''
    const path = this.target
    const note = path ? this.cache.getNote(path) : undefined
    if (!path || !note) {
      el('div', 'zn-panel-empty', this.listEl, 'Open a note to see what it links to.')
      return
    }
    const resolved = new Map<string, number>()
    const missing = new Map<string, number>()
    for (const l of note.meta.links) {
      if (!l.link) continue
      const target = this.cache.resolve(l.link, path)
      if (target) resolved.set(target, (resolved.get(target) ?? 0) + 1)
      else missing.set(l.link, (missing.get(l.link) ?? 0) + 1)
    }
    this.countEl.textContent = resolved.size + missing.size ? String(resolved.size + missing.size) : ''
    if (!resolved.size && !missing.size) {
      el('div', 'zn-panel-empty', this.listEl, 'This note has no links.')
      return
    }
    for (const [target, count] of [...resolved].sort((a, b) => a[0].localeCompare(b[0]))) {
      const row = el('div', 'zn-outgoing-item', this.listEl)
      el('span', 'zn-outgoing-name', row, stripExt(baseName(target)))
      const folder = parentDir(target)
      if (folder) el('span', 'zn-outgoing-folder', row, folder)
      if (count > 1) el('span', 'zn-outgoing-count', row, String(count))
      row.title = target
      row.addEventListener('click', () => this.onOpen(target))
    }
    if (missing.size) {
      el('div', 'zn-panel-subhead', this.listEl, 'Not created yet')
      for (const [link] of [...missing].sort((a, b) => a[0].localeCompare(b[0]))) {
        const row = el('div', 'zn-outgoing-item is-unresolved', this.listEl)
        el('span', 'zn-outgoing-name', row, link)
        row.title = `Create "${link}"`
        row.addEventListener('click', () => this.onCreate(link))
      }
    }
  }
}
