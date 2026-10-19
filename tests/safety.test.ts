// Data-safety tests: checked writes, file names, renames, retries.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Vault } from '../src/main/vault'
import { friendlyError, withRetry } from '../src/main/fsutil'
import { RecoveryJournal } from '../src/main/recovery'
import { SnapshotStore } from '../src/main/snapshots'
import { fileNameProblem } from '../src/shared/fileNames'
import { findConflictCopies, hasMergeMarkers } from '../src/renderer/src/sync/conflictCopies'
import { attachmentName } from '../src/renderer/src/editor/attachments'
import { sortTree } from '../src/renderer/src/treeSort'
import { contentHash } from '../src/shared/hash'
import { eq } from './harness'

const dir = mkdtempSync(join(tmpdir(), 'zenode-safety-'))
const overwritten: Array<[string, string]> = []
const vault = new Vault(dir, async (rel, old) => {
  overwritten.push([rel, old])
})
const disk = (rel: string): string => readFileSync(join(dir, rel), 'utf8')

// Checked writes.
writeFileSync(join(dir, 'a.md'), 'v1')
eq('hash: stable and content-sensitive', [contentHash('v1') === contentHash('v1'), contentHash('v1') === contentHash('v2')], [true, false])
eq('writeChecked: writes when disk matches', await vault.writeChecked('a.md', 'v2', contentHash('v1')), { status: 'ok' })
eq('writeChecked: content written', disk('a.md'), 'v2')
eq('writeChecked: old content handed to snapshots', overwritten, [['a.md', 'v1']])
writeFileSync(join(dir, 'a.md'), 'changed elsewhere')
eq('writeChecked: refuses when disk changed', await vault.writeChecked('a.md', 'mine', contentHash('v2')), { status: 'conflict', disk: 'changed elsewhere' })
eq('writeChecked: disk left untouched on conflict', disk('a.md'), 'changed elsewhere')
eq('writeChecked: same text already on disk is fine', await vault.writeChecked('a.md', 'changed elsewhere', contentHash('v2')), { status: 'ok' })
rmSync(join(dir, 'a.md'))
eq('writeChecked: deleted file is a conflict with no disk version', await vault.writeChecked('a.md', 'mine', contentHash('v2')), { status: 'conflict', disk: null })
eq('writeChecked: no temp files left', readdirSync(dir).filter((f) => f.endsWith('.zenode-tmp')), [])

// File names (Windows rules).
eq('names: ordinary names pass', ['Meeting notes', 'Q3 plan.md', 'naïve café', 'a.b.c'].map(fileNameProblem), [null, null, null, null])
const rejected = ['', '  ', 'a:b', 'what?', 'x/y', 'pipe|', 'CON', 'con.md', 'LPT1.txt', 'trailing.', 'space ', 'tab\there', '..', 'x'.repeat(256)]
eq('names: invalid names rejected', rejected.filter((n) => fileNameProblem(n) === null), [])
eq('names: message says why', fileNameProblem('a:b'), 'Names can\'t contain ":". Avoid < > : " / \\ | ? *')
let createRefused = ''
try { await vault.createFile('', 'AUX', 'md') } catch (e) { createRefused = (e as Error).message }
eq('createFile: refuses reserved names', createRefused, '"AUX" is a reserved name on Windows.')

// Renames.
writeFileSync(join(dir, 'note.md'), 'x')
eq('rename: case-only rename works', await vault.rename('note.md', 'Note.md'), 'Note.md')
eq('rename: file now has the new case', readdirSync(dir).includes('Note.md'), true)
writeFileSync(join(dir, 'other.md'), 'y')
let clash = ''
try { await vault.rename('other.md', 'Note.md') } catch (e) { clash = (e as Error).message }
eq('rename: refuses to overwrite another file', clash, '"Note.md" already exists')
let escaped = ''
try { vault.abs('../outside.md') } catch (e) { escaped = (e as Error).message }
eq('paths: cannot escape the vault', escaped, 'Path is outside the vault: ../outside.md')

// Moving into folders.
mkdirSync(join(dir, 'Inbox'))
mkdirSync(join(dir, 'Archive/2026'), { recursive: true })
writeFileSync(join(dir, 'Inbox/todo.md'), 't')
eq('move: file into a folder', await vault.move('Inbox/todo.md', 'Archive/2026'), 'Archive/2026/todo.md')
eq('move: to the vault root', await vault.move('Archive/2026/todo.md', ''), 'todo.md')
let moveError = ''
try { await vault.move('Archive', 'Archive/2026') } catch (e) { moveError = (e as Error).message }
eq('move: a folder into itself is refused', moveError, "A folder can't be moved into itself")
writeFileSync(join(dir, 'Inbox/todo.md'), 'other')
try { await vault.move('todo.md', 'Inbox') } catch (e) { moveError = (e as Error).message }
eq('move: never overwrites', moveError, '"todo.md" already exists in Inbox')
try { await vault.move('todo.md', 'Nope') } catch (e) { moveError = (e as Error).message }
eq('move: destination must be a folder', moveError, '"Nope" is not a folder')

