// URL for showing a vault file in the page (served by the main process's vault:// protocol).
export function vaultUrl(path: string): string {
  return `vault://file/${path.split('/').map(encodeURIComponent).join('/')}`
}

export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'])

export function isImage(path: string): boolean {
  return IMAGE_EXTENSIONS.has(path.slice(path.lastIndexOf('.') + 1).toLowerCase())
}

const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'ogg', 'flac', 'webm', '3gp'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'ogv', 'mov', 'mkv'])

export type MediaKind = 'image' | 'audio' | 'video' | 'pdf' | 'other'

// How an embedded file is shown. (.webm is treated as video.)
export function mediaKind(path: string): MediaKind {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio'
  if (ext === 'pdf') return 'pdf'
  return 'other'
}
