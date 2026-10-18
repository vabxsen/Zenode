// Which viewer opens a vault file that isn't a note or a canvas.
import { mediaKind } from '../vaultUrl'

export type FileKind = 'image' | 'pdf' | 'audio' | 'video' | 'text' | 'other'

// Plain-text formats shown in the text viewer (read-only).
const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'log', 'csv', 'tsv', 'json', 'jsonc', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css', 'scss', 'less', 'html', 'htm', 'py', 'rb', 'rs', 'go', 'java',
  'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'php', 'lua', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd',
  'sql', 'r', 'tex', 'bib', 'org', 'rst', 'adoc', 'diff', 'patch', 'gitignore', 'editorconfig'
])

function extension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  // ".gitignore" has no base name: the whole thing is the extension.
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function fileKind(path: string): FileKind {
  const media = mediaKind(path)
  if (media !== 'other') return media
  return TEXT_EXTENSIONS.has(extension(path)) ? 'text' : 'other'
}

// Files Zenode can show in a tab (everything else opens in its default app).
export function hasViewer(path: string): boolean {
  return fileKind(path) !== 'other'
}
