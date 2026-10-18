import { promises as fs } from 'node:fs'

// Errors that usually mean another program (a sync client, antivirus, the
// indexer) has the file open for a moment. Worth a short retry on Windows.
const TRANSIENT = new Set(['EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENFILE'])
const RETRY_DELAYS = [40, 100, 250, 600]

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export function errorCode(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | null)?.code
}

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (attempt >= RETRY_DELAYS.length || !TRANSIENT.has(errorCode(e) ?? '')) throw e
      await sleep(RETRY_DELAYS[attempt])
    }
  }
}

// Write to a temp file next to the target, then rename over it, so a crash or
// power cut never leaves a half-written file behind.
export async function atomicWrite(file: string, content: string): Promise<void> {
  const temp = `${file}.zenode-tmp`
  try {
    await withRetry(() => fs.writeFile(temp, content, 'utf8'))
    await withRetry(() => fs.rename(temp, file))
  } catch (e) {
    await fs.rm(temp, { force: true }).catch(() => undefined)
    throw e
  }
}

// Reads a text file, or null if it doesn't exist.
export async function readIfExists(file: string): Promise<string | null> {
  try {
    return await withRetry(() => fs.readFile(file, 'utf8'))
  } catch (e) {
    if (errorCode(e) === 'ENOENT') return null
    throw e
  }
}

const FRIENDLY: Record<string, string> = {
  EACCES: 'Permission denied. The file may be read-only, or another program (a sync app or antivirus) is using it.',
  EPERM: 'Windows refused the change. The file may be read-only, or another program (a sync app or antivirus) is using it.',
  EBUSY: 'The file is in use by another program. Try again in a moment.',
  ENOSPC: 'The disk is full.',
  EROFS: 'The drive is read-only.',
  ENOENT: 'The file or folder no longer exists.',
  EEXIST: 'Something with that name already exists.',
  ENAMETOOLONG: 'The name or path is too long.',
  EMFILE: 'Too many files are open. Try again in a moment.'
}

// A message the user can act on, for errors that cross into the page.
export function friendlyError(e: unknown): Error {
  const code = errorCode(e)
  if (code && FRIENDLY[code]) {
    const path = (e as NodeJS.ErrnoException).path
    return new Error(path ? `${FRIENDLY[code]} (${path})` : FRIENDLY[code])
  }
  return e instanceof Error ? e : new Error(String(e))
}
