// Editing Markdown tables: Tab / Shift+Tab move between cells, and the table is
// re-aligned (padded columns) as you go. Enter at the end of the last row adds a row.
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type Extension } from '@codemirror/state'
import { keymap, type EditorView } from '@codemirror/view'

// Split a table row into cell texts ("| a | b |" -> ["a", "b"]); escaped \| stays in the cell.
export function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '\\|'
      i++
    } else if (s[i] === '|') {
      cells.push(cur.trim())
      cur = ''
    } else cur += s[i]
  }
  cells.push(cur.trim())
  return cells
}

const DELIMITER = /^:?-+:?$/

// Pads every column to the same width; keeps alignment colons in the delimiter row.
export function formatTable(text: string): string {
  const rows = text.split('\n').map(splitRow)
  const cols = Math.max(...rows.map((r) => r.length))
  const width = Array.from({ length: cols }, (_, c) =>
    Math.max(3, ...rows.map((r, i) => (i === 1 ? 3 : [...(r[c] ?? '')].length)))
  )
  return rows
    .map((r, i) => {
      const cells = Array.from({ length: cols }, (_, c) => {
        const cell = r[c] ?? ''
        if (i === 1) {
          const d = DELIMITER.test(cell) ? cell : '---'
          const left = d.startsWith(':')
          const right = d.endsWith(':')
          return (left ? ':' : '') + '-'.repeat(width[c] - (left ? 1 : 0) - (right ? 1 : 0)) + (right ? ':' : '')
        }
        return cell + ' '.repeat(width[c] - [...cell].length)
      })
      return `| ${cells.join(' | ')} |`
    })
    .join('\n')
}

// The [from, to) of the table around pos, if any.
function tableAt(state: EditorState, pos: number): { from: number; to: number } | null {
  let node = syntaxTree(state).resolveInner(pos, -1)
  while (node && node.name !== 'Table') node = node.parent!
  if (!node) return null
  return { from: state.doc.lineAt(node.from).from, to: state.doc.lineAt(node.to).to }
}

// Start offsets (within a formatted row) of each cell's text.
function cellStarts(row: string): number[] {
  const starts: number[] = []
  for (let i = 0; i < row.length; i++) if (row[i] === '|' && row[i - 1] !== '\\' && i < row.length - 1) starts.push(i + 2)
  return starts
}

function moveCell(view: EditorView, dir: 1 | -1): boolean {
  const { state } = view
  const head = state.selection.main.head
  const table = tableAt(state, head)
  if (!table) return false
  const original = state.doc.sliceString(table.from, table.to)
  const formatted = formatTable(original)
  // Where the cursor is: row and cell index in the original text.
  const lineNo = state.doc.lineAt(head).number - state.doc.lineAt(table.from).number
  const lineText = state.doc.lineAt(head).text
  const col = Math.max(0, lineText.slice(0, head - state.doc.lineAt(head).from).split('|').length - 2)
  const rows = formatted.split('\n')
  const cols = cellStarts(rows[0]).length
  let row = lineNo
  let cell = col + dir
  if (cell >= cols) {
    cell = 0
    row++
  } else if (cell < 0) {
    cell = cols - 1
    row--
  }
  if (row === 1) row += dir // skip the delimiter row
  if (row < 0) return true
  let text = formatted
  if (row >= rows.length) {
    // Tab past the last cell adds a row.
    const empty = formatTable(`${rows[0]}\n${rows[1]}\n|${' |'.repeat(cols)}`).split('\n')[2]
    text = `${formatted}\n${empty}`
    rows.push(empty)
  }
  const rowStart = rows.slice(0, row).reduce((n, r) => n + r.length + 1, 0)
  const start = cellStarts(rows[row])[cell]
  const end = rows[row].indexOf(' |', start)
  const from = table.from + rowStart + start
  const to = table.from + rowStart + (end === -1 ? start : end)
  view.dispatch({
    changes: text === original ? undefined : { from: table.from, to: table.to, insert: text },
    selection: EditorSelection.range(from, to),
    scrollIntoView: true
  })
  return true
}

export function tableEditing(): Extension {
  return keymap.of([
    { key: 'Tab', run: (v) => moveCell(v, 1) },
    { key: 'Shift-Tab', run: (v) => moveCell(v, -1) }
  ])
}
