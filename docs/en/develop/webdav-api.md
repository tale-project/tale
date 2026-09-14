---
title: WebDAV API
description: Connect a file client, verify uploads and downloads, and handle WebDAV permissions, locks, and protocol limits.
---

Use WebDAV when a file client needs folders, downloads, uploads, and edit locks over HTTP. This endpoint exposes the organization's Document Hub; project files are outside its tree. For Finder, File Explorer, or another existing client, start with [Connect with WebDAV](/platform/connectors/webdav).

This reference is for client implementers. First verify one authenticated listing, then a small upload. A successful `207` listing proves access; a successful upload followed by the same downloaded bytes proves the complete storage path.

## URL scheme

| Path | Access | Contents |
| --- | --- | --- |
| `/dav/<orgSlug>/documents/<path>` | Read and write | Active Document Hub documents and folders |
| `/dav/<orgSlug>/.trash/<path>` | Read only | Trashed documents |
| `/dav/<orgSlug>/` | Read only | The two collections above |

Encode each path segment separately. The parser normalizes Unicode to NFC and trims leading and trailing whitespace. It rejects empty names, `.` and `..`, `/`, `\`, control characters, and names longer than 255 UTF-16 code units. This is a character-length check, not a 255-byte limit. Organization slugs match `[a-zA-Z0-9_-]{1,64}`.

Use a trailing slash for folders and none for files. Listings return canonical URLs. Follow the returned `href` when addressing an existing item; do not reconstruct it from its display name, particularly when sibling documents share a title.

## Authentication

Generate an app password in **Settings > WebDAV** using an account with access to developer settings. The complete password appears once. Give each client its own label so you can revoke its access independently.

| Credential field | Value |
| --- | --- |
| HTTP scheme | Basic |
| Username | Your account email; the server accepts any non-empty username |
| Password | The generated WebDAV app password |
| Organization | The slug in the URL, checked against current membership |

The app password identifies the user. Neither an account password nor a REST API key is accepted. A valid password does not bypass organization membership: losing membership causes `403`. `OPTIONS` alone is available without authentication.

### Verify a listing

Set your deployment URL and email below. Each `curl --user` command prompts for the app password, keeping it out of the command itself and shell history.

```bash
export TALE_DAV_URL="https://your-host.example.com/dav/acme/documents"
export TALE_DAV_USER="you@example.com"

curl --user "$TALE_DAV_USER" --request PROPFIND \
  --header 'Depth: 1' "$TALE_DAV_URL/"
```

Expect `207 Multi-Status` with XML containing the collection and its immediate children. An empty folder still has a response for the collection itself. Do not parse the XML as JSON or treat every status inside a `207` as success.

### Verify a write and download

Choose a new folder name to avoid overwriting existing work. These commands create one folder, upload a small text file, and download it:

```bash
curl --user "$TALE_DAV_USER" --request MKCOL "$TALE_DAV_URL/Client%20test/"
printf 'Hello from WebDAV.\n' > webdav-test.txt
curl --user "$TALE_DAV_USER" --upload-file webdav-test.txt \
  --header 'Content-Type: text/plain' "$TALE_DAV_URL/Client%20test/webdav-test.txt"
