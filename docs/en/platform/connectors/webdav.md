---
title: WebDAV
description: Mount your organisation's documents as a network drive in Finder, File Explorer, or any WebDAV client.
---

WebDAV turns Tale's document store into a remote folder you mount like any shared network drive. The backing store is the same one the Document Hub shows — what you drop into the mounted folder appears in the UI, and vice versa. Everything you need is on one panel: **Settings > API > WebDAV** carries the connection details and the app-password generator.

<Frame caption="Settings > API > WebDAV — the pre-filled connection details on top, the app-password generator below.">

![The WebDAV settings page showing a connection URL, a username field with the account email, an explanation that the password is a generated app-password, and an app-passwords table holding two entries — Design workstation and MacBook Pro, each with only its prefix and creation date — beside a Generate button.](/images/platform/settings-webdav.webp)

</Frame>

## Generate an app-password

The endpoint authenticates with app-passwords — short secrets you mint per device — because every WebDAV client stores its credential in the system keychain, and a scoped, revocable secret belongs there rather than your account password. Your account password does not work on this endpoint.

Click **Generate**, label the password after the device (`MacBook Finder`, `ops-laptop rclone`), and copy it — use one per device; the full password is only shown once. Afterwards the table keeps only the label and a short prefix, enough to recognise the row when you revoke it. Generating requires the same capability that gates API keys; plain members ask an admin.

For the username, use your Tale account email. Only the password is actually verified, but the email keeps audit rows readable and matches what client dialogs expect.

## Connect from your device

The address is the URL from the panel — `https://<your-site>/dav/<orgSlug>/documents/`.

<Tabs>

<Tab title="macOS Finder">

Press **⌘K** (Connect to Server), paste the URL, and sign in with your email and the app-password. The share mounts in the sidebar; drag files in to upload, out to download, and rename or delete in place. The first listing of a large tree can take a few seconds.

</Tab>

<Tab title="Windows">

In **This PC**, choose **Map network drive**, paste the URL as the folder, and pick **Connect using different credentials**. Windows caps WebDAV transfers at 50 MB per file by default — raise `FileSizeLimitInBytes` under the `WebClient\Parameters` registry key and restart the WebClient service. On a non-standard HTTPS port, set `BasicAuthLevel` to `2` under the same key.

</Tab>

<Tab title="iOS Files">

Tap the three-dot menu, choose **Connect to Server**, and enter the same URL and credentials. Files supports browsing and downloading; in-place editing works for formats with an iOS app.

</Tab>

<Tab title="rclone">

```bash
rclone config create tale webdav \
    url=https://<your-site>/dav/<orgSlug>/documents/ \
    vendor=other \
    user=<your-email> \
    pass=$(rclone obscure '<app-password>')
rclone copy ./local-folder tale: --progress
```

`vendor=other` is correct — Tale's server is generic, not a named flavour rclone recognises.

</Tab>

</Tabs>

## What the mount can do

Reads and writes mirror your Document Hub permissions, files you upload index and search like direct uploads, and their source field is set to `webdav` for filtering in audit views. Project files are the exception: a project's **Knowledge** tab is scoped to that one project and never appears over WebDAV, so the mount shows only the org-wide Document Hub. The `.trash/` namespace lists soft-deleted documents read-only — download for recovery, restore through the UI. Editors that take WebDAV locks (Office, LibreOffice) get them; a competing write during an edit returns `423 Locked`.

## Revoking

Revoke a password with the trash icon on its row — the next request with it is rejected, other devices are untouched, and any locks it held are released. There is no undo; mint a new password if you revoke the wrong row.

<Warning>

Basic auth sends the app-password on every request. Mount only over HTTPS, keep the password in the OS keychain, and never paste it into a `https://user:pass@host/` URL — shell history and proxy logs outlive the mount. Revoke immediately on any suspected leak.

</Warning>

## Where this fits

WebDAV is the per-user, device-facing door to the same data as the [Document Hub](/platform/knowledge/documents); the wire protocol lives under [WebDAV API](/develop/webdav-api). For machine-to-machine imports, [API keys](/platform/admin/api-keys) plus the REST API are usually the better fit.
