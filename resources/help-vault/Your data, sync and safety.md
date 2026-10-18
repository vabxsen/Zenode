# Your data, sync and safety

- Notes and canvases are ordinary files in your vault folder. Zenode only writes a file after you change it, and writes it in one step so a crash can't leave half a note.
- Vault settings live in a hidden `.zenode` folder inside the vault. App settings and logs are in `%APPDATA%\Zenode`.
- **Deleted files** go to the Recycle Bin, or to a hidden `.trash` folder in the vault if you choose that in Settings → Files & links.

## When something changes outside Zenode

If another app or a sync service changes a note while you have unsaved edits, Zenode never overwrites it silently. A bar offers **Compare**, **Keep my version** or **Use the version on disk**.

## Crash recovery and file history

Text that wasn't saved yet is kept outside the vault and offered back after a crash. Before saving over a file, Zenode keeps the previous version: right-click a file → **Show file history** to look back and restore.

## Sync folders

Vaults in OneDrive, Dropbox, Syncthing, Nextcloud or Git work. When a sync tool makes a conflict copy (like `Note (conflicted copy).md`), the status bar shows it and lets you compare and merge.
