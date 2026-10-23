// The crash-recovery journal for a pane's note tabs: text that stays unsaved
// for a moment is copied to %APPDATA%\Zenode\recovery, and dropped once saved.
import { contentHash } from '../../shared/hash'
import type { Tab } from './paneTypes'

// Unsaved text still unsaved after this long goes to the crash-recovery journal
// (continuous typing keeps postponing autosave, so this bounds what a crash can lose).
const JOURNAL_DELAY = 1500

export function scheduleJournal(tab: Tab, write: (tab: Tab) => void): void {
  if (tab.journalTimer !== null) window.clearTimeout(tab.journalTimer)
  tab.journalTimer = window.setTimeout(() => write(tab), JOURNAL_DELAY)
}

// Copies `text` (the tab's current text) to the journal if it isn't what's saved.
export function writeJournal(tab: Tab, text: string, onError: (message: string) => void): void {
  if (tab.journalTimer !== null) window.clearTimeout(tab.journalTimer)
  tab.journalTimer = null
  if (text === tab.lastSaved) return
  tab.journaled = true
  window.zenode.journalPut(tab.path, text, contentHash(tab.lastSaved)).catch((e: Error) => onError(`Could not keep a recovery copy: ${e.message}`))
}

export function unjournal(tab: Tab): void {
  if (tab.journalTimer !== null) window.clearTimeout(tab.journalTimer)
  tab.journalTimer = null
  if (!tab.journaled) return
  tab.journaled = false
  void window.zenode.journalRemove(tab.path).catch(() => undefined)
}
