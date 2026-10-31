// Builds the Microsoft Store package (dist/Zenode-<version>-store.appx) from the
// already-built app in out/. The Store signs the package itself; it only needs
// the identity Partner Center gave Zenode, kept in build/store-identity.json:
//   { "identityName": "...", "publisher": "CN=...", "publisherDisplayName": "..." }
// (Partner Center > the app > Product management > Product identity.)
// `--test` builds with a made-up identity, to check the package locally.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const file = join(root, 'build', 'store-identity.json')
const test = process.argv.includes('--test')

let identity
if (test) {
  identity = { identityName: 'Zenode.Test', publisher: 'CN=00000000-0000-0000-0000-000000000000', publisherDisplayName: 'Zenode (test build)' }
} else {
  if (!existsSync(file)) {
    console.error('build/store-identity.json is missing. Copy the three values from Partner Center > Product identity into it (see docs/microsoft-store.md).')
    process.exit(1)
  }
  identity = JSON.parse(readFileSync(file, 'utf8'))
  for (const key of ['identityName', 'publisher', 'publisherDisplayName']) {
    if (typeof identity[key] !== 'string' || !identity[key].trim()) {
      console.error(`build/store-identity.json has no "${key}".`)
      process.exit(1)
    }
  }
  if (!identity.publisher.startsWith('CN=')) {
    console.error('"publisher" must start with CN= (copy it exactly from Partner Center).')
    process.exit(1)
  }
}

const builder = join(root, 'node_modules', 'electron-builder', 'cli.js')
execFileSync(
  process.execPath,
  [
    builder,
    '--win',
    'appx',
    '--x64',
    '--publish',
    'never',
    `-c.appx.identityName=${identity.identityName}`,
    `-c.appx.publisher=${identity.publisher}`,
    `-c.appx.publisherDisplayName=${identity.publisherDisplayName}`
  ],
  { cwd: root, stdio: 'inherit' }
)
