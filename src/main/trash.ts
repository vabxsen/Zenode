// Deleting a vault file the way the vault is set up to: the Recycle Bin, or
// the vault's own .trash folder. Used for deletes from the page and by sync.
import { app, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import type { TrashResult } from '../shared/api'
import { readConfig } from './config'
import { describeError, log } from './log'
import type { Vault } from './vault'

// End-to-end tests use their own folder instead of the user's Recycle Bin.
const testTrash = app.isPackaged ? undefined : process.env.ZENODE_TEST_TRASH

export async function trashFile(vault: Vault, path: string): Promise<TrashResult> {
  const file = await vault.realAbs(path)
  const config = (await readConfig(vault.root, 'app')) as { trashOption?: unknown } | null
  if (config?.trashOption === 'local') return { where: 'vault', path: await vault.moveToVaultTrash(path) }
  if (testTrash) {
    await fs.mkdir(testTrash, { recursive: true })
    await fs.rename(file, join(testTrash, `${Date.now()}-${basename(file)}`))
    return { where: 'system' }
  }
  try {
    await shell.trashItem(file)
    return { where: 'system' }
  } catch (e) {
    // Some network and cloud drives have no Recycle Bin: keep the file in the vault instead.
    void log('warn', `Recycle Bin refused ${path}: ${describeError(e)}`)
    return { where: 'vault', path: await vault.moveToVaultTrash(path) }
  }
}
