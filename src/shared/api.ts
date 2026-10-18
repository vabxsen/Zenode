// Contract between the main process and the renderer.
// All paths are vault-relative and use forward slashes.

export interface TreeEntry {
  name: string
  path: string
  kind: 'file' | 'folder'
  ext: string
  children?: TreeEntry[]
}

export interface VaultInfo {
  root: string
  name: string
}

export interface WorkspaceState {
  openFiles: string[]
  activeFile: string | null
}

export interface Settings {
  lastVault?: string
  recentVaults: string[]
  // Legacy: open tabs per vault, from before they moved to <vault>/.zenode/workspace.json.
  workspaces: Record<string, WorkspaceState>
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
  chooseVault(): Promise<VaultInfo | null>
  openVault(root: string): Promise<VaultInfo>
  currentVault(): Promise<VaultInfo | null>
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
  createFile(dir: string, baseName: string, ext: string): Promise<string>
  createFolder(dir: string, name: string): Promise<string>
  rename(path: string, newName: string): Promise<string>
  trash(path: string): Promise<void>
  reveal(path: string): Promise<void>
  openExternal(path: string): Promise<void>
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
  onBeforeClose(cb: () => Promise<void>): void
}
