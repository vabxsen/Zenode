// Draws the Zenode icon (the "Z" from the app's logo on a violet rounded square)
// at every Windows icon size and writes build/icon.ico and build/icon.png.
// Run with Electron: npx electron scripts/make-icons.cjs
const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
const OUT = join(__dirname, '..', 'build')

// Runs in the page: returns base64 PNGs, one per size.
const draw = `(${function (sizes) {
  return sizes.map((s) => {
    const c = document.createElement('canvas')
    c.width = c.height = s
    const g = c.getContext('2d')
    const r = s * 0.22
    const bg = g.createLinearGradient(0, 0, s, s)
    bg.addColorStop(0, '#9b6dff')
    bg.addColorStop(1, '#5b21b6')
    g.fillStyle = bg
    g.beginPath()
    g.roundRect(0, 0, s, s, r)
    g.fill()
    // The logo's Z (M5 5h14L5 19h14 on a 24 grid), a little inset; thicker when tiny.
    const u = s / 24
    const inset = s <= 24 ? 0.6 : 1.2
    const map = (v) => (inset + (v * (24 - 2 * inset)) / 24) * u
    g.strokeStyle = '#ffffff'
    g.lineWidth = Math.max(1.6, s * (s <= 32 ? 0.13 : 0.1))
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.beginPath()
    g.moveTo(map(6), map(6.5))
    g.lineTo(map(18), map(6.5))
    g.lineTo(map(6), map(17.5))
    g.lineTo(map(18), map(17.5))
    g.stroke()
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
