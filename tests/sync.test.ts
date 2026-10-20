// Sync: the planner's decisions, conflict copy names, and two computers
// syncing through a folder that stands in for the cloud.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { emptyMemory, syncPass, type SyncMemory } from '../src/main/sync/engine'
import { FolderRemote } from '../src/main/sync/folderRemote'
import { conflictPath, deviceLabel, planSync } from '../src/main/sync/plan'
import { findConflictCopies } from '../src/renderer/src/sync/conflictCopies'
import { eq } from './harness'

// ---------- Planner ----------
const plan = (base: Record<string, string>, local: Record<string, string>, remote: Record<string, { hash: string; deleted: boolean }>) => {
  const p = planSync(base, local, remote)
  return { up: p.upload, delR: p.deleteRemote, down: p.download, delL: p.deleteLocal, conflict: p.conflict, base: p.base }
}
const none = { up: [], delR: [], down: [], delL: [], conflict: [] }
eq('plan: nothing changed', plan({ a: '1' }, { a: '1' }, {}), { ...none, base: { a: '1' } })
eq('plan: new and edited here upload', plan({ a: '1' }, { a: '2', b: '3' }, {}), { ...none, up: ['a', 'b'], base: { a: '2', b: '3' } })
eq('plan: deleted here', plan({ a: '1' }, {}, {}), { ...none, delR: ['a'], base: {} })
eq('plan: new and edited elsewhere download', plan({ a: '1' }, { a: '1' }, { a: { hash: '2', deleted: false }, b: { hash: '3', deleted: false } }), {
  ...none,
  down: ['a', 'b'],
  base: { a: '2', b: '3' }
})
eq('plan: deleted elsewhere', plan({ a: '1' }, { a: '1' }, { a: { hash: '', deleted: true } }), { ...none, delL: ['a'], base: {} })
eq('plan: own change coming back is a no-op', plan({ a: '2' }, { a: '2' }, { a: { hash: '2', deleted: false } }), { ...none, base: { a: '2' } })
eq('plan: same edit on both sides', plan({ a: '1' }, { a: '2' }, { a: { hash: '2', deleted: false } }), { ...none, base: { a: '2' } })
eq('plan: different edits make a conflict', plan({ a: '1' }, { a: '2' }, { a: { hash: '3', deleted: false } }), { ...none, conflict: ['a'], base: { a: '2' } })
eq('plan: first sync with different files is a conflict', plan({}, { a: '2' }, { a: { hash: '3', deleted: false } }), { ...none, conflict: ['a'], base: { a: '2' } })
eq('plan: edit beats a delete elsewhere', plan({ a: '1' }, { a: '2' }, { a: { hash: '', deleted: true } }), { ...none, up: ['a'], base: { a: '2' } })
eq('plan: edit elsewhere beats a delete here', plan({ a: '1' }, {}, { a: { hash: '3', deleted: false } }), { ...none, down: ['a'], base: { a: '3' } })
eq('plan: deleted on both sides', plan({ a: '1' }, {}, { a: { hash: '', deleted: true } }), { ...none, base: {} })

// ---------- Conflict copy names ----------
const copy = conflictPath('Projects/Plan.md', 'LAPTOP', new Date(2026, 9, 20, 15, 42, 33))
eq('conflict: name', copy, 'Projects/Plan (Zenode conflict from LAPTOP 2026-10-20 154233).md')
eq('conflict: no extension', conflictPath('README', 'PC', new Date(2026, 0, 2, 3, 4, 5)), 'README (Zenode conflict from PC 2026-01-02 030405)')
eq(
  'conflict: listed with the other sync conflicts',
  findConflictCopies(['Projects/Plan.md', copy]).map((c) => [c.path, c.original, c.tool, c.device, c.originalExists]),
  [[copy, 'Projects/Plan.md', 'Zenode Sync', 'LAPTOP', true]]
)
eq('device: safe in a file name', [deviceLabel('DESKTOP-ABC'), deviceLabel('pat:s (pc)?'), deviceLabel('')], ['DESKTOP-ABC', 'pats pc', 'another computer'])

// ---------- Two computers through a pretend cloud ----------
const base = mkdtempSync(join(tmpdir(), 'zenode-sync-'))
const cloud = new FolderRemote(join(base, 'cloud'))
const remoteId = await cloud.createVault('Notes')

