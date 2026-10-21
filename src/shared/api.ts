// Contract between the main process and the renderer.
// All paths are vault-relative and use forward slashes.
import type { AccountState, RemoteVault, VaultSyncStatus } from './sync'
import type { UpdatePrefs, UpdateStatus } from './updates'

export interface TreeEntry {
  name: string
  path: string
  kind: 'file' | 'folder'
  ext: string
  children?: TreeEntry[]
  // Files only: last modified and created (ms since 1970), for sorting.
  mtime?: number
  ctime?: number
  // Bytes; with mtime it tells the index cache whether a file changed.
  size?: number
}

export interface VaultInfo {
  root: string
  name: string
  // Host of this vault's vault:// URLs.
  id: string
}

// Where a deleted file went: the Recycle Bin, or the vault's .trash folder (at `path`).
export type TrashResult = { where: 'system' } | { where: 'vault'; path: string }

// For Settings > About.
export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  // Where logs and app settings live.
  userData: string
}

// A note rendered for printing, with page settings.
export interface PdfExportRequest {
  // Self-contained HTML (images inlined) and the CSS it needs.
  html: string
  css: string
  title: string
  // The note's path, so the save dialog starts in its folder.
  path: string
  pageSize: 'A3' | 'A4' | 'A5' | 'Legal' | 'Letter' | 'Tabloid'
  landscape: boolean
  margins: 'default' | 'none' | 'minimum'
}

// One pane's tabs, in order.
export interface PaneLayout {
  tabs: string[]
  active: string | null
  pinned: string[]
}

// Panes side by side ("row") or stacked ("column"), with relative sizes.
export type LayoutNode = PaneLayout | { dir: 'row' | 'column'; sizes: number[]; children: LayoutNode[] }

export interface WorkspaceState {
  // The active pane's tabs (all that versions without split panes understand).
  openFiles: string[]
  activeFile: string | null
  layout?: LayoutNode
  // Index of the active pane, in depth-first order.
  activePane?: number
}

export interface Settings {
  lastVault?: string
  recentVaults: string[]
  // Legacy: open tabs per vault, from before they moved to <vault>/.zenode/workspace.json.
  workspaces: Record<string, WorkspaceState>
  updates?: UpdatePrefs
  // Which vaults sync with the signed-in account.
  sync?: SyncSettings
  // Folders that sync only once turned on by hand (the Help vault, a folder
  // opened just to read one file), whoever is signed in.
  syncSkip?: string[]
}

export interface SyncSettings {
  uid: string
  // Vault folder -> its vault id in the account.
  links: Record<string, string>
  // Vault folders the user turned sync off for.
  off: string[]
}

// Result of a checked write. "conflict" means the file on disk is no longer the
// version the page last saw (disk is null if it was deleted or moved); nothing was written.
export type WriteResult = { status: 'ok' } | { status: 'conflict'; disk: string | null }

// One saved copy of a file in the local file history.
export interface SnapshotInfo {
  id: string
  // Milliseconds since 1970.
  time: number
  size: number
}

// Unsaved note text kept for crash recovery. baseHash is the hash of the disk
// version the edits started from.
export interface RecoveryEntry {
  path: string
  content: string
  baseHash: string
  time: number
}

