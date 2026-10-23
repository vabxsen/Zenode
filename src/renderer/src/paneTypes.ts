// Types and helpers shared by panes and the workspace.
import type { EditorState } from '@codemirror/state'
import type { PaneLayout } from '../../shared/api'
import { openDialog } from './dialog'
import type { LinkTarget } from './editor/linkCompletion'
import type { ReadingContext } from './render/reading'

// A non-note tab (e.g. the graph). The workspace mounts `el` and shows/hides it.
export interface WorkspaceView {
  readonly id: string
  readonly title: string
  readonly el: HTMLElement
  show(): void
  hide(): void
  destroy(): void
  // File-backed views (e.g. a canvas) follow renames, save and reload like notes.
  readonly filePath?: string
  setPath?(path: string): void
  save?(): Promise<void>
  reloadFromDisk?(): Promise<void>
  // The file was deleted: close without writing it back.
  discard?(): void
  // While the view's unsaved content conflicts with the file on disk: that content.
  conflictText?(): string | null
}

export interface Tab {
  path: string
  kind: 'note' | 'view'
  state: EditorState | null
  view: WorkspaceView | null
  // The file's content as last read from or written to disk.
  lastSaved: string
  dirty: boolean
  timer: number | null
  // The file changed on disk (disk: new content) or vanished (disk: null) while
  // this tab had unsaved edits. Autosave pauses until the user picks a version.
  conflict: { disk: string | null } | null
  // The save in flight, so a change notification for our own write waits for it.
  saving: Promise<void> | null
  // Crash recovery: pending journal write, and whether an entry exists for this tab.
  journalTimer: number | null
  journaled: boolean
  // Reading view (rendered, read-only) and Source mode (plain Markdown) for note tabs.
  reading: boolean
  source: boolean
  // Pinned tabs sit first and can't be closed until unpinned.
  pinned: boolean
}

// A tab being moved to another pane (its editor state and view travel with it).
export type MovedTab = Tab

// What a pane saves in the layout.
export type PaneState = PaneLayout

export const VIEW_PREFIX = 'zenode:'

export interface OpenPosition {
  from: number
  to?: number
}

export interface WorkspaceHost {
  // `path` is the active note (null for view tabs); `title` is what the tab shows.
  onActiveChange(path: string | null, title: string): void
  onOpenLink(href: string, fromPath: string): void
  onOpenWikiLink(target: string, fromPath: string): void
  onOpenTag(tag: string): void
  isResolved(link: string, fromPath: string): boolean
  linkTargets(fromPath: string): LinkTarget[]
  onSaved(path: string, content: string): void
  onStats(words: number, chars: number): void
  onLayoutChange(): void
  onError(message: string): void
  // Text about to be thrown away (the user chose another version): keep a copy.
  preserve(path: string, text: string): void
  // Saves pasted/dropped files for the note at notePath; returns the links to insert.
  importFiles(notePath: string, files: File[]): Promise<string>
  // Links, embeds and clicks for a note shown in Reading view.
  readingContext(path: string): Omit<ReadingContext, 'sourcePath' | 'onToggleTask'>
  // The tab bar's "+" button.
  newNote(): void
  // Renames a note from its inline title; false if that didn't happen.
  renameNote(path: string, name: string): Promise<boolean>
}

// What a pane needs from the workspace around it.
export interface PaneHost extends WorkspaceHost {
  // This pane was clicked or focused.
  onFocus(): void
  // Whether this is the workspace's active pane (only that one takes keyboard focus).
  isActivePane(): boolean
  // The user closed the pane's last tab.
  onEmptied(): void
  // Open a path that's no longer in a tab (history navigation).
  reopen(path: string): Promise<void>
  // Open this tab's file in a new pane beside or below this one.
  splitWith(path: string, dir: 'right' | 'down'): void
  revealInTree(path: string): void
  // Drag & drop of tabs: the data to carry, and a tab dropped on this tab bar at index.
  dragData(path: string): string
  onDropTab(data: string, index: number): void
}

export const TAB_DRAG_TYPE = 'application/x-zenode-tab'

// Notes bigger than this (in characters) ask before opening: the live editor
// gets slow on multi-megabyte files, and they're often logs or exports.
export const LARGE_NOTE = 5_000_000

export async function confirmLargeNote(path: string, length: number): Promise<boolean> {
  const mb = (length / 1_000_000).toFixed(1)
  return openDialog({
    title: 'Open a very large note?',
    body: `"${noteTitle(path)}" is about ${mb} million characters. Editing it in Zenode may be slow. It won't be changed unless you edit it.`,
    buttons: [
      { label: 'Cancel', value: false },
      { label: 'Open anyway', value: true, primary: true }
    ],
    cancelValue: false
  })
}

export function noteTitle(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name
}

// Changes to a note's text, and where the cursor goes afterwards (in the new text).
export interface TextEdit {
  changes: Array<{ from: number; to?: number; insert: string }>
  cursor: number
}
