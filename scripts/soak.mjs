// Leak check: opens and closes notes, canvases, the graph and file views over
// and over, and compares the page's JS heap (after garbage collection) with a
// baseline taken after a warm-up. Uses the E2E build (out-e2e/).
// Usage: npm run test:e2e:build && node scripts/soak.mjs [cycles=200]
import { _electron as electron } from '@playwright/test'
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const cycles = Number(process.argv[2] ?? 200)
const WARMUP = 10
const LIMIT = 0.1
// --diff: also compare heap snapshots and list the object kinds that grew.
const diff = process.argv.includes('--diff')
const kb = (n) => Math.round(n)
// --retainers: print who keeps a few detached DOM nodes alive.
const retainers = process.argv.includes('--retainers')
// --skip=reading,canvas,media,graph,panels,typing: leave parts out to find what grows.
const skip = new Set((process.argv.find((a) => a.startsWith('--skip=')) ?? '').slice(7).split(',').filter(Boolean))

const work = mkdtempSync(join(tmpdir(), 'zenode-soak-'))
const vault = join(work, 'vault')
const userData = join(work, 'userdata')
cpSync(join(ROOT, 'tests/fixtures/vault'), vault, { recursive: true })
writeFileSync(join(vault, 'Media.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>')
mkdirSync(userData, { recursive: true })
writeFileSync(join(userData, 'zenode-settings.json'), JSON.stringify({ lastVault: vault, recentVaults: [vault], workspaces: {} }))

const env = { ...process.env, ZENODE_USER_DATA: userData }
delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({ args: [join(ROOT, 'out-e2e/main/index.js')], env })
const page = await app.firstWindow()
await page.waitForSelector('.zn-app[data-index="ready"]', { state: 'attached' })
const cdp = await page.context().newCDPSession(page)

async function heapMB() {
  for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage')
  const { usedSize } = await cdp.send('Runtime.getHeapUsage')
  return usedSize / 1024 / 1024
}

// Object counts and sizes by kind (type + constructor name) in a heap snapshot.
async function census() {
  for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage')
  let chunks = ''
  const onChunk = (e) => (chunks += e.chunk)
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk)
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
  cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk)
  const snap = JSON.parse(chunks)
  const f = snap.snapshot.meta.node_fields
  const types = snap.snapshot.meta.node_types[0]
  const [ti, ni, si, di] = ['type', 'name', 'self_size', 'detachedness'].map((k) => f.indexOf(k))
  const out = new Map()
  // Totals: everything but compiled code (which grows as V8 optimises, not a leak), and detached DOM nodes.
  const totals = { jsKB: 0, nativeKB: 0, codeKB: 0, detached: 0, detachedKinds: new Map() }
  for (let i = 0; i < snap.nodes.length; i += f.length) {
    const type = types[snap.nodes[i + ti]]
    // JS objects are what the app's own code can leak; native (Blink) and
    // compiled code are reported but not judged.
    const kb = snap.nodes[i + si] / 1024
    if (type === 'code') totals.codeKB += kb
    else if (type === 'native') totals.nativeKB += kb
    else totals.jsKB += kb
    const key = `${type}:${snap.strings[snap.nodes[i + ni]].slice(0, 60)}`
    if (di !== -1 && snap.nodes[i + di] === 2) {
      totals.detached++
      totals.detachedKinds.set(key, (totals.detachedKinds.get(key) ?? 0) + 1)
    }
    const e = out.get(key) ?? { count: 0, size: 0 }
    e.count++
    e.size += snap.nodes[i + si]
    out.set(key, e)
  }
  return { kinds: out, totals, snap }
}

