import type { TreeEntry } from '../../shared/api'
import { Component, el } from './component'
import { icon } from './icons'
import { showMenu } from './menu'
import { parentDir } from './paths'

export interface FileTreeHandlers {
  onOpen(entry: TreeEntry): void
  onNewNote(dir: string): void
  onNewFolder(dir: string): void
  onRename(entry: TreeEntry, newName: string): Promise<void>
  onDelete(entry: TreeEntry): void
  onReveal(path: string): void
}

const INDENT = 14

export { parentDir }

export function displayName(entry: TreeEntry): string {
  return entry.kind === 'file' && entry.ext === 'md' ? entry.name.slice(0, -3) : entry.name
}

export class FileTree extends Component {
  private tree: TreeEntry[] = []
  private expanded = new Set<string>()
  private active: string | null = null
  private renaming: string | null = null
  // The live rename box. A re-render (e.g. from the file watcher) silently
  // discards it and keeps what the user typed, instead of committing.
  private renameInput: { el: HTMLInputElement; discard(): void } | null = null
  private renameDraft: { value: string; start: number; end: number } | null = null
  private readonly listEl: HTMLElement

  constructor(
    private readonly container: HTMLElement,
    private readonly handlers: FileTreeHandlers
  ) {
    super()
    this.listEl = el('div', 'zn-tree', container)
  }

  onload(): void {
    this.registerDomEvent(this.container, 'contextmenu', (e) => {
      if ((e.target as HTMLElement).closest('.zn-tree-row')) return
      e.preventDefault()
      showMenu(e.clientX, e.clientY, [
        { label: 'New note', action: () => this.handlers.onNewNote('') },
        { label: 'New folder', action: () => this.handlers.onNewFolder('') }
      ])
    })
  }

  setTree(tree: TreeEntry[]): void {
    this.tree = tree
    this.render()
  }

  setActive(path: string | null): void {
    this.active = path
    if (path) this.expandParents(path)
    this.render()
  }

  startRename(path: string): void {
    this.expandParents(path)
    this.renaming = path
    this.render()
  }

  // Keep folder expansion in sync when a folder is renamed.
  renamePath(from: string, to: string): void {
    const next = new Set<string>()
    for (const p of this.expanded) {
      next.add(p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p)
    }
    this.expanded = next
  }

  private expandParents(path: string): void {
    let dir = parentDir(path)
    while (dir) {
      this.expanded.add(dir)
      dir = parentDir(dir)
    }
  }

  render(): void {
    if (this.renameInput) {
      const { value, selectionStart, selectionEnd } = this.renameInput.el
      this.renameDraft = { value, start: selectionStart ?? value.length, end: selectionEnd ?? value.length }
      this.renameInput.discard()
      this.renameInput = null
    }
    this.listEl.empty()
    if (this.tree.length === 0) {
      el('div', 'zn-tree-empty', this.listEl, 'No notes yet. Press Ctrl+N to create one.')
      return
    }
    this.renderEntries(this.tree, 0)
  }

  private renderEntries(entries: TreeEntry[], depth: number): void {
    for (const entry of entries) {
      this.renderRow(entry, depth)
      if (entry.kind === 'folder' && this.expanded.has(entry.path) && entry.children) {
        this.renderEntries(entry.children, depth + 1)
      }
    }
  }

  private renderRow(entry: TreeEntry, depth: number): void {
    const isFolder = entry.kind === 'folder'
    const row = el('div', 'zn-tree-row', this.listEl)
    row.style.paddingLeft = `${8 + depth * INDENT}px`
    row.dataset.path = entry.path
    if (entry.path === this.active) row.classList.add('is-active')
    if (!isFolder && entry.ext !== 'md') row.classList.add('is-other')

    const twisty = el('span', 'zn-tree-twisty', row)
    if (isFolder) {
      twisty.appendChild(icon('chevron', 14))
      if (this.expanded.has(entry.path)) twisty.classList.add('is-open')
    }

    if (this.renaming === entry.path) {
      this.renderRenameInput(row, entry)
    } else {
      el('span', 'zn-tree-label', row, displayName(entry))
      if (!isFolder && entry.ext && entry.ext !== 'md') el('span', 'zn-tree-ext', row, entry.ext)
    }

    row.addEventListener('click', () => {
      if (this.renaming === entry.path) return
      if (isFolder) {
        if (this.expanded.has(entry.path)) this.expanded.delete(entry.path)
        else this.expanded.add(entry.path)
        this.render()
      } else {
        this.handlers.onOpen(entry)
      }
    })
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      const dir = isFolder ? entry.path : parentDir(entry.path)
      showMenu(e.clientX, e.clientY, [
        ...(isFolder ? [] : [{ label: 'Open', action: () => this.handlers.onOpen(entry) }]),
        { label: 'New note', action: () => this.handlers.onNewNote(dir) },
        { label: 'New folder', action: () => this.handlers.onNewFolder(dir) },
        'separator',
        { label: 'Rename', action: () => this.startRename(entry.path) },
        { label: 'Show in Explorer', action: () => this.handlers.onReveal(entry.path) },
        'separator',
        { label: 'Delete', danger: true, action: () => this.handlers.onDelete(entry) }
      ])
    })
  }

  private renderRenameInput(row: HTMLElement, entry: TreeEntry): void {
    const input = el('input', 'zn-tree-rename', row)
    const keepExt = entry.kind === 'file' && entry.ext === 'md'
    const draft = this.renameDraft
    input.value = draft ? draft.value : keepExt ? entry.name.slice(0, -3) : entry.name
    let done = false
    this.renameInput = { el: input, discard: () => (done = true) }
    const finish = async (commit: boolean): Promise<void> => {
      if (done) return
      done = true
      this.renaming = null
      this.renameInput = null
      this.renameDraft = null
      const value = input.value.trim()
      const newName = keepExt ? `${value}.md` : value
      // A confirmed but unchanged name still goes through (as a no-op rename), so the app can move focus on.
      if (commit && value) {
        await this.handlers.onRename(entry, newName)
      } else {
        this.render()
      }
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void finish(true)
      if (e.key === 'Escape') void finish(false)
      e.stopPropagation()
    })
    input.addEventListener('blur', () => void finish(true))
    input.addEventListener('click', (e) => e.stopPropagation())
    requestAnimationFrame(() => {
      if (done) return
      input.focus()
      if (draft) {
        input.setSelectionRange(draft.start, draft.end)
      } else {
        const dot = keepExt ? input.value.length : input.value.lastIndexOf('.')
        input.setSelectionRange(0, dot > 0 ? dot : input.value.length)
      }
    })
  }
}
