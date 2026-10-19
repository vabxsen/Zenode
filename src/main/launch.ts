// Opens what Zenode was launched with (a file, a folder or a zenode:// link),
// at start-up and when Zenode is launched again while running.
import { describeError, log } from './log'
import { parseLaunchArgs, resolveTarget } from './launchArgs'
import { loadSettings } from './settings'
import { VaultWindow, windowWithVault } from './windows'

// `args` are a command line without the executable. Returns whether it named
// something Zenode could open (otherwise the caller opens Zenode as usual).
export async function openLaunchTarget(args: string[], cwd: string): Promise<boolean> {
  const target = parseLaunchArgs(args, cwd)
  if (!target) return false
  try {
    const found = await resolveTarget(target, (await loadSettings()).recentVaults)
    if (!found) {
      void log('warn', `launch: nothing to open for ${target.kind}`)
      return false
    }
    const open = windowWithVault(found.root)
    if (open) {
      open.focus()
      if (found.file) open.requestOpen(found.file)
    } else {
      const w = await VaultWindow.create(found.root)
      if (found.file) w.requestOpen(found.file)
    }
    return true
  } catch (e) {
    void log('warn', `launch: ${describeError(e)}`)
    return false
  }
}
