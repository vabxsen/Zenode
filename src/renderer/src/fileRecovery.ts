// File recovery: browse a file's local history (snapshots) and bring a version back.
import type { SnapshotInfo } from '../../shared/api'
import { contentHash } from '../../shared/hash'
import { el } from './component'
import { openDialog } from './dialog'
import type { Workspace } from './workspace'

const api = window.zenode

// Puts an old version back. An open note gets it as an ordinary edit (undoable,
// autosaved); otherwise the file is written, after keeping a copy of what it replaces.
export async function restoreVersion(workspace: Workspace | null, path: string, text: string, notice: (m: string) => void): Promise<void> {
  if (workspace?.replaceText(path, text)) {
    notice('Restored. Press Ctrl+Z to undo.')
    return
  }
  try {
    const disk = await api.read(path).catch(() => null)
    if (disk === text) return
    if (disk === null) {
      await api.write(path, text)
    } else {
      await api.keepSnapshot(path, disk)
      const result = await api.writeChecked(path, text, contentHash(disk))
      if (result.status === 'conflict') {
        notice(`${path} changed while restoring; nothing was overwritten. Try again.`)
        return
      }
    }
    notice(`Restored an earlier version of ${path}.`)
  } catch (e) {
    notice(`Could not restore ${path}: ${(e as Error).message}`)
  }
}

export interface RecoveryHandlers {
  // Put `text` back as the file's content (the caller keeps a copy of what it replaces).
  restore(text: string): Promise<void>
  notice(message: string): void
}

function describeSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

export async function openFileRecovery(path: string, title: string, h: RecoveryHandlers): Promise<void> {
  let snapshots: SnapshotInfo[]
  try {
    snapshots = await api.listSnapshots(path)
  } catch (e) {
    h.notice(`Could not read the history of ${path}: ${(e as Error).message}`)
    return
  }
  if (!snapshots.length) {
    await openDialog({
      title: `History of ${title}`,
      body: 'No earlier versions yet. Zenode keeps a copy of a file before saving over it (at most every 5 minutes) and whenever you discard a version, for 7 days.',
      buttons: [{ label: 'OK', value: null, primary: true }],
      cancelValue: null
    })
    return
  }

  const body = el('div', 'zn-history')
  const list = el('div', 'zn-history-list', body)
  list.setAttribute('role', 'listbox')
  const preview = el('pre', 'zn-history-preview', body)
  let selected: { id: string; text: string } | null = null

  const select = async (snap: SnapshotInfo, row: HTMLElement): Promise<void> => {
    for (const r of list.children) r.classList.remove('is-selected')
    row.classList.add('is-selected')
    try {
      const text = await api.readSnapshot(path, snap.id)
      selected = { id: snap.id, text }
      preview.textContent = text
    } catch (e) {
      selected = null
      preview.textContent = `Could not read this version: ${(e as Error).message}`
    }
  }
  snapshots.forEach((snap, i) => {
    const row = el('button', 'zn-history-row', list)
    row.setAttribute('role', 'option')
    el('span', 'zn-history-time', row, new Date(snap.time).toLocaleString())
    el('span', 'zn-history-size', row, describeSize(snap.size))
    row.addEventListener('click', () => void select(snap, row))
    if (i === 0) void select(snap, row)
  })

  const choice = await openDialog<'restore' | 'copy' | 'close'>({
    title: `History of ${title}`,
    body,
    className: 'zn-dialog-wide',
    buttons: [
      { label: 'Close', value: 'close' },
      { label: 'Copy text', value: 'copy' },
      { label: 'Restore this version', value: 'restore', primary: true }
    ],
    cancelValue: 'close'
  })
  if (choice === 'close' || !selected) return
  const text = (selected as { text: string }).text
  if (choice === 'copy') {
    await navigator.clipboard.writeText(text).then(
      () => h.notice('Copied to the clipboard.'),
      (e: Error) => h.notice(`Could not copy: ${e.message}`)
    )
    return
  }
  await h.restore(text)
}
