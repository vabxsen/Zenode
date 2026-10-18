// Export to PDF: the page sends a self-contained HTML rendering of a note
// (images inlined, styles included); it is printed from a hidden window that
// runs no page scripts and can't navigate, then saved where the user picks.
import { app, BrowserWindow, dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { PdfExportRequest } from '../shared/api'

const MAX_HTML = 64 * 1024 * 1024
const PAGE_SIZES = new Set(['A3', 'A4', 'A5', 'Legal', 'Letter', 'Tabloid'])
// Page margins in inches for each choice.
const MARGINS: Record<string, number> = { default: 0.4, minimum: 0.2, none: 0 }
// Gives web fonts a moment when the page doesn't report them ready.
const LOAD_TIMEOUT = 15000

// Unpackaged test builds save straight into this folder instead of asking.
const testExportDir = app.isPackaged ? undefined : process.env.ZENODE_TEST_EXPORT_DIR

function check(req: PdfExportRequest): void {
  if (typeof req?.html !== 'string' || typeof req.css !== 'string' || typeof req.title !== 'string') throw new Error('Invalid export request')
  if (req.html.length + req.css.length > MAX_HTML) throw new Error('The note is too large to export.')
  if (!PAGE_SIZES.has(req.pageSize) || !Object.hasOwn(MARGINS, req.margins) || typeof req.landscape !== 'boolean') throw new Error('Invalid page settings')
}

function page(req: PdfExportRequest): string {
  const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src file: http: data:">
<title>${esc(req.title)}</title><style>${req.css.replace(/<\/style/gi, '<\\/style')}</style></head>
<body class="zn-export">${req.html}</body></html>`
}

async function render(req: PdfExportRequest): Promise<Buffer> {
  const file = join(app.getPath('temp'), `zenode-export-${randomUUID()}.html`)
  await fs.writeFile(file, page(req), 'utf8')
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'zenode-export', spellcheck: false }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  try {
    await win.loadFile(file)
    await Promise.race([
      win.webContents.executeJavaScript('document.fonts.ready.then(() => true)'),
      new Promise((done) => setTimeout(done, LOAD_TIMEOUT))
    ])
    return await win.webContents.printToPDF({
      pageSize: req.pageSize as 'A4',
      landscape: req.landscape,
      margins: { top: MARGINS[req.margins], bottom: MARGINS[req.margins], left: MARGINS[req.margins], right: MARGINS[req.margins] },
      printBackground: true
    })
  } finally {
    win.destroy()
    await fs.rm(file, { force: true })
  }
}

// Returns the saved file's path, or null if the user cancelled.
export async function exportPdf(parent: BrowserWindow, req: PdfExportRequest, defaultDir: string): Promise<string | null> {
  check(req)
  const name = `${req.title.replace(/[<>:"/\\|?*]/g, '-') || 'Note'}.pdf`
  let target: string
  if (testExportDir) {
    target = join(testExportDir, name)
  } else {
    const choice = await dialog.showSaveDialog(parent, {
      title: 'Export to PDF',
      defaultPath: join(defaultDir, name),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (choice.canceled || !choice.filePath) return null
    target = choice.filePath
  }
  const pdf = await render(req)
  await fs.writeFile(target, pdf)
  return target
}
