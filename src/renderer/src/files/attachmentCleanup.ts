// "Find unused attachments": lists files no note or canvas uses and deletes
// the ones the user keeps ticked (to the Recycle Bin or the vault's .trash).
import type { TreeEntry } from '../../../shared/api'
import { el } from '../component'
import type { TrashOption } from '../config'
import { openDialog } from '../dialog'
import type { MetadataCache } from '../index/metadataCache'
import { findUnusedAttachments } from './unusedAttachments'

const api = window.zenode

export interface CleanupDeps {
  cache: MetadataCache
  trashOption: TrashOption
  // A file went: close its tabs and forget it (bookmarks).
  removed(path: string): void
  refreshTree(): Promise<void>
  notice(message: string): void
}

function allFiles(entries: TreeEntry[]): string[] {
  return entries.flatMap((e) => (e.kind === 'folder' ? allFiles(e.children ?? []) : [e.path]))
}

export async function cleanUpAttachments(d: CleanupDeps): Promise<void> {
  const files = allFiles(await api.list())
  const notes = d.cache.allNotes().map((n) => ({ path: n.path, content: n.content }))
  const unused = findUnusedAttachments(files, notes, d.cache.resolvedLinks)
  if (!unused.length) {
    d.notice('No unused attachments: every file is used by a note or canvas.')
    return
  }
  const where = d.trashOption === 'local' ? "the vault's .trash folder" : 'the Recycle Bin'
  const body = el('div', 'zn-cleanup')
  el('p', 'zn-cleanup-intro', body, `${unused.length} file${unused.length === 1 ? ' is' : 's are'} not linked or mentioned anywhere. Ticked files go to ${where}.`)
  const list = el('div', 'zn-cleanup-list', body)
  const boxes = unused.map((path) => {
    const row = el('label', 'zn-cleanup-row', list)
    const box = el('input', '', row)
    box.type = 'checkbox'
    box.checked = true
    el('span', 'zn-cleanup-path', row, path)
    return { path, box }
  })
  const ok = await openDialog({
    title: 'Unused attachments',
    body,
    buttons: [
      { label: 'Cancel', value: false },
      { label: 'Delete ticked files', value: true, danger: true }
    ],
    cancelValue: false,
    className: 'zn-cleanup-dialog'
  })
  if (!ok) return
  let done = 0
  for (const { path, box } of boxes) {
    if (!box.checked) continue
    try {
      await api.trash(path)
      d.removed(path)
      done++
    } catch (e) {
      d.notice(`Could not delete ${path}: ${(e as Error).message}`)
    }
  }
  await d.refreshTree()
  if (done) d.notice(`Moved ${done} unused file${done === 1 ? '' : 's'} to ${where}.`)
}
