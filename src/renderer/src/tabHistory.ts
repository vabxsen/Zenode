// Back/forward history of the paths a pane showed (Alt+Left / Alt+Right).
const MAX_HISTORY = 50

export class TabHistory {
  private items: string[] = []
  private at = -1

  // A newly shown path; anything "forward" of the current point is dropped.
  push(path: string): void {
    if (this.items[this.at] === path) return
    this.items = [...this.items.slice(0, this.at + 1), path].slice(-MAX_HISTORY)
    this.at = this.items.length - 1
  }

  canStep(dir: 1 | -1): boolean {
    return this.items[this.at + dir] !== undefined
  }

  // Moves back (-1) or forward (+1) and returns that path, or undefined at either end.
  step(dir: 1 | -1): string | undefined {
    const path = this.items[this.at + dir]
    if (path !== undefined) this.at += dir
    return path
  }
}
