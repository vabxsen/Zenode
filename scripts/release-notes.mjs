// Release helper for the release workflow.
//   node scripts/release-notes.mjs v0.6.0          prints that version's CHANGELOG section
//   node scripts/release-notes.mjs --check v0.6.0  fails unless the tag, package.json
//                                                  and CHANGELOG.md all agree on the version
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

function fail(message) {
  console.error(message)
  process.exit(1)
}

// The body of "## [version] - date", up to the next "## " heading or the link list.
export function section(changelog, version) {
  const lines = changelog.split(/\r?\n/)
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`))
  if (start < 0) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => l.startsWith('## ') || /^\[[^\]]+\]: /.test(l))
  return rest.slice(0, end < 0 ? rest.length : end).join('\n').trim()
}

const args = process.argv.slice(2)
const check = args[0] === '--check'
const tag = check ? args[1] : args[0]
if (!tag) fail('Usage: release-notes.mjs [--check] <tag, e.g. v0.6.0>')
const version = tag.replace(/^v/, '')
if (!SEMVER.test(version)) fail(`"${tag}" is not a version tag like v1.2.3 or v1.2.3-beta.1.`)

const notes = section(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'), version)
if (check) {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
  if (pkg !== version) fail(`The tag says ${version} but package.json says ${pkg}. Bump package.json before tagging.`)
  if (!notes) fail(`CHANGELOG.md has no "## [${version}]" section, or it is empty.`)
  console.log(`Version ${version}: tag, package.json and CHANGELOG.md agree.`)
} else {
  if (!notes) fail(`CHANGELOG.md has no "## [${version}]" section.`)
  console.log(notes)
}
