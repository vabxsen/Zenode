// "Sync conflicts": copies left by sync tools and notes with merge markers,
// with ways to merge or tidy them up. Copies go to the Recycle Bin, never deleted outright.
import { contentHash } from '../../../shared/hash'
import { Component, el } from '../component'
import { openCompareDialog } from '../conflictUi'
import { openDialog } from '../dialog'
import type { MetadataCache } from '../index/metadataCache'
import { baseName, isMarkdown, stripExt } from '../paths'
import type { Workspace } from '../workspace'
import { findConflictCopies, hasMergeMarkers, type ConflictCopy } from './conflictCopies'

const api = window.zenode
const TEXT = /\.(md|canvas|txt|json|css|base)$/i
const SCAN_DELAY = 400

export type SyncIssue = { kind: 'copy'; copy: ConflictCopy } | { kind: 'markers'; path: string }

export function findSyncIssues(cache: MetadataCache): SyncIssue[] {
  const files = cache.allFiles()
  const issues: SyncIssue[] = findConflictCopies(files).map((copy) => ({ kind: 'copy', copy }))
  for (const path of files) {
    if (!isMarkdown(path)) continue
    const note = cache.getNote(path)
    if (note && hasMergeMarkers(note.content)) issues.push({ kind: 'markers', path })
  }
  return issues
}

export interface SyncPanelDeps {
  cache: MetadataCache
  workspace(): Workspace | null
  openPath(path: string): void
  notice(message: string): void
}

// A status-bar button that appears while there are sync issues and opens the list.
export class SyncIndicator extends Component {
  private issues: SyncIssue[] = []
  private timer: number | null = null
  private readonly button: HTMLButtonElement

  constructor(
    parent: HTMLElement,
    private readonly deps: SyncPanelDeps
  ) {
    super()
    this.button = el('button', 'zn-status-sync', parent)
    this.button.style.display = 'none'
    this.button.addEventListener('click', () => void this.open())
  }

  onload(): void {
    this.register(this.deps.cache.onChange(() => this.scanSoon()))
    this.register(() => {
      if (this.timer !== null) window.clearTimeout(this.timer)
    })
    this.scanSoon()
  }

  scanSoon(): void {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.scan(), SCAN_DELAY)
  }

  private scan(): void {
    this.issues = findSyncIssues(this.deps.cache)
    const n = this.issues.length
    this.button.style.display = n ? '' : 'none'
    this.button.textContent = `⚠ ${n} sync conflict${n === 1 ? '' : 's'}`
    this.button.title = 'Copies left by a sync app, or notes with merge markers. Click to review.'
  }

  async open(): Promise<void> {
    this.scan()
    const body = el('div', 'zn-sync')
    const list = el('div', 'zn-sync-list', body)
    const render = (): void => {
      list.replaceChildren()
      if (!this.issues.length) {
        el('div', 'zn-sync-empty', list, 'No sync conflicts left.')
        return
      }
      for (const issue of this.issues) this.renderIssue(list, issue, render)
    }
    render()
    el('p', 'zn-dialog-hint', body, 'Copies you remove go to the Recycle Bin, and anything replaced is kept in File recovery.')
    await openDialog({
      title: 'Sync conflicts',
      body,
      className: 'zn-dialog-wide',
      buttons: [{ label: 'Done', value: null, primary: true }],
      cancelValue: null
    })
  }

  private renderIssue(list: HTMLElement, issue: SyncIssue, rerender: () => void): void {
    const row = el('div', 'zn-sync-row', list)
    const info = el('div', 'zn-sync-info', row)
    const actions = el('div', 'zn-sync-actions', row)
    const action = (label: string, run: () => Promise<boolean | void>, primary = false): void => {
      const b = el('button', `zn-btn${primary ? ' zn-btn-primary' : ''}`, actions, label)
      b.addEventListener('click', async () => {
        b.disabled = true
        try {
          if ((await run()) !== false) {
            this.issues = this.issues.filter((i) => i !== issue)
            rerender()
            this.scanSoon()
          }
        } catch (e) {
          this.deps.notice((e as Error).message)
        } finally {
          b.disabled = false
        }
      })
    }

    if (issue.kind === 'markers') {
      el('div', 'zn-sync-name', info, stripExt(baseName(issue.path)))
      el('div', 'zn-sync-meta', info, `${issue.path} · contains merge markers (<<<<<<< ======= >>>>>>>)`)
      action('Open note', async () => {
        this.deps.openPath(issue.path)
        return false
      }, true)
      return
    }

    const { copy } = issue
    const from = copy.device ? `${copy.tool}, from ${copy.device}` : copy.tool
    el('div', 'zn-sync-name', info, baseName(copy.path))
    el('div', 'zn-sync-meta', info, copy.originalExists ? `Copy of ${copy.original} (${from})` : `${from}; the original ${copy.original} no longer exists`)
    const isText = TEXT.test(copy.path)
    if (copy.originalExists && isText) action('Compare and merge', () => this.merge(copy), true)
    if (!copy.originalExists) action('Use as the original', async () => {
      await api.rename(copy.path, baseName(copy.original))
    }, true)
    action('Open copy', async () => {
      this.deps.openPath(copy.path)
      return false
    })
    action('Move copy to Recycle Bin', async () => {
      await api.trash(copy.path)
    })
  }

  // Compare the copy with the current note; saving writes the merge into the note
  // and moves the copy to the Recycle Bin.
  private async merge(copy: ConflictCopy): Promise<boolean> {
    const [copyText, current] = await Promise.all([api.read(copy.path), api.read(copy.original)])
    const merged = await openCompareDialog(baseName(copy.original), copyText, current, {
      left: `Conflict copy (${copy.device ? `from ${copy.device}` : copy.tool})`,
      right: 'Current version (edit this; arrows copy changes across)',
      save: 'Save and remove the copy'
    })
    if (merged === null) return false
    if (merged !== current) {
      const ws = this.deps.workspace()
      if (!ws?.replaceText(copy.original, merged)) {
        await api.keepSnapshot(copy.original, current)
        const result = await api.writeChecked(copy.original, merged, contentHash(current))
        if (result.status === 'conflict') throw new Error(`${copy.original} changed while merging; nothing was overwritten. Try again.`)
      }
    }
    await api.trash(copy.path)
    return true
  }
}
