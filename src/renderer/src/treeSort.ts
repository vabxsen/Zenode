// File tree ordering. Folders always come first, by name; files follow the
// chosen order. Returns new arrays (the tree from the main process is left as is).
import type { TreeEntry } from '../../shared/api'

export type SortMode = 'name-asc' | 'name-desc' | 'modified-new' | 'modified-old' | 'created-new' | 'created-old'

export const SORT_MODES: Array<{ mode: SortMode; label: string }> = [
  { mode: 'name-asc', label: 'File name (A to Z)' },
  { mode: 'name-desc', label: 'File name (Z to A)' },
  { mode: 'modified-new', label: 'Modified time (new to old)' },
  { mode: 'modified-old', label: 'Modified time (old to new)' },
  { mode: 'created-new', label: 'Created time (new to old)' },
  { mode: 'created-old', label: 'Created time (old to new)' }
]

export function isSortMode(v: unknown): v is SortMode {
  return SORT_MODES.some((m) => m.mode === v)
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function compareFiles(a: TreeEntry, b: TreeEntry, mode: SortMode): number {
  const byName = collator.compare(a.name, b.name)
  switch (mode) {
    case 'name-asc':
      return byName
    case 'name-desc':
      return -byName
    case 'modified-new':
      return (b.mtime ?? 0) - (a.mtime ?? 0) || byName
    case 'modified-old':
      return (a.mtime ?? 0) - (b.mtime ?? 0) || byName
    case 'created-new':
      return (b.ctime ?? 0) - (a.ctime ?? 0) || byName
    case 'created-old':
      return (a.ctime ?? 0) - (b.ctime ?? 0) || byName
  }
}

export function sortTree(entries: TreeEntry[], mode: SortMode): TreeEntry[] {
  const folders = entries
    .filter((e) => e.kind === 'folder')
    .map((f) => ({ ...f, children: sortTree(f.children ?? [], mode) }))
    .sort((a, b) => (mode === 'name-desc' ? -1 : 1) * collator.compare(a.name, b.name))
  const files = entries.filter((e) => e.kind === 'file').sort((a, b) => compareFiles(a, b, mode))
  return [...folders, ...files]
}
