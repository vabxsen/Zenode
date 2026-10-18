// The saved index: unchanged files are reused, changed ones are read again,
// and notes edited in the app are left out of the next save.
import { MetadataCache } from '../src/renderer/src/index/metadataCache'
import { INDEX_FORMAT } from '../src/renderer/src/index/indexStore'
import { eq } from './harness'

const disk: Record<string, string> = { 'A.md': 'Links [[B]] #tag', 'B.md': '# B\nBack to [[A]]', 'C.canvas': '{"nodes":[{"id":"1","type":"text","text":"see [[A]]","x":0,"y":0,"width":10,"height":10}],"edges":[]}' }
let reads: string[] = []
;(globalThis as any).window.zenode.readMany = async (ps: string[]) => {
  reads.push(...ps)
  return Object.fromEntries(ps.map((p) => [p, disk[p] ?? null]))
}
const entry = (path: string, mtime: number) => ({ name: path, path, kind: 'file', ext: path.split('.').pop(), mtime, size: disk[path].length })
const tree = (bMtime = 2) => [entry('A.md', 1), entry('B.md', bMtime), entry('C.canvas', 3)] as any

const first = new MetadataCache()
eq('cache: first build reads everything', await first.build(tree()), { reused: 0, read: 3 })
const saved = { format: INDEX_FORMAT, notes: first.snapshot() }
eq('cache: snapshot has every note', saved.notes.map((n) => n.path).sort(), ['A.md', 'B.md', 'C.canvas'])

reads = []
const warm = new MetadataCache()
eq('cache: warm build reuses unchanged files', await warm.build(tree(), saved), { reused: 3, read: 0 })
eq('cache: nothing read from disk', reads, [])
eq('cache: links still resolve', warm.getBacklinks('A.md').map((b) => b.source).sort(), ['B.md', 'C.canvas'])
eq('cache: canvas search text kept', warm.getNote('C.canvas')?.searchText.includes('see [[A]]'), true)

reads = []
const changed = new MetadataCache()
eq('cache: a changed file is read again', await changed.build(tree(9), saved), { reused: 2, read: 1 })
eq('cache: only that file', reads, ['B.md'])

await changed.setContent('A.md', 'edited in the app')
eq('cache: edited notes are not saved with old stats', changed.snapshot().map((n) => n.path).sort(), ['B.md', 'C.canvas'])
first.dispose()
warm.dispose()
changed.dispose()