// File tree ordering.
const entries = [
  { name: 'b.md', path: 'b.md', kind: 'file' as const, ext: 'md', mtime: 30, ctime: 1 },
  { name: 'Zeta', path: 'Zeta', kind: 'folder' as const, ext: '', children: [] },
  { name: 'a.md', path: 'a.md', kind: 'file' as const, ext: 'md', mtime: 10, ctime: 3 },
  { name: 'Alpha', path: 'Alpha', kind: 'folder' as const, ext: '', children: [{ name: 'c10.md', path: 'Alpha/c10.md', kind: 'file' as const, ext: 'md' }, { name: 'c9.md', path: 'Alpha/c9.md', kind: 'file' as const, ext: 'md' }] }
]
const names = (list: Array<{ name: string }>) => list.map((e) => e.name)
eq('sort: folders first, then names A-Z', names(sortTree(entries, 'name-asc')), ['Alpha', 'Zeta', 'a.md', 'b.md'])
eq('sort: numbers in names sort naturally', names(sortTree(entries, 'name-asc')[0].children!), ['c9.md', 'c10.md'])
eq('sort: Z-A', names(sortTree(entries, 'name-desc')), ['Zeta', 'Alpha', 'b.md', 'a.md'])
eq('sort: modified newest first', names(sortTree(entries, 'modified-new')).slice(2), ['b.md', 'a.md'])
eq('sort: created oldest first', names(sortTree(entries, 'created-old')).slice(2), ['b.md', 'a.md'])
eq('sort: input left unchanged', names(entries), ['b.md', 'Zeta', 'a.md', 'Alpha'])

// Long paths (> 260 characters) work through Node's long-path support.
const deep = Array.from({ length: 6 }, (_, i) => `folder-with-a-fairly-long-name-${i}-${'x'.repeat(20)}`).join('/')
mkdirSync(join(dir, deep), { recursive: true })
await vault.write(`${deep}/long.md`, 'deep')
eq('long paths: write and read past 260 characters', [join(dir, deep, 'long.md').length > 260, await vault.read(`${deep}/long.md`)], [true, 'deep'])

// Attachments (pasted / dropped files).
const png = new Uint8Array([137, 80, 78, 71])
eq('attachment: saved in a new folder', await vault.saveAttachment('Assets/img', 'photo.png', png), 'Assets/img/photo.png')
eq('attachment: never overwrites', await vault.saveAttachment('Assets/img', 'photo.png', png), 'Assets/img/photo 1.png')
eq('attachment: bytes intact', [...readFileSync(join(dir, 'Assets/img/photo 1.png'))], [137, 80, 78, 71])
let badAttachment = ''
try { await vault.saveAttachment('', 'what?.png', png) } catch (e) { badAttachment = (e as Error).message }
eq('attachment: invalid names refused', badAttachment.startsWith("Names can't contain"), true)
const when = new Date(2026, 9, 18, 9, 5, 7)
eq('attachment names: clipboard images get a timestamp', attachmentName(new File([png], 'image.png', { type: 'image/png' }), when), 'Pasted image 20261018090507.png')
eq('attachment names: jpeg becomes jpg', attachmentName(new File([png], 'image.jpg', { type: 'image/jpeg' }), when), 'Pasted image 20261018090507.jpg')
eq('attachment names: real names kept', attachmentName(new File([png], 'Holiday.png', { type: 'image/png' }), when), 'Holiday.png')

// Retries and messages.
let attempts = 0
const flaky = await withRetry(async () => {
  attempts++
  if (attempts < 3) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
  return 'done'
})
eq('retry: transient errors are retried', [flaky, attempts], ['done', 3])
attempts = 0
let permanent = ''
try { await withRetry(async () => { attempts++; throw Object.assign(new Error('gone'), { code: 'ENOENT' }) }) } catch (e) { permanent = (e as Error).message }
eq('retry: other errors fail at once', [permanent, attempts], ['gone', 1])
eq('errors: friendly message', friendlyError(Object.assign(new Error('x'), { code: 'ENOSPC' })).message, 'The disk is full.')

