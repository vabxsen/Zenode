// The main area: panes (tab groups, see pane.ts) arranged in horizontal and
// vertical splits. Actions go to the active pane; file events (renames,
// deletions, outside changes, saving) go to every pane.
import type { LayoutNode, PaneLayout, WorkspaceState } from '../../shared/api'
import { Component, el } from './component'
import { Pane } from './pane'
import type { MovedTab, OpenPosition, PaneHost, TextEdit, WorkspaceHost, WorkspaceView } from './paneTypes'
import { dialogHasFocus } from './focusGuard'


export { noteTitle, VIEW_PREFIX, type OpenPosition, type WorkspaceHost, type WorkspaceView } from './paneTypes'

type Dir = 'row' | 'column'
export type Direction = 'left' | 'right' | 'up' | 'down'

interface SplitNode {
  kind: 'split'
  dir: Dir
  children: TreeNode[]
  // Relative sizes (flex-grow) of the children.
  sizes: number[]
  parent: SplitNode | null
}

interface LeafNode {
  kind: 'leaf'
  id: number
  pane: Pane
  el: HTMLElement
  parent: SplitNode | null
}

type TreeNode = SplitNode | LeafNode

export interface WorkspaceHostWithPanes extends WorkspaceHost {
  // Open a path in the active pane (notes, canvases, the graph).
  reopen(path: string): Promise<void>
  revealInTree(path: string): void
}

const TAB_DRAG_TYPE = 'application/x-zenode-tab'
const MIN_SIZE = 0.15
const MAX_PANES = 16

export class Workspace extends Component {
  private root: TreeNode
  private active: LeafNode
  private nextId = 1
  private restoring = false
  private readonly dropOverlay: HTMLElement

  constructor(
    private readonly container: HTMLElement,
    private readonly host: WorkspaceHostWithPanes
  ) {
    super()
    container.classList.add('zn-workspace')
    this.dropOverlay = el('div', 'zn-drop-overlay')
    this.root = this.makeLeaf(null)
    this.active = this.root
    this.renderTree()
  }

  // ---------- Panes ----------

  private makeLeaf(parent: SplitNode | null): LeafNode {
    const leafEl = el('div', 'zn-pane-leaf')
    // The pane's callbacks refer to its leaf, which is complete before any of them run.
    let leaf: LeafNode
    const paneHost: PaneHost = {
      ...this.host,
      onActiveChange: (path, title) => {
        if (leaf === this.active) this.host.onActiveChange(path, title)
      },
      onStats: (words, chars) => {
        if (leaf === this.active) this.host.onStats(words, chars)
      },
      // While a saved layout is restored, focus moves around; it mustn't pick the pane.
      onFocus: () => {
        if (!this.restoring) this.setActive(leaf)
      },
      isActivePane: () => leaf === this.active,
      onEmptied: () => this.removeLeaf(leaf),
      reopen: (path) => this.host.reopen(path),
      splitWith: (path, dir) => void this.split(dir === 'right' ? 'row' : 'column', path),
      revealInTree: (path) => this.host.revealInTree(path),
      dragData: (path) => JSON.stringify({ pane: leaf.id, path }),
      onDropTab: (data, index) => this.moveTab(data, leaf, index)
    }
    leaf = { kind: 'leaf', id: this.nextId++, el: leafEl, parent, pane: this.addChild(new Pane(leafEl, paneHost)) }
    this.wireDropZones(leaf)
    return leaf
  }

  private leaves(node: TreeNode = this.root): LeafNode[] {
    return node.kind === 'leaf' ? [node] : node.children.flatMap((c) => this.leaves(c))
  }

  private panes(): Pane[] {
    return this.leaves().map((l) => l.pane)
  }

  get paneCount(): number {
    return this.leaves().length
  }

  private setActive(leaf: LeafNode): void {
    if (leaf === this.active) return
    this.active.el.classList.remove('is-active-pane')
    this.active = leaf
    leaf.el.classList.add('is-active-pane')
    leaf.pane.announce()
    this.host.onLayoutChange()
  }

  // Splits the active pane (row = side by side, column = stacked). The new pane
  // shows `path` if given, else stays empty. Returns the new pane's leaf.
  async split(dir: Dir, path?: string): Promise<void> {
    if (this.paneCount >= MAX_PANES) {
      this.host.onError(`Zenode shows at most ${MAX_PANES} panes.`)
      return
    }
    const leaf = this.insertBeside(this.active, dir, 'after')
    this.setActive(leaf)
    if (path) await this.host.reopen(path)
    else this.host.onActiveChange(null, '')
  }

