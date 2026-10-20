// The signed-in Zenode account: Google sign-in exchanged for a Firebase session.
// The Firebase refresh token is kept encrypted with Windows' data protection
// (Electron safeStorage), so the user stays signed in across restarts.
import { app, safeStorage, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AccountInfo, AccountState } from '../../shared/sync'
import { atomicWrite } from '../fsutil'
import { describeError, log } from '../log'
import { syncConfig } from './config'
import { googleIdToken } from './googleAuth'

interface Session extends AccountInfo {
  refreshToken: string
  idToken: string
  // When idToken stops working (ms since 1970).
  expiresAt: number
}

// Development builds only: end-to-end tests use a pretend account and a folder as the cloud.
export const testSyncDir = app.isPackaged ? undefined : process.env.ZENODE_TEST_SYNC_DIR
const TEST_ACCOUNT: AccountInfo = { uid: 'test-user', email: 'tester@example.com', name: 'Test user' }

const REFRESH_EARLY_MS = 5 * 60 * 1000
let session: Session | null = null
let signingIn: AbortController | null = null
const listeners = new Set<() => void>()

const sessionFile = (): string => join(app.getPath('userData'), testSyncDir ? 'account-test.json' : 'account.bin')
const info = (s: Session): AccountInfo => ({ uid: s.uid, email: s.email, name: s.name })

export function onAccountChange(cb: () => void): void {
  listeners.add(cb)
}
const changed = (): void => listeners.forEach((cb) => cb())

export function accountState(): AccountState {
  return { configured: !!testSyncDir || syncConfig() !== null, account: session ? info(session) : null }
}

async function saveSession(s: Session | null): Promise<void> {
  const file = sessionFile()
  if (!s) {
    await fs.rm(file, { force: true })
    return
  }
  const data = JSON.stringify({ uid: s.uid, email: s.email, name: s.name, refreshToken: s.refreshToken })
  if (testSyncDir) return atomicWrite(file, data)
  if (!safeStorage.isEncryptionAvailable()) {
    void log('warn', 'account: no secure storage, so the sign-in lasts until Zenode closes')
    return
  }
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(file, safeStorage.encryptString(data))
}

// Restores the account saved by a previous run, if any.
export async function loadAccount(): Promise<void> {
  try {
    const raw = await fs.readFile(sessionFile())
    const text = testSyncDir ? raw.toString('utf8') : safeStorage.decryptString(raw)
    const saved = JSON.parse(text) as Omit<Session, 'idToken' | 'expiresAt'>
    if (saved.uid && saved.refreshToken) session = { ...saved, idToken: '', expiresAt: 0 }
  } catch {
    session = null
  }
}

// Firebase answers with error codes; these are the ones people can do something about.
function firebaseError(code: string): Error {
  if (code.startsWith('OPERATION_NOT_ALLOWED')) return new Error('Google sign-in is not turned on in the Firebase project.')
  if (code.startsWith('INVALID_IDP_RESPONSE')) return new Error('Firebase did not accept the Google sign-in. Check that the desktop client ID is safelisted in Firebase.')
  if (code.includes('API key not valid') || code.startsWith('INVALID_API_KEY')) return new Error('The Firebase API key in this build is not valid.')
  if (code.startsWith('TOKEN_EXPIRED') || code.startsWith('USER_DISABLED') || code.startsWith('USER_NOT_FOUND') || code.startsWith('INVALID_REFRESH_TOKEN'))
    return new Error('Your sign-in has expired. Sign in again.')
  return new Error(`Sign-in failed: ${code}`)
}

async function postJson<T>(url: string, body: unknown, form = false): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
    body: form ? new URLSearchParams(body as Record<string, string>) : JSON.stringify(body)
  }).catch(() => {
    throw new Error('Could not reach the sign-in service. Check your internet connection.')
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } }
  if (!res.ok) throw firebaseError(json.error?.message ?? String(res.status))
  return json
}

export async function signIn(): Promise<AccountState> {
  if (testSyncDir) {
    session = { ...TEST_ACCOUNT, refreshToken: 'test', idToken: 'test', expiresAt: Number.MAX_SAFE_INTEGER }
  } else {
    const config = syncConfig()
    if (!config) throw new Error('Sync is not set up in this build of Zenode.')
    signingIn?.abort()
    signingIn = new AbortController()
    try {
      const google = await googleIdToken({ clientId: config.googleClientId, clientSecret: config.googleClientSecret }, (url) => shell.openExternal(url), signingIn.signal)
      const r = await postJson<{ localId: string; email?: string; displayName?: string; idToken: string; refreshToken: string; expiresIn: string }>(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(config.firebaseApiKey)}`,
        { postBody: `id_token=${encodeURIComponent(google)}&providerId=google.com`, requestUri: 'http://localhost', returnSecureToken: true }
      )
      session = {
        uid: r.localId,
        email: r.email ?? '',
        name: r.displayName ?? r.email ?? 'Google account',
        idToken: r.idToken,
        refreshToken: r.refreshToken,
        expiresAt: Date.now() + Number(r.expiresIn) * 1000
      }
    } finally {
      signingIn = null
    }
  }
  await saveSession(session)
  changed()
  return accountState()
}

export function cancelSignIn(): void {
  signingIn?.abort()
}

export async function signOut(): Promise<AccountState> {
  session = null
  await saveSession(null).catch((e) => log('warn', `account: ${describeError(e)}`))
  changed()
  return accountState()
}

// A Firebase ID token for calls to Firestore, refreshed when it is about to expire.
export async function idToken(): Promise<string> {
  if (!session) throw new Error('Not signed in.')
  if (session.expiresAt - REFRESH_EARLY_MS > Date.now()) return session.idToken
  const config = syncConfig()
  if (!config) throw new Error('Sync is not set up in this build of Zenode.')
  try {
    const r = await postJson<{ id_token: string; refresh_token: string; expires_in: string }>(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(config.firebaseApiKey)}`,
      { grant_type: 'refresh_token', refresh_token: session.refreshToken },
      true
    )
    session = { ...session, idToken: r.id_token, refreshToken: r.refresh_token, expiresAt: Date.now() + Number(r.expires_in) * 1000 }
    return session.idToken
  } catch (e) {
    // A refresh token Google no longer accepts means signing in again.
    if ((e as Error).message.includes('expired')) await signOut()
    throw e
  }
}

export function currentUid(): string | null {
  return session?.uid ?? null
}
