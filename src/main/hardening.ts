// Locks down what web content can do: only the app's own page (the main frame
// of one of its windows) may call the main process, every page is refused
// permissions it has no use for, and nothing may navigate, open windows or
// embed webviews.
import { app, session, type WebContents, type WebFrameMain } from 'electron'
import { join } from 'node:path'
import { isFileUrlOf } from './fileUrl'

// Permissions the app actually uses (copying paths and diagnostics to the clipboard).
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write'])

// Whether `url` is the app's own page: on the dev server in development,
// otherwise the built index.html (with any #hash or ?query).
function isAppUrl(url: string): boolean {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    try {
      return new URL(url).origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
    } catch {
      return false
    }
  }
  return isFileUrlOf(url, join(__dirname, '../renderer/index.html'))
}

// True when an IPC message comes from the app page itself: the main frame of the
// sending window, showing the app's own URL (not a vault file, a PDF or an iframe).
export function isAppFrame(sender: WebContents, frame: WebFrameMain | null | undefined): boolean {
  if (!frame || frame !== sender.mainFrame) return false
  return isAppUrl(frame.url)
}

// The Origin header the app page sends: "null" for a file:// page (the built app),
// or the dev server's origin. A vault file shown as a page also gets origin
// "null" (its CSP sandbox), but that sandbox allows no scripts, so it can't fetch.
export function isAppOrigin(origin: string): boolean {
  if (origin === 'null' || origin === 'file://') return true
  return !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL && origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
}

export function hardenSessions(): void {
  const lock = (s: Electron.Session): void => {
    s.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)))
    s.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission))
  }
  lock(session.defaultSession)
  app.on('session-created', lock)
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (e) => e.preventDefault())
    contents.on('will-redirect', (e) => {
      // In-page redirects of the app's own page are fine; anything else is not.
      if (!isAppUrl(e.url)) e.preventDefault()
    })
    contents.on('will-attach-webview', (e) => e.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
}
