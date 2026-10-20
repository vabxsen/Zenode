// Recognising the extra copies sync tools leave when they can't merge two edits.
import { baseName, parentDir } from '../paths'

export type SyncTool = 'Zenode Sync' | 'OneDrive' | 'Dropbox' | 'Syncthing' | 'Nextcloud'

export interface ConflictCopy {
  // The conflict copy.
  path: string
  // The note it is a copy of (it may no longer exist).
  original: string
  originalExists: boolean
  tool: SyncTool
  // The device that made the copy, when the name says.
  device?: string
}

interface Pattern {
  tool: SyncTool
  re: RegExp
  // Builds the original file name from the match.
  original(m: RegExpExecArray): string
  device?(m: RegExpExecArray): string
  // Only count it when the original exists (for loose patterns).
  needsOriginal?: boolean
}

const EXT = '(\\.[^.\\s]+)?'
const PATTERNS: Pattern[] = [
  // Note (Zenode conflict from LAPTOP 2026-10-20 154233).md
  {
    tool: 'Zenode Sync',
    re: new RegExp(`^(.+) \\(Zenode conflict from (.+?) \\d{4}-\\d{2}-\\d{2} \\d{6}\\)${EXT}$`),
    original: (m) => m[1] + (m[3] ?? ''),
    device: (m) => m[2]
  },
  // Note.sync-conflict-20261018-123456-ABCDEFG.md
  { tool: 'Syncthing', re: new RegExp(`^(.+)\\.sync-conflict-\\d{8}-\\d{6}-[A-Z0-9]{7}${EXT}$`), original: (m) => m[1] + (m[2] ?? '') },
  // Note (Pat's conflicted copy 2026-10-18).md, Note (Pat's conflicted copy 2026-10-18 (1)).md
  {
    tool: 'Dropbox',
    re: new RegExp(`^(.+) \\((.+?)['’]s conflicted copy(?: \\d{4}-\\d{2}-\\d{2})?(?: \\(\\d+\\))?\\)${EXT}$`),
    original: (m) => m[1] + (m[3] ?? ''),
    device: (m) => m[2]
  },
  // Note (conflicted copy 2026-10-18 123456).md (Nextcloud), Note_conflict-20261018-123456.md (ownCloud)
  { tool: 'Nextcloud', re: new RegExp(`^(.+) \\(conflicted copy \\d{4}-\\d{2}-\\d{2} \\d{6}\\)${EXT}$`), original: (m) => m[1] + (m[2] ?? '') },
  { tool: 'Nextcloud', re: new RegExp(`^(.+)_conflict-\\d{8}-\\d{6}${EXT}$`), original: (m) => m[1] + (m[2] ?? '') },
  // Note-DESKTOP-ABC123.md: OneDrive appends the computer name. Loose, so the original must exist.
  {
    tool: 'OneDrive',
    // Lazy: computer names may contain hyphens, so split at the first one that leaves a valid name.
    re: /^(.+?)-((?=[A-Z0-9-]*[A-Z])[A-Z0-9][A-Z0-9-]{2,14})(\.[^.\s]+)$/,
    original: (m) => m[1] + m[3],
    device: (m) => m[2],
    needsOriginal: true
  }
]

export function findConflictCopies(paths: string[]): ConflictCopy[] {
  const existing = new Set(paths.map((p) => p.toLowerCase()))
  const out: ConflictCopy[] = []
  for (const path of paths) {
    const name = baseName(path)
    const dir = parentDir(path)
    for (const p of PATTERNS) {
      const m = p.re.exec(name)
      if (!m) continue
      const originalName = p.original(m)
      const original = dir ? `${dir}/${originalName}` : originalName
      const originalExists = existing.has(original.toLowerCase())
      if (p.needsOriginal && !originalExists) continue
      out.push({ path, original, originalExists, tool: p.tool, device: p.device?.(m) })
      break
    }
  }
  return out
}

// Git (or a manual merge) left conflict markers in the text.
export function hasMergeMarkers(text: string): boolean {
  if (!text.includes('<<<<<<<')) return false
  return /^<{7}(?: .*)?$[\s\S]*?^={7}$[\s\S]*?^>{7}(?: .*)?$/m.test(text)
}
