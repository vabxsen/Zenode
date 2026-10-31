# Zenode privacy policy

Last updated: 30 October 2026

Zenode is a note-taking app for Windows. This page explains what it does with your information.

## Your notes stay on your computer

Your notes, canvases and attachments are ordinary files in folders you choose (your "vaults"). Zenode reads and writes them on your computer. It does not send them anywhere unless you turn on the optional Zenode account below.

Zenode also keeps some things in its own folder on your computer (`%APPDATA%\Zenode`): your settings, the list of your vaults, earlier versions of edited notes (file recovery), unsaved text kept in case of a crash, a search index, and a log file for troubleshooting. None of this leaves your computer.

## The optional Zenode account (sync)

If you choose **Sign in with Google** in Settings → Account & sync:

- **Sign-in:** Google tells Zenode your Google account's name, email address and an account ID. Zenode uses them only to show who is signed in and to keep your vaults separate from other people's. The sign-in is kept on your computer, encrypted with Windows' data protection.
- **What is stored online:** the text files of the vaults you sync (notes, canvases, vault settings), with their folder paths and the names of your vaults. Images and other attachments are not synced. Each computer's own layout and tab state is not synced either.
- **Where:** in Google Cloud Firestore (Google Firebase), in the asia-south1 region. Access rules let only your signed-in account read or change your files.
- **Not end-to-end encrypted:** your synced files are encrypted in transit and at rest by Google, but not with a key only you hold. The developer, who administers the Firebase project, could technically access them; the developer does not look at them.
- **Stopping:** you can turn sync off for a vault or sign out at any time in Settings → Account & sync. To have your synced data deleted from the account storage, open an issue at https://github.com/vabxsen/Zenode/issues (without posting private details) and ask.

Google's own handling of sign-in and Firebase data is described in Google's privacy policy: https://policies.google.com/privacy

## Update checks

Copies of Zenode installed from GitHub check GitHub (https://github.com/vabxsen/Zenode/releases) for new versions when they start and every few hours. This sends GitHub an ordinary web request, like visiting the page. You can turn automatic checks off in Settings → General → Updates. Copies installed from the Microsoft Store are updated by the Store and make no update checks of their own.

## Links you open

When you click a web or email link in a note, Zenode hands it to your browser or mail app. Zenode itself loads nothing from the internet to show your notes.

## No tracking

Zenode has no ads, no analytics, no telemetry and no crash reporting service. It does not sell or share your information.

## Children

Zenode is a general-purpose app and does not knowingly collect information from children.

## Changes and contact

Changes to this policy are listed in the app's changelog and in this file's history on GitHub. Questions: https://github.com/vabxsen/Zenode/issues
