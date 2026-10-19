// Update preferences and status, shared by the main process and Settings.

export type UpdateChannel = 'stable' | 'beta'

export interface UpdatePrefs {
  // Check GitHub for a new version at start-up and every few hours.
  autoCheck: boolean
  // Beta also offers pre-releases.
  channel: UpdateChannel
}

// How this copy of Zenode was installed: only installed copies update themselves.
export type InstallKind = 'installed' | 'portable' | 'zip' | 'dev'

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'none' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string }

export interface UpdateStatus {
  version: string
  kind: InstallKind
  prefs: UpdatePrefs
  state: UpdateState
}

export const DEFAULT_UPDATE_PREFS: UpdatePrefs = { autoCheck: true, channel: 'stable' }

export function sanitizeUpdatePrefs(raw: unknown): UpdatePrefs {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    autoCheck: typeof r.autoCheck === 'boolean' ? r.autoCheck : DEFAULT_UPDATE_PREFS.autoCheck,
    channel: r.channel === 'beta' ? 'beta' : 'stable'
  }
}

// One line for Settings.
export function describeUpdate(s: UpdateStatus): string {
  if (s.kind === 'dev') return 'Updates are off in development builds.'
  const st = s.state
  switch (st.status) {
    case 'idle':
      return s.prefs.autoCheck ? 'Zenode checks for updates automatically.' : 'Automatic checks are off.'
    case 'checking':
      return 'Checking for updates…'
    case 'none':
      return `Zenode ${s.version} is the latest version.`
    case 'available':
      return s.kind === 'installed' ? `Zenode ${st.version} is available.` : `Zenode ${st.version} is available to download.`
    case 'downloading':
      return `Downloading Zenode ${st.version}… ${Math.round(st.percent)}%`
    case 'ready':
      return `Zenode ${st.version} is ready. It installs when you restart Zenode.`
    case 'error':
      return `Could not check for updates: ${st.message}`
  }
}

// Short, readable text for an updater error (they can include whole HTTP responses).
export function updateErrorText(e: unknown): string {
  const msg = String((e as Error)?.message ?? e)
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|ERR_INTERNET_DISCONNECTED|net::ERR_/i.test(msg)) return 'no connection to GitHub.'
  if (/No published versions|ERR_UPDATER_NO_PUBLISHED_VERSIONS/i.test(msg)) return 'no releases published yet.'
  if (/latest\.yml|beta\.yml|CHANNEL_FILE_NOT_FOUND/i.test(msg)) return 'the latest release has no update files.'
  if (/sha512 checksum mismatch/i.test(msg)) return 'the download was damaged. Try again.'
  return msg.split('\n')[0].slice(0, 160)
}
