// After a crash or a forced quit: offer back note text that was never saved.
import { el } from './component'
import { openDialog } from './dialog'
import { noteTitle, type Workspace } from './workspace'

const api = window.zenode

export async function offerRecovery(workspace: Workspace, notice: (message: string) => void): Promise<void> {
  let entries
  try {
    entries = await api.journalList()
  } catch (e) {
    notice(`Could not check for unsaved changes: ${(e as Error).message}`)
    return
  }
  // Entries whose text is already on disk are leftovers; drop them quietly.
  const pending = []
  for (const entry of entries) {
    const disk = await api.read(entry.path).catch(() => null)
    if (disk === entry.content) await api.journalRemove(entry.path).catch(() => undefined)
    else pending.push(entry)
  }
  if (!pending.length) return

  const body = el('div', 'zn-recovery')
  el('p', '', body, `Zenode didn't close properly last time. ${pending.length === 1 ? 'This note has' : 'These notes have'} changes that were never saved:`)
  const list = el('ul', 'zn-recovery-list', body)
  for (const entry of pending) {
    const item = el('li', '', list)
    el('span', 'zn-recovery-name', item, noteTitle(entry.path))
    el('span', 'zn-recovery-meta', item, ` ${entry.path} · ${new Date(entry.time).toLocaleString()}`)
  }
  el('p', 'zn-dialog-hint', body, 'Restoring never overwrites a newer version: if a note changed since, you can compare both. Discarded text is kept in File recovery for 7 days.')

  const choice = await openDialog<'restore' | 'discard' | 'later'>({
    title: 'Recover unsaved changes',
    body,
    buttons: [
      { label: 'Not now', value: 'later' },
      { label: 'Discard', value: 'discard', danger: true },
      { label: pending.length === 1 ? 'Restore' : `Restore all (${pending.length})`, value: 'restore', primary: true }
    ],
    cancelValue: 'later'
  })
  if (choice === 'later') return
  for (const entry of pending) {
    try {
      if (choice === 'restore') {
        // Remove the old entry first: the restored tab journals itself again while unsaved.
        await api.journalRemove(entry.path)
        await workspace.restoreUnsaved(entry.path, entry.content, entry.baseHash)
      } else {
        await api.keepSnapshot(entry.path, entry.content)
        await api.journalRemove(entry.path)
      }
    } catch (e) {
      // Whatever went wrong, the text survives in File recovery.
      await api.keepSnapshot(entry.path, entry.content).catch(() => undefined)
      notice(`Could not ${choice} ${entry.path}: ${(e as Error).message}. A copy is in File recovery.`)
    }
  }
}
