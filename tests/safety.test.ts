// Data-safety tests: checked writes, file names, renames, retries.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Vault } from '../src/main/vault'
import { friendlyError, withRetry } from '../src/main/fsutil'
import { fileNameProblem } from '../src/shared/fileNames'
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

// Long paths (> 260 characters) work through Node's long-path support.
const deep = Array.from({ length: 6 }, (_, i) => `folder-with-a-fairly-long-name-${i}-${'x'.repeat(20)}`).join('/')
mkdirSync(join(dir, deep), { recursive: true })
await vault.write(`${deep}/long.md`, 'deep')
eq('long paths: write and read past 260 characters', [join(dir, deep, 'long.md').length > 260, await vault.read(`${deep}/long.md`)], [true, 'deep'])

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

rmSync(dir, { recursive: true, force: true })
