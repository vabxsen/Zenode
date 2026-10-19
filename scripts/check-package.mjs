// Checks the packaged app (after `npm run dist`): its Electron fuses are set as
// intended, and it starts, opens a vault and indexes it with those fuses on
// (ASAR integrity checked, app only loaded from the ASAR). The page must have
// the zenode bridge and no Node access.
// Usage: node scripts/check-package.mjs [path to Zenode.exe]
import { FuseV1Options, FuseVersion, getCurrentFuseWire } from '@electron/fuses'
import { spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { APP_STATE, evaluate, killTree, pageUp, sleep, waitFor } from './cdp.mjs'

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
writeFileSync(join(userData, 'zenode-settings.json'), JSON.stringify({ lastVault: vault, recentVaults: [vault], workspaces: {}, updates: { autoCheck: false, channel: 'stable' } }))
const child = spawn(exe, [`--user-data-dir=${userData}`, `--remote-debugging-port=${PORT}`], { stdio: 'ignore' })

try {
  const state = await waitFor(async () => {
    const s = await evaluate(PORT, APP_STATE)
    return s?.ready ? s : null
  }, 60)
  if (!state?.ready) fail(`the app did not finish indexing the vault: ${JSON.stringify(state)}`)
  else {
    console.log(`ok  app started and indexed the vault (${state.rows} tree rows)`)
    if (state.bridge !== 'object') fail('window.zenode is missing')
    if (state.node !== 'undefined/undefined') fail(`the page can reach Node (${state.node})`)
    else console.log('ok  the page has the zenode bridge and no Node access')
  }
} finally {
  killTree(child.pid)
  await sleep(1000)
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
  let loaded = false
  if (!exited) {
    loaded = await pageUp(PORT + 1)
    killTree(tampered.pid)
  }
  if (loaded) fail('a tampered app.asar still loaded')
  else console.log('ok  a tampered app.asar is refused')
  await sleep(1000)
  rmSync(copy, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}

if (!process.exitCode) console.log('Package check passed.')
