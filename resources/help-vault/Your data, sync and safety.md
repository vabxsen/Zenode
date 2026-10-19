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

## Updates and privacy

Zenode has no account and sends nothing about you or your notes. The only thing it asks the internet is whether a new version is out on GitHub, when it starts and every few hours. Turn that off in Settings → General → Updates, or press **Check now** there whenever you like.

The installed app downloads a new version in the background and installs it the next time you restart Zenode. The portable and zip copies don't update themselves: they tell you when a new version is out and link to its download page.
