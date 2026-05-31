---
title: WebDAV
description: Mount your organisation's documents as a network drive in Finder, File Explorer, or any WebDAV client. Set up an app-password under Settings > WebDAV, then connect from your device.
---

WebDAV turns Tale's document store into a remote folder you can mount the same way you mount a shared network drive at work. From Finder on a Mac, File Explorer on Windows, the Files app on iOS, or a Linux file manager, you connect to a URL and authenticate with an app-password; from there, the document hierarchy under your organisation appears as folders you can browse, drag files into, and edit in place. It is the same backing store as the Document Hub in Tale's web UI — what you see in one surface, you see in the other.

This page is the setup guide. The wire-protocol reference lives under [Develop > WebDAV API](/develop/webdav-api).

## Before you start

The WebDAV endpoint authenticates with **app-passwords** — short random secrets you generate per device under Settings. Your main account password does not work here; the platform does not accept it on the WebDAV endpoint, and it would be insecure to do so (every WebDAV client stores credentials in its system keychain, replayable to anything that can read that keychain). App-passwords let you scope access per device and revoke per device without rotating anything else.

A note on the username field: the app-password is the only credential the server actually verifies — the username string is not matched against your account record. The convention is to use your Tale account email so audit logs and the row label stay readable, and most client UIs expect an email-shaped string anyway, but the auth decision is made on the password alone.

You also need to know your **organisation slug** and the **site URL** your operator deployed the platform under. Both are visible on the Settings > WebDAV panel, and the panel will pre-fill them in the connection details below the password generator.

Generating an app-password requires **Admin** or **Developer** permissions in the organisation — the same capability that gates API keys. A plain member who opens Settings > WebDAV sees an access-denied screen instead of the generator; ask an organisation admin to issue a password, or to grant the capability.

## Generating an app-password

Open **Settings > WebDAV** and type a label that describes where you will use the password — `MacBook Finder`, `iPhone Files`, `ops-laptop rclone`. Click **Generate**. The full password appears once, with a copy button next to it; copy it into your device's connection dialog or into your password manager before you close the panel. After dismissing, only the first four characters are visible from the table, which is enough to identify the row when you later want to revoke it.

You can hold as many app-passwords as you like. The plan is one per device — if you lose the device or stop using it, revoke that row without disturbing any other client you have configured.

## Connecting from macOS Finder

In Finder, press **⌘K** (Connect to Server). The address is `https://<your-site>/dav/<orgSlug>/documents/` — copy it from the connection-details panel. When Finder prompts for credentials, use your Tale account email as the username and the app-password as the password. Finder mounts the share in the sidebar; from there you can browse the document tree, drag files in to upload, drag them out to download, and rename or delete in place.

The first PROPFIND can take a couple of seconds on a large document tree — Finder issues a depth-1 listing of the path you mount, and the platform answers from the same Convex tree the Document Hub UI uses. After the first load, browsing is fast.

## Connecting from Windows File Explorer

In **This PC**, choose **Map network drive**. The folder is `https://<your-site>/dav/<orgSlug>/documents/`. Pick a drive letter, leave **Reconnect at sign-in** checked, and click **Connect using different credentials**. Use your Tale account email and the app-password.

Windows imposes a **50 MB default size limit** on individual files transferred over WebDAV. To raise it, open `regedit` and edit `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\WebClient\Parameters\FileSizeLimitInBytes` — set it to a decimal value up to `4294967295` (4 GB). Restart the **WebClient** service after the change. This limit is enforced by Windows, not by Tale, so files smaller than the limit transfer fine without the registry edit.

If File Explorer refuses to connect with **"The folder you entered does not appear to be valid"**, the cause is almost always Windows' default refusal to use Basic auth over HTTPS on non-port-443 origins. If your deployment runs on a non-standard HTTPS port, set `BasicAuthLevel` under the same registry key to `2`.

## Connecting from iOS Files

In the Files app, tap the three-dot menu in the top right and choose **Connect to Server**. The address is the same `https://<your-site>/dav/<orgSlug>/documents/`. Use your Tale account email and the app-password. iOS Files supports browsing and downloading; in-place editing is supported for app formats that have an iOS counterpart.

