// Commands for interface zoom and the colour theme.
import type { CommandRegistry } from '../commands'
import { appearance, resolvedTheme, updateAppearance, ZOOM } from './appearance'

export function registerAppearanceCommands(registry: CommandRegistry, hasVault: () => boolean, notice: (m: string) => void): () => void {
  const save = (change: Parameters<typeof updateAppearance>[0]): void => {
    updateAppearance(change).catch((e: Error) => notice(`Could not save appearance: ${e.message}`))
  }
  const zoomTo = (z: number): void => {
    const zoom = Math.round(Math.min(ZOOM.max, Math.max(ZOOM.min, z)) * 10) / 10
    save({ zoom })
    notice(`Zoom ${Math.round(zoom * 100)}%`)
  }
  const inVault = (run: () => void) => (checking: boolean): boolean => {
    if (!hasVault()) return false
    if (!checking) run()
    return true
  }
  const disposers = [
    registry.register({
      id: 'window:zoom-in',
      name: 'Zoom in',
      hotkeys: [{ modifiers: ['Mod'], key: '=' }],
      checkCallback: inVault(() => zoomTo(appearance().zoom + ZOOM.step))
    }),
    registry.register({
      id: 'window:zoom-out',
      name: 'Zoom out',
      hotkeys: [{ modifiers: ['Mod'], key: '-' }],
      checkCallback: inVault(() => zoomTo(appearance().zoom - ZOOM.step))
    }),
    registry.register({
      id: 'window:reset-zoom',
      name: 'Reset zoom',
      hotkeys: [{ modifiers: ['Mod'], key: '0' }],
      checkCallback: inVault(() => zoomTo(1))
    }),
    registry.register({
      id: 'theme:toggle-light-dark',
      name: 'Switch between light and dark theme',
      checkCallback: inVault(() => save({ theme: resolvedTheme() === 'dark' ? 'light' : 'dark' }))
    })
  ]
  return () => disposers.forEach((d) => d())
}
