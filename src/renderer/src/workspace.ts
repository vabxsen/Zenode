import { EditorSelection, type EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { WorkspaceState } from '../../shared/api'
import { Component, el } from './component'
import { createEditorState, fromDisk } from './editor/editor'
import type { LinkTarget } from './editor/linkCompletion'
import { linksChanged } from './editor/livePreview'
import { icon } from './icons'

const SAVE_DELAY = 600

// A non-note tab (e.g. the graph). The workspace mounts `el` and shows/hides it.
export interface WorkspaceView {
  readonly id: string
  readonly title: string
  readonly el: HTMLElement
  show(): void
  hide(): void
  destroy(): void
  // File-backed views (e.g. a canvas) follow renames, save and reload like notes.
  readonly filePath?: string
  setPath?(path: string): void
  save?(): Promise<void>
  reloadFromDisk?(): Promise<void>
  // The file was deleted: close without writing it back.
  discard?(): void
}

interface Tab {
  path: string
  kind: 'note' | 'view'
  state: EditorState | null
  view: WorkspaceView | null
  lastSaved: string
  dirty: boolean
  timer: number | null
}

export const VIEW_PREFIX = 'zenode:'

export interface OpenPosition {
  from: number
  to?: number
}

export interface WorkspaceHost {
  // `path` is the active note (null for view tabs); `title` is what the tab shows.
  onActiveChange(path: string | null, title: string): void
  onOpenLink(href: string, fromPath: string): void
  onOpenWikiLink(target: string, fromPath: string): void
  onOpenTag(tag: string): void
  isResolved(link: string, fromPath: string): boolean
  linkTargets(fromPath: string): LinkTarget[]
  onSaved(path: string, content: string): void
  onStats(words: number, chars: number): void
  onLayoutChange(): void
  onError(message: string): void
}

export function noteTitle(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name
}

export class Workspace extends Component {
  private tabs: Tab[] = []
  private active: Tab | null = null
  private readonly view: EditorView
  private readonly tabbarEl: HTMLElement
  private readonly editorEl: HTMLElement
  private readonly viewsEl: HTMLElement
  private readonly emptyEl: HTMLElement
  private statsTimer: number | null = null

  constructor(
    container: HTMLElement,
    private readonly host: WorkspaceHost
  ) {
    super()
    this.tabbarEl = el('div', 'zn-tabbar', container)
    this.editorEl = el('div', 'zn-editor', container)
    this.viewsEl = el('div', 'zn-views', container)
    this.emptyEl = el('div', 'zn-empty', container)
    const inner = el('div', 'zn-empty-inner', this.emptyEl)
    inner.appendChild(icon('note', 40))
    el('div', 'zn-empty-title', inner, 'No note open')
    el('div', 'zn-empty-hint', inner, 'Pick a note on the left, or press Ctrl+N to start a new one.')
    this.view = new EditorView({ parent: this.editorEl })
    this.render()
  }

  onunload(): void {
    this.view.destroy()
  }

  // The active note's path (null when a view tab or nothing is active).
  get activePath(): string | null {
    // Notes and file-backed views (canvases) count as the active file; the graph does not.
    if (this.active?.kind === 'note') return this.active.path
    return this.active?.view?.filePath ?? null
  }

  focus(): void {
    if (this.active?.kind === 'note') this.view.focus()
  }

  openView(view: WorkspaceView): void {
    const existing = this.tabs.find((t) => t.path === view.id)
    if (existing) {
      view.destroy()
      this.activate(existing)
      return
    }
    this.viewsEl.appendChild(view.el)
    view.hide()
    const tab: Tab = { path: view.id, kind: 'view', state: null, view, lastSaved: '', dirty: false, timer: null }
    const at = this.active ? this.tabs.indexOf(this.active) + 1 : this.tabs.length
    this.tabs.splice(at, 0, tab)
    this.activate(tab)
  }

  // Switch to an open tab by its path or view id. Returns false if none is open.
  activateById(id: string): boolean {
    const tab = this.tabs.find((t) => t.path === id)
    if (tab) this.activate(tab)
    return !!tab
  }

  hasView(id: string): boolean {
    return this.tabs.some((t) => t.path === id)
  }

  async open(path: string, pos?: OpenPosition): Promise<void> {
    const existing = this.tabs.find((t) => t.path === path)
    if (existing) {
      this.activate(existing)
      if (pos) this.reveal(pos)
      return
    }
    let content: string
    try {
      content = await window.zenode.read(path)
    } catch (e) {
      this.host.onError(`Could not open ${path}: ${(e as Error).message}`)
      return
    }
    const tab: Tab = { path, kind: 'note', state: null, view: null, lastSaved: content, dirty: false, timer: null }
    tab.state = createEditorState(content, {
      onChange: () => this.onEdited(tab),
      onOpenLink: (href) => this.host.onOpenLink(href, tab.path),
      onOpenWikiLink: (target) => this.host.onOpenWikiLink(target, tab.path),
      onOpenTag: (tag) => this.host.onOpenTag(tag),
      isResolved: (link) => this.host.isResolved(link, tab.path),
      linkTargets: () => this.host.linkTargets(tab.path)
    })
    const at = this.active ? this.tabs.indexOf(this.active) + 1 : this.tabs.length
    this.tabs.splice(at, 0, tab)
    this.activate(tab)
    if (pos) this.reveal(pos)
  }

  // Select a range in the active note and scroll it to the middle of the view.
  private reveal(pos: OpenPosition): void {
    if (this.active?.kind !== 'note') return
    const len = this.view.state.doc.length
    const from = Math.min(pos.from, len)
    const to = Math.min(pos.to ?? pos.from, len)
    this.view.dispatch({
      selection: EditorSelection.range(from, to),
      effects: EditorView.scrollIntoView(from, { y: 'center' })
    })
    requestAnimationFrame(() => this.view.focus())
  }

  // Re-run link styling after the vault's links changed (e.g. a missing note was created).
  refreshLinks(): void {
    if (this.active?.kind === 'note') this.view.dispatch({ effects: linksChanged.of(null) })
  }

  isOpen(path: string): boolean {
    return this.tabs.some((t) => t.path === path)
  }

  private activate(tab: Tab): void {
    const prev = this.active
    if (prev && prev !== tab) {
      if (prev.kind === 'note') prev.state = this.view.state
      else prev.view?.hide()
    }
    this.active = tab
    if (tab.kind === 'note') this.view.setState(tab.state!)
    this.render()
    if (tab.kind === 'view') tab.view!.show()
    this.updateStats()
    this.host.onActiveChange(this.activePath, this.titleOf(tab))
    this.host.onLayoutChange()
    if (tab.kind === 'note') requestAnimationFrame(() => this.view.focus())
  }

  private titleOf(tab: Tab): string {
    return tab.view ? tab.view.title : noteTitle(tab.path)
  }

  async close(tab: Tab | null = this.active): Promise<void> {
    if (!tab) return
    await this.save(tab)
    this.dispose(tab)
  }

  private dispose(tab: Tab): void {
    if (tab.timer !== null) window.clearTimeout(tab.timer)
    tab.view?.destroy()
    const i = this.tabs.indexOf(tab)
    if (i === -1) return
    this.tabs.splice(i, 1)
    if (this.active === tab) {
      this.active = null
      const next = this.tabs[Math.min(i, this.tabs.length - 1)]
      if (next) {
        this.activate(next)
        return
      }
      this.host.onActiveChange(null, '')
      this.host.onStats(0, 0)
    }
    this.render()
    this.host.onLayoutChange()
  }

  cycle(delta: number): void {
    if (this.tabs.length < 2 || !this.active) return
    const i = this.tabs.indexOf(this.active)
    this.activate(this.tabs[(i + delta + this.tabs.length) % this.tabs.length])
  }

  private docOf(tab: Tab): string {
    return (tab === this.active ? this.view.state : tab.state!).doc.toString()
  }

  private onEdited(tab: Tab): void {
    if (!tab.dirty) {
      tab.dirty = true
      this.render()
    }
    if (tab.timer !== null) window.clearTimeout(tab.timer)
    tab.timer = window.setTimeout(() => void this.save(tab), SAVE_DELAY)
    if (tab === this.active) this.updateStats()
  }

  async save(tab: Tab | null = this.active): Promise<void> {
    if (!tab) return
    if (tab.kind === 'view') {
      await tab.view?.save?.()
      return
    }
    if (tab.timer !== null) {
      window.clearTimeout(tab.timer)
      tab.timer = null
    }
    const content = this.docOf(tab)
    if (content === tab.lastSaved) {
      if (tab.dirty) {
        tab.dirty = false
        this.render()
      }
      return
    }
    try {
      await window.zenode.write(tab.path, content)
      tab.lastSaved = content
      this.host.onSaved(tab.path, content)
      if (this.docOf(tab) === content) tab.dirty = false
      this.render()
    } catch (e) {
      this.host.onError(`Could not save ${tab.path}: ${(e as Error).message}`)
    }
  }

  async saveAll(): Promise<void> {
    await Promise.all(this.tabs.map((t) => this.save(t)))
  }

  async closeAll(): Promise<void> {
    await this.saveAll()
    for (const tab of this.tabs.slice()) this.dispose(tab)
  }

  // A file or folder was renamed: retarget every tab under it.
  renamed(from: string, to: string): void {
    for (const tab of this.tabs) {
      if (tab.kind === 'view' && tab.view?.filePath === undefined) continue
      let next: string | null = null
      if (tab.path === from) next = to
      else if (tab.path.startsWith(`${from}/`)) next = to + tab.path.slice(from.length)
      if (next === null) continue
      tab.path = next
      tab.view?.setPath?.(next)
    }
    this.render()
    if (this.active) this.host.onActiveChange(this.activePath, this.titleOf(this.active))
    this.host.onLayoutChange()
  }

  // A file or folder was deleted: close its tabs without saving.
  removed(path: string): void {
    for (const tab of this.tabs.slice()) {
      if (tab.kind === 'view' && tab.view?.filePath === undefined) continue
      if (tab.path === path || tab.path.startsWith(`${path}/`)) {
        tab.view?.discard?.()
        this.dispose(tab)
      }
    }
  }

  // Pick up edits made outside Zenode, unless the user has unsaved changes.
  async reloadChanged(paths: string[]): Promise<void> {
    const changed = new Set(paths)
    for (const tab of this.tabs.slice()) {
      if (tab.kind === 'view') {
        if (tab.view?.filePath !== undefined && changed.has(tab.path)) await tab.view.reloadFromDisk?.()
        continue
      }
      if (tab.kind !== 'note' || !changed.has(tab.path) || tab.dirty) continue
      let content: string
      try {
        content = await window.zenode.read(tab.path)
      } catch {
        this.dispose(tab)
        continue
      }
      if (content === tab.lastSaved) continue
      tab.lastSaved = content
      const state = tab === this.active ? this.view.state : tab.state!
      const spec = { changes: { from: 0, to: state.doc.length, insert: content }, annotations: fromDisk.of(true) }
      if (tab === this.active) {
        this.view.dispatch(spec)
        this.updateStats()
      } else {
        tab.state = state.update(spec).state
      }
    }
  }

  serialize(): WorkspaceState {
    return { openFiles: this.tabs.map((t) => t.path), activeFile: this.active?.path ?? null }
  }

  private updateStats(): void {
    if (this.statsTimer !== null) window.clearTimeout(this.statsTimer)
    this.statsTimer = window.setTimeout(() => {
      const text = this.active?.kind === 'note' ? this.view.state.doc.toString() : ''
      const words = text.trim() ? text.trim().split(/\s+/).length : 0
      this.host.onStats(words, text.length)
    }, 150)
  }

  private render(): void {
    this.tabbarEl.empty()
    for (const tab of this.tabs) {
      const tabEl = el('div', 'zn-tab', this.tabbarEl)
      if (tab === this.active) tabEl.classList.add('is-active')
      if (tab.dirty) tabEl.classList.add('is-dirty')
      if (tab.kind === 'view') tabEl.classList.add('is-view')
      el('span', 'zn-tab-title', tabEl, this.titleOf(tab))
      tabEl.title = tab.kind === 'view' ? this.titleOf(tab) : tab.path
      const closeBtn = el('span', 'zn-tab-close', tabEl)
      closeBtn.appendChild(icon('close', 12))
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        void this.close(tab)
      })
      tabEl.addEventListener('mousedown', (e) => {
        if (e.button === 1) {
          e.preventDefault()
          void this.close(tab)
        }
      })
      tabEl.addEventListener('click', () => this.activate(tab))
    }
    const kind = this.active?.kind
    this.editorEl.style.display = kind === 'note' ? '' : 'none'
    this.viewsEl.style.display = kind === 'view' ? '' : 'none'
    this.emptyEl.style.display = kind ? 'none' : ''
    this.tabbarEl.classList.toggle('is-empty', this.tabs.length === 0)
  }
}
