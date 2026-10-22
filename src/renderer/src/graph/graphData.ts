import type { MetadataCache } from '../index/metadataCache'
import { baseName, isMarkdown, stripExt } from '../paths'
import { matchNote, parseQuery } from '../search/query'

export type NodeKind = 'note' | 'tag' | 'attachment' | 'unresolved'

export interface GraphNode {
  id: string
  kind: NodeKind
  label: string
  degree: number
}

export interface GraphData {
  nodes: GraphNode[]
  // Index pairs into `nodes`.
  links: Array<[number, number]>
}

export interface GraphFilters {
  showTags: boolean
  showAttachments: boolean
  showOrphans: boolean
  showUnresolved: boolean
  search: string
}

export interface LocalOptions {
  center: string
  depth: number
}

// Build the node/link lists from the link index, the way Obsidian's graph does:
// notes are nodes, resolved links are edges; tags, attachments and unresolved
// links are optional extra node kinds.
export function buildGraph(cache: MetadataCache, filters: GraphFilters, local?: LocalOptions): GraphData {
  const ids = new Map<string, number>()
  const nodes: GraphNode[] = []
  const edgeSet = new Set<string>()
  const links: Array<[number, number]> = []

  const add = (id: string, kind: NodeKind, label: string): number => {
    let i = ids.get(id)
    if (i === undefined) {
      i = nodes.length
      ids.set(id, i)
      nodes.push({ id, kind, label, degree: 0 })
    }
    return i
  }
  const connect = (a: number, b: number): void => {
    if (a === b) return
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    if (edgeSet.has(key)) return
    edgeSet.add(key)
    links.push([a, b])
    nodes[a].degree++
    nodes[b].degree++
  }

  // Optional search filter, using the same query language as the search pane.
  const query = filters.search.trim() ? parseQuery(filters.search) : null
  const passes = (path: string): boolean => {
    if (!query || query.error || !query.terms.length) return true
    const note = cache.getNote(path)
    if (!note) return query.terms.every((t) => t.negate) // attachments only pass pure exclusions
    const tags = [...note.meta.tags.map((t) => t.tag), ...note.meta.frontmatterTags]
    return matchNote(query.terms, { path, content: note.searchText, tags }) !== null
  }

  const notes = cache.allNotes().filter((n) => passes(n.path))
  for (const note of notes) add(note.path, 'note', stripExt(baseName(note.path)))

  if (filters.showAttachments) {
    for (const path of cache.allFiles()) {
      if (!isMarkdown(path) && !path.toLowerCase().endsWith('.canvas') && passes(path)) add(path, 'attachment', baseName(path))
    }
  }

  for (const note of notes) {
    const from = ids.get(note.path)!
    for (const target of Object.keys(cache.resolvedLinks[note.path] ?? {})) {
      const to = ids.get(target)
      if (to !== undefined) connect(from, to)
    }
    if (filters.showUnresolved) {
      for (const link of Object.keys(cache.unresolvedLinks[note.path] ?? {})) {
        connect(from, add(`unresolved:${link.toLowerCase()}`, 'unresolved', link))
      }
    }
    if (filters.showTags) {
      const tags = new Set([...note.meta.tags.map((t) => t.tag), ...note.meta.frontmatterTags].map((t) => t.toLowerCase()))
      for (const tag of tags) connect(from, add(`tag:${tag}`, 'tag', tag))
    }
  }

  let data: GraphData = { nodes, links }
  if (local) data = localSubgraph(data, ids.get(local.center), local.depth)
  if (!filters.showOrphans && !local) data = dropOrphans(data)
  return data
}

// Keep nodes within `depth` hops of the center (links followed in both directions).
function localSubgraph(data: GraphData, center: number | undefined, depth: number): GraphData {
  if (center === undefined) return { nodes: [], links: [] }
  const adjacency = new Map<number, number[]>()
  for (const [a, b] of data.links) {
    ;(adjacency.get(a) ?? adjacency.set(a, []).get(a)!).push(b)
    ;(adjacency.get(b) ?? adjacency.set(b, []).get(b)!).push(a)
  }
  const keep = new Set([center])
  let frontier = [center]
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: number[] = []
    for (const n of frontier) {
      for (const m of adjacency.get(n) ?? []) {
        if (!keep.has(m)) {
          keep.add(m)
          next.push(m)
        }
      }
    }
    frontier = next
  }
  return subset(data, keep)
}

function dropOrphans(data: GraphData): GraphData {
  const keep = new Set<number>()
  for (const [a, b] of data.links) {
    keep.add(a)
    keep.add(b)
  }
  return subset(data, keep)
}

function subset(data: GraphData, keep: Set<number>): GraphData {
  const remap = new Map<number, number>()
  const nodes: GraphNode[] = []
  data.nodes.forEach((node, i) => {
    if (keep.has(i)) {
      remap.set(i, nodes.length)
      nodes.push({ ...node, degree: 0 })
    }
  })
  const links: Array<[number, number]> = []
  for (const [a, b] of data.links) {
    const na = remap.get(a)
    const nb = remap.get(b)
    if (na !== undefined && nb !== undefined) {
      links.push([na, nb])
      nodes[na].degree++
      nodes[nb].degree++
    }
  }
  return { nodes, links }
}

// What an empty graph says. The local graph's centre can be any open file:
// a note, a canvas, or an image, PDF or other attachment. Attachments are left
// out unless the graph shows them, so an empty graph then says nothing about
// what links to the file.
export function emptyGraphText(local: boolean, center: string | null, showAttachments: boolean): string {
  if (!local) return 'No notes to show.'
  if (!center) return 'Open a note to see its local graph.'
  if (isMarkdown(center)) return 'This note has no links yet.'
  if (center.toLowerCase().endsWith('.canvas')) return 'This canvas has no links yet.'
  if (!showAttachments) return 'Turn on Attachments in the graph settings to see what links to this file.'
  return 'No notes link to this file yet.'
}
