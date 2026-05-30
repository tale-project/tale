# WebDAV smoke matrix

Manual end-to-end checks for the WebDAV path. Run these after `bun install`,
with the platform stack up. Each command exercises one verb against the
running server.

## 0. Prereqs

Both `ADMIN_KEY` and `WEBDAV_APP_PASSWORD_HMAC_KEY` are derived deterministically
from `INSTANCE_SECRET` — operators don't need to mint them manually. In prod,
`docker-entrypoint.sh` exports both before `bun server.ts` starts. In dev,
`bun server.ts` derives the HMAC key from `INSTANCE_SECRET` at boot when
not explicitly set.

Operators who want an HMAC rotation independent of `INSTANCE_SECRET` can
set `WEBDAV_APP_PASSWORD_HMAC_KEY=$(openssl rand -hex 32)` in `.env`; an
explicit value always wins over the derived one.

```bash
cd services/platform
# Ensure INSTANCE_SECRET is set in .env.local (64-char hex). Then:
bun dev   # the Vite plugin mirrors /dav/* in dev.
```

Then generate an app-password through the UI (Settings > WebDAV) and copy
the plaintext. The vars below assume:

```bash
ORIGIN=http://localhost:3000          # bun dev
ORG=myorg                              # your org slug
USER=user@example.com                  # your account email
PASS='paste-app-password-here'
AUTH=$(printf '%s:%s' "$USER" "$PASS" | base64)
```

## 1. OPTIONS — capability probe (anon)

```bash
curl -i -X OPTIONS "$ORIGIN/dav/$ORG/documents/"
# Expect: 200, DAV: 1, 2 header, Allow: OPTIONS, GET, HEAD, PROPFIND, ...
```

## 2. PROPFIND — list root collection, Depth 1

```bash
curl -i -H "Authorization: Basic $AUTH" -H 'Depth: 1' \
  -X PROPFIND "$ORIGIN/dav/$ORG/documents/"
# Expect: 207 Multi-Status, XML with <D:response> for each child.
```

## 3. PROPFIND — Depth: infinity rejection

```bash
curl -i -H "Authorization: Basic $AUTH" -H 'Depth: infinity' \
  -X PROPFIND "$ORIGIN/dav/$ORG/documents/"
# Expect: 403, <D:error><D:propfind-finite-depth/>
```

## 4. PUT — create a document

```bash
echo "smoke-test" > /tmp/smoke.txt
curl -i -H "Authorization: Basic $AUTH" -H 'Content-Type: text/plain' \
  -T /tmp/smoke.txt "$ORIGIN/dav/$ORG/documents/smoke.txt"
# Expect: 201 Created.
```

## 5. GET — read it back

```bash
curl -i -H "Authorization: Basic $AUTH" "$ORIGIN/dav/$ORG/documents/smoke.txt"
# Expect: 200, body "smoke-test", Content-Type: text/plain, ETag set.
```

## 6. PROPFIND — verify it appears

```bash
curl -s -H "Authorization: Basic $AUTH" -H 'Depth: 1' \
  -X PROPFIND "$ORIGIN/dav/$ORG/documents/" | grep -A1 smoke.txt
# Expect: <D:href>/dav/myorg/documents/smoke.txt</D:href>
```

## 7. MKCOL — create a folder

```bash
curl -i -H "Authorization: Basic $AUTH" \
  -X MKCOL "$ORIGIN/dav/$ORG/documents/smoke-folder/"
# Expect: 201 Created.
```

## 8. MOVE — relocate

```bash
curl -i -H "Authorization: Basic $AUTH" \
  -H "Destination: $ORIGIN/dav/$ORG/documents/smoke-folder/moved.txt" \
  -X MOVE "$ORIGIN/dav/$ORG/documents/smoke.txt"
# Expect: 201 Created (new destination).
```

## 9. COPY — duplicate

```bash
curl -i -H "Authorization: Basic $AUTH" \
  -H "Destination: $ORIGIN/dav/$ORG/documents/smoke-folder/copy.txt" \
  -X COPY "$ORIGIN/dav/$ORG/documents/smoke-folder/moved.txt"
# Expect: 201 Created.
```

## 10. LOCK — acquire an exclusive write lock

```bash
LOCK_BODY='<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner>smoke-test</D:owner></D:lockinfo>'
curl -i -H "Authorization: Basic $AUTH" -H 'Timeout: Second-600' \
  --data "$LOCK_BODY" \
  -X LOCK "$ORIGIN/dav/$ORG/documents/smoke-folder/moved.txt"
# Expect: 200, Lock-Token: <opaquelocktoken:UUID>
# Save the UUID for the next two steps.
TOKEN=<paste-uuid>
```

## 11. PUT against the locked path — expect 423

```bash
echo "should fail" > /tmp/fail.txt
curl -i -H "Authorization: Basic $AUTH" -T /tmp/fail.txt \
  "$ORIGIN/dav/$ORG/documents/smoke-folder/moved.txt"
# Expect: 423 Locked
```

## 12. PUT with matching If: — succeeds

```bash
curl -i -H "Authorization: Basic $AUTH" \
  -H "If: (<opaquelocktoken:$TOKEN>)" -T /tmp/fail.txt \
  "$ORIGIN/dav/$ORG/documents/smoke-folder/moved.txt"
# Expect: 204 No Content (overwrite).
```

## 13. UNLOCK

```bash
curl -i -H "Authorization: Basic $AUTH" \
  -H "Lock-Token: <opaquelocktoken:$TOKEN>" \
  -X UNLOCK "$ORIGIN/dav/$ORG/documents/smoke-folder/moved.txt"
# Expect: 204 No Content.
```

## 14. DELETE the folder — cascade

```bash
curl -i -H "Authorization: Basic $AUTH" \
  -X DELETE "$ORIGIN/dav/$ORG/documents/smoke-folder/"
# Expect: 204; documents inside go to lifecycleStatus = "trashed".
```

## 15. PROPFIND .trash — verify soft-deleted resources appear

```bash
curl -i -H "Authorization: Basic $AUTH" -H 'Depth: 1' \
  -X PROPFIND "$ORIGIN/dav/$ORG/.trash/"
# Expect: 207, response includes moved.txt + copy.txt (trashed).
```

## 16. PUT into .trash — rejected

```bash
curl -i -H "Authorization: Basic $AUTH" -T /tmp/smoke.txt \
  "$ORIGIN/dav/$ORG/.trash/new.txt"
# Expect: 403 Forbidden (trash is read-only).
```

## Real-client matrix

After the curl matrix passes, connect a real client:

- **macOS Finder**: ⌘K → `$ORIGIN/dav/$ORG/documents/` → mount, browse, drag in, drag out.
- **Windows 11 Explorer**: Map network drive → same URL → upload < 50 MB file.
- **iOS Files**: Connect to Server → browse + download.
- **rclone**: `rclone config create tale webdav vendor=other url=... user=... pass=$(rclone obscure '...')` → `rclone copy ./folder tale:`.

After each pass: confirm uploaded files appear in the Document Hub UI with
`sourceProvider: 'webdav'` and that RAG indexing reaches `completed`.
