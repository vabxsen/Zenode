# Changelog

All notable changes to Zenode are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Zenode uses [Semantic Versioning](https://semver.org/).

Each release's notes on GitHub are taken from its section below, so write entries for people who use Zenode.

## [Unreleased]

### Security

- Updated Electron to 44.9.3, which distrusts the compromised eMudhra intermediate certificates (GHSA-jr5w-w6x2-84p9).
- Hardened file access:
  - The vault folder itself can no longer be renamed, moved or deleted from inside Zenode.
  - Vault settings, themes and snippets are only read and written inside the vault, even when `.zenode` is a link to another folder.
  - Snippet and theme names can't contain path separators.
- Zenode only opens vaults from your vault list by name; a new folder always goes through the folder picker.
- Synced files whose names contain a backslash are ignored.
- Installed copies never load the development address.

## [0.6.0] - 2026-10-23

### Added

- **Zenode account:** sign in with Google (Settings → Account & sync), and the vaults you open are kept in your account.
  - Notes, canvases and vault settings sync between computers within seconds; each computer keeps its own tabs and layout.
  - On a new or reset computer, "Restore from your account" on the welcome screen brings a vault back.
  - When two computers change the same note, the other version is kept beside it as a conflict copy to compare and merge.
  - The Help vault, and folders opened just to read one file, sync only if you turn them on.
  - Images and other attachments don't sync yet.
- A new app icon and logo: the Ribbon Z.

### Fixed

- Typing right after Zenode starts no longer lands in a reopened note instead of the command palette or another dialog.
- The file tree keeps keyboard focus when it redraws.
- The local graph of an image or other attachment explains how to show what links to it.

## [0.5.0] - 2026-10-19

The first public build.

### Added

- **Notes:** Markdown notes with Live Preview, Source mode and Reading view.
  - `[[wikilinks]]` and embeds; tables; callouts; footnotes; highlights; comments; math; Mermaid diagrams.
  - Code blocks with highlighting; folding; find and replace; spellcheck.
- **Linking and search:** backlinks with unlinked mentions, outgoing links, outline, tags, bookmarks, and recent files.
  - Search, the quick switcher, the command palette, and hover previews.
  - Renaming or moving a note updates the links to it.
- **Workspace:** split panes and tabs you can drag between them; the layout is restored when you come back.
  - Several vaults, each in its own window.
- **More views:** graph view, canvas boards, and viewers for images, PDFs, audio, video and text files.
- **Writing helpers:**
  - Properties (front matter) with typed values.
  - Daily notes and templates.
  - Pasted or dropped files are saved as attachments; unused attachments can be found and cleaned up.
- **Export:** PDF export of a note.
- **Data safety:**
  - Atomic saves, and conflict warnings when a note changes on disk.
  - Crash recovery of unsaved typing, file history snapshots.
  - Detection of sync-tool conflict copies.
  - Deletes go to the Recycle Bin or the vault's `.trash` folder.
- **Speed:** a persistent index cache and virtualised lists keep large vaults (10,000+ notes) quick.
- **Appearance:**
  - Dark and light themes, accent colour, fonts, text size, line width and zoom.
  - CSS themes and snippets.
  - A hotkey editor.
- **Getting started:** a first-run screen, a bundled "Zenode Help" vault, and a vault manager.
- **Accessibility:** keyboard navigation, screen-reader labels, and support for high-contrast and reduced-motion settings.
- **Security:**
  - The page is sandboxed, and file access stays inside the vault.
  - Only web and mail links open outside Zenode, and programs ask before they open.
  - Electron fuses are set, and the app archive is integrity-checked.
- **Windows integration:**
  - The app icon.
  - `.md` and `.canvas` files open in Zenode.
  - "Open folder as Zenode vault" in File Explorer.
  - `zenode://open?vault=…&file=…` links.
- **Updates:**
  - The installed app updates itself from GitHub Releases, with stable and beta channels.
  - "Check now" in Settings, and automatic checks can be turned off.
  - Portable and zip copies say when a new version is out.
- **Downloads:** an installer (per user, no admin rights needed), a portable `.exe`, and a `.zip`.

[Unreleased]: https://github.com/vabxsen/Zenode/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/vabxsen/Zenode/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/vabxsen/Zenode/releases/tag/v0.5.0
