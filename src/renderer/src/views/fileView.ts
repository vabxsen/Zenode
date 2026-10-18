// A tab for a vault file that isn't a note or canvas: images, PDFs, audio,
// video and plain text. It follows renames and reloads when the file changes.
import { el } from '../component'
import { LARGE_NOTE, type WorkspaceView } from '../paneTypes'
import { baseName } from '../paths'
import { vaultUrl } from '../vaultUrl'
import { fileKind, type FileKind } from './fileKinds'
import { ImageViewer } from './imageViewer'

const api = window.zenode

export interface FileViewDeps {
  notice(message: string): void
}

export class FileView implements WorkspaceView {
  readonly el: HTMLElement
  private readonly kind: FileKind
  private readonly titleEl: HTMLElement
  private readonly body: HTMLElement
  private image: ImageViewer | null = null
  private media: HTMLMediaElement | HTMLIFrameElement | null = null
  private textEl: HTMLElement | null = null
  private version = 0

  constructor(
    private path: string,
    private readonly d: FileViewDeps
  ) {
    this.kind = fileKind(path)
    this.el = el('div', `zn-view-host zn-file-view is-${this.kind}`)
    const header = el('div', 'zn-file-header', this.el)
    this.titleEl = el('span', 'zn-file-title', header)
    const action = (text: string, run: () => Promise<void>): void => {
      const b = el('button', 'zn-btn zn-file-action', header, text)
      b.addEventListener('click', () => void run().catch((e: Error) => this.d.notice(e.message)))
    }
    action('Open in default app', () => api.openExternal(this.path))
    action('Show in Explorer', () => api.reveal(this.path))
    this.body = el('div', 'zn-file-body', this.el)
    this.build()
    this.load()
  }

  get id(): string {
    return this.path
  }

  get title(): string {
    return baseName(this.path)
  }

  get filePath(): string {
    return this.path
  }

  setPath(path: string): void {
    this.path = path
    this.load()
  }

  async reloadFromDisk(): Promise<void> {
    this.version++
    this.load()
  }

  show(): void {
    this.el.style.display = ''
    if (this.kind === 'image') this.image?.fit()
  }

  hide(): void {
    this.el.style.display = 'none'
    // Don't keep playing in a hidden tab.
    if (this.media instanceof HTMLMediaElement) this.media.pause()
  }

  destroy(): void {
    if (this.media instanceof HTMLMediaElement) {
      this.media.pause()
      this.media.removeAttribute('src')
      this.media.load()
    }
    this.el.remove()
  }

  private build(): void {
    switch (this.kind) {
      case 'image':
        this.image = new ImageViewer(this.body, baseName(this.path))
        return
      case 'pdf': {
        const frame = el('iframe', 'zn-file-pdf', this.body)
        frame.title = baseName(this.path)
        this.media = frame
        return
      }
      case 'audio':
      case 'video': {
        const media = el(this.kind, `zn-file-${this.kind}`, this.body)
        media.controls = true
        this.media = media
        return
      }
      default:
        this.textEl = el('pre', 'zn-file-text', this.body)
    }
  }

  // The URL changes with each reload so the page doesn't show a cached copy.
  private url(): string {
    return this.version ? `${vaultUrl(this.path)}?v=${this.version}` : vaultUrl(this.path)
  }

  private load(): void {
    this.titleEl.textContent = this.path
    if (this.image) this.image.setSource(this.url())
    else if (this.media) this.media.src = this.url()
    else void this.loadText()
  }

  private async loadText(): Promise<void> {
    const target = this.textEl
    if (!target) return
    try {
      const text = await api.read(this.path)
      target.textContent = text.length > LARGE_NOTE ? `${text.slice(0, LARGE_NOTE)}\n\n… (only the first 5 MB are shown)` : text
      target.classList.remove('is-error')
    } catch (e) {
      target.textContent = `Could not read this file: ${(e as Error).message}`
      target.classList.add('is-error')
    }
  }
}
