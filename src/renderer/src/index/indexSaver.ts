// Keeps the saved index (indexStore) up to date: after a build that had to read
// files, after changes settle, and when the window closes.
import { saveIndexSnapshot } from './indexStore'
import type { MetadataCache } from './metadataCache'

// Changes come in bursts (typing autosaves); save once things are quiet.
const IDLE_DELAY = 30_000

export class IndexSaver {
  private timer: number | null = null
  private dirty = false
  private saving: Promise<void> | null = null
  private readonly unsubscribe: () => void

  constructor(
    private readonly cache: MetadataCache,
    private readonly vaultId: string,
    private readonly onError: (message: string) => void
  ) {
    this.unsubscribe = cache.onChange(() => this.changed())
  }

  changed(): void {
    this.dirty = true
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.saveNow(), IDLE_DELAY)
  }

  async saveNow(): Promise<void> {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
    if (this.saving) await this.saving
    if (!this.dirty) return
    this.dirty = false
    this.saving = saveIndexSnapshot(this.vaultId, this.cache.snapshot())
      .catch((e: Error) => this.onError(`Could not save the index cache: ${e.message}`))
      .finally(() => (this.saving = null))
    await this.saving
  }

  dispose(): void {
    this.unsubscribe()
    if (this.timer !== null) window.clearTimeout(this.timer)
  }
}
