// Which vault in the account a folder belongs to, kept in the folder itself
// (.zenode/sync.json, never uploaded). It survives a reinstall or a new
// computer with the same folder, without ever matching vaults by name.
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { checkInsideVault } from '../config'
import { atomicWrite } from '../fsutil'

const linkFile = (root: string): string => join(root, '.zenode', 'sync.json')

export async function readVaultLink(root: string, uid: string): Promise<string | null> {
  try {
    const link = JSON.parse(await fs.readFile(linkFile(root), 'utf8')) as { uid?: unknown; vaultId?: unknown }
    return link.uid === uid && typeof link.vaultId === 'string' && link.vaultId ? link.vaultId : null
  } catch {
    return null
  }
}

export async function writeVaultLink(root: string, uid: string, vaultId: string): Promise<void> {
  await fs.mkdir(join(root, '.zenode'), { recursive: true })
  await checkInsideVault(root, join(root, '.zenode'))
  await atomicWrite(linkFile(root), JSON.stringify({ uid, vaultId }, null, 2))
}