export interface ZenodeAPI {
  // Null when cancelled, or when that vault is open in another window.
  chooseVault(): Promise<VaultInfo | null>
  // Null when the vault is already open in another window (that window comes forward).
  openVault(root: string): Promise<VaultInfo | null>
  // Opens a vault in a new window (asks for a folder when no root is given).
  openVaultInNewWindow(root?: string): Promise<void>
  // Asks for a parent folder, creates the vault folder and opens it (null when
  // cancelled or opened in a new window).
  createVault(name: string, newWindow: boolean): Promise<VaultInfo | null>
  // The Help vault that ships with Zenode (a copy in the app's data folder).
  openHelpVault(newWindow: boolean): Promise<VaultInfo | null>
  // Removes a vault from the recent list (its files are not touched).
  forgetVault(root: string): Promise<void>
  // Interface zoom (1 = 100%), and the window frame's colours to match the theme.
  setZoom(factor: number): void
  setTitleBarColors(color: string, symbolColor: string): Promise<void>
  appInfo(): Promise<AppInfo>
  // Updates from GitHub Releases (Settings > General > Updates).
  updateStatus(): Promise<UpdateStatus>
  checkForUpdates(): Promise<UpdateStatus>
  setUpdatePrefs(change: Partial<UpdatePrefs>): Promise<UpdateStatus>
  // Restarts into a downloaded update, or opens the release page.
  installUpdate(): Promise<void>
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void
  // The Zenode account (Google sign-in) and syncing vaults with it.
  accountState(): Promise<AccountState>
  // Opens the browser to sign in with Google; resolves once signed in.
  signIn(): Promise<AccountState>
  cancelSignIn(): Promise<void>
  signOut(): Promise<AccountState>
  onAccountChange(cb: (s: AccountState) => void): () => void
  syncStatus(): Promise<VaultSyncStatus | null>
  syncNow(): Promise<VaultSyncStatus>
  setSyncEnabled(on: boolean): Promise<VaultSyncStatus>
  onSyncStatus(cb: (s: VaultSyncStatus) => void): () => void
  remoteVaults(): Promise<RemoteVault[]>
  // Downloads a vault from the account into a folder the user picks. Null if
  // cancelled, or when it opened in another window.
  restoreVault(remoteId: string): Promise<VaultInfo | null>
  // Installed CSS themes (.zenode/themes) and snippets (.zenode/snippets).
  listCss(): Promise<{ themes: string[]; snippets: string[] }>
  readCss(kind: 'theme' | 'snippet', name: string): Promise<string>
  openCssFolder(kind: 'theme' | 'snippet'): Promise<void>
  // Asks where to save, then writes the PDF. Null if cancelled.
  exportPdf(req: PdfExportRequest): Promise<string | null>
  currentVault(): Promise<VaultInfo | null>
  // A note or canvas Zenode was asked to open (file association or zenode:// link), once.
  takeOpenRequest(): Promise<string | null>
  getSettings(): Promise<Settings>
  // Per-vault config files in <vault>/.zenode/<name>.json. Missing or broken files read as null.
  readConfig(name: string): Promise<unknown>
  writeConfig(name: string, data: unknown): Promise<void>

  list(): Promise<TreeEntry[]>
  read(path: string): Promise<string>
  // Missing or unreadable files come back as null instead of failing the batch.
  readMany(paths: string[]): Promise<Record<string, string | null>>
  write(path: string, content: string): Promise<void>
  // Writes only if the file on disk still hashes to `expectHash` (see shared/hash.ts).
  writeChecked(path: string, content: string, expectHash: string): Promise<WriteResult>
  // A new file with content, creating folders as needed; fails if it exists.
  createAt(path: string, content: string): Promise<void>
  createFile(dir: string, baseName: string, ext: string): Promise<string>
  // A pasted/dropped file, saved under a unique name in dir. Returns its path.
  saveAttachment(dir: string, fileName: string, bytes: Uint8Array): Promise<string>
  createFolder(dir: string, name: string): Promise<string>
  rename(path: string, newName: string): Promise<string>
  // Into another folder ('' = vault root), keeping the name. Returns the new path.
  move(path: string, destDir: string): Promise<string>
  trash(path: string): Promise<TrashResult>
  reveal(path: string): Promise<void>
  // False when the file would run as a program and the user said no.
  openExternal(path: string): Promise<boolean>
  openUrl(url: string): Promise<void>

  // Local file history for a vault file (kept outside the vault, for 7 days).
  listSnapshots(path: string): Promise<SnapshotInfo[]>
  readSnapshot(path: string, id: string): Promise<string>
  // Keep a copy of text that's about to be thrown away.
  keepSnapshot(path: string, content: string): Promise<void>

  // Crash-recovery journal of unsaved note text (outside the vault).
  journalPut(path: string, content: string, baseHash: string): Promise<void>
  journalRemove(path: string): Promise<void>
  journalList(): Promise<RecoveryEntry[]>

  // Appends to the app log (%APPDATA%\Zenode\logs\zenode.log).
  log(level: 'info' | 'warn' | 'error', message: string): Promise<void>

  onVaultChanged(cb: (paths: string[]) => void): () => void
  // Zenode was asked to open a file in this window; takeOpenRequest() says which.
  onOpenRequested(cb: () => void): () => void
  onBeforeClose(cb: () => Promise<void>): void
}
