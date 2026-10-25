// Security: what may be opened outside Zenode, and file access staying inside the vault.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readConfig, readCss, writeConfig } from '../src/main/config'
import { isFileUrlOf } from '../src/main/fileUrl'
import { knownVault } from '../src/main/launchArgs'
import { Vault } from '../src/main/vault'
import { hasScheme, isRunnable, safeExternalUrl } from '../src/shared/linkSafety'
import { eq } from './harness'

// Links handed to the browser or mail app.
eq('url: web and mail allowed', ['https://example.com/a?b=1', 'http://x.org', 'mailto:me@example.com'].map(safeExternalUrl), ['https://example.com/a?b=1', 'http://x.org/', 'mailto:me@example.com'])
eq(
  'url: everything else refused',
  ['file:///C:/Windows/notepad.exe', 'javascript:alert(1)', 'ms-settings:privacy', 'obsidian://open', 'vbscript:x', 'https://', 'C:\\Windows', '\\\\server\\share', 'data:text/html,hi', 42, ''].map(safeExternalUrl),
  [null, null, null, null, null, null, null, null, null, null, null]
)
eq('url: case and spaces normalised', safeExternalUrl('  HTTPS://Example.COM '), 'https://example.com/')
eq('scheme: detected, drive letters are paths', ['ms-settings:x', 'https://a', 'C:\\notes\\a.md', 'C:/a.md', 'Folder/Note.md', '../up.md'].map(hasScheme), [true, true, false, false, false, false])
eq(
  'runnable: programs and shortcuts',
  ['tool.exe', 'Setup.MSI', 'a/b/run.bat', 'script.ps1', 'link.lnk', 'site.url', 'evil.exe.', 'x.js', 'disk.iso'].map(isRunnable),
  [true, true, true, true, true, true, true, true, true]
)
eq('runnable: documents are not', ['note.md', 'photo.png', 'doc.pdf', 'data.csv', 'exe', 'archive.zip'].map(isRunnable), [false, false, false, false, false, false])

// File access stays inside the vault.
const base = mkdtempSync(join(tmpdir(), 'zenode-sec-'))
const root = join(base, 'vault')
const outside = join(base, 'outside')
mkdirSync(root)
mkdirSync(outside)
writeFileSync(join(outside, 'secret.txt'), 'secret')
writeFileSync(join(root, 'note.md'), 'hello')
// A junction needs no admin rights on Windows (a file symlink would).
symlinkSync(outside, join(root, 'link'), 'junction')
const vault = new Vault(root)
const refused = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run()
    return 'allowed'
  } catch (e) {
    return (e as Error).message.split(':')[0]
  }
}
eq('vault: normal read', await vault.read('note.md'), 'hello')
eq('vault: dot-dot refused', await refused(() => vault.read('../outside/secret.txt')), 'Path is outside the vault')
eq('vault: absolute path refused', await refused(() => vault.read(join(outside, 'secret.txt'))), 'Path is outside the vault')
eq('vault: read through a junction refused', await refused(() => vault.read('link/secret.txt')), 'Path leads outside the vault through a link')
eq('vault: write through a junction refused', await refused(() => vault.write('link/new.md', 'x')), 'Path leads outside the vault through a link')
eq('vault: create through a junction refused', await refused(() => vault.createAt('link/deep/new.md', 'x')), 'Path leads outside the vault through a link')
eq('vault: the junction itself refused', await refused(() => vault.realAbs('link')), 'Path leads outside the vault through a link')
eq('vault: bulk reads skip it', Object.entries(await vault.readMany(['note.md', 'link/secret.txt'])).sort(), [['link/secret.txt', null], ['note.md', 'hello']])
eq('vault: alternate data stream refused', await refused(() => vault.read('note.md:hidden')), 'Not a usable file name')
eq('vault: device names refused', await refused(() => vault.write('NUL.md', 'x')), 'Not a usable file name')
eq('vault: new folders inside are fine', await refused(() => vault.createAt('new/sub/a.md', 'x')), 'allowed')
// The vault folder itself can't be renamed, moved or thrown away from inside.
eq(
  'vault: its own folder is not an entry',
  [await refused(() => vault.rename('', 'gone')), await refused(() => vault.move('', 'new')), await refused(() => vault.moveToVaultTrash('')), await refused(() => vault.realEntry('.'))],
  Array(4).fill("The vault folder itself can't be changed from inside the vault")
)
eq('vault: entries inside still are', await refused(() => vault.realEntry('note.md')), 'allowed')

