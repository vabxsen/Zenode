// Pasting or dropping files into a note: the files are handed to `onFiles`
// with the position where links should go.
import { EditorView } from '@codemirror/view'

export function fileDropAndPaste(onFiles: (files: File[], pos: number) => void) {
  return EditorView.domEventHandlers({
    paste(e, view) {
      const files = [...(e.clipboardData?.files ?? [])]
      if (!files.length) return false
      e.preventDefault()
      onFiles(files, view.state.selection.main.head)
      return true
    },
    drop(e, view) {
      const files = [...(e.dataTransfer?.files ?? [])]
      if (!files.length) return false
      e.preventDefault()
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head
      onFiles(files, pos)
      return true
    }
  })
}

// Clipboard images arrive as "image.png"; give them a findable, unique-ish name.
export function attachmentName(file: File, now = new Date()): string {
  const generic = !file.name || /^image\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)
  if (!generic) return file.name
  const ext = (/^image\/(\w+)/.exec(file.type)?.[1] ?? file.name.split('.').pop() ?? 'png').replace('jpeg', 'jpg')
  const p = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  return `Pasted image ${stamp}.${ext}`
}
