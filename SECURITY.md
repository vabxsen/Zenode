# Security

## Reporting a problem

Please report security issues privately, not in a public issue: use GitHub's **Report a vulnerability** button on the repository's Security tab (private vulnerability reporting). Include the Zenode version (Settings → General → Copy diagnostics), what you did, and what happened.

You can expect an answer within a week. Once a fix is released, the issue will be described in the release notes, with credit if you'd like it.

## Supported versions

Only the latest release gets security fixes.

## How Zenode protects your notes and your computer

Zenode is a desktop app that reads and writes files in folders you choose. It has no telemetry or analytics. Without signing in, the only network request it makes is the update check: it asks GitHub Releases whether a new version is out, at start-up and every few hours. That can be turned off in Settings → General → Updates.

**Account and sync (optional).** Signing in with Google syncs vaults to the Zenode Firebase project (Cloud Firestore):
- Sign-in uses Google's flow for desktop apps in your browser (PKCE, with a one-time local address). Zenode never sees your Google password.
- The session is kept encrypted with Windows' data protection (Electron safeStorage).
- Firestore security rules let each account read and write only its own data.
- Synced notes are encrypted in transit and at rest by Google, but not end to end yet: the project's owners could read them. End-to-end encryption is planned.
- Sync runs in the main process; the page still cannot reach the network.

**The page is sandboxed.**
- The app's interface runs with Chromium's sandbox and context isolation, without Node.js.
- It can only use a small, fixed set of functions (`window.zenode`).
- The main process answers those only for the app's own page, in the main frame of its own windows.

**File access stays inside the vault.**
- Every path from the page is resolved inside the open vault.
- A path is refused if it would leave the vault, including through symbolic links or junctions.
- NTFS alternate data streams and Windows device names are refused.

**Notes can't run code.**
- Markdown is rendered through DOMPurify.
- Mermaid runs in strict mode.
- The app page's Content-Security-Policy allows scripts only from the app itself.
- Files served to the page through `vault://` are sent with a sandboxing CSP and `nosniff`, so a vault HTML or SVG file shown as a page can't run scripts.

**Links and files.**
- Only `http(s)` and `mailto` links are handed to Windows. Other schemes (`file:`, `ms-settings:`, custom app protocols) are refused.
- Opening a vault file that would run as a program (`.exe`, `.bat`, `.ps1`, `.lnk`, `.msi`, …) asks for confirmation first.
- **`zenode://` links** open only vaults Zenode already knows, and only notes and canvases inside them. A link can't open another folder, a file outside the vault, or a program. Windows passes a link after `--`, so a link can't add command-line switches.

**No surprises from web content.**
- Pages get no permissions: no camera, microphone, location or notifications; only writing to the clipboard.
- Nothing can navigate the window, open new windows or embed webviews.

**The packaged app is locked down.** Electron fuses are set at build time:
- **Turned off:** running as Node (`ELECTRON_RUN_AS_NODE`), `NODE_OPTIONS`, and Node inspector flags.
- **Turned on:**
  - The app is loaded only from its `app.asar` archive, whose integrity is checked against a hash stored in the executable, so a modified `app.asar` is refused.
  - Cookie encryption.

  CI checks the fuses and the tamper refusal on every build (`npm run check:package`).

**Updates.**
- Updates come only from this repository's GitHub Releases, over HTTPS.
- The download is checked against the SHA-512 hash in the release's `latest.yml` before it's installed.
- Only installed copies update themselves. Portable and zip copies link to the release page.

**Data safety.**
- Notes are written atomically and never overwritten silently when they changed outside Zenode.
- Deletes go to the Recycle Bin or the vault's `.trash` folder.

**Dependencies.**
- CI fails on high or critical advisories in shipped dependencies (`npm audit --omit=dev`).
- Dependabot proposes updates weekly.

## Known limits

- **Unsigned builds.** Releases are not code-signed yet. Windows SmartScreen may warn on first install, and Smart App Control (Windows 11) blocks unsigned apps altogether.
- **Updates trust the release.** Without a code signature, an update is only as trustworthy as the GitHub release it comes from: the hash check catches a damaged download, not a compromised release.
- **Not encrypted.** Zenode doesn't encrypt your vault. Use BitLocker, or an encrypted folder, if you need that.
- **Trusted themes and snippets.** CSS themes and snippets in `.zenode/` can change how the app looks, including hiding or restyling content. Only install themes you trust.
