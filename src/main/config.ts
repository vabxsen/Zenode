import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { atomicWrite } from './fsutil'

// Per-vault configuration lives in <vault>/.zenode/<name>.json, like Obsidian's
// .obsidian folder. Only plain, known-shaped names are allowed, so the page can
// never use this to reach other files.
export const CONFIG_DIR = '.zenode'
const NAME = /^[a-z][a-z0-9-]{0,63}$/

export function configPath(vaultRoot: string, name: string): string {
  if (!NAME.test(name)) throw new Error(`Invalid config name: ${name}`)
  return join(vaultRoot, CONFIG_DIR, `${name}.json`)
}

// Missing or unreadable config comes back as null; the page falls back to defaults.
export async function readConfig(vaultRoot: string, name: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(configPath(vaultRoot, name), 'utf8')) as unknown
  } catch (e) {
    if ((e as Error).message.startsWith('Invalid config name')) throw e
    return null
  }
}

export async function writeConfig(vaultRoot: string, name: string, data: unknown): Promise<void> {
  const file = configPath(vaultRoot, name)
  await fs.mkdir(join(vaultRoot, CONFIG_DIR), { recursive: true })
  await atomicWrite(file, `${JSON.stringify(data, null, 2)}\n`)
}
