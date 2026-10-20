import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Settings } from '../shared/api'
import { atomicWrite } from './fsutil'

const MAX_RECENT = 8

function settingsFile(): string {
  return join(app.getPath('userData'), 'zenode-settings.json')
}

export async function loadSettings(): Promise<Settings> {
  try {
    const parsed = JSON.parse(await fs.readFile(settingsFile(), 'utf8')) as Partial<Settings>
    return {
      lastVault: parsed.lastVault,
      recentVaults: Array.isArray(parsed.recentVaults) ? parsed.recentVaults : [],
      workspaces: parsed.workspaces && typeof parsed.workspaces === 'object' ? parsed.workspaces : {},
      updates: parsed.updates,
      sync: parsed.sync
    }
  } catch {
    return { recentVaults: [], workspaces: {} }
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  const file = settingsFile()
  await fs.mkdir(dirname(file), { recursive: true })
  await atomicWrite(file, JSON.stringify(settings, null, 2))
}

export function rememberVault(settings: Settings, root: string): Settings {
  const recentVaults = [root, ...settings.recentVaults.filter((v) => v !== root)].slice(0, MAX_RECENT)
  return { ...settings, lastVault: root, recentVaults }
}
