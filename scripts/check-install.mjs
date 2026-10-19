// Installs, updates and uninstalls Zenode the way users do, after `npm run dist`.
// CI only: it really installs Zenode for the current Windows user.
//   1. Builds an older version (0.0.1) whose updater looks at a local server.
//   2. Installs it silently, checks the shortcuts' registry entries, opens a vault.
//   3. Serves the new build (dist/) and waits for the app to download it, then restarts into it.
//   4. Uninstalls, and checks the registry entries are gone and the vault is untouched.
// Usage: node scripts/check-install.mjs
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { APP_STATE, evaluate, killTree, sleep, waitFor } from './cdp.mjs'

if (!process.env.CI) {
  console.error('check-install installs Zenode on this computer, so it only runs in CI (set CI=true to run it anyway).')
  process.exit(1)
}

const ROOT = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const NEW = pkg.version
const OLD = '0.0.1'
const PORT = 9556
const FEED_PORT = 8765
const FEED = `http://127.0.0.1:${FEED_PORT}/`

let failed = false
const fail = (msg) => {
  console.error(`FAIL: ${msg}`)
  failed = true
}
const ok = (msg) => console.log(`ok  ${msg}`)

const work = mkdtempSync(join(tmpdir(), 'zenode-install-'))
const installDir = join(work, 'app')
const exe = join(installDir, 'Zenode.exe')
const uninstaller = join(installDir, 'Uninstall Zenode.exe')
const vault = join(work, 'vault')
const userData = join(work, 'userdata')

// Registry values (default value of a key), or null when the key is missing.
function regDefault(key) {
  const r = spawnSync('reg', ['query', key, '/ve'], { encoding: 'utf8' })
  if (r.status !== 0) return null
  const line = r.stdout.split(/\r?\n/).find((l) => l.includes('REG_SZ'))
  return line ? line.split('REG_SZ')[1].trim() : ''
}
const CLASSES = 'HKCU\\Software\\Classes'
const KEYS = {
  link: `${CLASSES}\\zenode\\shell\\open\\command`,
  folder: `${CLASSES}\\Directory\\shell\\Zenode\\command`,
  background: `${CLASSES}\\Directory\\Background\\shell\\Zenode\\command`,
  note: `${CLASSES}\\Zenode.Note\\shell\\open\\command`,
  canvas: `${CLASSES}\\Zenode.Canvas\\shell\\open\\command`
}

const fileVersion = (file) =>
  existsSync(file) ? execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${file}').VersionInfo.ProductVersion`], { encoding: 'utf8' }).trim() : null

// Every vault file except Zenode's own .zenode folder, with a hash of its content.
function vaultFiles(dir) {
  const out = {}
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (e.name !== '.zenode') walk(p)
      } else out[relative(dir, p)] = createHash('sha256').update(readFileSync(p)).digest('hex')
    }
  }
  walk(dir)
  return out
}

function killZenode() {
  spawnSync('taskkill', ['/IM', 'Zenode.exe', '/T', '/F'], { stdio: 'ignore' })
}

// Serves dist/ (latest.yml and the new installer) as the update feed.
function serveFeed() {
  const server = createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, FEED).pathname.slice(1))
    const file = join(ROOT, 'dist', name)
    if (!name || name.includes('..') || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404
      res.end()
      return
    }
    res.setHeader('Content-Length', statSync(file).size)
    createReadStream(file).pipe(res)
  })
  return new Promise((done) => server.listen(FEED_PORT, '127.0.0.1', () => done(server)))
}

