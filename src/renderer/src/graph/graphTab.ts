// The graph view as a workspace tab. The graph itself is created the first time
// the tab is shown, and torn down when the tab closes.
import type { Component } from '../component'
import type { MetadataCache } from '../index/metadataCache'
import { VIEW_PREFIX, type WorkspaceView } from '../paneTypes'
import { GraphView } from './graphView'

export const GRAPH_ID = `${VIEW_PREFIX}graph`

export interface GraphTabDeps {
  // Owns the graph component's lifetime.
  shell: Component
  cache: MetadataCache
  // The note to highlight.
  getActive(): string | null
  onOpen(path: string): void
  // The live graph (null once its tab closes), e.g. to keep it in step with the active note.
  onGraphChange(graph: GraphView | null): void
}

export function makeGraphTab(d: GraphTabDeps): WorkspaceView {
  const host = document.createElement('div')
  host.className = 'zn-view-host'
  let graph: GraphView | null = null
  const ensure = (): GraphView => {
    if (!graph) {
      graph = d.shell.addChild(new GraphView(host, { cache: d.cache, mode: 'global', getActive: d.getActive, onOpen: d.onOpen }))
      d.onGraphChange(graph)
    }
    return graph
  }
  return {
    id: GRAPH_ID,
    title: 'Graph view',
    el: host,
    show: () => {
      host.style.display = ''
      ensure().setVisible(true)
    },
    // Hidden, not just paused, so its floating controls don't show over other tabs.
    hide: () => {
      host.style.display = 'none'
      graph?.setVisible(false)
    },
    destroy: () => {
      if (graph) {
        d.shell.removeChild(graph)
        d.onGraphChange(null)
      }
      graph = null
      host.remove()
    }
  }
}
