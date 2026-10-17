// Parses notes off the main thread. Request: {id, files: [[path, text], ...]}.
// Reply: {id, results: [[path, NoteMeta, searchText], ...]}.
import { isCanvasPath, parseCanvasMeta } from './canvasMeta'
import { parseNote, type NoteMeta } from './parser'

interface Request {
  id: number
  files: Array<[string, string]>
}

self.onmessage = (e: MessageEvent<Request>) => {
  const { id, files } = e.data
  const results: Array<[string, NoteMeta, string]> = files.map(([path, text]) => {
    if (isCanvasPath(path)) {
      const { meta, searchText } = parseCanvasMeta(text)
      return [path, meta, searchText]
    }
    return [path, parseNote(text), text]
  })
  ;(self as unknown as Worker).postMessage({ id, results })
}
