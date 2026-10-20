// The account's vaults in Cloud Firestore, through its REST API:
//   users/{uid}/vaults/{vaultId}                 name, updatedAt
//   users/{uid}/vaults/{vaultId}/files/{fileId}  path, hash, deleted, content, device, updatedAt
// updatedAt is the server's clock, so "changed since" works across computers
// whose clocks disagree. Security rules let a user reach only users/{their uid}.
import { createHash, randomUUID } from 'node:crypto'
import { RemoteChangedError, type ChangesPage, type RemoteFile, type RemoteStore, type RemoteVaultInfo, type RemoteWrite } from './remote'

type Value = { stringValue?: string; booleanValue?: boolean; integerValue?: string; timestampValue?: string; referenceValue?: string }
interface Doc {
  name: string
  fields?: Record<string, Value>
  // Changes with every write; used as the file's version.
  updateTime?: string
}

const PAGE = 300
// Re-read writes from the last minute, in case one landed with a slightly
// earlier server time than a write already seen.
const OVERLAP_MS = 60_000
const MAX_WRITES = 400
const MAX_BATCH_BYTES = 4 * 1024 * 1024

export const fileId = (path: string): string => createHash('sha256').update(path).digest('hex').slice(0, 40)

function httpError(status: number, message: string): Error {
  // A write's precondition failed: another computer wrote the file first.
  if (status === 409 || /FAILED_PRECONDITION|ALREADY_EXISTS|precondition/i.test(message)) return new RemoteChangedError()
  if (status === 401 || status === 403) return new Error('Sync was refused by the cloud. Sign in again, or check the Firestore rules.')
  if (status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(message)) return new Error('The sync service is busy or over its daily limit. Zenode will try again later.')
  if (status === 404 && /database/i.test(message)) return new Error('The Firestore database has not been created in the Firebase project yet.')
  return new Error(`Sync failed (${status}): ${message.slice(0, 200)}`)
}

export class FirestoreRemote implements RemoteStore {
  constructor(
    private readonly projectId: string,
    private readonly uid: () => string,
    private readonly token: () => Promise<string>
  ) {}

  private get root(): string {
    return `projects/${this.projectId}/databases/(default)/documents`
  }

  private vaultPath(vaultId: string): string {
    return `${this.root}/users/${this.uid()}/vaults/${vaultId}`
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`https://firestore.googleapis.com/v1/${path}`, {
      method,
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).catch(() => {
      throw new Error('Could not reach the sync service. Check your internet connection.')
    })
    const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } }
    if (!res.ok) throw httpError(res.status, (json as { error?: { message?: string } }).error?.message ?? '')
    return json
  }

  async listVaults(): Promise<RemoteVaultInfo[]> {
    const out: RemoteVaultInfo[] = []
    let pageToken = ''
    do {
      const q = new URLSearchParams({ pageSize: String(PAGE), ...(pageToken ? { pageToken } : {}) })
      const r = await this.call<{ documents?: Doc[]; nextPageToken?: string }>('GET', `${this.root}/users/${this.uid()}/vaults?${q}`)
      for (const d of r.documents ?? []) {
        out.push({ id: d.name.split('/').pop()!, name: d.fields?.name?.stringValue ?? 'Vault', updatedAt: Date.parse(d.fields?.updatedAt?.timestampValue ?? '') || 0 })
      }
      pageToken = r.nextPageToken ?? ''
    } while (pageToken)
    return out
  }

  async createVault(name: string): Promise<string> {
    const id = randomUUID().replace(/-/g, '')
    await this.commit([
      {
        update: { name: this.vaultPath(id), fields: { name: { stringValue: name } } },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }]
      }
    ])
    return id
  }

  async changesSince(vaultId: string, cursor: string | null): Promise<ChangesPage> {
    const files: RemoteFile[] = []
    let latest = cursor
    const from = cursor ? new Date(Date.parse(cursor) - OVERLAP_MS).toISOString() : null
    let after: { values: Value[]; before: boolean } | undefined
    for (;;) {
      const structuredQuery = {
        from: [{ collectionId: 'files' }],
        ...(from ? { where: { fieldFilter: { field: { fieldPath: 'updatedAt' }, op: 'GREATER_THAN', value: { timestampValue: from } } } } : {}),
        orderBy: [{ field: { fieldPath: 'updatedAt' } }, { field: { fieldPath: '__name__' } }],
        limit: PAGE,
        ...(after ? { startAt: after } : {})
      }
      const rows = await this.call<Array<{ document?: Doc }>>('POST', `${this.vaultPath(vaultId)}:runQuery`, { structuredQuery })
      const docs = rows.map((r) => r.document).filter((d): d is Doc => !!d)
      for (const d of docs) {
        const f = d.fields ?? {}
        files.push({ path: f.path?.stringValue ?? '', hash: f.hash?.stringValue ?? '', deleted: !!f.deleted?.booleanValue, content: f.content?.stringValue ?? '', version: d.updateTime })
        const at = f.updatedAt?.timestampValue
        if (at && (!latest || Date.parse(at) > Date.parse(latest))) latest = at
      }
      if (docs.length < PAGE) break
      const last = docs[docs.length - 1]
      after = { values: [{ timestampValue: last.fields?.updatedAt?.timestampValue }, { referenceValue: last.name }], before: false }
    }
    return { files: files.filter((f) => f.path), cursor: latest }
  }

  async put(vaultId: string, files: RemoteWrite[], device: string): Promise<Record<string, string>> {
    const vault = this.vaultPath(vaultId)
    const versions: Record<string, string> = {}
    // Batches small enough for one request each; the vault's updatedAt moves with every batch.
    let batch: RemoteWrite[] = []
    let bytes = 0
    const flush = async (): Promise<void> => {
      if (!batch.length) return
      const writes: unknown[] = batch.map((f) => ({
        update: {
          name: `${vault}/files/${fileId(f.path)}`,
          fields: {
            path: { stringValue: f.path },
            hash: { stringValue: f.hash },
            deleted: { booleanValue: f.deleted },
            content: { stringValue: f.deleted ? '' : f.content },
            device: { stringValue: device }
          }
        },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        // Only if nobody else wrote it since this computer last saw it.
        currentDocument: f.expect ? { updateTime: f.expect } : { exists: false }
      }))
      writes.push({ transform: { document: vault, fieldTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] } })
      const r = await this.commit(writes)
      batch.forEach((f, i) => {
        const at = r.writeResults?.[i]?.updateTime ?? r.commitTime
        if (at) versions[f.path] = at
      })
      batch = []
      bytes = 0
    }
    for (const f of files) {
      const size = f.content.length + 512
      if (batch.length >= MAX_WRITES || bytes + size > MAX_BATCH_BYTES) await flush()
      batch.push(f)
      bytes += size
    }
    await flush()
    return versions
  }

  private commit(writes: unknown[]): Promise<{ writeResults?: Array<{ updateTime?: string }>; commitTime?: string }> {
    return this.call('POST', `${this.root}:commit`, { writes })
  }
}
