// Security: what may be opened outside Zenode, and file access staying inside the vault.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
rmSync(base, { recursive: true, force: true })
