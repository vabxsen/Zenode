# Zenode

A fast, local-first Markdown knowledge base for Windows. Your notes are plain `.md` files in a folder you choose (a "vault"), so they stay readable by any editor, including Obsidian.

## Install & updates (M8)

- **Downloads** (from [Releases](https://github.com/vabxsen/Zenode/releases)):
  - `Zenode-Setup-<version>.exe`: an installer for your user account only, with no admin rights needed.
  - `Zenode-<version>-portable.exe`: runs without installing.
  - `Zenode-<version>-win-x64.zip`: the same files, unzipped anywhere.

  Builds aren't code-signed yet, so SmartScreen may warn the first time.
- **Opening from Windows** (installed copy):
  - `.md` and `.canvas` files open in Zenode, in the vault that holds them or else in their own folder.
  - Right-click a folder in Explorer for **Open folder as Zenode vault**.
  - `zenode://open?vault=<name or folder>&file=<path in the vault>` links open a note in a vault Zenode already knows. Links can't open other folders or programs.
- **Updates**:
  - The installed app checks GitHub Releases at start-up and every few hours. It downloads a new version in the background and installs it on the next restart.
  - Settings → General → Updates has **Check now**, automatic checks on or off, and a **Stable** or **Beta** channel. Beta also gets pre-releases.
  - Portable and zip copies say when a new version is out and link to it.
  - The update check is the only network request Zenode makes.
- **Version and changes**: Settings → General shows the version; [CHANGELOG.md](CHANGELOG.md) lists what changed. Zenode uses semantic versioning from 0.5.0.

## Appearance, onboarding & accessibility (M6)

- **Light and dark themes**, or **System** to follow Windows (switching live). Every colour is a theme token, so the accent colour, CSS themes and snippets can restyle everything.
- **Settings** (Ctrl+, or the gear in the ribbon):
  - **General**: vault, About, copy diagnostics, updates.
  - **Editor**: default view, spellcheck, readable line length.
  - **Files & links**: attachment folder, where deleted files go, unused attachments.
  - **Appearance**: theme, accent, fonts, text size, zoom, CSS themes and snippets.
  - **Hotkeys**, **Daily notes**, **Templates**.
- **Hotkey editor**: press **+** next to any command and press the keys. Clashes are shown, a hotkey can be removed, and ↺ restores the default.
- **CSS themes and snippets**: `.zenode/themes/<Name>/theme.css` and `.zenode/snippets/*.css`. Themes written for Obsidian's public variables mostly work (`body.theme-dark`/`theme-light` and the common `--background-*`/`--text-*` variables are mapped).
- **Interface zoom**: Ctrl+= / Ctrl+- / Ctrl+0.
- **Welcome and vaults**: create a new vault, open a folder, or open the bundled **Zenode Help** vault, a guided tour with examples. Ctrl+Shift+O opens the same choices plus recent vaults, each removable.
- **Accessibility**:
  - Checked with axe-core in both themes (WCAG 2.1 AA, no serious issues).
  - Full keyboard use of the file tree, tabs, palette, switcher and settings.
  - Visible focus rings, screen-reader names and live notices.
  - Reduced-motion and Windows high-contrast support.

## Performance (M5)

Built and measured for big vaults. With 10,000 notes the index is ready in about 2.5 s on a first launch and about 1 s after that (a saved index means only changed files are read again). Search stays under 50 ms, and under 200 ms at 50,000 notes. Long file trees, much-linked notes, big graphs and big canvases draw only what's on screen. A 500-cycle soak test shows no memory growth from opening, editing and closing notes. Numbers, method and limits are in [docs/perf.md](docs/perf.md).

## Files, media & export (M4)

- **Viewers**: images open in a viewer with zoom (wheel, buttons, double-click) and pan; PDFs in the built-in PDF viewer; audio and video in players; text and code files (`.txt`, `.csv`, `.json`, `.js`, ...) in a read-only view. Tabs follow renames and reload when the file changes. Other files open in their default app.
- **Export to PDF** (command): the note as in Reading view, on light pages, with page size, orientation, margins and an optional title. Images are included; audio, video and PDFs are named.
- **Where deleted files go**: the Recycle Bin (default) or the vault's hidden `.trash` folder (`"trashOption": "local"` in `.zenode/app.json`, or the command "Deleted files: switch..."). Where a drive has no Recycle Bin, files go to `.trash` instead of failing.
- **Find unused attachments** (command): lists files that no note or canvas links to or mentions, and moves the ones you keep ticked to the trash.

## Workspace & navigation (M3)

- **Command palette** (Ctrl+P): every command, fuzzy-searched, recent ones first, with their shortcuts.
- **Split panes**: split right or down (tab menu or commands), drag tabs between panes or onto a pane's edge to split, resize by dragging the divider, move focus with Ctrl+Alt+arrows. Pinned tabs, and back/forward through each pane's history (Alt+← / Alt+→). The layout is restored on launch.
- **File tree**: drag files and folders to move them (links update), Ctrl/Shift+click to select several, **Move to…**, sort (name, modified, created), collapse all, reveal the current file.
- **Sidebar panels**: left: files, search, bookmarks (files and searches) with recent files, tags with counts; right: backlinks with **unlinked mentions** (one click turns a mention into a link), outgoing links, outline, local graph.
- **Daily notes** (Ctrl+Shift+D or the calendar button) and **templates** (command "Insert template"): `{{title}}`, `{{date}}`, `{{time}}`, `{{date:dddd, MMMM Do}}`. A template's properties are merged into the note.
- **Properties**: front matter shows as an editable table in Live Preview: text, number, checkbox, date, date & time, list and tags. Changing a property rewrites only the YAML and keeps its comments and order; a property's type applies across the vault.
- **Several vaults at once**: "Open another vault" opens it in its own window. Launching Zenode again brings the running window forward.

Daily notes and templates are set up per vault:

```jsonc
// .zenode/daily-notes.json
{ "folder": "Journal", "format": "YYYY-MM-DD", "template": "Templates/Daily" }
// .zenode/templates.json
{ "folder": "Templates", "dateFormat": "YYYY-MM-DD", "timeFormat": "HH:mm" }
```

## Editor (M2)

- **Reading view** (Ctrl+E): the note rendered and read-only, with clickable task boxes. **Source mode** (command) shows plain Markdown.
- **Embeds**: `![[Note]]`, `![[Note#Heading]]`, `![[Note#^block]]`, images with size (`![[photo.png|300]]`), audio, video and PDF, in Live Preview and Reading view.
- **Paste or drop files** into a note: they're saved to the attachment folder (never overwriting) and embedded.
- **Obsidian syntax**: callouts (`> [!tip]`, foldable with `-` / `+`), `==highlights==`, `%%comments%%`, footnotes, `$math$` and `$$math$$` (KaTeX), Mermaid diagrams, front matter as properties.
- **Tables** render in place; inside one, Tab / Shift+Tab move between cells and realign the columns.
- **Find & replace** in a note (Ctrl+F / Ctrl+H) with regex, case and whole-word options.
- **Code blocks** are highlighted in their language while editing and reading, with a copy button.
- **Folding** of headings and lists from the gutter; **hover previews** of linked notes (Ctrl+hover in the editor); spellcheck on/off.

Editor settings are in Settings (Ctrl+,) and saved in `<vault>/.zenode/app.json`:

```json
{ "defaultView": "live", "spellcheck": true, "attachmentFolder": "./assets", "trashOption": "system" }
```

`defaultView` is `live`, `source` or `reading`. `attachmentFolder` is `""` (vault root), `"./"` (the note's folder), `"./name"` (a subfolder there) or a vault folder.

## Phase 4

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
- File tree: create, rename (inline) and delete notes and folders (deletes go to the Recycle Bin, or the vault's `.trash`)
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
| Ctrl+P | Command palette |
| Ctrl+O | Quick switcher |
| Ctrl+Shift+F | Search |
| Ctrl+G | Graph view |
| Ctrl+Shift+B | Toggle right sidebar (backlinks, outgoing links, outline, local graph) |
| Ctrl+Shift+O | Vaults: open another vault (in a new window), create one, or the Help vault |
| Ctrl+, | Settings |
| Ctrl+= / Ctrl+- / Ctrl+0 | Zoom in / out / reset |
| Ctrl+Shift+D | Today's daily note |
| Alt+← / Alt+→ | Back / forward in the pane's history |
| Ctrl+Alt+arrows | Focus the pane to the left, right, above or below |
| Ctrl+\\ | Toggle left sidebar |
| Ctrl+E | Toggle Reading view |
| Ctrl+F / Ctrl+H | Find / find & replace in the note |
| Ctrl+Shift+[ / ] | Fold / unfold |

On a canvas: double-click empty space to add a card, double-click a card to edit it (Esc to stop), Enter to edit the selected card, Delete to remove, Ctrl+Z / Ctrl+Shift+Z to undo and redo, Ctrl+A to select all.

Shortcuts can be changed in Settings → Hotkeys; they're saved per vault in `.zenode/hotkeys.json`, keyed by command id:

```json
{ "app:toggle-left-sidebar": [{ "modifiers": ["Mod", "Shift"], "key": "l" }] }
```

## Your data

- Notes and canvases are plain files in your vault folder. Zenode writes them atomically (temp file, then rename) and only after you edit them: opening or browsing never rewrites a file, and notes with Windows (CRLF) line endings keep them.
- Per-vault settings live in `<vault>/.zenode/` (pane layout in `workspace.json`, shortcuts in `hotkeys.json`, appearance in `appearance.json`, bookmarks in `bookmarks.json`, property types in `types.json`, plus `themes/` and `snippets/`), like Obsidian's `.obsidian/` folder.
- App settings and logs live in `%APPDATA%\Zenode\` (`logs\zenode.log` is useful for bug reports).

### Data safety

- **Nothing outside Zenode is overwritten silently.** Every save checks that the file on disk is still the version Zenode last saw. If another app, a sync client or another device changed it while you had unsaved edits, a bar offers **Compare** (side by side, copy changes across), **Keep my version** or **Use the version on disk**. A note deleted or moved outside Zenode keeps your unsaved text, with **Save it again**. Autosave pauses and the tab can't be closed until you choose.
- **Crash recovery.** Text that couldn't be saved yet is journaled outside the vault; after a crash or forced quit, Zenode offers it back, and opens it in compare mode if the note changed in the meantime.
- **File recovery.** Before saving over a file, Zenode keeps a copy of the previous version (at most every 5 minutes per file), plus any version you discard. Right-click a file > **Show file history** to preview, copy or restore one. Copies live in `%APPDATA%\Zenode\snapshots\` for 7 days (up to 50 per file).
- **Sync folders** (OneDrive, Dropbox, Syncthing, Nextcloud, Git): conflict copies such as `Note-DESKTOP-ABC.md` or `Note (Pat's conflicted copy …).md`, and notes with merge markers, show a badge in the status bar. Open it to compare and merge a copy into the note, or move the copy to the Recycle Bin.
- **Windows file names** are checked up front (no `< > : " / \ | ? *`, reserved names like `CON`, or trailing dots), long paths over 260 characters work, and files briefly locked by sync or antivirus tools are retried.

Known limits: OneDrive "online-only" files are downloaded when Zenode first indexes them; symbolic-linked folders aren't shown; canvases aren't in the crash journal (they save within half a second of an edit).

## Development

```bash
npm install
npm run dev        # run with hot reload
npm run typecheck  # TypeScript checks for main, preload and renderer
npm test           # unit tests (tests/run.ts): parser, links, rename, search, graph, canvas, commands, config, data safety, rendering
npm run test:e2e   # builds, then drives the real app with Playwright against tests/fixtures/vault
npm run bench -- 10000  # benchmark on a generated 10,000-note vault (docs/perf.md)
npm run soak -- 500     # leak check: 500 open/edit/close cycles
npm run build      # production bundles in out/
npm run dist       # Windows installer in dist/
npm run check:package  # checks the built app: fuses, start-up, tamper refusal
npm run check:install  # CI only: installs an older build, updates it to dist/, uninstalls
```

`npm run dist` builds the installer, portable exe and zip into `dist/`, plus `latest.yml` for the updater. The app icon is drawn by `scripts/make-icons.cjs` (run it with Electron) into `build/icon.ico`. The installer's extra registry entries (`zenode://` links and the Explorer folder menu) are in `build/installer.nsh`.

### Releasing

1. Move the changes under **Unreleased** in `CHANGELOG.md` into a new `## [x.y.z] - date` section, and set `"version"` in `package.json` to match.
2. Commit, then tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`. Use `vX.Y.Z-beta.N` for a pre-release, which only the Beta channel gets.
3. The Release workflow (`.github/workflows/release.yml`) does the rest:
   - checks that the tag, `package.json` and the changelog agree;
   - runs the tests, builds and checks the package;
   - publishes the GitHub Release, with the changelog section as its notes and the update files the app reads.

## Architecture

```
src/
  main/       Electron main process: one window per vault, vault file access, file watcher, settings
  preload/    The only bridge to the page (contextBridge); exposes window.zenode
  shared/     Types shared by main and renderer (the IPC contract)
  renderer/   The UI: app shell, file tree, tabs, CodeMirror editor + Live Preview
tests/
  run.ts          Runs the unit tests (index, safety, render, editor, notes, properties, files) bundled with esbuild in Node
  e2e/            Playwright tests that launch the built app
  fixtures/vault  The sample vault the end-to-end tests run against (copied per test)
```

Every action is a command in a registry (`src/renderer/src/commands.ts`), shaped like Obsidian's `addCommand`, so the command palette, hotkey editor and plugin API can share it. CI runs typecheck, unit and end-to-end tests and builds the installer on every push.

Security: see [SECURITY.md](SECURITY.md).
- **Sandboxed page.** The page runs sandboxed and context-isolated, without Node, and only the app's own page may call the main process.
- **Vault-only file access.** Every path is checked against the vault's real location, so links and junctions can't escape it.
- **Safe links and files.** Only web and email links leave the app, and files that run as programs ask first.
- **Locked-down build.** The packaged app has Electron fuses set (no run-as-Node, `NODE_OPTIONS` or inspector; ASAR integrity enforced). `npm run check:package` verifies the built exe, including that a tampered `app.asar` is refused.

## Roadmap

2. ~~`[[wikilinks]]`, backlinks, quick switcher, full-text search~~ (done)
3. ~~Graph view (d3-force physics in a worker, WebGL rendering)~~ (done)
4. ~~Canvas (JSON Canvas files with cards, links and groups)~~ (done)

Towards 1.0 (production-ready core):

- ~~M0 Foundations: Electron 44, command registry, per-vault config, E2E tests, CI, error log~~ (done)
- ~~M1 Data safety: conflict handling for outside edits, crash recovery, file snapshots, sync-folder conflict copies~~ (done)
- ~~M2 Editor: embeds, paste/drop attachments, tables, callouts, find & replace, math, Mermaid, Reading view~~ (done)
- ~~M3 Workspace: command palette, split panes, drag & drop, outline/tags/bookmarks, daily notes, templates, properties, multiple windows~~ (done)
- ~~M4 Files: image/PDF/audio/video/text viewers, export to PDF, delete to Recycle Bin or .trash, unused attachments~~ (done)
- ~~M5 Performance: saved index, 10k-50k note vaults, long lists, graph and canvas at scale, leak check~~ (done)
- ~~M6 Appearance: light theme, settings screen, themes and snippets, hotkey editor, onboarding and Help vault, accessibility~~ (done)
- ~~M7 Security hardening: fuses, link and file-open safety, vault containment, IPC origin checks, CSP, Dependabot, audit gate~~ (done)
- ~~M8 Packaging: app icon, installer/portable/zip, file associations, Explorer folder menu, zenode:// links, auto-update with channels, release workflow, changelog~~ (done)
- M9 docs and website

After 1.0: Git and sync helpers (1.1), Bases database views (1.2), an Obsidian-compatible plugin API (1.3).
