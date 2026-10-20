// The settings sections (Hotkeys has its own module).
import type { VaultInfo } from '../../../shared/api'
import { appearance, FONT_SIZE, LINE_WIDTH, reloadCustomCss, updateAppearance, ZOOM, type ThemeChoice } from '../appearance/appearance'
import { el } from '../component'
import type { DefaultView, EditorSettings, TrashOption } from '../config'
import { formatDate, invalidNameChars } from '../templates/format'
import { DEFAULT_DAILY, DEFAULT_TEMPLATES, sanitizeDaily, sanitizeTemplates } from '../templates/settings'
import { button, colorPicker, dropdown, heading, settingRow, slider, textField, toggle } from './controls'
import type { SettingsSection } from './settingsModal'
import { renderUpdates } from './updatesSection'
import { accountSection } from './accountSection'

const api = window.zenode

export interface SettingsDeps {
  vault: VaultInfo
  editor(): EditorSettings
  updateEditor(change: Partial<EditorSettings>): Promise<void>
  openAnotherVault(): void
  findUnusedAttachments(): void
  notice(message: string): void
}

const saveAppearance = (d: SettingsDeps, change: Parameters<typeof updateAppearance>[0]): void => {
  updateAppearance(change).catch((e: Error) => d.notice(`Could not save appearance: ${e.message}`))
}

function general(d: SettingsDeps): SettingsSection {
  return {
    id: 'general',
    name: 'General',
    render: async (c) => {
      heading(c, 'Vault')
      settingRow(c, d.vault.name, d.vault.root)
      button(c, 'Vault folder', 'Show the folder in File Explorer.', 'Show in Explorer', () => api.reveal(''))
      button(c, 'Another vault', 'Opens in its own window.', 'Open another vault…', () => d.openAnotherVault())
      heading(c, 'About')
      const info = await api.appInfo()
      settingRow(c, `Zenode ${info.version}`, `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node} · ${info.platform}`)
      settingRow(c, 'Settings and logs', info.userData)
      button(c, 'Diagnostics', 'Copies versions and system details, to paste into a bug report.', 'Copy diagnostics', async () => {
        const text = [`Zenode ${info.version}`, `Electron ${info.electron}`, `Chromium ${info.chrome}`, `Node ${info.node}`, info.platform, `Zoom ${Math.round(appearance().zoom * 100)}%`, `Theme ${appearance().theme}`].join('\n')
        await navigator.clipboard.writeText(text)
        d.notice('Diagnostics copied.')
      })
      await renderUpdates(c)
    }
  }
}

function editor(d: SettingsDeps): SettingsSection {
  return {
    id: 'editor',
    name: 'Editor',
    render: (c) => {
      const s = d.editor()
      dropdown<DefaultView>(c, 'Default view for new tabs', 'How notes open.', [['live', 'Live Preview'], ['source', 'Source mode'], ['reading', 'Reading view']], s.defaultView, (v) => void d.updateEditor({ defaultView: v }))
      toggle(c, 'Spellcheck', 'Underline misspelt words (uses the Windows language).', s.spellcheck, (v) => void d.updateEditor({ spellcheck: v }))
      const a = appearance()
      toggle(c, 'Readable line length', 'Keep lines to a comfortable width instead of the full pane.', a.readableLineLength, (v) => saveAppearance(d, { readableLineLength: v }))
      slider(c, 'Line width', 'Used when readable line length is on.', { ...LINE_WIDTH, step: 20 }, a.lineWidth, (v) => `${v} px`, (v) => saveAppearance(d, { lineWidth: v }))
    }
  }
}

function files(d: SettingsDeps): SettingsSection {
  return {
    id: 'files',
    name: 'Files & links',
    render: (c) => {
      const s = d.editor()
      textField(
        c,
        'Attachment folder',
        'Where pasted and dropped files go: empty for the vault root, ./ for the note\'s folder, ./name for a subfolder there, or a vault folder.',
        s.attachmentFolder,
        'Vault root',
        (v) => void d.updateEditor({ attachmentFolder: v })
      )
      dropdown<TrashOption>(c, 'Deleted files', 'Where files go when you delete them.', [['system', 'Recycle Bin'], ['local', "The vault's .trash folder"]], s.trashOption, (v) => void d.updateEditor({ trashOption: v }))
      button(c, 'Unused attachments', 'Find files no note or canvas uses.', 'Find…', () => d.findUnusedAttachments())
    }
  }
}

