# Putting Zenode in the Microsoft Store

Windows' Smart App Control blocks programs that aren't signed by a verified publisher, and Zenode's GitHub downloads are unsigned. Apps from the Microsoft Store are signed by Microsoft, so Smart App Control lets them run, and the Store keeps them up to date.

Getting there has two parts: an account and a listing that only the owner can set up (steps 1 to 3, then 5), and the package, which the build makes (step 4).

## 1. Create a free developer account

1. Go to https://storedeveloper.microsoft.com and click **Get started** (or **Sign up**).
2. Choose **Individual developer**. It's free.
3. Sign in with your Microsoft account (the one you use for Windows or Outlook is fine).
4. Fill in your name, country and contact details.
5. Verify your identity when asked: a photo of an ID document and a selfie. This can take from minutes to a few days.

When it's done you land in **Partner Center** (https://partner.microsoft.com/dashboard).

## 2. Reserve the name "Zenode"

1. In Partner Center, open **Apps and games**.
2. Click **+ New product**, then **MSIX or PWA app**.
3. Type **Zenode** and click **Check availability**, then **Reserve product name**.

## 3. Copy Zenode's three identity values

1. In the Zenode product, open **Product management** → **Product identity**.
2. Copy these three lines:
   - **Package/Identity/Name** (looks like `12345YourName.Zenode`)
   - **Package/Identity/Publisher** (starts with `CN=`)
   - **Package/Properties/PublisherDisplayName** (your publisher name)

They aren't secret (they're written inside every package), so they live in the repository, in `build/store-identity.json`:

```json
{
  "identityName": "12345YourName.Zenode",
  "publisher": "CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
  "publisherDisplayName": "Your Name"
}
```

## 4. Build the package

With `build/store-identity.json` in place, every version tag (`v0.8.0`, ...) also builds the Store package. To build one any time: on GitHub, open **Actions** → **Microsoft Store package** → **Run workflow** (leave "Test package" off) → **Run workflow**.

When the run finishes, open it and download **zenode-store-package** under **Artifacts**. Unzip it: inside is `Zenode-<version>-store.appx`, the file to upload.

## 5. Submit Zenode to the Store

In Partner Center, open the Zenode product and click **Start your submission**. Fill in each section:

1. **Pricing and availability**: *Free*; markets: all (or the ones you want); visibility: *Public*.
2. **Properties**:
   - Category: **Productivity**.
   - Privacy policy URL: `https://github.com/vabxsen/Zenode/blob/main/PRIVACY.md`
   - Website: `https://github.com/vabxsen/Zenode`
   - Support contact: `https://github.com/vabxsen/Zenode/issues`
3. **Age ratings**: answer the questionnaire. Zenode has no violence or purchases. When it asks about user-generated content or communication, answer **No**: notes are private files and nothing is shared between users.
4. **Packages**: drag in the `.appx` file. Partner Center checks it; a green tick means it's fine.
5. **Store listings** → **English**:
   - Description: what Zenode does (a short paragraph is enough to start).
   - Screenshots: at least one, 1366×768 or larger.
6. **Submission options** → **Restricted capabilities**: Partner Center asks why Zenode needs **runFullTrust**. Write: *"Zenode is a desktop app built with Electron. It needs full trust to read and write the user's own note files in folders they choose, as a regular Windows desktop program does."*
7. Click **Submit to the Store**.

Microsoft's check usually takes 1 to 3 working days. You get an email when Zenode is live, with a link to its Store page.

## Later versions

For each new version, tag it as usual, download the new package from the **Microsoft Store package** run for that tag, and in Partner Center make a new submission (**Update** on the Zenode product) with the new package in **Packages**. Everything else carries over.

## What differs in the Store copy

- The Store installs updates; the app's own update checks are switched off (Settings shows "The Microsoft Store keeps this copy of Zenode up to date").
- `.md` and `.canvas` files and `zenode://` links open in Zenode, as with the installer.
- There's no "Open folder as Zenode vault" entry in File Explorer's right-click menu (Store packages can't add it). Use **Open folder as vault** inside Zenode instead.
