// Where synced vaults live in the account. The sync engine talks to this
// interface; Firestore (firestore.ts) is the real one, and a folder on disk
// (folderRemote.ts) stands in for it in tests.

export interface RemoteVaultInfo {
  id: string
  name: string
  updatedAt: number
}

// A file as stored in the account: its path in the vault, a hash of its text,
// and the text itself (empty when the file was deleted).
export interface RemoteFile {
  path: string
  hash: string
  deleted: boolean
  content: string
}

export interface ChangesPage {
  files: RemoteFile[]
  // Pass back next time to get only what changed since.
  cursor: string | null
}

export interface RemoteStore {
  listVaults(): Promise<RemoteVaultInfo[]>
  createVault(name: string): Promise<string>
  // Files written since `cursor` (everything when null).
  changesSince(vaultId: string, cursor: string | null): Promise<ChangesPage>
  put(vaultId: string, files: RemoteFile[], device: string): Promise<void>
}

// Firestore documents are limited to 1 MiB, so larger files don't sync (yet).
export const MAX_FILE_BYTES = 900 * 1024