let server = null
let app = null
try {
  // 1. The older version, pointed at the local feed.
  const config = join(work, 'old-build.json')
  writeFileSync(
    config,
    JSON.stringify({
      ...pkg.build,
      extraMetadata: { version: OLD },
      directories: { output: join(work, 'dist-old') },
      publish: [{ provider: 'generic', url: FEED }],
      win: { ...pkg.build.win, target: [{ target: 'nsis', arch: ['x64'] }] }
    })
  )
  console.log(`Building Zenode ${OLD} for the update test…`)
  execFileSync(process.execPath, [join(ROOT, 'node_modules/electron-builder/cli.js'), '--win', '--publish', 'never', '--config', config], { cwd: ROOT, stdio: 'inherit' })
  const oldSetup = join(work, 'dist-old', `Zenode-Setup-${OLD}.exe`)
  if (!existsSync(oldSetup)) throw new Error(`no installer at ${oldSetup}`)

  // 2. Install it, silently, for this user only.
  const install = spawnSync(oldSetup, ['/S', `/D=${installDir}`], { stdio: 'ignore' })
  if (install.status !== 0 || !existsSync(exe)) throw new Error(`the installer failed (exit ${install.status})`)
  ok(`installed Zenode ${fileVersion(exe)} to ${installDir}`)
  if (!existsSync(uninstaller)) fail('no uninstaller')
  for (const [name, key] of Object.entries(KEYS)) {
    const value = regDefault(key)
    if (!value || !value.toLowerCase().includes(exe.toLowerCase())) fail(`registry ${name}: ${value}`)
    else ok(`registry ${name}: ${value}`)
  }
  if (!regDefault(KEYS.link).includes(' -- "%1"')) fail('zenode:// links are not passed after "--"')

  cpSync(join(ROOT, 'tests/fixtures/vault'), vault, { recursive: true })
  const before = vaultFiles(vault)
  mkdirSync(userData, { recursive: true })
  writeFileSync(join(userData, 'zenode-settings.json'), JSON.stringify({ lastVault: vault, recentVaults: [vault], workspaces: {} }))

  // 3. Start it; it checks the feed after a few seconds and downloads the new version.
  server = await serveFeed()
  app = spawn(exe, [`--user-data-dir=${userData}`, `--remote-debugging-port=${PORT}`], { stdio: 'ignore' })
  const state = await waitFor(async () => {
    const s = await evaluate(PORT, APP_STATE)
    return s?.ready ? s : null
  }, 60)
  if (!state) throw new Error('the installed app did not open the vault')
  ok(`the installed app opened the vault (${state.rows} tree rows)`)
  const kind = await evaluate(PORT, 'window.zenode.updateStatus().then((s) => s.kind)')
  if (kind !== 'installed') fail(`the app thinks it is a "${kind}" copy`)
  const ready = await waitFor(async () => {
    const s = await evaluate(PORT, 'window.zenode.updateStatus()')
    if (s?.state.status === 'error') throw new Error(s.state.message)
    return s?.state.status === 'ready' ? s : null
  }, 180)
  if (!ready) throw new Error(`the update was not downloaded: ${JSON.stringify(await evaluate(PORT, 'window.zenode.updateStatus()').catch(() => null))}`)
  ok(`downloaded Zenode ${ready.state.version}`)
  await evaluate(PORT, 'window.zenode.installUpdate()').catch(() => undefined)
  const updated = await waitFor(async () => (fileVersion(exe) === NEW ? NEW : null), 240)
  if (!updated) throw new Error(`still ${fileVersion(exe)} after restarting to update`)
  ok(`updated to Zenode ${NEW}`)
  // It starts again after the update; give it time, then close it.
  await sleep(5000)
  killZenode()
  await sleep(2000)
  for (const [name, key] of Object.entries(KEYS)) if (!regDefault(key)) fail(`registry ${name} is gone after the update`)

  // 4. Uninstall.
  spawnSync(uninstaller, ['/S'], { stdio: 'ignore' })
  const gone = await waitFor(async () => !existsSync(exe), 120)
  if (!gone) fail('Zenode.exe is still there after uninstalling')
  else ok('uninstalled')
  for (const [name, key] of Object.entries(KEYS)) {
    const value = regDefault(key)
    if (value && value.toLowerCase().includes(exe.toLowerCase())) fail(`registry ${name} still points at Zenode: ${value}`)
  }
  ok('the registry entries are gone')
  const after = vaultFiles(vault)
  if (JSON.stringify(after) !== JSON.stringify(before)) fail(`the vault changed: ${JSON.stringify({ before, after })}`)
  else ok(`the vault is untouched (${Object.keys(after).length} files)`)
  if (!existsSync(join(userData, 'zenode-settings.json'))) fail('the settings folder was removed')
} catch (e) {
  fail(e.message)
} finally {
  if (app) killTree(app.pid)
  killZenode()
  server?.close()
  await sleep(1000)
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}

if (failed) process.exit(1)
console.log('Install check passed.')
