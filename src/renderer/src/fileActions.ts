// Creating, renaming, moving and deleting files and folders, with the open tabs,
// the file tree and every link in the vault kept in step.
import type { TreeEntry } from '../../shared/api'
import { fileNameProblem } from '../../shared/fileNames'
import { rewriteLinksAfterRename } from './fileOps'
import { displayName, type FileTree } from './fileTree'
import { allFolders, pickFolder } from './folderPicker'
import type { TrashOption } from './config'
import type { MetadataCache } from './index/metadataCache'
import { baseName, parentDir, stripMd } from './paths'
import type { Workspace } from './workspace'

const api = window.zenode

export interface FileActionDeps {
  cache(): MetadataCache | null
  workspace(): Workspace | null
  tree(): FileTree | null
  refreshTree(): Promise<void>
  queueIndex(task: () => Promise<void>): Promise<void>
  // Resolves once queued index work is done.
  indexIdle(): Promise<void>
  openCanvas(path: string): void
  notice(message: string): void
  // Told after a file or folder moved or went to the Recycle Bin.
  renamed(from: string, to: string): void
  removed(path: string): void
  // Where deletes go, for the confirmation.
  trashOption(): TrashOption
}

export class FileActions {
  constructor(private readonly d: FileActionDeps) {}

  async newNote(dir: string): Promise<void> {
    try {
      const path = await api.createFile(dir, 'Untitled', 'md')
      await this.d.refreshTree()
      await this.d.workspace()?.open(path)
      this.d.tree()?.startRename(path)
    } catch (e) {
      this.d.notice(`Could not create note: ${(e as Error).message}`)
    }
  }

  // Create a note from a name typed in the switcher or an unresolved link ("Folder/Name" allowed).
  async createNamedNote(name: string): Promise<void> {
    const clean = stripMd(name.trim().replace(/\\/g, '/'))
    if (!clean) return
    const dir = parentDir(clean)
    const base = baseName(clean)
    let path: string
    try {
      path = await api.createFile(dir, base, 'md')
    } catch {
      try {
        path = await api.createFile('', base, 'md')
      } catch (e) {
        this.d.notice(`Could not create note: ${(e as Error).message}`)
        return
      }
    }
    await this.d.refreshTree()
    await this.d.workspace()?.open(path)
  }

  async newCanvas(dir: string): Promise<void> {
    try {
      const path = await api.createFile(dir, 'Untitled', 'canvas')
      await this.d.refreshTree()
      this.d.openCanvas(path)
      this.d.tree()?.startRename(path)
    } catch (e) {
      this.d.notice(`Could not create canvas: ${(e as Error).message}`)
    }
  }

  async newFolder(dir: string): Promise<void> {
    try {
      const path = await api.createFolder(dir, 'Untitled folder')
      await this.d.refreshTree()
      this.d.tree()?.startRename(path)
    } catch (e) {
      this.d.notice(`Could not create folder: ${(e as Error).message}`)
    }
  }

  async rename(entry: TreeEntry, newName: string): Promise<void> {
    // Say what's wrong with the name at once, before saving and waiting for the index.
    const problem = fileNameProblem(newName)
    if (problem) {
      this.d.notice(problem)
      await this.d.refreshTree()
      return
    }
    const wasActive = this.d.workspace()?.activePath === entry.path
    await this.relocate(entry.path, entry.kind === 'folder', () => api.rename(entry.path, newName))
    // Naming the open note moves you straight into writing it.
    if (wasActive) this.d.workspace()?.focus()
  }

  // Renames or moves a file or folder (perform does it on disk), then follows it in
  // open tabs and the tree and rewrites every link that pointed at it.
  private async relocate(from: string, isFolder: boolean, perform: () => Promise<string>): Promise<void> {
    const cache = this.d.cache()
    try {
      await this.d.workspace()?.saveAll()
      await this.d.indexIdle()
      const pending = cache ? cache.collectRenameRefs(from, isFolder) : []
      const to = await perform()
      this.d.workspace()?.renamed(from, to)
      this.d.renamed(from, to)
      if (isFolder) this.d.tree()?.renamePath(from, to)
      await this.d.refreshTree()
      if (cache && to !== from && pending.length) {
        const reindex = (path: string, content: string): Promise<void> => this.d.queueIndex(() => cache.setContent(path, content))
        const { links, files, skipped } = await rewriteLinksAfterRename(cache, pending, from, to, reindex)
        if (links) this.d.notice(`Updated ${links} link${links === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}.`)
        if (skipped.length) this.d.notice(`Links not updated in ${skipped.join(', ')}: changed outside Zenode just now. Try again.`)
      }
    } catch (e) {
      this.d.notice((e as Error).message)
      await this.d.refreshTree()
    }
  }

  async moveAll(paths: string[], destDir: string): Promise<void> {
    const files = new Set(this.d.cache()?.allFiles() ?? [])
    for (const path of paths) await this.relocate(path, !files.has(path), () => api.move(path, destDir))
  }

  async moveTo(paths: string[]): Promise<void> {
    const folders = allFolders(await api.list()).filter((f) => !paths.some((p) => f === p || f.startsWith(`${p}/`)))
    const dest = await pickFolder(folders, paths.length === 1 ? `Move "${paths[0]}" to…` : `Move ${paths.length} items to…`)
    if (dest !== null) await this.moveAll(paths, dest)
  }

  async remove(entries: TreeEntry[]): Promise<void> {
    const [first] = entries
    if (!first) return
    const what =
      entries.length > 1
        ? `these ${entries.length} items`
        : first.kind === 'folder'
          ? `the folder "${first.name}" and everything in it`
          : `"${displayName(first)}"`
    const where = this.d.trashOption() === 'local' ? "the vault's .trash folder" : 'the Recycle Bin'
    if (!window.confirm(`Move ${what} to ${where}?`)) return
    // Save first; tabs close only once their file is really gone, so a failed
    // delete never loses unsaved typing.
    await this.d.workspace()?.saveAll()
    for (const entry of entries) {
      try {
        const result = await api.trash(entry.path)
        this.d.workspace()?.removed(entry.path)
        this.d.removed(entry.path)
        if (result.where === 'vault' && this.d.trashOption() !== 'local') {
          this.d.notice(`The Recycle Bin isn't available here, so "${entry.name}" went to ${result.path} in the vault.`)
        }
      } catch (e) {
        this.d.notice(`Could not delete ${entry.path}: ${(e as Error).message}`)
      }
    }
    await this.d.refreshTree()
  }
}
