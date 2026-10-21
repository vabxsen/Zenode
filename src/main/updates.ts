// Updates from GitHub Releases (electron-updater). An installed copy downloads
// a new version in the background and installs it when Zenode quits; portable
// and zip copies only say that one is out and link to its release page.
import { app, BrowserWindow, shell } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { autoUpdater } from 'electron-updater'
import { sanitizeUpdatePrefs, updateErrorText, type InstallKind, type UpdatePrefs, type UpdateState, type UpdateStatus } from '../shared/updates'
import { describeError, log } from './log'
import { loadSettings, updateSettings } from './settings'

const FIRST_CHECK_DELAY = 10_000
const CHECK_EVERY = 6 * 60 * 60 * 1000
const RELEASES = 'https://github.com/vabxsen/Zenode/releases'

let state: UpdateState = { status: 'idle' }
let prefs: UpdatePrefs = sanitizeUpdatePrefs(null)
let timer: NodeJS.Timeout | null = null
// End-to-end tests point the updater at a local server (development builds only).
const testFeed = app.isPackaged ? undefined : process.env.ZENODE_TEST_UPDATE_FEED

export function installKind(): InstallKind {
  if (testFeed) return 'zip'
  if (!app.isPackaged) return 'dev'
  if (process.env.PORTABLE_EXECUTABLE_DIR) return 'portable'
  return existsSync(join(dirname(process.execPath), 'Uninstall Zenode.exe')) ? 'installed' : 'zip'
}

export function updateStatus(): UpdateStatus {
  return { version: app.getVersion(), kind: installKind(), prefs, state }
}

// (A function, so TypeScript doesn't narrow `state` across awaits.)
const current = (): UpdateState => state

function setState(next: UpdateState): void {
  state = next
  const status = updateStatus()
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('update:state', status)
}

function configure(): void {
  if (testFeed) {
    autoUpdater.forceDevUpdateConfig = true
    autoUpdater.setFeedURL({ provider: 'generic', url: testFeed })
  }
  autoUpdater.autoDownload = installKind() === 'installed'
  autoUpdater.autoInstallOnAppQuit = true
  // Beta: the newest release, pre-release or not. Stable: the latest full release.
  autoUpdater.allowPrerelease = prefs.channel === 'beta'
  autoUpdater.allowDowngrade = false
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (installKind() === 'dev' || state.status === 'checking' || state.status === 'downloading' || state.status === 'ready') return updateStatus()
  setState({ status: 'checking' })
  try {
    configure()
    const result = await autoUpdater.checkForUpdates()
    // The events below set the outcome; this covers a check that found nothing to do.
    if (current().status === 'checking') setState(result?.isUpdateAvailable ? { status: 'available', version: result.updateInfo.version } : { status: 'none' })
  } catch (e) {
    setState({ status: 'error', message: updateErrorText(e) })
  }
  return updateStatus()
}

function schedule(): void {
  if (timer) clearInterval(timer)
  timer = null
  if (!prefs.autoCheck || installKind() === 'dev') return
  timer = setInterval(() => void checkForUpdates(), CHECK_EVERY)
}

export async function setUpdatePrefs(change: Partial<UpdatePrefs>): Promise<UpdateStatus> {
  prefs = sanitizeUpdatePrefs({ ...prefs, ...(change && typeof change === 'object' ? change : {}) })
  const next = prefs
  await updateSettings((s) => ({ ...s, updates: next }))
  schedule()
  setState(state)
  return updateStatus()
}

// Restarts into the downloaded version; anything else opens the release page.
export function installUpdate(): void {
  if (state.status === 'ready') {
    // Silent install, then Zenode starts again. The windows save their notes as they close.
    autoUpdater.quitAndInstall(true, true)
    return
  }
  const version = state.status === 'available' ? state.version : null
  if (testFeed) {
    void log('info', `update: would open the release page for ${version}`)
    return
  }
  void shell.openExternal(version ? `${RELEASES}/tag/v${version}` : `${RELEASES}/latest`)
}

export async function startUpdates(): Promise<void> {
  prefs = sanitizeUpdatePrefs((await loadSettings()).updates)
  if (installKind() === 'dev') return
  autoUpdater.logger = {
    info: (m: unknown) => void log('info', `update: ${String(m)}`),
    warn: (m: unknown) => void log('warn', `update: ${String(m)}`),
    error: (m: unknown) => void log('error', `update: ${String(m)}`),
    debug: () => undefined
  }
  autoUpdater.on('update-available', (info) => setState({ status: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => setState({ status: 'none' }))
  autoUpdater.on('download-progress', (p) => {
    const version = 'version' in state ? state.version : ''
    setState({ status: 'downloading', version, percent: p.percent })
  })
  autoUpdater.on('update-downloaded', (info) => setState({ status: 'ready', version: info.version }))
  autoUpdater.on('error', (e) => {
    void log('warn', `update: ${describeError(e)}`)
    if (state.status !== 'ready') setState({ status: 'error', message: updateErrorText(e) })
  })
  schedule()
  if (prefs.autoCheck) setTimeout(() => void checkForUpdates(), FIRST_CHECK_DELAY)
}
