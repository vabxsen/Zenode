# Zenode

A fast, local-first Markdown knowledge base for Windows. Your notes are plain `.md` files in a folder you choose (a "vault"), so they stay readable by any editor, including Obsidian.

## Phase 4 (current)

- Canvas: `.canvas` files in the open [JSON Canvas 1.0](https://jsoncanvas.org) format, compatible with Obsidian
- Cards: text (a full Live Preview editor), notes and images from the vault, web links, and labelled groups with optional backgrounds
- Connect cards from their side handles (drop on empty space to create a connected card); edges with arrows, labels and colours
- Move (groups carry their cards), resize, marquee and Shift selection, colours, grouping, delete, undo/redo (100 steps)
- Pan with space-drag, middle-drag or scroll; zoom around the cursor with Ctrl+scroll; zoom to fit
- Saves in Obsidian's layout (one line per card, so diffs stay small). Opening a canvas never rewrites it, unknown card types and fields are kept, and a damaged file is shown read-only and reloads once repaired
- Canvases are part of the link index: backlinks, graph, search and tags include them, and renaming a file updates the canvases that use it

## Phase 3

- Graph view (Ctrl+G): every note as a node, links as edges; tags, attachments and missing notes as optional node kinds; orphans toggle; filter with the search syntax
- Force-directed layout (d3-force) in a Web Worker, so the UI never blocks; positions stay stable as notes change
- WebGL2 rendering (instanced, antialiased nodes and edges) with labels that fade in as you zoom; tested at 1,500 notes
- Hover highlights a note and its neighbours; drag nodes, pan, zoom around the cursor, click to open, double-click to fit
- Local graph in the right sidebar, following the open note (depth 1–4)
- Settings panel: filters, node size, center/repel/link forces and link distance

## Phase 2

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
| Ctrl+G | Graph view |
| Ctrl+Shift+B | Toggle right sidebar (backlinks, local graph) |
| Ctrl+Shift+O | Open another vault |
| Ctrl+\\ | Toggle left sidebar |

On a canvas: double-click empty space to add a card, double-click a card to edit it (Esc to stop), Enter to edit the selected card, Delete to remove, Ctrl+Z / Ctrl+Shift+Z to undo and redo, Ctrl+A to select all.

Shortcuts can be changed per vault in `.zenode/hotkeys.json`, keyed by command id (a settings screen for this is planned):

```json
{ "app:toggle-left-sidebar": [{ "modifiers": ["Mod", "Shift"], "key": "l" }] }
```

## Your data

- Notes and canvases are plain files in your vault folder; Zenode writes them atomically (temp file, then rename).
- Per-vault settings live in `<vault>/.zenode/` (open tabs in `workspace.json`, custom shortcuts in `hotkeys.json`), like Obsidian's `.obsidian/` folder.
- App settings and logs live in `%APPDATA%\Zenode\` (`logs\zenode.log` is useful for bug reports).

## Development

```bash
npm install
npm run dev        # run with hot reload
npm run typecheck  # TypeScript checks for main, preload and renderer
npm test           # unit tests: parser, link resolution, rename edits, search, fuzzy, graph, canvas, commands, config
npm run test:e2e   # builds, then drives the real app with Playwright against tests/fixtures/vault
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
tests/
  index.test.ts   Unit tests (bundled with esbuild, run in Node)
  e2e/            Playwright tests that launch the built app
  fixtures/vault  The sample vault the end-to-end tests run against (copied per test)
```

Every action is a command in a registry (`src/renderer/src/commands.ts`), shaped like Obsidian's `addCommand`, so the command palette, hotkey editor and plugin API can share it. CI runs typecheck, unit and end-to-end tests and builds the installer on every push.

Security: the page runs with `contextIsolation`, `sandbox` and no Node integration. Every file path from the page is resolved inside the open vault and rejected if it escapes it.

## Roadmap

2. ~~`[[wikilinks]]`, backlinks, quick switcher, full-text search~~ (done)
3. ~~Graph view (d3-force physics in a worker, WebGL rendering)~~ (done)
4. ~~Canvas (JSON Canvas files with cards, links and groups)~~ (done)

Towards 1.0 (production-ready core):

- ~~M0 Foundations: Electron 44, command registry, per-vault config, E2E tests, CI, error log~~ (done)
- M1 Data safety: conflict handling for outside edits, crash recovery, file snapshots, sync-folder conflict copies
- M2 Editor: embeds, paste/drop attachments, tables, callouts, find & replace, math, Mermaid, Reading view
- M3 Workspace: command palette, split panes, drag & drop, outline/tags/bookmarks, daily notes, templates, properties
- M4 Files: PDF/audio/video viewers, export to PDF
- M5 Performance: persistent index cache, 10k+ note vaults
- M6 Appearance: light theme, themes and snippets, hotkey editor, onboarding, accessibility
- M7 Security hardening, M8 installer/updates/file associations, M9 docs and website

After 1.0: Git and sync helpers (1.1), Bases database views (1.2), an Obsidian-compatible plugin API (1.3).
