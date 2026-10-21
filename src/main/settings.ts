import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Settings } from '../shared/api'
import { atomicWrite } from './fsutil'
import { serial } from './serial'

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
      sync: parsed.sync,
      syncSkip: Array.isArray(parsed.syncSkip) ? parsed.syncSkip : undefined,
      syncChosen: Array.isArray(parsed.syncChosen) ? parsed.syncChosen : undefined
    }
  } catch {
    return { recentVaults: [], workspaces: {} }
  }
}

async function saveSettings(settings: Settings): Promise<void> {
  const file = settingsFile()
  await fs.mkdir(dirname(file), { recursive: true })
  await atomicWrite(file, JSON.stringify(settings, null, 2))
}

const inTurn = serial()

// Changes the settings file: `change` gets the latest settings and returns the
// new ones. Changes run one at a time, so two at once can't lose each other.
export function updateSettings(change: (s: Settings) => Settings): Promise<Settings> {
  return inTurn(async () => {
    const next = change(await loadSettings())
    await saveSettings(next)
    return next
  })
}

// How settings name a folder (Windows paths ignore case).
export const folderKey = (root: string): string => resolve(root).toLowerCase()

// Leaves a folder out of automatic sync until it is turned on by hand (a
// folder the user already chose for is left as they set it).
export function skipSyncFor(root: string): Promise<Settings> {
  const k = folderKey(root)
  return updateSettings((s) => ((s.syncSkip ?? []).includes(k) || (s.syncChosen ?? []).includes(k) ? s : { ...s, syncSkip: [...(s.syncSkip ?? []), k] }))
}

export function rememberVault(settings: Settings, root: string): Settings {
  const recentVaults = [root, ...settings.recentVaults.filter((v) => v !== root)].slice(0, MAX_RECENT)
  return { ...settings, lastVault: root, recentVaults }
}
