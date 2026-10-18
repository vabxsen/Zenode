import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

// A small rotating log in %APPDATA%\Zenode\logs\zenode.log (one previous file
// kept as zenode.old.log). Errors from both processes end up here, so users can
// attach it to bug reports.
export type LogLevel = 'info' | 'warn' | 'error'

const LEVELS = new Set<LogLevel>(['info', 'warn', 'error'])
const MAX_BYTES = 1_000_000
const MAX_MESSAGE = 8_000

let chain: Promise<void> = Promise.resolve()

function logFile(): string {
  return join(app.getPath('logs'), 'zenode.log')
}

export function isLogLevel(v: unknown): v is LogLevel {
  return LEVELS.has(v as LogLevel)
}

// Appends one line; writes are queued so lines never interleave. Never throws.
export function log(level: LogLevel, message: string): Promise<void> {
  const line = `${new Date().toISOString()} [${level}] ${message.slice(0, MAX_MESSAGE).replace(/\r?\n/g, '\n    ')}\n`
  chain = chain.then(() => append(line)).catch(() => undefined)
  return chain
}

async function append(line: string): Promise<void> {
  const file = logFile()
  await fs.mkdir(join(file, '..'), { recursive: true })
  try {
    if ((await fs.stat(file)).size > MAX_BYTES) await fs.rename(file, join(file, '..', 'zenode.old.log'))
  } catch {
    // No log yet.
  }
  await fs.appendFile(file, line, 'utf8')
}

export function describeError(e: unknown): string {
  return e instanceof Error ? (e.stack ?? `${e.name}: ${e.message}`) : String(e)
}