// Config, themes and snippets stay in the vault's own .zenode folder.
mkdirSync(join(outside, 'snippets'))
writeFileSync(join(outside, 'snippets', 'evil.css'), 'body{}')
writeFileSync(join(outside, 'x.css'), 'body{}')
eq(
  'css: names with path separators refused',
  [await refused(() => readCss(root, 'snippet', String.raw`..\..\outside\x`)), await refused(() => readCss(root, 'snippet', String.raw`a\..\..\..\outside\x`)), await refused(() => readCss(root, 'snippet', 'a/b'))],
  ['Invalid snippet name', 'Invalid snippet name', 'Invalid snippet name']
)
const linked = join(base, 'linked')
mkdirSync(linked)
symlinkSync(outside, join(linked, '.zenode'), 'junction')
writeFileSync(join(outside, 'app.json'), '{"secret":true}')
eq('config: a .zenode that links elsewhere is not read', await readConfig(linked, 'app'), null)
eq('config: nor written', await refused(() => writeConfig(linked, 'app', {})), 'Path leads outside the vault through a link')
eq('css: nor its snippets', await refused(() => readCss(linked, 'snippet', 'evil')), 'Path leads outside the vault through a link')
await writeConfig(root, 'app', { ok: 1 })
eq("config: the vault's own still works", await readConfig(root, 'app'), { ok: 1 })
rmSync(base, { recursive: true, force: true })

// The page opens vaults by name only from the vault list.
const known = [String.raw`C:\Notes\Work`, String.raw`D:\Vaults\Home`]
eq(
  'known vault: same folder in any spelling',
  [knownVault(String.raw`c:\notes\work`, known), knownVault(String.raw`C:\Notes\Work\ `.trim(), known), knownVault('C:/Notes/Work', known), knownVault(String.raw`D:\Vaults\Home`, known)],
  [String.raw`C:\Notes\Work`, String.raw`C:\Notes\Work`, String.raw`C:\Notes\Work`, String.raw`D:\Vaults\Home`]
)
eq(
  'known vault: anything else refused',
  [knownVault(String.raw`C:\Windows`, known), knownVault(String.raw`C:\Notes`, known), knownVault(String.raw`C:\Notes\Work\..\..\Windows`, known), knownVault('Work', known), knownVault('', known), knownVault(42, known)],
  [null, null, null, null, null, null]
)

// The app page's file:// URL, however Chromium spells it.
const page = String.raw`C:\Users\RUNNER~1\AppData\Local\Programs\zenode\resources\app.asar\out\renderer\index.html`
eq(
  'app page: same file, any spelling',
  [
    'file:///C:/Users/RUNNER~1/AppData/Local/Programs/zenode/resources/app.asar/out/renderer/index.html',
    'file:///C:/Users/RUNNER%7E1/AppData/Local/Programs/zenode/resources/app.asar/out/renderer/index.html#/x',
    'file:///c:/users/runner~1/appdata/local/programs/zenode/resources/app.asar/out/renderer/index.html?a=1'
  ].map((u) => isFileUrlOf(u, page)),
  [true, true, true]
)
eq(
  'app page: other files and schemes are not it',
  [
    'file:///C:/Users/RUNNER~1/AppData/Local/Programs/zenode/resources/app.asar/out/renderer/other.html',
    'file:///C:/Users/RUNNER~1/AppData/Local/Programs/zenode/resources/app.asar/out/renderer/index.html.evil',
    'vault://v1/C:/Users/RUNNER~1/AppData/Local/Programs/zenode/resources/app.asar/out/renderer/index.html',
    'https://example.com/index.html',
    'not a url'
  ].map((u) => isFileUrlOf(u, page)),
  [false, false, false, false, false]
)
