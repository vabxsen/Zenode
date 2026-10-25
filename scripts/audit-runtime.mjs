// Fails when the Electron runtime itself has a high or critical advisory.
// Electron is a devDependency (electron-builder bundles it), so
// `npm audit --omit=dev` never looks at it, yet it ships with every build.
import { execSync } from 'node:child_process'

const SHIPPED_DEV_PACKAGES = ['electron']
const BLOCKING = new Set(['high', 'critical'])

let report
try {
  report = execSync('npm audit --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
} catch (e) {
  // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
  report = e.stdout
}
const { vulnerabilities = {} } = JSON.parse(report)
const found = SHIPPED_DEV_PACKAGES.map((name) => vulnerabilities[name]).filter((v) => v && BLOCKING.has(v.severity))
for (const v of found) {
  const titles = v.via.filter((x) => typeof x === 'object').map((x) => `  ${x.title} (${x.url})`)
  console.error(`${v.name} ${v.range}: ${v.severity}\n${titles.join('\n')}`)
}
if (found.length) process.exit(1)
console.log(`No high or critical advisories for ${SHIPPED_DEV_PACKAGES.join(', ')}.`)
