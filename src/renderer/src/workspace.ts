import { EditorSelection, type EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { WorkspaceState } from '../../shared/api'
import { Component, el } from './component'
import { createEditorState, fromDisk } from './editor/editor'
import type { LinkTarget } from './editor/linkCompletion'
import { linksChanged } from './editor/livePreview'
import { icon } from './icons'

const SAVE_DELAY = 600

interface Tab {
  path: string
  state: EditorState
  lastSaved: string
  dirty: boolean
  timer: number | null
}

export interface OpenPosition {
  from: number
  to?: number
}

export interface WorkspaceHost {
  onActiveChange(path: string | null): void
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
  private readonly emptyEl: HTMLElement
  private statsTimer: number | null = null

  constructor(
    container: HTMLElement,
    private readonly host: WorkspaceHost
  ) {
    super()
    this.tabbarEl = el('div', 'zn-tabbar', container)
    this.editorEl = el('div', 'zn-editor', container)
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

  get activePath(): string | null {
    return this.active?.path ?? null
  }

  focus(): void {
    if (this.active) this.view.focus()
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
    const tab: Tab = { path, state: null as unknown as EditorState, lastSaved: content, dirty: false, timer: null }
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
    if (this.active) this.view.dispatch({ effects: linksChanged.of(null) })
  }

  isOpen(path: string): boolean {
    return this.tabs.some((t) => t.path === path)
  }

  private activate(tab: Tab): void {
    if (this.active && this.active !== tab) this.active.state = this.view.state
    this.active = tab
    this.view.setState(tab.state)
    this.render()
    this.updateStats()
    this.host.onActiveChange(tab.path)
    this.host.onLayoutChange()
    requestAnimationFrame(() => this.view.focus())
  }

  async close(tab: Tab | null = this.active): Promise<void> {
    if (!tab) return
    await this.save(tab)
    this.dispose(tab)
  }

  private dispose(tab: Tab): void {
    if (tab.timer !== null) window.clearTimeout(tab.timer)
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
      this.host.onActiveChange(null)
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
    return (tab === this.active ? this.view.state : tab.state).doc.toString()
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
      if (tab.path === from) tab.path = to
      else if (tab.path.startsWith(`${from}/`)) tab.path = to + tab.path.slice(from.length)
    }
    this.render()
    if (this.active) this.host.onActiveChange(this.active.path)
    this.host.onLayoutChange()
  }

  // A file or folder was deleted: close its tabs without saving.
  removed(path: string): void {
    for (const tab of this.tabs.slice()) {
      if (tab.path === path || tab.path.startsWith(`${path}/`)) this.dispose(tab)
    }
  }

  // Pick up edits made outside Zenode, unless the user has unsaved changes.
  async reloadChanged(paths: string[]): Promise<void> {
    const changed = new Set(paths)
    for (const tab of this.tabs.slice()) {
      if (!changed.has(tab.path) || tab.dirty) continue
      let content: string
      try {
        content = await window.zenode.read(tab.path)
      } catch {
        this.dispose(tab)
        continue
      }
      if (content === tab.lastSaved) continue
      tab.lastSaved = content
      const state = tab === this.active ? this.view.state : tab.state
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
      const text = this.active ? this.view.state.doc.toString() : ''
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
      el('span', 'zn-tab-title', tabEl, noteTitle(tab.path))
      tabEl.title = tab.path
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
    const hasTab = this.active !== null
    this.editorEl.style.display = hasTab ? '' : 'none'
    this.emptyEl.style.display = hasTab ? 'none' : ''
    this.tabbarEl.classList.toggle('is-empty', this.tabs.length === 0)
  }
}
