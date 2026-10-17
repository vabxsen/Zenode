// Lifecycle base class: anything registered here is torn down on unload.
// Unload order: children (last added first), then cleanups (last registered first), then onunload().
export class Component {
  private loaded = false
  private children: Component[] = []
  private cleanups: Array<() => void> = []

  load(): void {
    if (this.loaded) return
    this.loaded = true
    this.onload()
    for (const child of this.children.slice()) child.load()
  }

  unload(): void {
    if (!this.loaded) return
    this.loaded = false
    while (this.children.length) this.children.pop()!.unload()
    while (this.cleanups.length) this.cleanups.pop()!()
    this.onunload()
  }

  onload(): void {}
  onunload(): void {}

  addChild<T extends Component>(child: T): T {
    this.children.push(child)
    if (this.loaded) child.load()
    return child
  }

  removeChild(child: Component): void {
    const i = this.children.indexOf(child)
    if (i !== -1) {
      this.children.splice(i, 1)
      child.unload()
    }
  }

  register(cleanup: () => void): void {
    this.cleanups.push(cleanup)
  }

  registerDomEvent<K extends keyof WindowEventMap>(
    el: Window,
    type: K,
    cb: (ev: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions
  ): void
  registerDomEvent<K extends keyof HTMLElementEventMap>(
    el: HTMLElement,
    type: K,
    cb: (ev: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions
  ): void
  registerDomEvent(el: EventTarget, type: string, cb: (ev: Event) => void, options?: AddEventListenerOptions): void {
    el.addEventListener(type, cb, options)
    this.register(() => el.removeEventListener(type, cb, options))
  }
}

declare global {
  interface HTMLElement {
    empty(): void
  }
}

HTMLElement.prototype.empty = function (this: HTMLElement): void {
  while (this.firstChild) this.removeChild(this.firstChild)
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  parent?: HTMLElement,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  parent?.appendChild(node)
  return node
}
