// The canvas being edited: its data, the selection and the undo history, plus
// every editing operation. No DOM here; the view renders after each change.
import {
  bounds,
  contains,
  facingSide,
  isGroup,
  newId,
  parseCanvas,
  serializeCanvas,
  stackOrder,
  type CanvasData,
  type CanvasEdge,
  type CanvasNode,
  type Point,
  type Side,
  type TextNode
} from './model'

export const GRID = 20
const HISTORY_LIMIT = 100
const GROUP_PAD = 40

export const snap = (v: number): number => Math.round(v / GRID) * GRID

// Where a new connection ends: an existing card, or empty space (a new card is made there).
export type ConnectTarget = { id: string; side: Side } | { at: Point }

export class CanvasDocument {
  data: CanvasData = { nodes: [], edges: [] }
  selected = new Set<string>()
  selectedEdges = new Set<string>()
  private history: string[] = []
  private future: string[] = []

  load(data: CanvasData): void {
    this.data = data
    this.prune()
  }

  snapshot(): string {
    return serializeCanvas(this.data)
  }

  // Records `before` as an undo step if the canvas changed since. Returns whether it did.
  commit(before: string): boolean {
    if (before === this.snapshot()) return false
    this.history.push(before)
    if (this.history.length > HISTORY_LIMIT) this.history.shift()
    this.future = []
    return true
  }

  undo(): boolean {
    const prev = this.history.pop()
    if (prev === undefined) return false
    this.future.push(this.snapshot())
    this.restore(prev)
    return true
  }

  redo(): boolean {
    const next = this.future.pop()
    if (next === undefined) return false
    this.history.push(this.snapshot())
    this.restore(next)
    return true
  }

  private restore(text: string): void {
    this.data = parseCanvas(text)
    this.prune()
  }

  // Drop selection entries that no longer exist.
  prune(): void {
    const ids = new Set(this.data.nodes.map((n) => n.id))
    for (const id of this.selected) if (!ids.has(id)) this.selected.delete(id)
    const edgeIds = new Set(this.data.edges.map((e) => e.id))
    for (const id of this.selectedEdges) if (!edgeIds.has(id)) this.selectedEdges.delete(id)
  }

  node(id: string): CanvasNode | undefined {
    return this.data.nodes.find((n) => n.id === id)
  }

  // The topmost card under a point.
  nodeAt(p: Point, exclude?: string): CanvasNode | null {
    const ordered = stackOrder(this.data.nodes)
    for (let i = ordered.length - 1; i >= 0; i--) {
      const n = ordered[i]
      if (n.id !== exclude && p.x >= n.x && p.x <= n.x + n.width && p.y >= n.y && p.y <= n.y + n.height) return n
    }
    return null
  }

  // ---------- Selection ----------

  selectOnly(id: string): void {
    this.selected = new Set([id])
    this.selectedEdges.clear()
  }

  selectAll(): void {
    this.selected = new Set(this.data.nodes.map((n) => n.id))
  }

  clearSelection(): void {
    this.selected.clear()
    this.selectedEdges.clear()
  }

  hasSelection(): boolean {
    return this.selected.size + this.selectedEdges.size > 0
  }

  // The selection plus every card fully inside a selected group moves together.
  moveSet(): Map<string, Point> {
    const out = new Map<string, Point>()
    for (const n of this.data.nodes) {
      if (!this.selected.has(n.id)) continue
      out.set(n.id, { x: n.x, y: n.y })
      if (isGroup(n)) {
        for (const m of this.data.nodes) if (m.id !== n.id && contains(n, m)) out.set(m.id, { x: m.x, y: m.y })
      }
    }
    return out
  }

  // ---------- Operations (callers commit and render) ----------

  addText(at: Point): TextNode {
    const node: TextNode = { id: newId(), type: 'text', text: '', x: snap(at.x - 125), y: snap(at.y - 30), width: 260, height: 60 }
    this.data.nodes.push(node)
    this.selectOnly(node.id)
    return node
  }

  addFile(path: string, center: Point, isNote: boolean): CanvasNode {
    const node: CanvasNode = {
      id: newId(),
      type: 'file',
      file: path,
      x: snap(center.x - 200),
      y: snap(center.y - (isNote ? 200 : 150)),
      width: 400,
      height: isNote ? 400 : 300
    }
    this.data.nodes.push(node)
    this.selectOnly(node.id)
    return node
  }

  // Wraps the selection in a new group; with nothing selected, adds an empty group at `center`.
  groupSelection(center: Point): CanvasNode {
    const picked = this.data.nodes.filter((n) => this.selected.has(n.id))
    const box = bounds(picked) ?? { x: center.x - 200, y: center.y - 150, width: 400, height: 300 }
    const group: CanvasNode = {
      id: newId(),
      type: 'group',
      label: 'Group',
      x: snap(box.x - GROUP_PAD),
      y: snap(box.y - GROUP_PAD),
      width: snap(box.width + GROUP_PAD * 2),
      height: snap(box.height + GROUP_PAD * 2)
    }
    this.data.nodes.unshift(group)
    this.selectOnly(group.id)
    return group
  }

  // An empty color clears it.
  setColor(color: string): void {
    for (const n of this.data.nodes) {
      if (!this.selected.has(n.id)) continue
      if (color) n.color = color
      else delete n.color
    }
    for (const e of this.data.edges) {
      if (!this.selectedEdges.has(e.id)) continue
      if (color) e.color = color
      else delete e.color
    }
  }

  // Removes selected cards and edges, and any edge left without both ends.
  deleteSelection(): boolean {
    if (!this.hasSelection()) return false
    this.data.nodes = this.data.nodes.filter((n) => !this.selected.has(n.id))
    this.data.edges = this.data.edges.filter(
      (e) => !this.selectedEdges.has(e.id) && !this.selected.has(e.fromNode) && !this.selected.has(e.toNode)
    )
    this.clearSelection()
    return true
  }

  // Adds an edge; when it ends on empty space, a new text card is created there first.
  // Returns the id of the card the edge ends on, or null if `from` is gone.
  connect(fromId: string, fromSide: Side, target: ConnectTarget): string | null {
    const from = this.node(fromId)
    if (!from) return null
    let toId: string
    let toSide: Side
    if ('id' in target) {
      toId = target.id
      toSide = target.side
    } else {
      const card: TextNode = { id: newId(), type: 'text', text: '', x: snap(target.at.x - 130), y: snap(target.at.y - 30), width: 260, height: 60 }
      this.data.nodes.push(card)
      toId = card.id
      toSide = facingSide(card, from)
    }
    const edge: CanvasEdge = { id: newId(), fromNode: fromId, fromSide, toNode: toId, toSide }
    this.data.edges.push(edge)
    return toId
  }
}