## Connecting with rclone

For batch uploads or scripted sync, `rclone` is the most reliable WebDAV client:

```bash
rclone config create tale webdav \
    url=https://<your-site>/dav/<orgSlug>/documents/ \
    vendor=other \
    user=<your-email> \
    pass=$(rclone obscure '<app-password>')
rclone copy ./local-folder tale: --progress
```

`vendor=other` is the right setting — Tale's WebDAV server is generic, not one of the named flavours (`nextcloud`, `owncloud`, `sharepoint`) that rclone recognises by name.

## What you can and cannot do

Read and write to the **documents** namespace mirror what you can do in the Document Hub UI. Files you upload through WebDAV land in the same store, with the same retention, indexing, and search behaviour; the source field on the document is set to `webdav` so you can filter for them in audit logs and reports. Folders you create through MKCOL show up in the UI immediately.

The **.trash** namespace is read-only — `https://<your-site>/dav/<orgSlug>/.trash/` lists documents you have soft-deleted but are still within the retention grace window. You can download files from trash for recovery, but writes there are rejected with 403. To restore, move them through the Document Hub UI.

Some clients call PROPFIND with **Depth: infinity** — a request to dump the entire tree in one response. Tale rejects that with `403` to prevent runaway responses on large stores. Every mainstream client (Finder, File Explorer, iOS, rclone, cadaver) uses Depth: 0 or 1, so you should never see this in practice.

## Locking

Tale implements WebDAV Class 2 locks. When you open a file in an app that respects locks (Microsoft Office, LibreOffice, BBEdit, several text editors), the app LOCKs the resource for the duration of the edit; another client trying to write to the same path during that window gets `423 Locked`. Locks expire automatically after at most an hour even if the app crashes, but if you need to clear a stuck lock before then, revoke the app-password that holds it — Tale releases every lock held under a revoked app-password on the same operation.

## Revoking

To revoke an app-password, click the trash icon next to its row. The row stays in the table for the audit trail and is badged **revoked**. Any in-flight request authenticated with the revoked password completes; the next one is rejected. There is no undo — generate a new password if you revoke the wrong row.

## Troubleshooting

A request that returns `401` after working yesterday almost always means the app-password was revoked or expired. The username field itself is not verified — only the password is checked — so a typo in the username will not cause a 401, but a wrong, revoked, or mis-pasted password will.

A request that returns `423 Locked` means the path is locked by another client. Wait for the lock to expire, switch to a different filename, or revoke the app-password holding it.

A Finder mount that hangs on first browse usually means Convex is slow to answer a large PROPFIND on a deep tree — wait it out. If it never returns, check that your account is still a member of the organisation slug in the URL; the WebDAV endpoint rejects requests from non-members with `403`.

A `502` on GET indicates the platform could fetch the document metadata but failed to retrieve the blob bytes from storage. Check the Convex logs for storage errors and confirm `ADMIN_KEY` is set in the platform environment — the WebDAV server reads blobs through an admin-authenticated client.

## Security

WebDAV uses HTTP Basic, which means the app-password is sent on every request — there is no session cookie that expires, no refresh token, just the raw credential going up the wire every time the client talks to the server. Only mount the share over HTTPS; over plain HTTP, anyone on the path between you and the server can read the password. Let your OS keychain (macOS Keychain, Windows Credential Manager, GNOME Keyring) hold the password — never paste it into the `https://user:pass@host/...` shorthand, because most tools log URLs in shell history, crash reports, and proxy access logs where the credential would survive far longer than the mount.

If you suspect a password has leaked, revoke that row in **Settings > WebDAV** immediately. The revoke is instant; the next request authenticated with the leaked password is rejected. Other devices using their own app-passwords are unaffected.

## Where this fits

WebDAV sits beside the [Document Hub](/platform/knowledge/documents) (the same data, viewed through the web UI), [Integrations](/platform/integrations/overview) (third-party systems Tale pulls from), and [API keys](/platform/admin/api-keys) (org-wide credentials for the REST API). WebDAV is per-user — the credentials authenticate as you, scoped to organisations you are a member of. For machine-to-machine document import, API keys plus the REST API are usually the better fit.
