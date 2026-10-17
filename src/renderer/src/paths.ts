// Vault-relative path helpers. Paths always use forward slashes.

export function parentDir(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function stripMd(path: string): string {
  return path.toLowerCase().endsWith('.md') ? path.slice(0, -3) : path
}

// Note and canvas names are shown without their extension.
export function stripExt(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.md')) return path.slice(0, -3)
  if (lower.endsWith('.canvas')) return path.slice(0, -7)
  return path
}

export function isMarkdown(path: string): boolean {
  return path.toLowerCase().endsWith('.md')
}

// Join and normalise ".", ".." and duplicate slashes. Returns null if it climbs above the root.
export function joinPath(dir: string, rel: string): string | null {
  const parts = (dir ? `${dir}/${rel}` : rel).split('/')
  const out: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!out.length) return null
      out.pop()
    } else {
      out.push(part)
    }
  }
  return out.join('/')
}

// Relative path from one folder to a file, for Markdown-style links.
export function relativePath(fromDir: string, to: string): string {
  const from = fromDir ? fromDir.split('/') : []
  const target = to.split('/')
  let i = 0
  while (i < from.length && i < target.length - 1 && from[i] === target[i]) i++
  return [...from.slice(i).map(() => '..'), ...target.slice(i)].join('/')
}
