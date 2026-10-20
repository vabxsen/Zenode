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
  // Which write of it this is (changes with every write).
  version?: string
}

// A write, made only if the file in the account is still `expect`: the
// version this computer last saw, or null for "not in the account yet".
export interface RemoteWrite extends RemoteFile {
  expect: string | null
}

export interface ChangesPage {
  files: RemoteFile[]
  // Pass back next time to get only what changed since.
  cursor: string | null
}

// Another computer wrote one of the files since this one last looked; nothing
// in the batch was written. The next pass sees the change and handles it.
export class RemoteChangedError extends Error {
  constructor() {
    super('A file changed on another computer at the same moment. Syncing again.')
  }
}

export interface RemoteStore {
  listVaults(): Promise<RemoteVaultInfo[]>
  createVault(name: string): Promise<string>
  // Files written since `cursor` (everything when null).
  changesSince(vaultId: string, cursor: string | null): Promise<ChangesPage>
  // Writes all or (on RemoteChangedError) none of a batch; large uploads go
  // in several batches. Resolves with each written file's new version.
  put(vaultId: string, files: RemoteWrite[], device: string): Promise<Record<string, string>>
}

// Firestore documents are limited to 1 MiB, so larger files don't sync (yet).
export const MAX_FILE_BYTES = 900 * 1024