interface Device {
  root: string
  memory: SyncMemory
  name: string
}
const device = (name: string): Device => {
  const root = join(base, name)
  mkdirSync(root, { recursive: true })
  return { root, memory: emptyMemory(), name }
}
const put = (d: Device, path: string, text: string): void => {
  mkdirSync(dirname(join(d.root, path)), { recursive: true })
  writeFileSync(join(d.root, path), text)
}
const get = (d: Device, path: string): string | null => (existsSync(join(d.root, path)) ? readFileSync(join(d.root, path), 'utf8') : null)
const sync = async (d: Device) => {
  const r = await syncPass(d.root, remoteId, d.memory, {
    remote: cloud,
    device: d.name,
    read: async (p) => readFileSync(join(d.root, p), 'utf8'),
    write: async (p, c) => put(d, p, c),
    trash: async (p) => {
      mkdirSync(join(base, `${d.name}-trash`), { recursive: true })
      renameSync(join(d.root, p), join(base, `${d.name}-trash`, p.replace(/\//g, '_')))
    },
    now: () => new Date(2026, 9, 20, 12, 0, 0)
  })
  d.memory = r.memory
  return r.report
}

const a = device('PC-A')
const b = device('PC-B')
put(a, 'Home.md', '# Home\n')
put(a, 'Projects/Plan.md', '# Plan\n')
put(a, '.zenode/app.json', '{"spellcheck":true}')
put(a, 'photo.png', 'not text')
put(a, '.trash/Old.md', 'gone')
eq('two PCs: first upload', await sync(a), { uploaded: 3, downloaded: 0, deleted: 0, conflicts: 0, skipped: 1 })
eq('two PCs: a new PC gets everything', await sync(b), { uploaded: 0, downloaded: 3, deleted: 0, conflicts: 0, skipped: 0 })
eq('two PCs: same files', [get(b, 'Home.md'), get(b, 'Projects/Plan.md'), get(b, '.zenode/app.json'), get(b, '.trash/Old.md')], ['# Home\n', '# Plan\n', '{"spellcheck":true}', null])
eq('two PCs: nothing to do', await sync(a), { uploaded: 0, downloaded: 0, deleted: 0, conflicts: 0, skipped: 1 })

put(b, 'Home.md', '# Home\nfrom B\n')
await sync(b)
eq('two PCs: an edit travels', [(await sync(a)).downloaded, get(a, 'Home.md')], [1, '# Home\nfrom B\n'])

unlinkSync(join(a.root, 'Projects/Plan.md'))
eq('two PCs: a delete uploads', (await sync(a)).deleted, 1)
eq('two PCs: and goes to the trash on the other PC', [(await sync(b)).deleted, get(b, 'Projects/Plan.md'), readdirSync(join(base, 'PC-B-trash'))], [1, null, ['Projects_Plan.md']])

put(a, 'Home.md', 'A version\n')
put(b, 'Home.md', 'B version\n')
await sync(a)
const conflictName = 'Home (Zenode conflict from PC-B 2026-10-20 120000).md'
eq('two PCs: both edited, nothing lost', [(await sync(b)).conflicts, get(b, 'Home.md'), get(b, conflictName)], [1, 'B version\n', 'A version\n'])
await sync(a)
eq('two PCs: both PCs end with both versions', [get(a, 'Home.md'), get(a, conflictName)], ['B version\n', 'A version\n'])

// Both PCs upload the same note at the same moment: PC-A writes in the gap
// between PC-B reading the account and writing to it.
put(a, 'Ideas.md', 'A idea\n')
put(b, 'Ideas.md', 'B idea\n')
const racing = {
  ...cloud,
  listVaults: () => cloud.listVaults(),
  createVault: (n: string) => cloud.createVault(n),
  put: (id: string, f: Parameters<typeof cloud.put>[1], dev: string) => cloud.put(id, f, dev),
  changesSince: async (id: string, cursor: string | null) => {
    const page = await cloud.changesSince(id, cursor)
    await sync(a)
    return page
  }
}
const raced = await syncPass(b.root, remoteId, b.memory, {
  remote: racing,
  device: b.name,
  read: async (p) => readFileSync(join(b.root, p), 'utf8'),
  write: async (p, c) => put(b, p, c),
  trash: async () => undefined
})
b.memory = raced.memory
eq('race: the later write is refused, and a retry is asked for', [raced.retry, raced.report.uploaded, get(b, 'Ideas.md')], [true, 0, 'B idea\n'])
await sync(b)
await sync(a)
const ideaCopy = 'Ideas (Zenode conflict from PC-B 2026-10-20 120000).md'
eq('race: both PCs end with both versions', [get(a, 'Ideas.md'), get(a, ideaCopy), get(b, 'Ideas.md'), get(b, ideaCopy)], ['B idea\n', 'A idea\n', 'B idea\n', 'A idea\n'])
eq('race: and then nothing is left to do', [await sync(a), await sync(b)].map((r) => r.uploaded + r.downloaded + r.conflicts), [0, 0])

rmSync(base, { recursive: true, force: true })
