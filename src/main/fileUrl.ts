// Comparing a page's file:// URL with a file path.
import { normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

// True when `url` is a file:// URL of `file` (ignoring any #hash or ?query).
// Compared as paths, not strings: Chromium and Node escape characters like "~"
// differently (Node writes %7E), and 8.3 short paths such as C:\Users\RUNNER~1
// are full of them. Windows paths are compared without regard to case.
export function isFileUrlOf(url: string, file: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'file:') return false
  u.hash = ''
  u.search = ''
  try {
    return normalize(fileURLToPath(u)).toLowerCase() === normalize(file).toLowerCase()
  } catch {
    return false
  }
}
