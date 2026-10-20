// Account and sync types shared by the main process and the page.

export interface AccountInfo {
  uid: string
  email: string
  name: string
}

export interface AccountState {
  // False when this build has no Firebase settings (sync can't be used).
  configured: boolean
  account: AccountInfo | null
}

// A vault stored in the user's account.
export interface RemoteVault {
  id: string
  name: string
  // When something in it last changed (ms since 1970).
  updatedAt: number
  // The folder on this computer synced with it, if any.
  localRoot: string | null
}

export type SyncState =
  | { status: 'off' }
  | { status: 'idle'; lastSync: number | null }
  | { status: 'syncing' }
  | { status: 'error'; message: string }

// What the page shows for its vault.
export interface VaultSyncStatus {
  signedIn: boolean
  // This vault syncs with the account.
  enabled: boolean
  state: SyncState
  // Files that can't sync (too big, or not a text file yet).
  skipped: number
}

// The outcome of one sync pass.
export interface SyncReport {
  uploaded: number
  downloaded: number
  deleted: number
  conflicts: number
  skipped: number
}
