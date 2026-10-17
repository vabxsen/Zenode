// JSON Canvas 1.0 (https://jsoncanvas.org), compatible with Obsidian's .canvas files.
// Unlike Obsidian (note 09 §5), unknown node *types* are kept and written back,
// along with any unknown keys on nodes, edges and the top level.

export type Side = 'top' | 'right' | 'bottom' | 'left'
export type EdgeEnd = 'none' | 'arrow'

interface NodeBase {
  id: string
  x: number
  y: number
  width: number
  height: number
  color?: string
  [key: string]: unknown
}

export interface TextNode extends NodeBase {
  type: 'text'
  text: string
}

export interface FileNode extends NodeBase {
  type: 'file'
  file: string
  subpath?: string
}

export interface LinkNode extends NodeBase {
  type: 'link'
  url: string
}

export interface GroupNode extends NodeBase {
  type: 'group'
  label?: string
  background?: string
  backgroundStyle?: 'cover' | 'ratio' | 'repeat'
}

export interface UnknownNode extends NodeBase {
  type: string
}

export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode | UnknownNode

export interface CanvasEdge {
  id: string
  fromNode: string
  fromSide?: Side
  fromEnd?: EdgeEnd
  toNode: string
  toSide?: Side
  toEnd?: EdgeEnd
  color?: string
  label?: string
  [key: string]: unknown
}

export interface CanvasData {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  [key: string]: unknown
}

export const KNOWN_TYPES = new Set(['text', 'file', 'link', 'group'])

export function isText(n: CanvasNode): n is TextNode {
  return n.type === 'text'
}
export function isFile(n: CanvasNode): n is FileNode {
  return n.type === 'file'
}
export function isLink(n: CanvasNode): n is LinkNode {
  return n.type === 'link'
}
export function isGroup(n: CanvasNode): n is GroupNode {
  return n.type === 'group'
}

export class CanvasParseError extends Error {}

// Drawing order, back to front: groups (larger behind smaller, so nested groups stay
// reachable), then cards in file order.
export function stackOrder(nodes: CanvasNode[]): CanvasNode[] {
  const area = (n: CanvasNode): number => n.width * n.height
  const groups = nodes.filter(isGroup).sort((a, b) => area(b) - area(a))
  return [...groups, ...nodes.filter((n) => !isGroup(n))]
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback)

// Empty files open as an empty canvas; invalid JSON throws so the caller never overwrites it.
export function parseCanvas(text: string): CanvasData {
  if (!text.trim()) return { nodes: [], edges: [] }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new CanvasParseError(`This canvas file is not valid JSON: ${(e as Error).message}`)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CanvasParseError('This canvas file is not a JSON object.')
  const obj = raw as Record<string, unknown>
  const nodes: CanvasNode[] = []
  for (const n of Array.isArray(obj.nodes) ? obj.nodes : []) {
    if (!n || typeof n !== 'object' || typeof (n as { id?: unknown }).id !== 'string') continue
    const node = { ...(n as Record<string, unknown>) } as CanvasNode
    node.type = typeof node.type === 'string' ? node.type : 'text'
    node.x = num(node.x, 0)
    node.y = num(node.y, 0)
    node.width = Math.max(num(node.width, 250), 20)
    node.height = Math.max(num(node.height, 60), 20)
    if (node.type === 'text' && typeof (node as TextNode).text !== 'string') (node as TextNode).text = ''
    nodes.push(node)
  }
  const ids = new Set(nodes.map((n) => n.id))
  const edges: CanvasEdge[] = []
  for (const e of Array.isArray(obj.edges) ? obj.edges : []) {
    if (!e || typeof e !== 'object') continue
    const edge = { ...(e as Record<string, unknown>) } as CanvasEdge
    // Edges to missing nodes are dropped: they could never be drawn or reconnected.
    if (typeof edge.id !== 'string' || !ids.has(edge.fromNode) || !ids.has(edge.toNode)) continue
    edges.push(edge)
  }
  return { ...obj, nodes, edges }
}

// Obsidian-style output: tab indentation, but any object or array holding only
// primitives on a single line, so each node and edge is one line (diff-friendly).
export function serializeCanvas(data: CanvasData): string {
  return stringify(data, '')
}

function isPrimitive(v: unknown): boolean {
  return v === null || typeof v !== 'object'
}

