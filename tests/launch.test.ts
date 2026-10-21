// Opening Zenode from Windows (command lines and zenode:// links), and update text.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseLaunchArgs, resolveTarget } from '../src/main/launchArgs'
import { describeUpdate, sanitizeUpdatePrefs, updateErrorText, type UpdateStatus } from '../src/shared/updates'
import { eq } from './harness'

const cwd = 'C:\\Users\\me'

// Command lines.
eq('args: nothing to open', [parseLaunchArgs([], cwd), parseLaunchArgs(['.', '--inspect=0', 'out/main/index.js'], cwd)], [null, null])
eq('args: a note (relative to the working folder)', parseLaunchArgs(['notes\\a.md'], cwd), { kind: 'file', path: 'C:\\Users\\me\\notes\\a.md' })
eq('args: a canvas, after switches', parseLaunchArgs(['--no-sandbox', 'D:\\v\\Board.canvas'], cwd), { kind: 'file', path: 'D:\\v\\Board.canvas' })
eq('args: other files are ignored', parseLaunchArgs(['D:\\v\\photo.png', 'D:\\v\\tool.exe'], cwd), null)
eq('args: folder (both forms)', [parseLaunchArgs(['--open-folder=D:\\My vault'], cwd), parseLaunchArgs(['--open-folder', 'D:\\x'], cwd)], [
  { kind: 'folder', path: 'D:\\My vault' },
  { kind: 'folder', path: 'D:\\x' }
])
eq('args: link after "--"', parseLaunchArgs(['--', 'zenode://open?vault=Work&file=Plans%2FQ4'], cwd), { kind: 'link', vault: 'Work', file: 'Plans/Q4' })
eq('args: link without a file', parseLaunchArgs(['ZENODE://open?vault=Work'], cwd), { kind: 'link', vault: 'Work', file: undefined })
eq(
  'args: unusable links',
  ['zenode://open', 'zenode://open?file=a', 'zenode://settings?vault=Work', 'zenode:%%%', 'obsidian://open?vault=Work'].map((a) => parseLaunchArgs([a], cwd)),
  [null, null, null, null, null]
)

// Turning targets into a vault and a file.
const base = mkdtempSync(join(tmpdir(), 'zenode-launch-'))
const work = join(base, 'Work')
mkdirSync(join(work, 'Plans'), { recursive: true })
mkdirSync(join(work, '.zenode'))
writeFileSync(join(work, 'Plans', 'Q4.md'), '# Q4\n')
writeFileSync(join(work, 'tool.exe'), '')
writeFileSync(join(base, 'secret.md'), 'no\n')
const loose = join(base, 'Loose')
mkdirSync(loose)
writeFileSync(join(loose, 'Note.md'), 'hi\n')
const known = [work]

eq('resolve: link by vault name, file without .md', await resolveTarget({ kind: 'link', vault: 'work', file: 'Plans/Q4' }, known), { root: work, file: 'Plans/Q4.md' })
eq('resolve: link by vault folder', await resolveTarget({ kind: 'link', vault: work }, known), { root: work })
eq('resolve: link to an unknown vault', await resolveTarget({ kind: 'link', vault: 'Loose' }, known), null)
eq(
  'resolve: link files outside the vault, programs or missing open just the vault',
  await Promise.all(['../secret.md', 'tool.exe', 'Missing'].map((file) => resolveTarget({ kind: 'link', vault: 'Work', file }, known))),
  [{ root: work }, { root: work }, { root: work }]
)
eq('resolve: a file in a known vault', await resolveTarget({ kind: 'file', path: join(work, 'Plans', 'Q4.md') }, []), { root: work, file: 'Plans/Q4.md' })
eq('resolve: a file in no vault opens its folder, marked loose', await resolveTarget({ kind: 'file', path: join(loose, 'Note.md') }, known), { root: loose, file: 'Note.md', loose: true })
eq('resolve: missing file or folder', [await resolveTarget({ kind: 'file', path: join(loose, 'Nope.md') }, known), await resolveTarget({ kind: 'folder', path: join(base, 'Nope') }, known)], [null, null])
eq('resolve: folder', await resolveTarget({ kind: 'folder', path: loose }, known), { root: loose })
rmSync(base, { recursive: true, force: true })

// Update preferences and status text.
eq('updates: prefs default and cleaned', [sanitizeUpdatePrefs(null), sanitizeUpdatePrefs({ autoCheck: false, channel: 'beta' }), sanitizeUpdatePrefs({ autoCheck: 'no', channel: 'nightly' })], [
  { autoCheck: true, channel: 'stable' },
  { autoCheck: false, channel: 'beta' },
  { autoCheck: true, channel: 'stable' }
])
const status = (kind: UpdateStatus['kind'], state: UpdateStatus['state']): UpdateStatus => ({ version: '0.5.0', kind, prefs: { autoCheck: true, channel: 'stable' }, state })
eq(
  'updates: status text',
  [
    status('dev', { status: 'idle' }),
    status('installed', { status: 'none' }),
    status('installed', { status: 'available', version: '0.6.0' }),
    status('zip', { status: 'available', version: '0.6.0' }),
    status('installed', { status: 'downloading', version: '0.6.0', percent: 41.6 }),
    status('installed', { status: 'ready', version: '0.6.0' })
  ].map(describeUpdate),
  [
    'Updates are off in development builds.',
    'Zenode 0.5.0 is the latest version.',
    'Zenode 0.6.0 is available.',
    'Zenode 0.6.0 is available to download.',
    'Downloading Zenode 0.6.0… 42%',
    'Zenode 0.6.0 is ready. It installs when you restart Zenode.'
  ]
)
eq(
  'updates: errors in plain words',
  [new Error('net::ERR_INTERNET_DISCONNECTED'), new Error('No published versions on GitHub'), new Error('Cannot find latest.yml in the latest release artifacts\nlong body'), 'odd\nsecond line'].map(updateErrorText),
  ['no connection to GitHub.', 'no releases published yet.', 'the latest release has no update files.', 'odd']
)
