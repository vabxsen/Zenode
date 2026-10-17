# Zenode

A fast, local-first Markdown knowledge base for Windows. Your notes are plain `.md` files in a folder you choose (a "vault"), so they stay readable by any editor, including Obsidian.

## Phase 2 (current)

- `[[Wikilinks]]`, `[[Note#Heading|alias]]` and `![[embeds]]`, rendered in Live Preview; links to missing notes are dimmed, and clicking one creates it
- `[[` autocomplete with fuzzy matching; inserts the shortest unique link text
- Link index in a Web Worker: resolves links like Obsidian (unique name, relative path, path suffix preferring the same folder), plus Markdown links, headings, `#tags` and front-matter tags/aliases
- Backlinks panel (right sidebar) with the linking text; click to jump to the link
- Renaming a note or folder rewrites every link that pointed to it
- Quick switcher (Ctrl+O): fuzzy search by name, path or alias; Shift+Enter creates a note
- Search (Ctrl+Shift+F): words, `"phrases"`, `-exclude`, `/regex/`, `path:`, `file:`, `tag:`; clicking a `#tag` searches for it
- Front matter renders as a compact properties block

## Phase 1

- Open any folder as a vault; the last vault and its open tabs are restored on launch
- File tree: create, rename (inline) and delete notes and folders (deletes go to the Recycle Bin)
- Editor: CodeMirror 6 with **Live Preview**. Markdown syntax hides until the cursor touches it:
  headings, bold, italic, strikethrough, inline code, links, bare URLs, lists, task checkboxes,
  blockquotes, horizontal rules and fenced code blocks
- Tabs with per-tab undo history, autosave, and live reload when a file changes on disk
- Word and character count

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+N | New note |
| Ctrl+S | Save now (autosave also runs after you pause typing) |
| Ctrl+W | Close tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+O | Quick switcher |
| Ctrl+Shift+F | Search |
| Ctrl+Shift+B | Toggle backlinks panel |
| Ctrl+Shift+O | Open another vault |
| Ctrl+\\ | Toggle left sidebar |

## Development

```bash
npm install
npm run dev        # run with hot reload
npm run typecheck  # TypeScript checks for main, preload and renderer
npm test           # unit tests: parser, link resolution, rename edits, search, fuzzy
npm run build      # production bundles in out/
npm run dist       # Windows installer in dist/
```

## Architecture

```
src/
  main/       Electron main process: window, vault file access, file watcher, settings
  preload/    The only bridge to the page (contextBridge); exposes window.zenode
  shared/     Types shared by main and renderer (the IPC contract)
  renderer/   The UI: app shell, file tree, tabs, CodeMirror editor + Live Preview
```

Security: the page runs with `contextIsolation`, `sandbox` and no Node integration. Every file path from the page is resolved inside the open vault and rejected if it escapes it.

## Roadmap

2. ~~`[[wikilinks]]`, backlinks, quick switcher, full-text search~~ (done)
3. Graph view (d3-force physics in a worker, WebGL rendering)
4. Canvas, database views (Bases-style), plugin API
