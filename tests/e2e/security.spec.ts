// Security: vault:// stays inside the vault, only web links leave the app,
// programs aren't opened without a yes, and pages get no extra permissions.
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import type { Page } from '@playwright/test'
import { expect, test, treeRow } from './fixture'

// A real (tiny) PNG: 2×2 red pixels.
function png(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer): number => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const ihdr = Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0])
  const rows = Buffer.from([0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0])
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

const vaultId = (page: Page) => page.evaluate(async () => (await window.zenode.currentVault())!.id)
const status = (page: Page, url: string) => page.evaluate(async (u) => (await fetch(u).catch(() => null))?.status ?? 0, url)

test('vault:// serves only files inside the vault', async ({ page, vaultDir, workDir }) => {
  const outside = join(workDir, 'outside')
  mkdirSync(outside)
  writeFileSync(join(outside, 'secret.txt'), 'secret')
  symlinkSync(outside, join(vaultDir, 'link'), 'junction')
  const id = await vaultId(page)
  expect(await status(page, `vault://${id}/Home.md`)).toBe(200)
  expect(await status(page, `vault://${id}/..%2F..%2Foutside%2Fsecret.txt`)).toBe(404)
  expect(await status(page, `vault://${id}/%2E%2E/%2E%2E/outside/secret.txt`)).toBe(404)
  expect(await status(page, `vault://${id}/link/secret.txt`)).toBe(404)
  expect(await status(page, `vault://${id}/Home.md:stream`)).toBe(404)
  expect(await status(page, `vault://notavault/Home.md`)).toBe(404)
  // Through IPC too.
  const err = await page.evaluate(() => window.zenode.read('link/secret.txt').then(() => 'read', (e: Error) => e.message))
  expect(err).toContain('outside the vault')
  // Files can't run scripts even if shown as a page.
  const headers = await page.evaluate(async (u) => {
    const r = await fetch(u)
    return [r.headers.get('content-security-policy'), r.headers.get('x-content-type-options')]
  }, `vault://${id}/Home.md`)
  expect(headers[0]).toContain('sandbox')
  expect(headers[1]).toBe('nosniff')
})

test('only web and email links are opened', async ({ page, vaultDir }) => {
  const refused = await page.evaluate(async () =>
    Promise.all(['file:///C:/Windows/notepad.exe', 'ms-settings:privacy', 'javascript:alert(1)'].map((u) => window.zenode.openUrl(u).then(() => 'opened', () => 'refused')))
  )
  expect(refused).toEqual(['refused', 'refused', 'refused'])
  writeFileSync(join(vaultDir, 'Links.md'), 'Open [settings](ms-settings:privacy) here.\n')
  await expect(treeRow(page, 'Links')).toBeVisible()
  await treeRow(page, 'Links').click()
  await page.keyboard.press('Control+e')
  await page.locator('.zn-reading a', { hasText: 'settings' }).click()
  await expect(page.locator('.zn-notice').last()).toContainText('only opens web and email links')
})

test('a file that runs as a program is not opened without a yes', async ({ page, vaultDir }) => {
  writeFileSync(join(vaultDir, 'run.bat'), '@echo off\r\necho hi\r\n')
  await expect(treeRow(page, 'run.bat')).toBeVisible()
  await treeRow(page, 'run.bat').click()
  await page.locator('.zn-file-view.is-text .zn-file-action', { hasText: 'Open in default app' }).click()
  // The test build answers "Cancel" (ZENODE_TEST_CONFIRM=no).
  await expect(page.locator('.zn-notice').last()).toHaveText('Not opened.')
})

test('pages get no camera, microphone or notification permissions', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const state = (name: string) => navigator.permissions.query({ name: name as PermissionName }).then((s) => s.state)
    return {
      // Refused (NotAllowedError), or NotFoundError on a machine with no microphone.
      mic: await navigator.mediaDevices.getUserMedia({ audio: true }).then(() => 'granted', (e: Error) => e.name),
      states: [await state('microphone'), await state('camera'), await state('geolocation')],
      notify: await Notification.requestPermission()
    }
  })
  expect(['NotAllowedError', 'NotFoundError']).toContain(result.mic)
  expect(result.states).toEqual(['denied', 'denied', 'denied'])
  expect(result.notify).toBe('denied')
})

test('PDF export includes images from the vault', async ({ page, vaultDir, workDir }) => {
  writeFileSync(join(vaultDir, 'dot.png'), png())
  writeFileSync(join(vaultDir, 'Picture.md'), '# Picture\n\n![[dot.png]]\n')
  mkdirSync(join(workDir, 'exports'), { recursive: true })
  await expect(treeRow(page, 'Picture')).toBeVisible()
  await treeRow(page, 'Picture').click()
  await page.keyboard.press('Control+p')
  await page.locator('.zn-switcher-input').fill('Export to PDF')
  await page.keyboard.press('Enter')
  await page.locator('.zn-export-dialog button', { hasText: 'Export…' }).click()
  await expect(page.locator('.zn-notice').last()).toContainText('Exported to')
  expect(readFileSync(join(workDir, 'exports', 'Picture.pdf')).toString('latin1')).toMatch(/\/Subtype\s*\/Image/)
})
