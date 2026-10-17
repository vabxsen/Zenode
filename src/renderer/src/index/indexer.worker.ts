// Parses notes off the main thread. Request: {id, files: [[path, text], ...]}.
// Reply: {id, results: [[path, NoteMeta], ...]}.
import { parseNote, type NoteMeta } from './parser'

interface Request {
  id: number
  files: Array<[string, string]>
}

self.onmessage = (e: MessageEvent<Request>) => {
  const { id, files } = e.data
  const results: Array<[string, NoteMeta]> = files.map(([path, text]) => [path, parseNote(text)])
  ;(self as unknown as Worker).postMessage({ id, results })
}
