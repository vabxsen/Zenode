// Draws the Microsoft Store (MSIX) tile images with the Ribbon Z and writes
// them to build/appx/, where electron-builder picks them up by name.
// Run with Electron: npx electron scripts/make-store-assets.cjs
const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const OUT = join(__dirname, '..', 'build', 'appx')
// [file, width, height, rounded corners]. The app list and taskbar icon and
// the Store logo are rounded like the app icon; Start tiles fill their square.
const ASSETS = [
  ['StoreLogo.png', 50, 50, true],
  ['Square44x44Logo.png', 44, 44, true],
  ['SmallTile.png', 71, 71, false],
  ['Square150x150Logo.png', 150, 150, false],
  ['Wide310x150Logo.png', 310, 150, false],
  ['LargeTile.png', 310, 310, false]
]

// Runs in the page: returns one base64 PNG per asset. The mark uses the same
// 64-unit shapes as scripts/make-icons.cjs and src/renderer/src/logo.ts.
const draw = `(${function (assets) {
  return assets.map(([, w, h, rounded]) => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d')
    g.fillStyle = '#0b0b0f'
    g.beginPath()
    g.roundRect(0, 0, w, h, rounded ? Math.min(w, h) * 0.22 : 0)
    g.fill()
    // The mark is a square in the middle; on tiles it leaves room around it.
    const side = Math.min(w, h) * (rounded ? 1 : 0.66)
    g.translate((w - side) / 2, (h - side) / 2)
    g.scale(side / 64, side / 64)
    g.fillStyle = '#c2410c'
    g.fill(new Path2D('M38 24H48L26 40H16Z'))
    g.fillStyle = '#fb923c'
    g.beginPath()
    g.roundRect(16, 16, 32, 8, 2)
    g.roundRect(16, 40, 32, 8, 2)
    g.fill()
    return c.toDataURL('image/png').split(',')[1]
  })
}})(${JSON.stringify(ASSETS)})`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  await win.loadURL('data:text/html,<!doctype html><title>store assets</title>')
  const pngs = await win.webContents.executeJavaScript(draw)
  mkdirSync(OUT, { recursive: true })
  ASSETS.forEach(([file], i) => writeFileSync(join(OUT, file), Buffer.from(pngs[i], 'base64')))
  console.log(`Wrote ${ASSETS.map(([f]) => f).join(', ')} to build/appx`)
  app.quit()
})