// Sync conflict copies.
const vaultFiles = [
  'Plan.md',
  'Plan-DESKTOP-ABC123.md',
  'Folder/Note.md',
  'Folder/Note.sync-conflict-20261018-123456-ABCDEFG.md',
  'Ideas (Pat\'s conflicted copy 2026-10-18).md',
  'Ideas.md',
  'Budget (conflicted copy 2026-10-18 101500).md',
  'Report_conflict-20261018-101500.md',
  'Report-Q3.md',
  'Report-FINAL.md',
  'Lonely-LAPTOP7.md',
  'img/photo.sync-conflict-20261018-123456-ABCDEFG.png'
]
eq('sync copies: each tool recognised', findConflictCopies(vaultFiles).map((c) => [c.path, c.original, c.tool, c.originalExists]), [
  ['Plan-DESKTOP-ABC123.md', 'Plan.md', 'OneDrive', true],
  ['Folder/Note.sync-conflict-20261018-123456-ABCDEFG.md', 'Folder/Note.md', 'Syncthing', true],
  ["Ideas (Pat's conflicted copy 2026-10-18).md", 'Ideas.md', 'Dropbox', true],
  ['Budget (conflicted copy 2026-10-18 101500).md', 'Budget.md', 'Nextcloud', false],
  ['Report_conflict-20261018-101500.md', 'Report.md', 'Nextcloud', false],
  ['img/photo.sync-conflict-20261018-123456-ABCDEFG.png', 'img/photo.png', 'Syncthing', false]
])
eq('sync copies: device names', findConflictCopies(vaultFiles).filter((c) => c.device).map((c) => c.device), ['DESKTOP-ABC123', 'Pat'])
eq('sync copies: ordinary dashed names are not copies', findConflictCopies(['Report-Q3.md', 'Report-FINAL.md', 'Lonely-LAPTOP7.md', 'my-note.md']), [])
eq('merge markers: found', hasMergeMarkers('a\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> branch\nb'), true)
eq('merge markers: lookalikes ignored', [hasMergeMarkers('<<<<<<< only start'), hasMergeMarkers('text ======= text')], [false, false])

// Local file history.
const userData = join(dir, 'userdata')
const snaps = new SnapshotStore(userData, 'C:/Vault')
const t0 = Date.UTC(2026, 9, 18, 10, 0, 0)
eq('snapshots: first auto snapshot is kept', await snaps.save('n.md', 'one', 'auto', t0), true)
eq('snapshots: auto snapshots are throttled', await snaps.save('n.md', 'two', 'auto', t0 + 60_000), false)
eq('snapshots: kept snapshots always save', await snaps.save('n.md', 'mine', 'kept', t0 + 61_000), true)
eq('snapshots: identical to the latest is skipped', await snaps.save('n.md', 'mine', 'kept', t0 + 62_000), false)
eq('snapshots: auto again after the interval', await snaps.save('n.md', 'three', 'auto', t0 + 7 * 60_000), true)
const listed = await snaps.list('n.md')
eq('snapshots: listed newest first', await Promise.all(listed.map((s) => snaps.read('n.md', s.id))), ['three', 'mine', 'one'])
eq('snapshots: other files are separate', await snaps.list('other.md'), [])
let badId = ''
try { await snaps.read('n.md', '../../x') } catch (e) { badId = (e as Error).message }
eq('snapshots: ids are validated', badId, 'Invalid snapshot id')
await snaps.prune(t0 + 7 * 24 * 60 * 60_000 + 2 * 60_000)
eq('snapshots: a week later only recent ones remain', (await snaps.list('n.md')).length, 1)

// Crash-recovery journal.
const journal = new RecoveryJournal(userData, 'C:/Vault')
await journal.put('a.md', 'draft', contentHash('base'), t0)
await journal.put('b.md', 'other', contentHash('x'), t0 + 1)
eq('journal: lists entries newest first', (await journal.list()).map((e) => [e.path, e.content]), [['b.md', 'other'], ['a.md', 'draft']])
await Promise.all([journal.put('a.md', 'newer', 'h', t0 + 2), journal.remove('a.md')])
eq('journal: a remove queued after a put wins', (await journal.list()).map((e) => e.path), ['b.md'])
eq('journal: another vault has its own entries', await new RecoveryJournal(userData, 'D:/Other').list(), [])

// Watching: reading a folder is not a change (on Windows the first listing of a
// new folder updates its last-access time, which the watcher reports).
const watched = mkdtempSync(join(tmpdir(), 'zenode-watch-'))
mkdirSync(join(watched, 'Sub'))
writeFileSync(join(watched, 'Sub/a.md'), 'a')
const watchVault = new Vault(watched)
const batches: string[][] = []
watchVault.watch((paths) => batches.push(paths.sort()))
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 600))
await settle()
readdirSync(join(watched, 'Sub'))
await settle()
eq('watch: listing a folder reports nothing', batches, [])
writeFileSync(join(watched, 'Sub/b.md'), 'b')
await settle()
eq('watch: a new note in a folder is reported', batches.flat().includes('Sub/b.md'), true)
watchVault.unwatch()
rmSync(watched, { recursive: true, force: true })

rmSync(dir, { recursive: true, force: true })
