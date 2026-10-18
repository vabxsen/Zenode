import { promises as fs } from 'node:fs'

// Write to a temp file next to the target, then rename over it, so a crash or
// power cut never leaves a half-written file behind.
export async function atomicWrite(file: string, content: string): Promise<void> {
  const temp = `${file}.zenode-tmp`
  try {
    await fs.writeFile(temp, content, 'utf8')
    await fs.rename(temp, file)
  } catch (e) {
    await fs.rm(temp, { force: true }).catch(() => undefined)
    throw e
  }
}