  // A new leaf next to `target` in direction dir.
  private insertBeside(target: LeafNode, dir: Dir, where: 'before' | 'after'): LeafNode {
    const parent = target.parent
    if (parent && parent.dir === dir) {
      const i = parent.children.indexOf(target)
      const leaf = this.makeLeaf(parent)
      const at = where === 'after' ? i + 1 : i
      // The new pane takes half of the target's share.
      const share = parent.sizes[i] / 2
      parent.sizes[i] = share
      parent.children.splice(at, 0, leaf)
      parent.sizes.splice(at, 0, share)
      this.renderTree()
      return leaf
    }
    const split: SplitNode = { kind: 'split', dir, children: [], sizes: [1, 1], parent }
    const leaf = this.makeLeaf(split)
    split.children = where === 'after' ? [target, leaf] : [leaf, target]
    this.replaceNode(target, split)
    target.parent = split
    this.renderTree()
    return leaf
  }

  private replaceNode(old: TreeNode, next: TreeNode): void {
    const parent = old.parent
    next.parent = parent
    if (!parent) this.root = next
    else parent.children[parent.children.indexOf(old)] = next
  }

  // Removes an empty pane (never the last one) and tidies single-child splits.
  private removeLeaf(leaf: LeafNode): void {
    if (this.paneCount === 1 || !leaf.parent) return
    const parent = leaf.parent
    const i = parent.children.indexOf(leaf)
    parent.children.splice(i, 1)
    const [freed] = parent.sizes.splice(i, 1)
    if (parent.sizes.length) parent.sizes[Math.min(i, parent.sizes.length - 1)] += freed
    if (parent.children.length === 1) this.replaceNode(parent, parent.children[0])
    this.removeChild(leaf.pane)
    if (this.active === leaf) {
      this.active = this.leaves()[0]
      this.active.el.classList.add('is-active-pane')
      this.active.pane.announce()
    }
    this.renderTree()
    this.host.onLayoutChange()
  }

  // Close the active pane (its tabs close first; conflicts or pinned tabs keep it open).
  async closePane(): Promise<void> {
    if (this.paneCount === 1) return
    const leaf = this.active
    await leaf.pane.closeAll()
    if (leaf.pane.isEmpty) this.removeLeaf(leaf)
  }

  // Ctrl+Alt+arrows: move to the pane in that direction.
  focusPane(direction: Direction): void {
    const from = this.active.el.getBoundingClientRect()
    const cx = from.left + from.width / 2
    const cy = from.top + from.height / 2
    let best: LeafNode | null = null
    let bestDistance = Infinity
    for (const leaf of this.leaves()) {
      if (leaf === this.active) continue
      const r = leaf.el.getBoundingClientRect()
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      const ok =
        (direction === 'left' && r.right <= from.left + 1) ||
        (direction === 'right' && r.left >= from.right - 1) ||
        (direction === 'up' && r.bottom <= from.top + 1) ||
        (direction === 'down' && r.top >= from.bottom - 1)
      const d = Math.hypot(x - cx, y - cy)
      if (ok && d < bestDistance) {
        best = leaf
        bestDistance = d
      }
    }
    if (best) {
      this.setActive(best)
      best.pane.focus()
    }
  }

  // ---------- Moving tabs ----------

  private parseDrag(data: string): { leaf: LeafNode; path: string } | null {
    try {
      const { pane, path } = JSON.parse(data) as { pane: number; path: string }
      const leaf = this.leaves().find((l) => l.id === pane)
      return leaf && typeof path === 'string' ? { leaf, path } : null
    } catch {
      return null
    }
  }

  private moveTab(data: string, target: LeafNode, index?: number): void {
    const drag = this.parseDrag(data)
    if (!drag) return
    if (drag.leaf === target && index === undefined) return
    if (drag.leaf !== target && target.pane.hasTab(drag.path)) {
      // The target already shows this file: switch to it and close the dragged copy.
      this.setActive(target)
      target.pane.activateById(drag.path)
      void drag.leaf.pane.closePath(drag.path)
      return
    }
    const tab: MovedTab | null = drag.leaf.pane.detachTab(drag.path)
    if (!tab) return
    this.setActive(target)
    target.pane.attachTab(tab, index)
    if (drag.leaf !== target && drag.leaf.pane.isEmpty) this.removeLeaf(drag.leaf)
    this.host.onLayoutChange()
  }