function appearanceSection(d: SettingsDeps): SettingsSection {
  return {
    id: 'appearance',
    name: 'Appearance',
    render: (c) => {
      const a = appearance()
      dropdown<ThemeChoice>(c, 'Theme', '"System" follows the Windows light/dark setting.', [['system', 'System'], ['dark', 'Dark'], ['light', 'Light']], a.theme, (v) => saveAppearance(d, { theme: v }))
      colorPicker(c, 'Accent colour', 'Links, buttons and highlights.', a.accent, '#8b5cf6', (v) => saveAppearance(d, { accent: v }))
      heading(c, 'Fonts')
      textField(c, 'Text font', 'A font installed on this PC, e.g. Georgia. Empty for the default.', a.fontText, 'Segoe UI', (v) => saveAppearance(d, { fontText: v }))
      textField(c, 'Code font', 'For code blocks and Source mode code. Empty for the default.', a.fontMono, 'Cascadia Code', (v) => saveAppearance(d, { fontMono: v }))
      slider(c, 'Text size', 'Note text in the editor and Reading view.', { ...FONT_SIZE, step: 1 }, a.fontSize, (v) => `${v} px`, (v) => saveAppearance(d, { fontSize: v }))
      heading(c, 'Interface')
      slider(c, 'Zoom', 'Everything bigger or smaller (Ctrl+= / Ctrl+- / Ctrl+0).', ZOOM, a.zoom, (v) => `${Math.round(v * 100)}%`, (v) => saveAppearance(d, { zoom: v }))
      return customCss(c, d)
    }
  }
}

// Themes and snippets found in .zenode/themes and .zenode/snippets.
async function customCss(c: HTMLElement, d: SettingsDeps): Promise<void> {
  const a = appearance()
  const { themes, snippets } = await api.listCss()
  heading(c, 'Themes')
  dropdown(c, 'CSS theme', 'Folders in .zenode/themes with a theme.css (themes made for Obsidian mostly work).', [['', 'None (built-in)'], ...themes.map((t): [string, string] => [t, t])], themes.includes(a.cssTheme) ? a.cssTheme : '', (v) => saveAppearance(d, { cssTheme: v }))
  button(c, 'Themes folder', '', 'Open folder', () => api.openCssFolder('theme'))
  heading(c, 'CSS snippets')
  if (!snippets.length) settingRow(c, 'No snippets yet', 'Put .css files in .zenode/snippets, then Reload.')
  for (const name of snippets) toggle(c, name, '', a.snippets.includes(name), (on) => saveAppearance(d, { snippets: on ? [...appearance().snippets, name] : appearance().snippets.filter((n) => n !== name) }))
  button(c, 'Snippets folder', 'After editing a snippet or theme, reload to see it.', 'Open folder', () => api.openCssFolder('snippet'))
  button(c, '', '', 'Reload themes and snippets', async () => {
    const failed = await reloadCustomCss()
    d.notice(failed.length ? `Could not load ${failed.join(', ')}.` : 'Themes and snippets reloaded.')
  })
}

function dailyNotes(d: SettingsDeps): SettingsSection {
  return {
    id: 'daily-notes',
    name: 'Daily notes',
    render: async (c) => {
      const s = sanitizeDaily(await api.readConfig('daily-notes').catch(() => null))
      const save = (change: Partial<typeof s>): void => {
        Object.assign(s, change)
        api.writeConfig('daily-notes', s).catch((e: Error) => d.notice(`Could not save daily note settings: ${e.message}`))
      }
      textField(c, 'Folder', 'Where new daily notes go. Empty for the vault root.', s.folder, 'Vault root', (v) => save({ folder: v }))
      const format = textField(c, 'Name format', 'Moment-style date format, e.g. YYYY-MM-DD or YYYY/MM/DD dddd ("/" makes folders).', s.format, DEFAULT_DAILY.format, (v) => {
        save({ format: v || DEFAULT_DAILY.format })
        preview()
      })
      const example = el('div', 'zn-set-preview', format.parentElement!)
      const preview = (): void => {
        const name = formatDate(new Date(), format.value.trim() || DEFAULT_DAILY.format)
        const bad = invalidNameChars(name)
        example.textContent = bad.length ? `Can't be used as a file name (${bad.join(' ')})` : `Today: ${name}.md`
        example.classList.toggle('is-error', bad.length > 0)
      }
      format.addEventListener('input', preview)
      preview()
      textField(c, 'Template', 'A note to start each daily note from, e.g. Templates/Daily.', s.template, 'None', (v) => save({ template: v }))
    }
  }
}

function templates(d: SettingsDeps): SettingsSection {
  return {
    id: 'templates',
    name: 'Templates',
    render: async (c) => {
      const s = sanitizeTemplates(await api.readConfig('templates').catch(() => null))
      const save = (change: Partial<typeof s>): void => {
        Object.assign(s, change)
        api.writeConfig('templates', s).catch((e: Error) => d.notice(`Could not save template settings: ${e.message}`))
      }
      textField(c, 'Template folder', 'Notes in this folder are offered by "Insert template".', s.folder, DEFAULT_TEMPLATES.folder, (v) => save({ folder: v }))
      textField(c, 'Date format', 'What {{date}} becomes.', s.dateFormat, DEFAULT_TEMPLATES.dateFormat, (v) => save({ dateFormat: v || DEFAULT_TEMPLATES.dateFormat }))
      textField(c, 'Time format', 'What {{time}} becomes.', s.timeFormat, DEFAULT_TEMPLATES.timeFormat, (v) => save({ timeFormat: v || DEFAULT_TEMPLATES.timeFormat }))
    }
  }
}

export function buildSections(d: SettingsDeps, extra: SettingsSection[]): SettingsSection[] {
  return [general(d), accountSection(d.notice), editor(d), files(d), appearanceSection(d), ...extra, dailyNotes(d), templates(d)]
}