// Shortest path from the GC roots to a few detached nodes matching `match`:
// the chain that keeps them alive.
function printRetainers(snap, match, samples = 3) {
  const nf = snap.snapshot.meta.node_fields
  const ef = snap.snapshot.meta.edge_fields
  const types = snap.snapshot.meta.node_types[0]
  const etypes = snap.snapshot.meta.edge_types[0]
  const [ti, ni, ci, di] = ['type', 'name', 'edge_count', 'detachedness'].map((k) => nf.indexOf(k))
  const [eti, eni, eto] = ['type', 'name_or_index', 'to_node'].map((k) => ef.indexOf(k))
  const N = snap.nodes.length / nf.length
  const firstEdge = new Uint32Array(N + 1)
  for (let n = 0, e = 0; n < N; n++) {
    firstEdge[n] = e
    e += snap.nodes[n * nf.length + ci] * ef.length
  }
  firstEdge[N] = snap.edges.length
  const label = (n) => `${types[snap.nodes[n * nf.length + ti]]}:${snap.strings[snap.nodes[n * nf.length + ni]].slice(0, 60)}`
  const parent = new Int32Array(N).fill(-1)
  const via = new Int32Array(N).fill(-1)
  parent[0] = 0
  const queue = [0]
  for (let q = 0; q < queue.length; q++) {
    const n = queue[q]
    for (let e = firstEdge[n]; e < firstEdge[n + 1]; e += ef.length) {
      if (etypes[snap.edges[e + eti]] === 'weak') continue
      const to = snap.edges[e + eto] / nf.length
      if (parent[to] !== -1) continue
      parent[to] = n
      via[to] = e
      queue.push(to)
    }
  }
  const edgeName = (e) => {
    const et = etypes[snap.edges[e + eti]]
    const idx = snap.edges[e + eni]
    return et === 'element' || et === 'hidden' ? `${et}[${idx}]` : `${et}:${snap.strings[idx]}`
  }
  const targets = []
  for (let n = 0; n < N; n++) if (snap.nodes[n * nf.length + di] === 2 && label(n).includes(match) && parent[n] !== -1) targets.push(n)
  console.log(`\n${targets.length} reachable detached nodes match "${match}"`)
  for (const t of targets.filter((_, i) => i % Math.max(1, Math.floor(targets.length / samples)) === 0).slice(0, samples)) {
    const chain = []
    for (let n = t; n !== 0; n = parent[n]) chain.push(`${edgeName(via[n])} -> ${label(n)}`)
    console.log(`\nPath to ${label(t)}:`)
    for (const step of chain.reverse()) console.log(`  ${step}`)
  }
}

const row = (name) => page.locator('.zn-tree-row', { has: page.locator('.zn-tree-label', { hasText: new RegExp(`^${name}$`) }) })
const closeAll = async () => {
  while (await page.locator('.zn-tabbar .zn-tab').count()) await page.keyboard.press('Control+w')
}

async function cycle(i) {
  await row('Home').click()
  if (!skip.has('typing')) {
    await page.locator('.cm-content').first().click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type(` ${i}`)
  }
  await row('Formatting').click()
  if (!skip.has('reading')) {
    await page.keyboard.press('Control+e')
    await page.keyboard.press('Control+e')
  }
  if (!skip.has('canvas')) {
    await row('Board').click()
    await page.locator('.zn-canvas:visible .zn-cnode').first().waitFor()
  }
  if (!skip.has('media')) await row('Media.svg').click()
  if (!skip.has('graph')) {
    await page.keyboard.press('Control+g')
    await page.locator('.zn-graph canvas').first().waitFor()
  }
  await page.keyboard.press('Control+s')
  await closeAll()
  // Side panels too.
  if (!skip.has('panels')) {
    for (const tab of ['Outline', 'Outgoing links', 'Local graph', 'Backlinks']) {
      await page.locator(`.zn-rightbar .zn-sidebar-tab[aria-label="${tab}"]`).click()
    }
  }
}

let ok = true
try {
  for (let i = 0; i < WARMUP; i++) await cycle(i)
  const before = await census()
  const started = Date.now()
  for (let i = 0; i < cycles; i++) {
    await cycle(WARMUP + i)
    if ((i + 1) % 50 === 0) console.error(`- ${i + 1} cycles, heap ${(await heapMB()).toFixed(1)} MB`)
  }
  const after = await census()
  if (diff) report(before, after)
  if (retainers) printRetainers(after.snap, 'cm-line')
  const [a, b] = [before.totals, after.totals]
  const growth = (b.jsKB - a.jsKB) / a.jsKB
  ok = growth < LIMIT
  console.log(
    JSON.stringify(
      {
        cycles,
        minutes: +((Date.now() - started) / 60000).toFixed(1),
        jsHeapKB: [kb(a.jsKB), kb(b.jsKB)],
        jsGrowth: `${(growth * 100).toFixed(1)}%`,
        nativeKB: [kb(a.nativeKB), kb(b.nativeKB)],
        codeKB: [kb(a.codeKB), kb(b.codeKB)],
        detachedDomNodes: [a.detached, b.detached],
        ok
      },
      null,
      2
    )
  )
} finally {
  await app.close()
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  } catch {
    // Left in the temp folder.
  }
}
process.exitCode = ok ? 0 : 1
