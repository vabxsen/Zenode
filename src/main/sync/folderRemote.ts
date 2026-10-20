// A stand-in for the cloud: a folder of JSON files. Used by tests (and only in
// development builds) so sync can be tested end to end without Firebase.
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { atomicWrite } from '../fsutil'
import { RemoteChangedError, type ChangesPage, type RemoteFile, type RemoteStore, type RemoteVaultInfo, type RemoteWrite } from './remote'

interface VaultData {
  seq: number
  files: Record<string, Omit<RemoteFile, 'version'> & { seq: number; device: string }>
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
      .map(({ path, hash, deleted, content, seq }) => ({ path, hash, deleted, content, version: String(seq) }))
    return { files, cursor: String(data.seq) }
  }

  async put(vaultId: string, files: RemoteWrite[], device: string): Promise<Record<string, string>> {
    const data = await this.readJson<VaultData>(`${vaultId}.json`, { seq: 0, files: {} })
    // All or nothing, like a Firestore commit with preconditions.
    if (files.some((f) => (data.files[f.path] ? String(data.files[f.path].seq) : null) !== f.expect)) throw new RemoteChangedError()
    data.seq += 1
    const versions: Record<string, string> = {}
    for (const { expect: _expect, version: _version, ...f } of files) {
      data.files[f.path] = { ...f, content: f.deleted ? '' : f.content, seq: data.seq, device }
      versions[f.path] = String(data.seq)
    }
    await this.writeJson(`${vaultId}.json`, data)
    const vaults = await this.listVaults()
    await this.writeJson(
      'vaults.json',
      vaults.map((v) => (v.id === vaultId ? { ...v, updatedAt: Date.now() } : v))
    )
    return versions
  }
}
