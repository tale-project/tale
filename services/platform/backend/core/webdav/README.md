# WebDAV compatibility helpers

[`helpers.ts`](helpers.ts) contains path helpers shared with Tale’s WebDAV
implementation. The active SQL handlers live in
[`backend/domains/webdav/handlers.ts`](../../domains/webdav/handlers.ts); the
protocol implementation lives in [`lib/webdav/`](../../../lib/webdav/).

## Locate the authorization boundary

The [WebDAV routes](../../domains/webdav/routes.ts) mount the protocol at `/dav`.
The protocol layer validates HTTP Basic credentials using a Tale app password,
then passes the authenticated user and organization to the storage handlers.
An internal handler name is not a public endpoint: callers must establish that
identity before invoking it.

App-password creation, listing and revocation use the signed-in settings
surface. Creation returns the secret once; listing returns metadata. Keep
password ownership checks separate from the document-operation permissions.

## Preserve document scope

WebDAV exposes the organization’s knowledge hub. Project documents and project
folders must not appear in listings, path resolution, or name-collision checks.
A same-named project resource must not block creation of an independent hub
resource. Project files remain available through the authorized project APIs.

The SQL handlers also own legal-hold and controlled-record checks, lock behavior,
bounded tree walks, and blob/indexing updates. Review those consequences for
`PUT`, `DELETE`, `MOVE` and `COPY`; changing a path helper must not bypass them.

## Configure and test

`WEBDAV_APP_PASSWORD_HMAC_KEY` is a 32-byte hex key. Normal startup derives it
from `INSTANCE_SECRET`; an explicit environment value overrides that derivation.
Changing the effective HMAC key invalidates existing app passwords, so coordinate
rotation with users and retain deployment secrets during restores.

Use the [WebDAV API guide](../../../../../docs/en/develop/webdav-api.md) for
client requests and expected statuses. Run the platform tests and the backend’s
real-Postgres integration suite for storage or authorization changes; see the
[backend README](../../README.md). The adjacent historical smoke notes are not
a replacement for the current API contract.
