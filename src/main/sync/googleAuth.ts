// Google sign-in for a desktop app (OAuth 2.0 for installed apps): opens the
// user's browser, and catches Google's answer on a one-time address on this
// computer (http://127.0.0.1:<port>). PKCE and a random state guard the reply.
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const TIMEOUT_MS = 5 * 60 * 1000

export interface GoogleClient {
  clientId: string
  clientSecret: string
}

const PAGE = (title: string, text: string): string =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font-family:system-ui,sans-serif;background:#0b0b0f;color:#e4e4e7;display:grid;place-items:center;height:90vh;margin:0">` +
  `<div style="text-align:center"><h1 style="font-weight:600;font-size:22px">${title}</h1><p style="color:#a1a1aa">${text}</p></div>`

export class SignInCancelled extends Error {
  constructor() {
    super('Sign-in was cancelled.')
  }
}

// Waits for one redirect carrying ?code=&state=. Resolves with the code.
function waitForCode(server: Server, state: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Sign-in timed out. Try again.')), TIMEOUT_MS)
    const done = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = (): void => {
      done()
      reject(new SignInCancelled())
    }
    signal.addEventListener('abort', onAbort)
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/') {
        res.writeHead(404).end()
        return
      }
      const error = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      if (url.searchParams.get('state') !== state || (!code && !error)) {
        res.end(PAGE('Sign-in failed', 'This answer was not for Zenode. Try signing in again.'))
        return
      }
      done()
      if (error) {
        res.end(PAGE('Sign-in cancelled', 'You can close this tab and go back to Zenode.'))
        reject(error === 'access_denied' ? new SignInCancelled() : new Error(`Google said: ${error}`))
        return
      }
      res.end(PAGE('Signed in to Zenode', 'You can close this tab and go back to Zenode.'))
      resolve(code!)
    })
  })
}

// Signs in with Google in the browser and returns Google's ID token for the user.
export async function googleIdToken(client: GoogleClient, openBrowser: (url: string) => Promise<void>, signal: AbortSignal): Promise<string> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const verifier = randomBytes(32).toString('base64url')
    const state = randomBytes(16).toString('base64url')
    const auth = new URL(AUTH_URL)
    auth.search = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      state,
      prompt: 'select_account'
    }).toString()
    const codePromise = waitForCode(server, state, signal)
    await openBrowser(auth.toString())
    const code = await codePromise
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier
      })
    })
    const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string }
    if (!res.ok || !body.id_token) throw new Error(`Google sign-in failed: ${body.error_description ?? body.error ?? res.status}`)
    return body.id_token
  } finally {
    server.close()
  }
}
