// Bookmarks (files and searches, kept in .zenode/bookmarks.json) and the
// recently opened files.
import { Component, el } from '../component'
import { sanitizeBookmarks, type Bookmark } from '../config'
import { showMenu } from '../menu'
import { baseName, parentDir, stripExt } from '../paths'

const api = window.zenode

export interface BookmarksDeps {
  openFile(path: string): void
  search(query: string): void
  recent(): string[]
  notice(message: string): void
}

// Paths under `from` move to `to` (a renamed or moved file or folder).
function movedPath(path: string, from: string, to: string): string {
  return path === from ? to : path.startsWith(`${from}/`) ? to + path.slice(from.length) : path
}

export class BookmarksPanel extends Component {
  private items: Bookmark[] = []
  private readonly listEl: HTMLElement
  private readonly recentEl: HTMLElement

  constructor(
    container: HTMLElement,
    private readonly d: BookmarksDeps
  ) {
    super()
    const header = el('div', 'zn-panel-header', container)
    el('span', 'zn-panel-title', header, 'Bookmarks')
    this.listEl = el('div', 'zn-bookmarks', container)
    const recentHeader = el('div', 'zn-panel-header', container)
    el('span', 'zn-panel-title', recentHeader, 'Recent files')
    this.recentEl = el('div', 'zn-recent-files', container)
  }

  async load(): Promise<void> {
    this.items = sanitizeBookmarks(await api.readConfig('bookmarks').catch(() => null))
    this.render()
  }

  isBookmarked(path: string): boolean {
    return this.items.some((b) => b.type === 'file' && b.path === path)
  }

  // Adds or removes a file bookmark.
  toggle(path: string): void {
    const had = this.isBookmarked(path)
    this.items = had ? this.items.filter((b) => !(b.type === 'file' && b.path === path)) : [...this.items, { type: 'file', path }]
    this.d.notice(had ? `Removed "${stripExt(baseName(path))}" from bookmarks.` : `Bookmarked "${stripExt(baseName(path))}".`)
    this.save()
  }

  addSearch(query: string): void {
    if (this.items.some((b) => b.type === 'search' && b.query === query)) return
    this.items = [...this.items, { type: 'search', query }]
    this.save()
  }

  // Keep bookmarks pointing at files that were renamed or moved.
  renamed(from: string, to: string): void {
    let changed = false
    this.items = this.items.map((b) => {
      if (b.type !== 'file') return b
      const path = movedPath(b.path, from, to)
      if (path !== b.path) changed = true
      return { ...b, path }
    })
    if (changed) this.save()
    else this.renderRecent()
  }

  removed(path: string): void {
    const before = this.items.length
    this.items = this.items.filter((b) => !(b.type === 'file' && (b.path === path || b.path.startsWith(`${path}/`))))
    if (this.items.length !== before) this.save()
  }

  renderRecent(): void {
    this.recentEl.replaceChildren()
    const recent = this.d.recent().slice(0, 15)
    if (!recent.length) {
      el('div', 'zn-panel-empty', this.recentEl, 'Files you open appear here.')
      return
    }
    for (const path of recent) this.fileRow(this.recentEl, path)
  }

  private save(): void {
    this.render()
    api.writeConfig('bookmarks', { items: this.items }).catch((e: Error) => this.d.notice(`Could not save bookmarks: ${e.message}`))
  }

  private render(): void {
    this.listEl.replaceChildren()
    if (!this.items.length) {
      el('div', 'zn-panel-empty', this.listEl, 'No bookmarks. Use "Bookmark current file" or right-click a file.')
    }
    this.items.forEach((b, i) => {
      const row = b.type === 'file' ? this.fileRow(this.listEl, b.path) : this.searchRow(b.query)
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        showMenu(e.clientX, e.clientY, [
          ...(i > 0 ? [{ label: 'Move up', action: () => this.reorder(i, -1) }] : []),
          ...(i < this.items.length - 1 ? [{ label: 'Move down', action: () => this.reorder(i, 1) }] : []),
          { label: 'Remove bookmark', danger: true, action: () => this.removeAt(i) }
        ])
      })
    })
    this.renderRecent()
  }

  private fileRow(parent: HTMLElement, path: string): HTMLElement {
    const row = el('div', 'zn-bookmark-item', parent)
    el('span', 'zn-bookmark-name', row, stripExt(baseName(path)))
    const folder = parentDir(path)
    if (folder) el('span', 'zn-bookmark-folder', row, folder)
    row.title = path
    row.addEventListener('click', () => this.d.openFile(path))
    return row
  }

  private searchRow(query: string): HTMLElement {
    const row = el('div', 'zn-bookmark-item is-search', this.listEl)
    el('span', 'zn-bookmark-name', row, query)
    el('span', 'zn-bookmark-folder', row, 'search')
    row.addEventListener('click', () => this.d.search(query))
    return row
  }

  private reorder(i: number, step: 1 | -1): void {
    const items = [...this.items]
    ;[items[i], items[i + step]] = [items[i + step], items[i]]
    this.items = items
    this.save()
  }

  private removeAt(i: number): void {
    this.items = this.items.filter((_, j) => j !== i)
    this.save()
  }
}
