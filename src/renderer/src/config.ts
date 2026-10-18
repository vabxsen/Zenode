// Validation for the per-vault config files in <vault>/.zenode/. Config is
// user-editable JSON, so every value is checked and anything unexpected falls
// back to the default instead of breaking the app.
import type { LayoutNode, WorkspaceState } from '../../shared/api'
import type { Hotkey, Modifier } from './commands'

const MODIFIERS = new Set<Modifier>(['Mod', 'Ctrl', 'Shift', 'Alt'])

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'

// .zenode/app.json
export type DefaultView = 'live' | 'source' | 'reading'

export interface EditorSettings {
  // How notes open: Live Preview, Source (plain Markdown) or Reading view.
  defaultView: DefaultView
  spellcheck: boolean
  // Where pasted or dropped files go: '' = vault root, './' = the note's folder,
  // './name' = a subfolder of the note's folder, anything else = that vault folder.
  attachmentFolder: string
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  defaultView: 'live',
  spellcheck: true,
  attachmentFolder: ''
}

const VIEWS = new Set<DefaultView>(['live', 'source', 'reading'])

export function sanitizeEditorSettings(raw: unknown): EditorSettings {
  const d = DEFAULT_EDITOR_SETTINGS
  if (!isRecord(raw)) return { ...d }
  return {
    defaultView: VIEWS.has(raw.defaultView as DefaultView) ? (raw.defaultView as DefaultView) : d.defaultView,
    spellcheck: typeof raw.spellcheck === 'boolean' ? raw.spellcheck : d.spellcheck,
    attachmentFolder: isString(raw.attachmentFolder) ? cleanFolder(raw.attachmentFolder) : d.attachmentFolder
  }
}

function cleanFolder(value: string): string {
  const s = value.trim().replace(/\\/g, '/')
  if (s === '.' || s === './') return './'
  return s.replace(/^\/+|\/+$/g, '')
}

// The folder a pasted/dropped file goes in, for a note at `notePath`.
export function attachmentDir(setting: string, notePath: string): string {
  const noteDir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : ''
  if (setting === './') return noteDir
  if (setting.startsWith('./')) {
    const sub = setting.slice(2)
    return noteDir ? `${noteDir}/${sub}` : sub
  }
  return setting
}

const MAX_LAYOUT_DEPTH = 6

// A saved pane layout; anything malformed is dropped (the open tabs still restore).
function sanitizeLayout(raw: unknown, depth = 0): LayoutNode | null {
  if (!isRecord(raw) || depth > MAX_LAYOUT_DEPTH) return null
  if (Array.isArray(raw.tabs)) {
    const tabs = raw.tabs.filter(isString)
    return {
      tabs,
      active: isString(raw.active) && tabs.includes(raw.active) ? raw.active : null,
      pinned: Array.isArray(raw.pinned) ? raw.pinned.filter((p): p is string => isString(p) && tabs.includes(p)) : []
    }
  }
  if ((raw.dir !== 'row' && raw.dir !== 'column') || !Array.isArray(raw.children)) return null
  const children = raw.children.map((c) => sanitizeLayout(c, depth + 1))
  if (children.length < 2 || children.some((c) => c === null)) return null
  const sizes = Array.isArray(raw.sizes) && raw.sizes.length === children.length && raw.sizes.every((n) => typeof n === 'number' && n > 0)
    ? (raw.sizes as number[])
    : children.map(() => 1)
  return { dir: raw.dir, sizes, children: children as LayoutNode[] }
}

export function sanitizeWorkspace(raw: unknown): WorkspaceState | null {
  if (!isRecord(raw)) return null
  const openFiles = Array.isArray(raw.openFiles) ? raw.openFiles.filter(isString) : []
  const activeFile = isString(raw.activeFile) ? raw.activeFile : null
  const layout = sanitizeLayout(raw.layout)
  const activePane = typeof raw.activePane === 'number' && Number.isInteger(raw.activePane) && raw.activePane >= 0 ? raw.activePane : 0
  return layout ? { openFiles, activeFile, layout, activePane } : { openFiles, activeFile }
}

function sanitizeHotkey(raw: unknown): Hotkey | null {
  if (!isRecord(raw) || !isString(raw.key) || !raw.key || !Array.isArray(raw.modifiers)) return null
  const modifiers = raw.modifiers.filter((m): m is Modifier => MODIFIERS.has(m as Modifier))
  if (modifiers.length !== raw.modifiers.length) return null
  return { modifiers, key: raw.key }
}

// { "command-id": [ { "modifiers": ["Mod"], "key": "k" } ] }. An empty list means "no hotkey".
export function sanitizeHotkeys(raw: unknown): Record<string, Hotkey[]> {
  const out: Record<string, Hotkey[]> = {}
  if (!isRecord(raw)) return out
  for (const [id, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue
    out[id] = list.map(sanitizeHotkey).filter((h): h is Hotkey => h !== null)
  }
  return out
}