  // Dropping a tab on a pane's edge splits it; on its middle, moves the tab there.
  private wireDropZones(leaf: LeafNode): void {
    const zoneAt = (e: DragEvent): Direction | 'center' => {
      const r = leaf.el.getBoundingClientRect()
      const x = (e.clientX - r.left) / r.width
      const y = (e.clientY - r.top) / r.height
      const edges: Array<[Direction, number]> = [
        ['left', x],
        ['right', 1 - x],
        ['up', y],
        ['down', 1 - y]
      ]
      const [dir, distance] = edges.sort((a, b) => a[1] - b[1])[0]
      return distance < 0.25 ? dir : 'center'
    }
    leaf.el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes(TAB_DRAG_TYPE)) return
      if ((e.target as HTMLElement).closest('.zn-tabbar')) {
        this.dropOverlay.remove()
        return
      }
      e.preventDefault()
      const zone = zoneAt(e)
      this.dropOverlay.className = `zn-drop-overlay is-${zone}`
      if (this.dropOverlay.parentElement !== leaf.el) leaf.el.appendChild(this.dropOverlay)
    })
    leaf.el.addEventListener('dragleave', (e) => {
      if (!leaf.el.contains(e.relatedTarget as Node | null)) this.dropOverlay.remove()
    })
    leaf.el.addEventListener('drop', (e) => {
      this.dropOverlay.remove()
      const data = e.dataTransfer?.getData(TAB_DRAG_TYPE)
      if (!data || (e.target as HTMLElement).closest('.zn-tabbar')) return
      e.preventDefault()
      const zone = zoneAt(e)
      if (zone === 'center') {
        this.moveTab(data, leaf)
        return
      }
      const drag = this.parseDrag(data)
      if (!drag || this.paneCount >= MAX_PANES) return
      // Splitting a pane with its only tab would leave an empty pane behind: nothing to do.
      if (drag.leaf === leaf && leaf.pane.state().tabs.length === 1) return
      const dir: Dir = zone === 'left' || zone === 'right' ? 'row' : 'column'
      const fresh = this.insertBeside(leaf, dir, zone === 'left' || zone === 'up' ? 'before' : 'after')
      this.moveTab(data, fresh)
    })
  }

  // ---------- Layout rendering and resizing ----------

  private renderTree(): void {
    this.container.replaceChildren(this.build(this.root))
    for (const leaf of this.leaves()) leaf.el.classList.toggle('is-active-pane', leaf === this.active && this.paneCount > 1)
    this.markEdges(this.root, true, true)
  }

  // Panes along the top carry the window's title bar in their tab bars; the
  // top right one leaves room for the window buttons.
  private markEdges(node: TreeNode, top: boolean, right: boolean): void {
    if (node.kind === 'leaf') {
      node.el.classList.toggle('is-top', top)
      node.el.classList.toggle('is-top-right', top && right)
      return
    }
    const last = node.children.length - 1
    node.children.forEach((c, i) => this.markEdges(c, node.dir === 'column' ? top && i === 0 : top, node.dir === 'row' ? right && i === last : right))
  }

  private build(node: TreeNode): HTMLElement {
    if (node.kind === 'leaf') return node.el
    const box = el('div', `zn-split is-${node.dir}`)
    node.children.forEach((child, i) => {
      if (i > 0) this.addDivider(box, node, i)
      const childEl = this.build(child)
      childEl.style.flex = `${node.sizes[i]} 1 0`
      box.appendChild(childEl)
    })
    return box
  }

  private addDivider(box: HTMLElement, split: SplitNode, index: number): void {
    const divider = el('div', 'zn-split-divider', box)
    divider.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const rect = box.getBoundingClientRect()
      const total = split.sizes.reduce((a, b) => a + b, 0)
      const pair = split.sizes[index - 1] + split.sizes[index]
      const before = split.sizes.slice(0, index - 1).reduce((a, b) => a + b, 0)
      const move = (ev: MouseEvent): void => {
        const pos = split.dir === 'row' ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height
        const share = Math.max(MIN_SIZE * pair, Math.min(pair - MIN_SIZE * pair, pos * total - before))
        split.sizes[index - 1] = share
        split.sizes[index] = pair - share
        const kids = [...box.children].filter((c) => !c.classList.contains('zn-split-divider')) as HTMLElement[]
        kids[index - 1].style.flex = `${split.sizes[index - 1]} 1 0`
        kids[index].style.flex = `${split.sizes[index]} 1 0`
      }
      const up = (): void => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
        document.body.classList.remove('is-resizing')
        this.host.onLayoutChange()
      }
      document.body.classList.add('is-resizing')
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    })
  }

  // ---------- Saving and restoring the layout ----------

  serialize(): WorkspaceState {
    const leaves = this.leaves()
    const toLayout = (node: TreeNode): LayoutNode =>
      node.kind === 'leaf' ? node.pane.state() : { dir: node.dir, sizes: [...node.sizes], children: node.children.map(toLayout) }
    const active = this.active.pane.state()
    // openFiles/activeFile describe the active pane, for older versions of Zenode.
    return { openFiles: active.tabs, activeFile: active.active, layout: toLayout(this.root), activePane: leaves.indexOf(this.active) }
  }

  // Rebuilds saved panes and opens their tabs with `open` (which opens in the active pane).
  async restoreLayout(layout: LayoutNode, activePane: number, open: (path: string) => Promise<void>): Promise<void> {
    const states: Array<[LeafNode, PaneLayout]> = []
    const buildNode = (spec: LayoutNode, parent: SplitNode | null, reuse: LeafNode | null): TreeNode => {
      if ('tabs' in spec) {
        const leaf = reuse ?? this.makeLeaf(parent)
        leaf.parent = parent
        states.push([leaf, spec])
        return leaf
      }
      const split: SplitNode = { kind: 'split', dir: spec.dir, children: [], sizes: [...spec.sizes], parent }
      split.children = spec.children.map((c, i) => buildNode(c, split, i === 0 ? reuse : null))
      return split
    }
    // The first leaf reuses the existing (empty) pane.
    this.root = buildNode(layout, null, this.leaves()[0])
    this.renderTree()
    this.restoring = true
    try {
      for (const [leaf, state] of states) {
        this.setActive(leaf)
        for (const path of state.tabs) await open(path)
        leaf.pane.applyState(state)
      }
    } finally {
      this.restoring = false
    }
    const leaves = this.leaves()
    this.setActive(leaves[Math.max(0, Math.min(activePane, leaves.length - 1))])
    this.active.pane.announce()
    // Restoring finishes after the window is up: leave a dialog the user opened meanwhile alone.
    if (!dialogHasFocus()) this.active.pane.focus()
  }

  // ---------- The rest of the app talks to the active pane ----------

  get activePath(): string | null {
    return this.active.pane.activePath
  }

  focus(): void {
    this.active.pane.focus()
  }

  setDefaultView(view: 'live' | 'source' | 'reading'): void {
    for (const p of this.panes()) p.setDefaultView(view)
  }

  applySpellcheck(on: boolean): void {
    for (const p of this.panes()) p.applySpellcheck(on)
  }

  toggleReading(): void {
    this.active.pane.toggleReading()
  }

  toggleSource(): void {
    this.active.pane.toggleSource()
  }

  activeMode(): 'live' | 'source' | 'reading' | null {
    return this.active.pane.activeMode()
  }

  openView(view: WorkspaceView): void {
    this.active.pane.openView(view)
  }

  // Shows an open tab by path or view id, in whichever pane has it.
  activateById(id: string): boolean {
    const leaf = this.leaves().find((l) => l.pane.hasTab(id))
    if (!leaf) return false
    this.setActive(leaf)
    return leaf.pane.activateById(id)
  }

  hasView(id: string): boolean {
    return this.panes().some((p) => p.hasView(id))
  }

  open(path: string, pos?: OpenPosition): Promise<void> {
    return this.active.pane.open(path, pos)
  }

  activeNote(): { path: string; text: string } | null {
    return this.active.pane.activeNote()
  }

  editActive(build: (doc: string, cursor: number) => TextEdit): boolean {
    return this.active.pane.editActive(build)
  }

  replaceText(path: string, text: string): boolean {
    const leaf = this.active.pane.hasTab(path) ? this.active : this.leaves().find((l) => l.pane.hasTab(path))
    if (!leaf) return false
    this.setActive(leaf)
    return leaf.pane.replaceText(path, text)
  }

  restoreUnsaved(path: string, content: string, baseHash: string): Promise<void> {
    return this.active.pane.restoreUnsaved(path, content, baseHash)
  }

  refreshLinks(): void {
    for (const p of this.panes()) p.refreshLinks()
  }

  isOpen(path: string): boolean {
    return this.panes().some((p) => p.isOpen(path))
  }

  close(): Promise<void> {
    return this.active.pane.close()
  }

  closeOthers(): Promise<void> {
    return this.active.pane.closeOthers()
  }

  togglePin(): void {
    this.active.pane.togglePin()
  }

  cycle(delta: number): void {
    this.active.pane.cycle(delta)
  }

  go(step: 1 | -1): Promise<void> {
    return this.active.pane.go(step)
  }

  save(): Promise<void> {
    return this.active.pane.save()
  }

  async saveAll(): Promise<void> {
    await Promise.all(this.panes().map((p) => p.saveAll()))
  }

  closeView(id: string): void {
    for (const p of this.panes()) p.closeView(id)
  }

  async closeAll(): Promise<void> {
    for (const p of this.panes()) await p.closeAll()
  }

  renamed(from: string, to: string): void {
    for (const p of this.panes()) p.renamed(from, to)
  }

  removed(path: string): void {
    for (const p of this.panes()) p.removed(path)
  }

  async reloadChanged(paths: string[]): Promise<void> {
    await Promise.all(this.panes().map((p) => p.reloadChanged(paths)))
  }
}
