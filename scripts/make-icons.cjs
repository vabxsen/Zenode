// Draws the Zenode icon (the Ribbon Z on a near-black rounded square)
// at every Windows icon size and writes build/icon.ico and build/icon.png.
// Run with Electron: npx electron scripts/make-icons.cjs
const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
const OUT = join(__dirname, '..', 'build')

// Runs in the page: returns base64 PNGs, one per size.
// The Ribbon Z: two orange strips joined by a darker diagonal, the fold, on a
// near-black tile (64-unit grid; the in-app mark in src/renderer/src/logo.ts
// uses the same shapes).
const draw = `(${function (sizes) {
  return sizes.map((s) => {
    const c = document.createElement('canvas')
    c.width = c.height = s
    const g = c.getContext('2d')
    g.fillStyle = '#0b0b0f'
    g.beginPath()
    g.roundRect(0, 0, s, s, s * 0.22)
    g.fill()
    g.scale(s / 64, s / 64)
    // Small sizes get a larger mark, so it stays readable in the taskbar.
    if (s <= 24) {
      g.translate(32, 32)
      g.scale(1.18, 1.18)
      g.translate(-32, -32)
    }
    g.fillStyle = '#c2410c'
    g.fill(new Path2D('M38 24H48L26 40H16Z'))
    g.fillStyle = '#fb923c'
    g.beginPath()
    g.roundRect(16, 16, 32, 8, 2)
    g.roundRect(16, 40, 32, 8, 2)
    g.fill()
    return c.toDataURL('image/png').split(',')[1]
  })
}})(${JSON.stringify(SIZES)})`

// An .ico holding PNG images (supported since Windows Vista).
function ico(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const entries = []
  let offset = 6 + 16 * pngs.length
  pngs.forEach(({ size, data }) => {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0)
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt8(0, 2)
    e.writeUInt8(0, 3)
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(e)
  })
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)])
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  await win.loadURL('data:text/html,<!doctype html><title>icons</title>')
  const pngs = (await win.webContents.executeJavaScript(draw)).map((b64, i) => ({ size: SIZES[i], data: Buffer.from(b64, 'base64') }))
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'icon.ico'), ico(pngs))
  writeFileSync(join(OUT, 'icon.png'), pngs[pngs.length - 1].data)
  console.log(`Wrote build/icon.ico (${SIZES.join(', ')} px) and build/icon.png`)
  app.quit()
})
