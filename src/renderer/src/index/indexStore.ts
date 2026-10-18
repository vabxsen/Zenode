// The index saved between launches (IndexedDB, one record per vault), so a
// warm start re-reads and re-parses only files that changed. It is only a
// cache: anything missing, old or unreadable just means a full rebuild.
import type { NoteMeta } from './parser'

const DB_NAME = 'zenode-index'
const STORE = 'vaults'
// Bump when the parser or the cached shape changes: old caches are then ignored.
export const INDEX_FORMAT = 1

export interface CachedNote {
  path: string
  // The file's stats when `content` was read.
  mtime: number
  size: number
  content: string
  meta: NoteMeta
  // Only for canvases (a note's search text is its content).
  searchText?: string
}

export interface IndexSnapshot {
  format: number
  notes: CachedNote[]
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const req = work(tx.objectStore(STORE))
        tx.oncomplete = () => {
          db.close()
          resolve(req.result)
        }
        tx.onerror = tx.onabort = () => {
          db.close()
          reject(tx.error ?? req.error)
        }
      })
  )
}

export async function loadIndexSnapshot(vaultId: string): Promise<IndexSnapshot | null> {
  try {
    const snap = (await run('readonly', (s) => s.get(vaultId))) as IndexSnapshot | undefined
    return snap && snap.format === INDEX_FORMAT && Array.isArray(snap.notes) ? snap : null
  } catch {
    return null
  }
}

export async function saveIndexSnapshot(vaultId: string, notes: CachedNote[]): Promise<void> {
  const snap: IndexSnapshot = { format: INDEX_FORMAT, notes }
  await run('readwrite', (s) => s.put(snap, vaultId))
}