function stringify(value: unknown, indent: string): string {
  if (isPrimitive(value)) return JSON.stringify(value) ?? 'null'
  const inner = indent + '\t'
  if (Array.isArray(value)) {
    if (value.every(isPrimitive)) return JSON.stringify(value)
    return `[\n${value.map((v) => inner + stringify(v, inner)).join(',\n')}\n${indent}]`
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
  if (entries.every(([, v]) => isPrimitive(v))) return JSON.stringify(Object.fromEntries(entries))
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}:${stringify(v, inner)}`).join(',\n')}\n${indent}}`
}

export function newId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------- Geometry ----------

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export function anchor(r: Rect, side: Side): Point {
  switch (side) {
    case 'top':
      return { x: r.x + r.width / 2, y: r.y }
    case 'bottom':
      return { x: r.x + r.width / 2, y: r.y + r.height }
    case 'left':
      return { x: r.x, y: r.y + r.height / 2 }
    default:
      return { x: r.x + r.width, y: r.y + r.height / 2 }
  }
}

const NORMALS: Record<Side, Point> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }

// The side of `from` that faces `to`, compared against the node's own diagonal (as Obsidian does).
export function facingSide(from: Rect, to: Rect): Side {
  const a = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
  const b = { x: to.x + to.width / 2, y: to.y + to.height / 2 }
  const angle = Math.atan2(b.y - a.y, b.x - a.x)
  const diag = Math.atan2(from.height, from.width)
  if (angle > -diag && angle <= diag) return 'right'
  if (angle > diag && angle <= Math.PI - diag) return 'bottom'
  if (angle > Math.PI - diag || angle <= -(Math.PI - diag)) return 'left'
  return 'top'
}

export interface EdgeGeometry {
  path: string
  start: Point
  end: Point
  // Unit direction the curve arrives with, for the arrowhead.
  endDir: Point
  startDir: Point
  mid: Point
}

// Cubic Bézier leaving and entering perpendicular to the chosen sides.
export function edgeGeometry(from: Rect, fromSide: Side, to: Rect | Point, toSide: Side | null): EdgeGeometry {
  const start = anchor(from, fromSide)
  const end = 'width' in to ? anchor(to, toSide ?? 'left') : to
  const dist = Math.hypot(end.x - start.x, end.y - start.y)
  const k = Math.min(Math.max(dist * 0.4, 30), 220)
  const n1 = NORMALS[fromSide]
  const c1 = { x: start.x + n1.x * k, y: start.y + n1.y * k }
  let c2: Point
  if (toSide) {
    const n2 = NORMALS[toSide]
    c2 = { x: end.x + n2.x * k, y: end.y + n2.y * k }
  } else {
    c2 = { x: (c1.x + end.x) / 2, y: (c1.y + end.y) / 2 }
  }
  const dirLen = Math.hypot(end.x - c2.x, end.y - c2.y) || 1
  const startLen = Math.hypot(c1.x - start.x, c1.y - start.y) || 1
  // Point at t = 0.5 for the label.
  const mid = {
    x: 0.125 * start.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * end.x,
    y: 0.125 * start.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * end.y
  }
  return {
    path: `M${start.x},${start.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${end.x},${end.y}`,
    start,
    end,
    endDir: { x: (end.x - c2.x) / dirLen, y: (end.y - c2.y) / dirLen },
    startDir: { x: (start.x - c1.x) / startLen, y: (start.y - c1.y) / startLen },
    mid
  }
}

export function arrowHead(tip: Point, dir: Point, size = 12): string {
  const back = { x: tip.x - dir.x * size, y: tip.y - dir.y * size }
  const nx = -dir.y * size * 0.5
  const ny = dir.x * size * 0.5
  return `M${tip.x},${tip.y} L${back.x + nx},${back.y + ny} L${back.x - nx},${back.y - ny} Z`
}

export function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

export function bounds(rects: Rect[]): Rect | null {
  if (!rects.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.width)
    maxY = Math.max(maxY, r.y + r.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

// ---------- Index & rename support ----------

export interface CanvasRefs {
  // Text of every text card, for search.
  texts: Array<{ id: string; text: string }>
  // File cards and group backgrounds.
  files: Array<{ id: string; file: string; subpath: string }>
}

export function canvasRefs(data: CanvasData): CanvasRefs {
  const texts: CanvasRefs['texts'] = []
  const files: CanvasRefs['files'] = []
  for (const n of data.nodes) {
    if (isText(n)) texts.push({ id: n.id, text: n.text })
    else if (isFile(n) && typeof n.file === 'string') files.push({ id: n.id, file: n.file, subpath: n.subpath ?? '' })
    else if (isGroup(n) && typeof n.background === 'string' && n.background) files.push({ id: n.id, file: n.background, subpath: '' })
  }
  return { texts, files }
}
