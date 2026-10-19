// Helpers for the package and install checks: talk to a running Zenode over the
// Chrome DevTools Protocol, and stop it.
import { execFileSync } from 'node:child_process'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Evaluates `expression` in Zenode's page (the app's file:// page) on `port`.
export async function evaluate(port, expression) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = list.find((t) => t.type === 'page' && t.url.startsWith('file:'))
  if (!page) throw new Error('no app page yet')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => {
    ws.addEventListener('open', r)
    ws.addEventListener('error', j)
  })
  const reply = new Promise((done) =>
    ws.addEventListener('message', (m) => {
      const msg = JSON.parse(m.data)
      if (msg.id === 1) done(msg.result?.result?.value)
    })
  )
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  const value = await reply
  ws.close()
  return value
}

// Whether the app's page is up on `port`.
export async function pageUp(port) {
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json(), () => [])
  return list.some((t) => t.type === 'page' && t.url.startsWith('file:'))
}

// Polls `probe` once a second until it returns something truthy; the last result.
export async function waitFor(probe, seconds) {
  let value = null
  for (let i = 0; i < seconds && !value; i++) {
    await sleep(1000)
    value = await probe().catch(() => null)
  }
  return value
}

// The state the checks wait for: the vault indexed, the bridge there, no Node in the page.
export const APP_STATE = `({ ready: document.querySelector('.zn-app')?.dataset.index === 'ready', rows: document.querySelectorAll('.zn-tree-row').length, bridge: typeof window.zenode, node: typeof require + '/' + typeof process })`

// Stops a process and its children (Electron's helper processes).
export function killTree(pid) {
  try {
    execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    // Already gone.
  }
}
