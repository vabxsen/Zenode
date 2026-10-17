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
  workspaces: Record<string, WorkspaceState>
}

export interface ZenodeAPI {
  chooseVault(): Promise<VaultInfo | null>
  openVault(root: string): Promise<VaultInfo>
  currentVault(): Promise<VaultInfo | null>
  getSettings(): Promise<Settings>
  saveWorkspace(state: WorkspaceState): Promise<void>

  list(): Promise<TreeEntry[]>
  read(path: string): Promise<string>
  write(path: string, content: string): Promise<void>
  createFile(dir: string, baseName: string, ext: string): Promise<string>
  createFolder(dir: string, name: string): Promise<string>
  rename(path: string, newName: string): Promise<string>
  trash(path: string): Promise<void>
  reveal(path: string): Promise<void>
  openExternal(path: string): Promise<void>
  openUrl(url: string): Promise<void>

  onVaultChanged(cb: (paths: string[]) => void): () => void
  onBeforeClose(cb: () => Promise<void>): void
}
