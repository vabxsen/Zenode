import type { TreeEntry } from '../../../shared/api'
import { baseName, isMarkdown, joinPath, parentDir, relativePath, stripMd } from '../paths'
import { parseCanvas, serializeCanvas } from '../canvas/model'
import { isCanvasPath, parseCanvasMeta } from './canvasMeta'
import { parseNote, type LinkRef, type NoteMeta } from './parser'

export interface IndexedNote {
  path: string
  // The file's raw text.
  content: string
  // What search looks at: the note itself, or a canvas's card texts.
  searchText: string
  meta: NoteMeta
}

// Notes and canvases are indexed; everything else is just a file.
export function isIndexable(path: string): boolean {
  return isMarkdown(path) || isCanvasPath(path)
}

export interface Backlink {
  source: string
  refs: LinkRef[]
}

export interface TextEdit {
  start: number
  end: number
  text: string
}

interface PendingRename {
  source: string
  ref: LinkRef
  target: string
}

const READ_BATCH = 200

// In-memory index of every note: content, parsed metadata, resolved links and backlinks.
export class MetadataCache {
  private notes = new Map<string, IndexedNote>()
  private files = new Map<string, string>() // lower-case path -> path, every file in the vault
  private byName = new Map<string, string[]>() // lower-case file name -> paths
  private backlinkIndex = new Map<string, Set<string>>() // target -> sources
  resolvedLinks: Record<string, Record<string, number>> = {}
  unresolvedLinks: Record<string, Record<string, number>> = {}
  private worker: Worker | null = null
  private requestId = 0
  private pending = new Map<number, (results: Array<[string, NoteMeta, string]>) => void>()
  private listeners = new Set<(path: string | null) => void>()

  constructor() {
    try {
      this.worker = new Worker(new URL('./indexer.worker.ts', import.meta.url), { type: 'module', name: 'Zenode Indexer' })
      this.worker.onmessage = (e: MessageEvent<{ id: number; results: Array<[string, NoteMeta, string]> }>) => {
        this.pending.get(e.data.id)?.(e.data.results)
        this.pending.delete(e.data.id)
      }
    } catch {
      this.worker = null
    }
  }

  dispose(): void {
    this.worker?.terminate()
    this.listeners.clear()
  }

