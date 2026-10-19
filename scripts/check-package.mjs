// Checks the packaged app (after `npm run dist`): its Electron fuses are set as
// intended, and it starts, opens a vault and indexes it with those fuses on
// (ASAR integrity checked, app only loaded from the ASAR). The page must have
// the zenode bridge and no Node access.
// Usage: node scripts/check-package.mjs [path to Zenode.exe]
import { FuseV1Options, FuseVersion, getCurrentFuseWire } from '@electron/fuses'
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const exe = resolve(process.argv[2] ?? join(ROOT, 'dist/win-unpacked/Zenode.exe'))
const PORT = 9555
const fail = (msg) => {
  console.error(`FAIL: ${msg}`)
  process.exitCode = 1
}

// 1. Fuses.
const EXPECTED = {
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true
}
const wire = await getCurrentFuseWire(exe)
if (wire.version !== FuseVersion.V1) fail(`unexpected fuse version ${wire.version}`)
for (const [option, want] of Object.entries(EXPECTED)) {
  const name = FuseV1Options[option]
  const got = wire[option] === 49 // '1' enabled, '0' (48) disabled
  if (got !== want) fail(`fuse ${name} is ${got ? 'on' : 'off'}, expected ${want ? 'on' : 'off'}`)
  else console.log(`ok  fuse ${name}: ${got ? 'on' : 'off'}`)
}

// 2. Start it on a copy of the test vault, with throwaway settings.
const work = mkdtempSync(join(tmpdir(), 'zenode-pkg-'))
const vault = join(work, 'vault')
const userData = join(work, 'userdata')
cpSync(join(ROOT, 'tests/fixtures/vault'), vault, { recursive: true })
mkdirSync(userData, { recursive: true })
writeFileSync(join(userData, 'zenode-settings.json'), JSON.stringify({ lastVault: vault, recentVaults: [vault], workspaces: {} }))
const child = spawn(exe, [`--user-data-dir=${userData}`, `--remote-debugging-port=${PORT}`], { stdio: 'ignore' })

async function evaluate(expression) {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
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
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
  const value = await reply
  ws.close()
  return value
}

try {
  let state = null
  for (let i = 0; i < 60 && !(state?.ready); i++) {
    await new Promise((r) => setTimeout(r, 1000))
    state = await evaluate(
      `({ ready: document.querySelector('.zn-app')?.dataset.index === 'ready', rows: document.querySelectorAll('.zn-tree-row').length, bridge: typeof window.zenode, node: typeof require + '/' + typeof process })`
    ).catch(() => null)
  }
  if (!state?.ready) fail(`the app did not finish indexing the vault: ${JSON.stringify(state)}`)
  else {
    console.log(`ok  app started and indexed the vault (${state.rows} tree rows)`)
    if (state.bridge !== 'object') fail('window.zenode is missing')
    if (state.node !== 'undefined/undefined') fail(`the page can reach Node (${state.node})`)
    else console.log('ok  the page has the zenode bridge and no Node access')
  }
} finally {
  // Electron's helper processes go with it.
  try {
    execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    // Already gone.
  }
  await new Promise((r) => setTimeout(r, 1000))
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}
// 3. A tampered app.asar must not load (integrity checked against the exe).
{
  const copy = mkdtempSync(join(tmpdir(), 'zenode-tamper-'))
  cpSync(dirname(exe), copy, { recursive: true })
  const asar = join(copy, 'resources', 'app.asar')
  const bytes = readFileSync(asar)
  // A harmless change to the main process code (one character of a dialog title):
  // without integrity checking the app would start normally.
  const marker = Buffer.from('Open a program?')
  const at = bytes.indexOf(marker)
  if (at === -1) fail('could not find the main process code in app.asar to tamper with')
  bytes[at + marker.length - 1] = '!'.charCodeAt(0)
  writeFileSync(asar, bytes)
  const tampered = spawn(join(copy, basename(exe)), [`--user-data-dir=${join(copy, 'ud')}`, `--remote-debugging-port=${PORT + 1}`], { stdio: 'ignore' })
  const exited = await new Promise((done) => {
    const timer = setTimeout(() => done(false), 15000)
    tampered.on('exit', () => {
      clearTimeout(timer)
      done(true)
    })
  })
  let pageUp = false
  if (!exited) {
    const list = await fetch(`http://127.0.0.1:${PORT + 1}/json/list`).then((r) => r.json(), () => [])
    pageUp = list.some((t) => t.type === 'page' && t.url.startsWith('file:'))
    try {
      execFileSync('taskkill', ['/pid', String(tampered.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      // Already gone.
    }
  }
  if (pageUp) fail('a tampered app.asar still loaded')
  else console.log('ok  a tampered app.asar is refused')
  await new Promise((r) => setTimeout(r, 1000))
  rmSync(copy, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}

if (!process.exitCode) console.log('Package check passed.')
