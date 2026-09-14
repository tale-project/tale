---
title: Open Tale documents through WebDAV
description: Generate a device password, connect a WebDAV client and verify file access without confusing project and organization storage.
---

WebDAV lets a compatible file client read and edit Tale’s organization documents as a remote folder. Changes use the same document store as **Knowledge > Documents**. Project-specific Knowledge files are not included in this mount.

## Get the connection details

Open **Settings > API > WebDAV**. Owners, Admins and Developers can generate their own device credentials. Copy the displayed URL, including the organization slug and `/documents/` path; do not construct it from an organization ID or use another organization’s address.

<Frame caption="Settings > API > WebDAV — the pre-filled connection details on top, the app-password generator below.">

![The WebDAV settings page shows the connection URL and username above three app-password rows. Retired design workstation is revoked; Design workstation and MacBook Pro remain active with Revoke actions.](/images/platform/settings-webdav.webp)

</Frame>

Use your Tale account email as the username and an app-password as the password. Your normal account password does not authenticate WebDAV. On a deployed service, connect over HTTPS; avoid credentials embedded in URLs or saved in command history.

## Generate one password per device

1. Select **Generate** and enter a **Label** such as `Design laptop`.
2. Generate the password and copy it before closing the result. The full value appears only once.
3. Store it in the device client’s credential manager, then select **I have saved it**.

The list keeps the label, prefix and usage dates, not the recoverable password. If you lose it, generate a replacement and revoke the old one once you have updated the client. Separate passwords let you disconnect one device without changing every other connection.

## Configure your client

<Tabs>

<Tab title="macOS Finder">

In Finder, press **⌘K** to open **Connect to Server**. Paste Tale’s WebDAV URL and connect with your email and app-password. Open the mounted folder and inspect a known document before copying files into it. Save the credential only on a device you trust.

</Tab>

<Tab title="Windows">

Use File Explorer’s network-drive connection with the HTTPS WebDAV address and your generated credentials. The Windows WebClient service must be available. If connection or large transfers fail, check Microsoft’s [WebDAV client requirements and limits](https://learn.microsoft.com/en-us/iis/publish/using-webdav/using-the-webdav-redirector) with IT, or use a dedicated WebDAV client. Keep HTTPS authentication enabled.

</Tab>

<Tab title="Linux">

A desktop file manager with WebDAV support can use the displayed host and path. GNOME Files uses `davs://` for secure WebDAV; KDE Dolphin uses `webdavs://`. If the dialog separates server and folder, enter the host in the server field and `/dav/<orgSlug>/documents/` as the folder, with HTTPS and the correct port.

</Tab>

<Tab title="iPhone and iPad">

Choose a client that explicitly supports WebDAV and give the device its own app-password. Tale’s browser-based Documents page also works for occasional access. Do not assume the Files app’s generic server dialog supports this protocol. Direct WebDAV upload from Pages, Numbers and Keynote is [no longer supported](https://support.apple.com/en-us/101948).

</Tab>

<Tab title="rclone">

Run `rclone config` and create a WebDAV remote with Tale’s URL, your email and app-password. Choose vendor `other`. Enter the password through the interactive prompt. Follow [rclone’s WebDAV guide](https://rclone.org/webdav/) to list files and copy a small test directory before a larger transfer.

</Tab>

</Tabs>

## Verify a small transfer

Open or download a document you can already read in Tale. If your role permits writes, upload a small uniquely named text file in a test folder. Confirm its name and content in **Knowledge > Documents**, then check its indexing status before expecting it in search.

A WebDAV upload follows document permissions and indexing rules; the source is recorded as `webdav`. A successful file transfer does not mean indexing has finished. If a project file seems missing from the mount, open that project’s Knowledge tab instead.

## Handle locks and deleted files

A compatible editor can lock a file while editing. A conflicting write receives **423 Locked**; finish or close the other editing session rather than repeatedly overwriting. Revoking an app-password also releases locks held by that credential.

The `.trash/` area lists soft-deleted documents read-only. Download a retained file if you need to inspect it; use Tale’s UI to restore it. You cannot use this area to retrieve a file that has already been permanently removed.

## Revoke or repair a connection

Use **Revoke** on the password’s row and confirm. Subsequent requests with it are rejected, while other app-passwords remain usable. Revocation cannot be undone; update the client with a new password if needed.

Repeated sign-in prompts usually warrant checking the exact URL, organization membership and whether the password was revoked. A permission refusal after authentication is different from a wrong password. Use the [WebDAV API reference](/develop/webdav-api) for status codes and protocol diagnostics, or [API keys](/platform/admin/api-keys) for software that needs the REST API instead.
