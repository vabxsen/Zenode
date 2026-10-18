// "Export to PDF": renders the note like Reading view, makes it self-contained
// (images inlined, media replaced by their names, styles collected) and asks
// main to print it on light pages.
import type { PdfExportRequest } from '../../../shared/api'
import { el } from '../component'
import { openDialog } from '../dialog'
import { baseName, stripExt } from '../paths'
import { renderInto, type ReadingContext } from '../render/reading'
import { EXPORT_CSS } from './printStyles'
import { startsWithTitle } from './title'

const api = window.zenode
const SETTINGS_KEY = 'zenode.pdfExport'

type PageSettings = Pick<PdfExportRequest, 'pageSize' | 'landscape' | 'margins'> & { includeTitle: boolean }

const DEFAULTS: PageSettings = { pageSize: 'A4', landscape: false, margins: 'default', includeTitle: true }

export interface PdfExportDeps {
  readingContext(path: string): Omit<ReadingContext, 'sourcePath' | 'onToggleTask'>
  notice(message: string): void
}

function loadSettings(): PageSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<PageSettings>) }
  } catch {
    return { ...DEFAULTS }
  }
}

function saveSettings(s: PageSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    // Not remembered.
  }
}

function select<T extends string>(parent: HTMLElement, label: string, options: Array<[T, string]>, value: T): HTMLSelectElement {
  const row = el('label', 'zn-export-row', parent)
  el('span', 'zn-export-label', row, label)
  const sel = el('select', 'zn-export-select', row)
  for (const [v, text] of options) {
    const opt = el('option', '', sel, text)
    opt.value = v
    opt.selected = v === value
  }
  return sel
}

// The page settings dialog; null if cancelled.
async function askSettings(title: string): Promise<PageSettings | null> {
  const s = loadSettings()
  const body = el('div', 'zn-export-form')
  const size = select(body, 'Page size', [['A4', 'A4'], ['Letter', 'Letter'], ['Legal', 'Legal'], ['A3', 'A3'], ['A5', 'A5'], ['Tabloid', 'Tabloid']], s.pageSize)
  const orient = select(body, 'Orientation', [['portrait', 'Portrait'], ['landscape', 'Landscape']], s.landscape ? 'landscape' : 'portrait')
  const margins = select(body, 'Margins', [['default', 'Normal'], ['minimum', 'Narrow'], ['none', 'None']], s.margins)
  const titleRow = el('label', 'zn-export-row is-check', body)
  const includeTitle = el('input', '', titleRow)
  includeTitle.type = 'checkbox'
  includeTitle.checked = s.includeTitle
  el('span', '', titleRow, `Start with the title "${title}"`)
  const go = await openDialog({
    title: 'Export to PDF',
    body,
    buttons: [
      { label: 'Cancel', value: false },
      { label: 'Export…', value: true, primary: true }
    ],
    cancelValue: false,
    className: 'zn-export-dialog'
  })
  if (!go) return null
  const chosen: PageSettings = {
    pageSize: size.value as PageSettings['pageSize'],
    landscape: orient.value === 'landscape',
    margins: margins.value as PageSettings['margins'],
    includeTitle: includeTitle.checked
  }
  saveSettings(chosen)
  return chosen
}

async function dataUrl(src: string): Promise<string | null> {
  try {
    const blob = await (await fetch(src)).blob()
    return await new Promise((done) => {
      const reader = new FileReader()
      reader.onload = () => done(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => done(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

// Makes the rendered note stand alone on paper.
async function makeSelfContained(body: HTMLElement): Promise<void> {
  body.querySelectorAll('.zn-copy-code').forEach((b) => b.remove())
  for (const media of body.querySelectorAll<HTMLElement>('iframe, audio, video')) {
    const src = media.getAttribute('src') ?? ''
    const name = decodeURIComponent(src.split('/').pop()?.split(/[?#]/)[0] ?? '')
    const note = document.createElement('p')
    note.className = 'zn-export-media'
    note.textContent = `[${name || 'media'}]`
    media.replaceWith(note)
  }
  // Task boxes keep their state when written out as HTML.
  body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box) => box.toggleAttribute('checked', box.checked))
  await Promise.all(
    [...body.querySelectorAll('img')].map(async (img) => {
      img.loading = 'eager'
      const src = img.getAttribute('src')
      const url = src && !src.startsWith('data:') ? await dataUrl(img.src) : src
      if (url) img.setAttribute('src', url)
      else img.remove()
    })
  )
}

// The page's own CSS, with url()s made absolute so fonts still load from the print page.
function collectCss(): string {
  const out: string[] = []
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    const base = sheet.href ?? document.baseURI
    for (const rule of [...rules]) {
      out.push(rule.cssText.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q: string, url: string) => {
        if (url.startsWith('data:')) return m
        try {
          return `url(${q}${new URL(url, base).href}${q})`
        } catch {
          return m
        }
      }))
    }
  }
  return `${out.join('\n')}\n${EXPORT_CSS}`
}

export async function exportNoteToPdf(path: string, text: string, d: PdfExportDeps): Promise<void> {
  const title = stripExt(baseName(path))
  const settings = await askSettings(title)
  if (!settings) return
  // Rendered off-screen at reading width (diagrams need to be in the page to lay out).
  const stage = el('div', 'zn-export-stage', document.body)
  const body = el('div', 'zn-reading-body', stage)
  try {
    if (settings.includeTitle && !startsWithTitle(text, title)) el('h1', 'zn-export-title', body, title)
    const content = el('div', '', body)
    await renderInto(content, text, { ...d.readingContext(path), sourcePath: path, onToggleTask: () => undefined })
    await makeSelfContained(body)
    const saved = await api.exportPdf({
      html: body.outerHTML,
      css: collectCss(),
      title,
      path,
      pageSize: settings.pageSize,
      landscape: settings.landscape,
      margins: settings.margins
    })
    if (saved) d.notice(`Exported to ${saved}`)
  } catch (e) {
    d.notice(`Could not export to PDF: ${(e as Error).message}`)
  } finally {
    stage.remove()
  }
}
