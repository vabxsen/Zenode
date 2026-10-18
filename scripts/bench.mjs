// Measures Zenode on a generated vault: start-up, indexing (cold, then warm with
// the same settings folder), search and memory. Uses the E2E build (out-e2e/).
// Usage: npm run test:e2e:build && node scripts/bench.mjs <count> [--keep]
import { _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const count = Number(process.argv[2] ?? 10000)
const keep = process.argv.includes('--keep')

const work = mkdtempSync(join(tmpdir(), 'zenode-bench-'))
const vault = join(work, 'vault')
const userData = join(work, 'userdata')
execFileSync(process.execPath, [join(ROOT, 'scripts/gen-vault.mjs'), String(count), vault], { stdio: 'inherit' })
mkdirSync(userData, { recursive: true })
writeFileSync(join(userData, 'zenode-settings.json'), JSON.stringify({ lastVault: vault, recentVaults: [vault], workspaces: {} }))

async function launch() {
  const env = { ...process.env, ZENODE_USER_DATA: userData }
  delete env.ELECTRON_RENDERER_URL
  const started = performance.now()
  const app = await electron.launch({ args: [join(ROOT, 'out-e2e/main/index.js')], env })
  const page = await app.firstWindow()
  page.on('console', (m) => {
    if (m.type() === 'error') console.error(`[page] ${m.text()}`)
  })
  await page.waitForSelector('.zn-tree-row', { state: 'attached', timeout: 120000 })
  console.error(`tree after ${Math.round(performance.now() - started)} ms`)
  const tree = performance.now() - started
  await page.waitForSelector('.zn-app[data-index="ready"]', { state: 'attached', timeout: 300000 })
  const indexed = performance.now() - started
  return { app, page, tree, indexed }
}

async function memoryMB(app) {
  const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics())
  return Math.round(metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024)
}

async function search(page, query) {
  await page.locator('.zn-sidebar .zn-sidebar-tab[aria-label="Search"]').click()
  const input = page.locator('.zn-search-input')
  await input.fill(query)
  await input.press('Enter')
  const summary = page.locator('.zn-search-summary')
  await summary.filter({ hasText: / ms$/ }).waitFor({ timeout: 60000 })
  return Number(/(\d+) ms$/.exec(await summary.innerText())[1])
}

// Opens the graph and measures frames while its layout runs.
async function graph(page) {
  await page.keyboard.press('Control+g')
  await page.locator('.zn-graph canvas').first().waitFor({ timeout: 60000 })
  return page.evaluate(
    () =>
      new Promise((done) => {
        let frames = 0
        let longest = 0
        let last = performance.now()
        const start = last
        const tick = (now) => {
          frames++
          longest = Math.max(longest, now - last)
          last = now
          if (now - start < 3000) requestAnimationFrame(tick)
          else done({ graphFps: Math.round(frames / ((now - start) / 1000)), graphLongestFrameMs: Math.round(longest) })
        }
        requestAnimationFrame(tick)
      })
  )
}

const results = { count }
const step = (name) => console.error(`- ${name}`)
try {
  const cold = await launch()
  results.coldTree = Math.round(cold.tree)
  results.coldIndex = Math.round(cold.indexed)
  step('search')
  results.searchWords = await search(cold.page, 'lattice quiet')
  results.searchTag = await search(cold.page, 'tag:#work/launch')
  results.searchRegex = await search(cold.page, '/ledger \\w+ prism/')
  step('graph')
  Object.assign(results, await graph(cold.page))
  results.memoryMB = await memoryMB(cold.app)
  step('close')
  await cold.app.close()
  step('warm start')

  const warm = await launch()
  results.warmTree = Math.round(warm.tree)
  results.warmIndex = Math.round(warm.indexed)
  await warm.app.close()
} catch (e) {
  console.error('Benchmark failed:', e)
  process.exitCode = 1
} finally {
  if (keep) console.log(`Kept ${work}`)
  else {
    try {
      // Electron's helper processes can hold files for a moment after closing.
      rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
    } catch (e) {
      console.warn(`Could not remove ${work}: ${e.message}`)
    }
  }
}
console.log(JSON.stringify(results, null, 2))