curl --user "$TALE_DAV_USER" "$TALE_DAV_URL/Client%20test/webdav-test.txt"
```

Expect `201` for the new folder, `201` for the new file, and the text `Hello from WebDAV.` on download. Uploading to an existing file returns `204` and replaces its content. The file also appears in the Document Hub without a separate synchronization operation.

## Methods

All methods except `OPTIONS` require the app password.

| Method | Purpose | Successful response |
| --- | --- | --- |
| `OPTIONS` | Discover capabilities and the target's allowed methods | `200`, `DAV: 1, 2`, `Allow` |
| `PROPFIND` | Read properties; use `Depth: 0` for the target or `Depth: 1` for its immediate children | `207` XML |
| `PROPPATCH` | Submit property changes; see persistence limitations below | `207`, with a status per property |
| `GET`, `HEAD` | Download a file or read its headers | `200`; conditional and range requests can change the status |
| `PUT` | Create or replace a file | `201` new, `204` replacement |
| `DELETE` | Move documents to trash; recursively trash folder contents and remove folder rows | `204` |
| `MKCOL` | Create a folder whose parent already exists | `201` |
| `MOVE` | Rename or relocate a document or folder | `201` new destination, `204` replacement |
| `COPY` | Copy a document or folder tree on the server; file copies share stored bytes | `201` new destination, `204` replacement |
| `LOCK` | Acquire or refresh a write lock | `200`, with a lock token |
| `UNLOCK` | Release a lock owned by the requesting user | `204` |

`GET` on a folder is `405`; use `PROPFIND`. An omitted `Depth` defaults to `1`; `Depth: infinity` is `403`. `MKCOL` takes an empty body. `PUT` requires `Content-Length`: use a known-size file rather than chunked transfer.

`MOVE` and `COPY` use `Destination` and honor `Overwrite: T/F` and `If`. Keep the destination on the same host and in the same organization. A missing destination parent is `409`; `Overwrite: F` onto an existing item is `412`. Moving a document is atomic; moving a folder changes its parent. Destructive operations also respect legal holds and document record restrictions.

The `Allow` header describes the target: the documents tree advertises the methods above, a trash file advertises `OPTIONS, GET, HEAD, PROPFIND`, and the trash collection and organization root advertise `OPTIONS, PROPFIND`. Capability probes on a path that cannot yet be parsed still advertise the full method set. Windows discovery also receives `MS-Author-Via: DAV` and `Microsoft-Server-WebDAV-Extensions: 1`.

## Properties

| DAV property | Meaning |
| --- | --- |
| `resourcetype` | `<collection/>` for folders; empty for files |
| `displayname` | Folder name or document title |
| `getlastmodified` | RFC 1123 timestamp; source modification time, falling back to creation time |
| `creationdate` | Creation time in ISO 8601 |
| `getcontenttype` | File MIME type |
| `getcontentlength` | File size in bytes |
| `getetag` | The same validator returned by `GET` and `HEAD` |
| `supportedlock` | Exclusive write-lock support |
| `lockdiscovery` | Active lock information when available |

File-only properties do not apply to collections. An ETag is a quoted content hash when one exists, otherwise a weak validator based on size and modification time, such as `W/"42-1789373842855"`. Preserve the quotes and `W/` marker; do not substitute the document ID or infer byte equality from a weak validator. `GET` supports conditional requests and byte ranges.

<Warning>

Custom properties are not persisted. A `PROPPATCH` containing only dead properties reports per-property `200` for client compatibility, but a later read does not return those values. A protected live property gets `403`; dead properties in that same request get `424 Failed Dependency`. Do not use these properties to store business metadata.

</Warning>

## Lock semantics

Use an exclusive write lock and retain its `opaquelocktoken:<uuid>` token. The advertised lock support is exclusive; although the parser accepts a shared scope, the backing store permits only one live lock at a resource. Do not build a shared-editing workflow around shared locks.

| Client action | Required behavior |
| --- | --- |
| Acquire | Send `LOCK` with an XML write-lock body and `Timeout: Second-N` |
| Write while locked | Include `If: (<opaquelocktoken:...>)` |
| Refresh | Send an empty `LOCK` body with the same `If` token |
| Release | Send `UNLOCK` with `Lock-Token: <opaquelocktoken:...>` as the owning user |

Timeouts are clamped to 1–3600 seconds. Refresh before expiry if an edit takes longer. A missing token on a protected write gives `423`; a mismatched token or an unknown refresh token gives `412`. Locks can cover descendant paths, so a parent lock can block a write below it.

Locks are stored in Postgres and expire lazily. Expired rows do not protect a resource even before cleanup removes them. Revoking an app password deletes its locks immediately. This is also a recovery path for a client that disappeared while holding a lock; it disconnects every mount using that password.

## Status codes

| Status | Meaning and next action |
| --- | --- |
| `200`, `201`, `204` | Successful read, creation, or update; see the method table |
| `207` | Inspect each resource/property result in the XML envelope |
| `400` | Correct a malformed `Destination`, `If`, `Lock-Token`, or `Timeout` header |
| `401` | Supply a valid, unrevoked app password using Basic authentication |
| `403` | Check membership, read-only namespace, legal hold/record rules, depth, ownership, and destination scope |
| `404` | Check the returned `href`, organization slug, and resource existence |
| `405` | Check the target's `Allow`; folders cannot be downloaded or overwritten as files |
| `409` | Create the destination parent first |
| `411` | Send `Content-Length` for `PUT` |
| `412` | Re-read the resource or lock state; check `If`, `If-Match`, `If-None-Match`, and `Overwrite` |
| `413` | Reduce the file or XML body size, or review the operator's upload limit |
| `415` | Send an empty `MKCOL` body; extended MKCOL is unsupported |
| `423` | Obtain the matching lock token or wait for/release the lock |
| `502` | Check cross-host destinations and object-store connectivity |
| `503` | Release unused locks for this password and honor `Retry-After` |
| `507` | Split a folder-tree operation into smaller operations |

Do not retry every refusal automatically. A missing parent or an invalid credential needs a correction; a lock conflict needs coordination with the other editor.

## Compliance

The endpoint advertises `DAV: 1, 2`. Treat the methods and limitations on this page as the implementation contract; the advertisement is not a promise that every optional WebDAV feature works. In particular, dead properties do not persist and shared editing locks are not available. Calendar, contact, search, and ACL extensions are not provided.

For wire syntax, consult [RFC 4918](https://www.rfc-editor.org/rfc/rfc4918). DAV compliance class 3 is a revision-compliance category, not a name for calendar or contact extensions.

## Limits

| Boundary | Limit or behavior |
| --- | --- |
| Recursive listing | `Depth: infinity` refused; walk one level at a time |
| Lock duration | 1–3600 seconds |
| Active locks | 200 per app password |
| Upload size | 5 GB by default; `WEBDAV_MAX_PUT_BYTES` sets the byte cap |
| XML bodies | 64 KiB for `PROPFIND`, `PROPPATCH`, `MKCOL`, and `LOCK` |
| Password creation | Up to 50 active app passwords per user in an organization |
| Usage timestamp | Updated at most once per minute per password |

Uploads stream to the object store with backpressure. The server needs the length before it can create the upload request; chunked uploads receive `411`. Folder operations have bounded traversal budgets and can return `507`; splitting a large tree is preferable to repeatedly submitting the same oversized operation.

## Network requirements

The backend serves `/dav/*`; the platform proxy exposes it on the same public host as Tale. In local development, Vite forwards `/dav` from port 3000 to the backend, so clients can use the normal local application origin. There is no separate WebDAV service to deploy.

A listing can succeed while a download or upload fails: listings require the database, whereas file bytes also require a working object store. Test both paths after changing proxy or storage configuration. Keep the proxy's body cap consistent with `WEBDAV_MAX_PUT_BYTES`.

## Security

Use HTTPS for remote mounts. Basic authentication sends the app password on every request; Base64 is encoding, not encryption. Plain HTTP is suitable only for a controlled localhost test. Store credentials in the client's password prompt or operating-system keychain, never in a URL such as `https://user:password@host/`.

The backend stores HMAC-SHA256 hashes and a four-character lookup prefix, then verifies the hash in constant time. `WEBDAV_APP_PASSWORD_HMAC_KEY` is derived from `INSTANCE_SECRET` by the platform startup configuration unless explicitly set. Keep these deployment secrets stable and backed up; changing the HMAC key invalidates existing passwords.

The password list exposes its label, prefix, creation time, and last-use time. Use those to identify and revoke a lost device's credential. Last use is throttled metadata, not a complete per-request audit trail.

## Where this fits

Use [REST](/develop/api-reference) for project-scoped imports, explicit IDs, and search. Use WebDAV for Document Hub file clients that expect paths and locks. Both work with Tale documents, but WebDAV does not expose the project's file tree or every REST operation.
