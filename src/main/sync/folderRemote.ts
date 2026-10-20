// A stand-in for the cloud: a folder of JSON files. Used by tests (and only in
// development builds) so sync can be tested end to end without Firebase.
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { atomicWrite } from '../fsutil'
import type { ChangesPage, RemoteFile, RemoteStore, RemoteVaultInfo } from './remote'

interface VaultData {
  seq: number
  files: Record<string, RemoteFile & { seq: number; device: string }>
}

export class FolderRemote implements RemoteStore {
  constructor(private readonly dir: string) {}

  private async readJson<T>(name: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await fs.readFile(join(this.dir, name), 'utf8')) as T
    } catch {
      return fallback
    }
  }

  private async writeJson(name: string, data: unknown): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    await atomicWrite(join(this.dir, name), JSON.stringify(data))
  }

  listVaults(): Promise<RemoteVaultInfo[]> {
    return this.readJson<RemoteVaultInfo[]>('vaults.json', [])
  }

  async createVault(name: string): Promise<string> {
    const vaults = await this.listVaults()
    const id = randomUUID().replace(/-/g, '')
    await this.writeJson('vaults.json', [...vaults, { id, name, updatedAt: Date.now() }])
    return id
  }

  async changesSince(vaultId: string, cursor: string | null): Promise<ChangesPage> {
    const data = await this.readJson<VaultData>(`${vaultId}.json`, { seq: 0, files: {} })
    const since = Number(cursor ?? 0)
    const files = Object.values(data.files)
      .filter((f) => f.seq > since)
      .map(({ path, hash, deleted, content }) => ({ path, hash, deleted, content }))
    return { files, cursor: String(data.seq) }
  }

  async put(vaultId: string, files: RemoteFile[], device: string): Promise<void> {
    const data = await this.readJson<VaultData>(`${vaultId}.json`, { seq: 0, files: {} })
    data.seq += 1
    for (const f of files) data.files[f.path] = { ...f, content: f.deleted ? '' : f.content, seq: data.seq, device }
    await this.writeJson(`${vaultId}.json`, data)
    const vaults = await this.listVaults()
    await this.writeJson(
      'vaults.json',
      vaults.map((v) => (v.id === vaultId ? { ...v, updatedAt: Date.now() } : v))
    )
  }
}
