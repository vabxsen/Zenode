// File operations that touch many files at once.
import { contentHash } from '../../shared/hash'
import { attachmentName } from './editor/attachments'
import { applyEdits, type MetadataCache, type PendingRename } from './index/metadataCache'
import { mediaKind } from './vaultUrl'

// Saves pasted/dropped files into dir; returns their vault paths.
export async function saveAttachments(files: File[], dir: string): Promise<string[]> {
  const saved: string[] = []
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    saved.push(await window.zenode.saveAttachment(dir, attachmentName(file), bytes))
  }
  return saved
}

// The Markdown to insert for saved files: ![[embeds]] for things that can be
// shown, [[links]] otherwise. Call after the index knows the files, so the
// shortest unique link text is used.
export function attachmentLinks(paths: string[], notePath: string, linktext: (path: string, from: string) => string): string {
  return paths
    .map((p) => {
      const link = linktext(p, notePath)
      return mediaKind(p) === 'other' ? `[[${link}]]` : `![[${link}]]`
    })
    .join('\n')
}

export interface LinkRewriteResult {
  links: number
  files: number
  // Files changed outside Zenode since they were indexed; left untouched.
  skipped: string[]
}

// After `from` was renamed to `to`, rewrite every link that pointed at it (in
// notes and in canvases). Each write is checked against the indexed version,
// so a file edited outside Zenode in the meantime is skipped, not overwritten.
export async function rewriteLinksAfterRename(
  cache: MetadataCache,
  pending: PendingRename[],
  from: string,
  to: string,
  reindex: (path: string, content: string) => Promise<void>
): Promise<LinkRewriteResult> {
  const result: LinkRewriteResult = { links: 0, files: 0, skipped: [] }
  const rewrite = async (path: string, before: string, updated: string, links: number): Promise<void> => {
    const write = await window.zenode.writeChecked(path, updated, contentHash(before))
    if (write.status === 'conflict') {
      result.skipped.push(path)
      return
    }
    await reindex(path, updated)
    result.links += links
    result.files++
  }
  for (const [path, list] of cache.buildRenameEdits(pending, from, to)) {
    const note = cache.getNote(path)
    if (note) await rewrite(path, note.content, applyEdits(note.content, list), list.length)
  }
  // Links inside canvases live in JSON; rewrite those files too.
  for (const [path, updated] of cache.buildCanvasRenames(pending, from, to)) {
    const before = cache.getNote(path)?.content
    if (before !== undefined) await rewrite(path, before, updated, 1)
  }
  return result
}
