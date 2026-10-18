// Draws connections as SVG curves with arrowheads, and their labels as HTML.
import { el } from '../component'
import { arrowHead, colorOf, edgeGeometry, facingSide, type CanvasData, type CanvasNode, type Point, type Rect, type Side } from './model'

const SVG_NS = 'http://www.w3.org/2000/svg'

function path(d: string, ...classes: string[]): SVGPathElement {
  const p = document.createElementNS(SVG_NS, 'path')
  p.setAttribute('d', d)
  p.classList.add(...classes)
  return p
}

export function renderEdges(edgesG: SVGGElement, labelsLayer: HTMLElement, data: CanvasData, selected: Set<string>): void {
  edgesG.replaceChildren()
  labelsLayer.replaceChildren()
  // First card wins on a duplicate id, as with a lookup by find().
  const byId = new Map<string, CanvasNode>()
  for (const n of data.nodes) if (!byId.has(n.id)) byId.set(n.id, n)
  for (const e of data.edges) {
    const from = byId.get(e.fromNode)
    const to = byId.get(e.toNode)
    if (!from || !to) continue
    const geo = edgeGeometry(from, e.fromSide ?? facingSide(from, to), to, e.toSide ?? facingSide(to, from))
    const g = document.createElementNS(SVG_NS, 'g')
    g.classList.add('zn-cedge')
    g.dataset.edge = e.id
    if (selected.has(e.id)) g.classList.add('is-selected')
    const color = colorOf(e.color)
    if (color) g.style.setProperty('--edge-color', color)
    // A wide invisible stroke makes thin edges easy to click.
    g.append(path(geo.path, 'zn-cedge-hit'), path(geo.path, 'zn-cedge-line'))
    if ((e.toEnd ?? 'arrow') === 'arrow') g.appendChild(path(arrowHead(geo.end, geo.endDir), 'zn-cedge-head'))
    if (e.fromEnd === 'arrow') g.appendChild(path(arrowHead(geo.start, geo.startDir), 'zn-cedge-head'))
    edgesG.appendChild(g)
    if (e.label) {
      const label = el('div', 'zn-cedge-label', labelsLayer, e.label)
      label.dataset.edge = e.id
      label.style.left = `${geo.mid.x}px`
      label.style.top = `${geo.mid.y}px`
      if (selected.has(e.id)) label.classList.add('is-selected')
    }
  }
}

// The dashed preview while dragging out a new connection.
export function renderTempEdge(tempG: SVGGElement, from: CanvasNode, side: Side, pointer: Point, target: CanvasNode | null): void {
  const geo = target ? edgeGeometry(from, side, target, nearestSide(target, pointer)) : edgeGeometry(from, side, pointer, null)
  tempG.replaceChildren(path(geo.path, 'zn-cedge-line', 'is-temp'), path(arrowHead(geo.end, geo.endDir), 'zn-cedge-head', 'is-temp'))
}

export function nearestSide(r: Rect, p: Point): Side {
  const d = { top: Math.abs(p.y - r.y), bottom: Math.abs(p.y - (r.y + r.height)), left: Math.abs(p.x - r.x), right: Math.abs(p.x - (r.x + r.width)) }
  return (Object.entries(d) as Array<[Side, number]>).sort((a, b) => a[1] - b[1])[0][0]
}
