// Daily notes (open or create today's note, optionally from a template) and
// "Insert template" into the active note.
import type { MetadataCache } from '../index/metadataCache'
import { pickFromList } from '../folderPicker'
import { baseName, stripExt } from '../paths'
import type { Workspace } from '../workspace'
import { applyTemplate, invalidNameChars, formatDate } from './format'
import { templateEdit } from './insert'
import { cleanVaultPath, sanitizeDaily, sanitizeTemplates, templatePath, type TemplateSettings } from './settings'

const api = window.zenode

export interface NoteTemplateDeps {
  cache(): MetadataCache | null
  workspace(): Workspace | null
  refreshTree(): Promise<void>
  openPath(path: string): Promise<void>
  notice(message: string): void
}

export class NoteTemplates {
  constructor(private readonly d: NoteTemplateDeps) {}

  // Opens the daily note `offset` days from today, creating it if needed.
  async openDaily(offset = 0): Promise<void> {
    const daily = sanitizeDaily(await api.readConfig('daily-notes'))
    const date = new Date()
    date.setDate(date.getDate() + offset)
    const name = cleanVaultPath(formatDate(date, daily.format))
    const bad = invalidNameChars(name)
    if (!name || bad.length) {
      this.d.notice(`The daily note format "${daily.format}" makes a name Windows can't use (${bad.join(' ') || 'empty'}). Change "format" in .zenode/daily-notes.json.`)
      return
    }
    const path = `${daily.folder ? `${daily.folder}/` : ''}${name}.md`
    if (this.d.cache()?.getNote(path) || (await this.create(path, daily.template, date))) await this.d.openPath(path)
  }

  // Lets the user pick a template and inserts it at the cursor.
  async insert(): Promise<void> {
    const ws = this.d.workspace()
    const active = ws?.activePath
    if (!ws || !active || ws.activeMode() === null) return
    if (ws.activeMode() === 'reading') {
      this.d.notice('Switch to editing to insert a template.')
      return
    }
    const settings = await this.settings()
    const prefix = settings.folder ? `${settings.folder}/` : ''
    const templates = (this.d.cache()?.allNotes() ?? [])
      .map((n) => n.path)
      .filter((p) => p.toLowerCase().endsWith('.md') && p.startsWith(prefix) && p !== active)
      .sort((a, b) => a.localeCompare(b))
    if (!templates.length) {
      this.d.notice(`No templates found. Put notes in the "${settings.folder || '/'}" folder (set "folder" in .zenode/templates.json).`)
      return
    }
    const chosen = await pickFromList(templates, 'Insert template…', (p) => stripExt(p.slice(prefix.length)), 'No matching template.')
    if (!chosen) return
    const text = await this.read(chosen)
    if (text === null) {
      this.d.notice(`Could not read the template "${stripExt(baseName(chosen))}".`)
      return
    }
    const filled = applyTemplate(text, { title: stripExt(baseName(active)), date: new Date(), ...this.formats(settings) })
    // The pick dialog took focus; the active note may have changed meanwhile.
    if (this.d.workspace()?.activePath !== active || !ws.editActive((doc, cursor) => templateEdit(doc, cursor, filled))) {
      this.d.notice('The note is no longer open for editing; the template was not inserted.')
    }
  }

  // False if the note could not be made.
  private async create(path: string, template: string, date: Date): Promise<boolean> {
    let content = ''
    if (template) {
      const text = await this.read(templatePath(template))
      if (text === null) this.d.notice(`Template "${template}" not found; the daily note starts empty.`)
      else content = applyTemplate(text, { title: stripExt(baseName(path)), date, ...this.formats(await this.settings()) })
    }
    try {
      await api.createAt(path, content)
    } catch (e) {
      // Already there (made outside Zenode, not indexed yet) is fine: it just opens.
      if ((await api.read(path).catch(() => null)) === null) {
        this.d.notice(`Could not create the daily note: ${(e as Error).message}`)
        return false
      }
    }
    await this.d.refreshTree()
    return true
  }

  private async read(path: string): Promise<string | null> {
    return this.d.cache()?.getNote(path)?.content ?? (await api.read(path).catch(() => null))
  }

  private async settings(): Promise<TemplateSettings> {
    return sanitizeTemplates(await api.readConfig('templates'))
  }

  private formats(s: TemplateSettings): { dateFormat: string; timeFormat: string } {
    return { dateFormat: s.dateFormat, timeFormat: s.timeFormat }
  }
}
