// URL for showing a vault file in the page (served by the main process's vault:// protocol).
export function vaultUrl(path: string): string {
  return `vault://file/${path.split('/').map(encodeURIComponent).join('/')}`
}

export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'])

export function isImage(path: string): boolean {
  return IMAGE_EXTENSIONS.has(path.slice(path.lastIndexOf('.') + 1).toLowerCase())
}
