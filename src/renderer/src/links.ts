// Where a link points: the file of a relative Markdown link, and the position of
// a "#Heading" or "#^block-id" inside a note.
import type { NoteMeta } from './index/parser'
import { joinPath, parentDir } from './paths'
import type { OpenPosition } from './workspace'

// "../Other%20note.md#Plans" from "Folder/Note.md" -> { path: "Other note.md", subpath: "#Plans" }.
// Paths without an extension are notes (.md). Null if it leaves the vault.
export function relativeLinkTarget(href: string, fromPath: string): { path: string; subpath: string } | null {
  let decoded = href
  try {
    decoded = decodeURI(href)
  } catch {
    // Use the raw href.
  }
  const [target, ...rest] = decoded.split('#')
  if (!target) return null
  let path = (target.startsWith('/') ? joinPath('', target.slice(1)) : joinPath(parentDir(fromPath), target)) ?? ''
  if (!path) return null
  if (!/\.[a-z0-9]+$/i.test(path)) path += '.md'
  return { path, subpath: rest.length ? `#${rest.join('#')}` : '' }
}

// The offset of a heading or block inside a note's text, if found.
export function subpathPosition(content: string, meta: NoteMeta, subpath: string): OpenPosition | undefined {
  if (subpath.startsWith('#^')) {
    const at = content.indexOf(`^${subpath.slice(2)}`)
    return at === -1 ? undefined : { from: content.lastIndexOf('\n', at) + 1 }
  }
  const wanted = subpath.slice(1).split('#').pop()!.trim().toLowerCase()
  const heading = meta.headings.find((h) => h.text.trim().toLowerCase() === wanted)
  if (!heading) return undefined
  let offset = 0
  for (let i = 0; i < heading.line; i++) offset = content.indexOf('\n', offset) + 1
  return { from: offset }
}