  // Listeners get the changed path, or null after a full rebuild.
  onChange(cb: (path: string | null) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(path: string | null): void {
    for (const cb of this.listeners) cb(path)
  }

  private parse(files: Array<[string, string]>): Promise<Array<[string, NoteMeta, string]>> {
    if (!this.worker) {
      return Promise.resolve(
        files.map(([p, t]): [string, NoteMeta, string] => {
          if (!isCanvasPath(p)) return [p, parseNote(t), t]
          const { meta, searchText } = parseCanvasMeta(t)
          return [p, meta, searchText]
        })
      )
    }
    const id = ++this.requestId
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.worker!.postMessage({ id, files })
    })
  }

  // ---------- Building ----------

  async build(tree: TreeEntry[]): Promise<void> {
    this.notes.clear()
    this.setFiles(tree)
    const mdPaths = [...this.files.values()].filter(isIndexable)
    for (let i = 0; i < mdPaths.length; i += READ_BATCH) {
      const contents = await window.zenode.readMany(mdPaths.slice(i, i + READ_BATCH))
      const batch = Object.entries(contents).filter((e): e is [string, string] => e[1] !== null)
      for (const [path, meta, searchText] of await this.parse(batch)) {
        this.notes.set(path, { path, content: contents[path]!, searchText, meta })
      }
    }
    this.resolveAll()
    this.emit(null)
  }

  // Reconcile with a fresh file tree: index new notes, drop deleted ones.
  async sync(tree: TreeEntry[]): Promise<void> {
    this.setFiles(tree)
    const present = new Set(this.files.values())
    for (const path of [...this.notes.keys()]) if (!present.has(path)) this.notes.delete(path)
    const added = [...present].filter((p) => isIndexable(p) && !this.notes.has(p))
    if (added.length) {
      const contents = await window.zenode.readMany(added)
      const batch = Object.entries(contents).filter((e): e is [string, string] => e[1] !== null)
      for (const [path, meta, searchText] of await this.parse(batch)) {
        this.notes.set(path, { path, content: contents[path]!, searchText, meta })
      }
    }
    this.resolveAll()
    this.emit(null)
  }

  // Re-read notes that changed on disk.
  async refresh(paths: string[]): Promise<void> {
    const targets = paths.filter((p) => isIndexable(p) && this.files.has(p.toLowerCase()))
    if (!targets.length) return
    const contents = await window.zenode.readMany(targets)
    for (const path of targets) {
      const content = contents[path]
      if (content == null || this.notes.get(path)?.content === content) continue
      await this.setContent(path, content)
    }
  }

  // The app saved a note: update it without touching the disk again.
  async setContent(path: string, content: string): Promise<void> {
    const [[, meta, searchText]] = await this.parse([[path, content]])
    this.notes.set(path, { path, content, searchText, meta })
    this.resolveSource(path)
    this.emit(path)
  }

  private setFiles(tree: TreeEntry[]): void {
    this.files.clear()
    this.byName.clear()
    const walk = (entries: TreeEntry[]): void => {
      for (const e of entries) {
        if (e.kind === 'folder') {
          walk(e.children ?? [])
          continue
        }
        this.files.set(e.path.toLowerCase(), e.path)
        const key = e.name.toLowerCase()
        const list = this.byName.get(key)
        if (list) list.push(e.path)
        else this.byName.set(key, [e.path])
      }
    }
    walk(tree)
  }

  // ---------- Resolution ----------

  private resolveAll(): void {
    this.resolvedLinks = {}
    this.unresolvedLinks = {}
    this.backlinkIndex.clear()
    for (const path of this.notes.keys()) this.resolveSource(path)
  }

  private resolveSource(source: string): void {
    const old = this.resolvedLinks[source]
    if (old) for (const target of Object.keys(old)) this.backlinkIndex.get(target)?.delete(source)
    const resolved: Record<string, number> = {}
    const unresolved: Record<string, number> = {}
    for (const ref of this.notes.get(source)?.meta.links ?? []) {
      const target = this.resolve(ref.link, source)
      if (target) {
        resolved[target] = (resolved[target] ?? 0) + 1
        let set = this.backlinkIndex.get(target)
        if (!set) this.backlinkIndex.set(target, (set = new Set()))
        set.add(source)
      } else if (ref.link) {
        unresolved[ref.link] = (unresolved[ref.link] ?? 0) + 1
      }
    }
    this.resolvedLinks[source] = resolved
    this.unresolvedLinks[source] = unresolved
  }

  // Obsidian-compatible link resolution: exact or relative path first, then a
  // unique file name, then any path ending in the link, preferring the source's folder.
  resolve(link: string, source: string): string | null {
    const lp = link.replace(/\\/g, '/').trim()
    if (!lp) return this.notes.has(source) ? source : null
    const srcDir = parentDir(source)

    const tryPath = (p: string | null): string | null => {
      if (p === null) return null
      return this.files.get(p.toLowerCase()) ?? this.files.get(`${p}.md`.toLowerCase()) ?? null
    }
    if (lp.startsWith('./') || lp.startsWith('../')) return tryPath(joinPath(srcDir, lp))
    if (lp.startsWith('/')) return tryPath(joinPath('', lp.slice(1)))
    const exact = tryPath(joinPath('', lp))
    if (exact) return exact

    const name = baseName(lp).toLowerCase()
    const candidates = this.byName.get(name) ?? this.byName.get(`${name}.md`) ?? []
    const suffix = lp.toLowerCase()
    const matches = candidates.filter((p) => {
      const lower = p.toLowerCase()
      return lower === suffix || lower === `${suffix}.md` || lower.endsWith(`/${suffix}`) || lower.endsWith(`/${suffix}.md`)
    })
    if (matches.length <= 1) return matches[0] ?? null
    const inFolder = (p: string): boolean => !srcDir || p.startsWith(`${srcDir}/`)
    return matches.sort((a, b) => Number(inFolder(b)) - Number(inFolder(a)) || a.length - b.length)[0]
  }

  // Shortest link text for `target`: the bare name when it is unique in the vault
  // (so the link stays stable as files are added), otherwise the full path.
  linktext(target: string, source: string): string {
    const name = baseName(target)
    const short = isMarkdown(target) ? stripMd(name) : name
    const unique = (this.byName.get(name.toLowerCase()) ?? []).length === 1
    if (unique && this.resolve(short, source) === target) return short
    return isMarkdown(target) ? stripMd(target) : target
  }

  // ---------- Queries ----------

  getNote(path: string): IndexedNote | undefined {
    return this.notes.get(path)
  }

  allNotes(): IndexedNote[] {
    return [...this.notes.values()]
  }

  exists(path: string): boolean {
    return this.files.has(path.toLowerCase())
  }

  allFiles(): string[] {
    return [...this.files.values()]
  }

  getBacklinks(target: string): Backlink[] {
    const out: Backlink[] = []
    for (const source of this.backlinkIndex.get(target) ?? []) {
      if (source === target) continue
      const refs = (this.notes.get(source)?.meta.links ?? []).filter((r) => this.resolve(r.link, source) === target)
      if (refs.length) out.push({ source, refs })
    }
    return out.sort((a, b) => a.source.localeCompare(b.source))
  }

  // ---------- Rename support ----------

  // Step 1, before the rename happens: remember every link that points at the old path.
  collectRenameRefs(from: string, isFolder: boolean): PendingRename[] {
    const hits: PendingRename[] = []
    for (const note of this.notes.values()) {
      for (const ref of note.meta.links) {
        const target = this.resolve(ref.link, note.path)
        if (target && (target === from || (isFolder && target.startsWith(`${from}/`)))) {
          hits.push({ source: note.path, ref, target })
        }
      }
    }
    return hits
  }

  // Step 2, after the rename and a fresh sync: rewrite those links so they point at the new path.
  buildRenameEdits(pending: PendingRename[], from: string, to: string): Map<string, TextEdit[]> {
    const move = (p: string): string => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p)
    const edits = new Map<string, TextEdit[]>()
    for (const { source, ref, target } of pending) {
      if (ref.canvasNode) continue // canvases are rewritten as JSON by buildCanvasRenames
      const newSource = move(source)
      const newTarget = move(target)
      let text: string
      if (ref.kind === 'wiki') {
        const alias = ref.alias ? `|${ref.alias}` : ''
        text = `${ref.embed ? '!' : ''}[[${this.linktext(newTarget, newSource)}${ref.subpath}${alias}]]`
      } else {
        const rel = relativePath(parentDir(newSource), newTarget).split('/').map(encodeURIComponent).join('/')
        text = `${ref.embed ? '!' : ''}[${ref.alias}](${rel}${ref.subpath ? encodeURI(ref.subpath) : ''})`
      }
      if (text === ref.original) continue
      const list = edits.get(newSource) ?? []
      list.push({ start: ref.start, end: ref.end, text })
      edits.set(newSource, list)
    }
    return edits
  }

  // Canvases store links in JSON (file cards, group backgrounds, card text): rewrite those.
  // Returns the new file text for every canvas that changed.
  buildCanvasRenames(pending: PendingRename[], from: string, to: string): Map<string, string> {
    const move = (p: string): string => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p)
    const bySource = new Map<string, PendingRename[]>()
    for (const p of pending) {
      if (!p.ref.canvasNode) continue
      const list = bySource.get(p.source) ?? []
      list.push(p)
      bySource.set(p.source, list)
    }
    const out = new Map<string, string>()
    for (const [source, refs] of bySource) {
      const newSource = move(source)
      const note = this.notes.get(newSource)
      if (!note) continue
      let data
      try {
        data = parseCanvas(note.content)
      } catch {
        continue
      }
      for (const { ref, target } of refs) {
        const node = data.nodes.find((n) => n.id === ref.canvasNode)
        if (!node) continue
        const newTarget = move(target)
        if (ref.kind === 'canvas') {
          if (node.type === 'file') node.file = newTarget
          else if (node.type === 'group') node.background = newTarget
        } else if (node.type === 'text' && typeof node.text === 'string') {
          const alias = ref.alias ? `|${ref.alias}` : ''
          const text = `${ref.embed ? '!' : ''}[[${this.linktext(newTarget, newSource)}${ref.subpath}${alias}]]`
          node.text = (node.text as string).replace(ref.original, text)
        }
      }
      const updated = serializeCanvas(data)
      if (updated !== note.content) out.set(newSource, updated)
    }
    return out
  }
}

export function applyEdits(content: string, edits: TextEdit[]): string {
  let out = content
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end)
  }
  return out
}
