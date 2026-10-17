// Force-directed layout off the main thread (d3-force).
// In:  init {count, links, positions, radii} | forces {...} | drag {index, x, y} | release {index} | reheat {alpha}
// Out: tick {positions: Float32Array (x,y per node), alpha} — transferred, not copied.
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum
} from 'd3-force'

export interface Forces {
  center: number
  repel: number
  linkStrength: number
  linkDistance: number
}

type Msg =
  | { type: 'init'; count: number; links: Array<[number, number]>; positions: Float32Array; radii: Float32Array; alpha: number }
  | { type: 'forces'; forces: Forces }
  | { type: 'drag'; index: number; x: number; y: number }
  | { type: 'release'; index: number }
  | { type: 'reheat'; alpha: number }
  | { type: 'stop' }

interface Node extends SimulationNodeDatum {
  r: number
}

let sim: Simulation<Node, SimulationLinkDatum<Node>> | null = null
let nodes: Node[] = []
let forces: Forces = { center: 0.08, repel: 10, linkStrength: 1, linkDistance: 60 }

function applyForces(): void {
  if (!sim) return
  sim.force('x', forceX(0).strength(forces.center))
  sim.force('y', forceY(0).strength(forces.center))
  sim.force('charge', forceManyBody<Node>().strength(-forces.repel * 30).distanceMin(8).theta(0.9))
  const link = sim.force('link') as ReturnType<typeof forceLink<Node, SimulationLinkDatum<Node>>> | undefined
  if (link) {
    link.distance(forces.linkDistance)
    // d3's default strength (1 / min degree) scaled by the slider.
    const counts = new Map<Node, number>()
    for (const l of link.links()) {
      counts.set(l.source as Node, (counts.get(l.source as Node) ?? 0) + 1)
      counts.set(l.target as Node, (counts.get(l.target as Node) ?? 0) + 1)
    }
    link.strength((l) => forces.linkStrength / Math.min(counts.get(l.source as Node) ?? 1, counts.get(l.target as Node) ?? 1))
  }
}

function post(): void {
  const buf = new Float32Array(nodes.length * 2)
  for (let i = 0; i < nodes.length; i++) {
    buf[i * 2] = nodes[i].x ?? 0
    buf[i * 2 + 1] = nodes[i].y ?? 0
  }
  ;(self as unknown as Worker).postMessage({ type: 'tick', positions: buf, alpha: sim?.alpha() ?? 0 }, [buf.buffer])
}

self.onmessage = (e: MessageEvent<Msg>) => {
  const msg = e.data
  switch (msg.type) {
    case 'init': {
      sim?.stop()
      nodes = Array.from({ length: msg.count }, (_, i) => ({
        x: msg.positions[i * 2],
        y: msg.positions[i * 2 + 1],
        r: msg.radii[i]
      }))
      const links = msg.links.map(([s, t]) => ({ source: s, target: t }))
      sim = forceSimulation<Node>(nodes)
        .alpha(msg.alpha)
        .alphaDecay(0.0228)
        .velocityDecay(0.4)
        .force('link', forceLink<Node, SimulationLinkDatum<Node>>(links))
        .force('collide', forceCollide<Node>((n) => n.r + 4).strength(0.5))
        .on('tick', post)
        .on('end', post)
      applyForces()
      break
    }
    case 'forces':
      forces = msg.forces
      applyForces()
      sim?.alpha(Math.max(sim.alpha(), 0.3)).restart()
      break
    case 'drag': {
      const n = nodes[msg.index]
      if (!n) return
      n.fx = msg.x
      n.fy = msg.y
      sim?.alphaTarget(0.3).restart()
      break
    }
    case 'release': {
      const n = nodes[msg.index]
      if (!n) return
      n.fx = null
      n.fy = null
      sim?.alphaTarget(0)
      break
    }
    case 'reheat':
      sim?.alpha(Math.max(sim.alpha(), msg.alpha)).restart()
      break
    case 'stop':
      sim?.stop()
      sim = null
      break
  }
}
