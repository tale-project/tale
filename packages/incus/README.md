# @tale/incus

Typed Incus REST client over mutual TLS, with an in-memory Incus for tests. The sandbox spawner's
Incus backend talks to its node through it.

```bash
bun run --filter @tale/incus typecheck
bun run --filter @tale/incus test
```

This is a source-only library with no build step. Other workspaces import the package root,
`@tale/incus`, which exports `src/index.ts`, or one module by its subpath, so a caller loads only
what it needs: the spawner's configuration reader imports `@tale/incus/units` and never loads the
client.

| Export | What it is |
| --- | --- |
| `@tale/incus/client` | `IncusClient`: every request bounded by a timeout, the caller's cancellation and a response-size cap; reads retried on a transport failure, writes never; background operations waited for with the API's long-poll |
| `@tale/incus/exec` | Exec mode 1 (`execForCode`) and mode 2 (`execWithOutput`, record-output read with a byte cap, then deleted); stdin pushed as a 0600 file of at most 1 MiB in `/dev/shm`, never argv; the image's `timeout` wraps the command when the caller names it |
| `@tale/incus/exec-session` | Exec mode 3: a websocket session over the same pinned mutual TLS (`openExecSession`, `execOverWebSocket`), stdin of any size, ended by closing its control socket |
| `@tale/incus/files` | The instance and custom-volume file APIs with owner and mode (`readFile`, `statFile`, `writeFile`, `makeDirectory`, `deleteFile`); every write is `application/octet-stream`; no rename |
| `@tale/incus/volumes` | `renameVolume` (detached volumes only), `attachDisk`/`detachDevice` under an ETag, `getStoragePoolResources` |
| `@tale/incus/snapshots` | Volume snapshots: create, list, delete, and a copy of a snapshot into a fresh volume |
| `@tale/incus/state` | Start, stop with a grace or forced, freeze, unfreeze; an instance's state and the project's usage against its limits |
| `@tale/incus/unix-transport` | A client over the node's local Unix socket, for a single box's bootstrap only |
| `@tale/incus/api` | The API objects the client reads and writes, their parsers, `IncusApiError` and the status codes |
| `@tale/incus/tls` | `readIncusTlsMaterial`: reads the client certificate, its key and the server certificate the connection is pinned to, and refuses at once what would only fail later as a TLS error |
| `@tale/incus/units` | Sizes as Incus reads them (`4GiB`), from Incus syntax or a Docker quantity (`4g`) |
| `@tale/incus/fake` | `FakeIncus`, an in-memory Incus that answers the client without a socket and records every request; tests only |
| `@tale/incus/test-certificates` | Throwaway certificates in the shapes that matter for pinning, made in process; tests only |

## The connection

The server certificate is pinned with `tls.ca`, full verification on. Bun accepts a certificate as
its own trust anchor only when it is a CA certificate, so the node's server certificate must be
self-signed with `CA:TRUE` (Incus's default `CA:FALSE` certificate fails with
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`); `readIncusTlsMaterial` refuses that shape up front, and
verification is never turned off. A redirect is an error: the client certificate never goes where
nobody pinned.

## Cancellation

`IncusClient` takes `signal: () => AbortSignal | undefined`, read at every request: once the signal
is aborted, the call in flight ends and no further attempt starts. The spawner hands it its
operation budget (`operationSignal`); a caller with no ambient cancellation passes
`() => undefined`.

## Exec

Three modes, after what Incus 7.6 does (the real tests hold each fact):

1. **The exit code** (`execForCode`): output goes nowhere.
2. **The code and bounded output** (`execWithOutput`): `record-output` files, read under the byte
   cap and then deleted, because they may hold secrets and Incus keeps them until then.
3. **A websocket session** (`openExecSession`, `execOverWebSocket`): file descriptors 0, 1 and 2
   plus `control`, connected control first; an empty text frame ends a stream.

A record-output exec cannot be cancelled: Incus refuses a `DELETE` of its operation. So modes 1-2
take `timeoutSeconds`, which bounds the client's wait, and `timeoutCommand`, the image's `timeout`
binary, which bounds the command inside the instance. Whether an image has one is an image fact
the caller reads; nothing here assumes it. Where there is none, use the websocket session, which
ends the command by closing its control socket.

stdin never travels in argv. In modes 1-2 it is pushed as a 0600 file owned by the exec user into
`/dev/shm` (no image's `/run` is a tmpfs), at most 1 MiB; the command's own shell redirects it in
and removes it before the command starts. Larger input goes over the websocket session. A leaked
file starts with `EXEC_PAYLOAD_PREFIX`, for a reaper to find.

## Files and volumes

Every file write sends `Content-Type: application/octet-stream`: with a form content type Incus
answers 200 and writes an empty file. The volume file API has no rename, and this package offers
none; replace a file a reader may be reading by writing a new name and deleting the old one.

A volume rename moves its whole snapshot history, and is refused here while anything uses the
volume (attached to a stopped instance Incus takes about 30 s and rewrites the device; attached to
a running one it refuses): detach first. An instance `PATCH` cannot remove a device, so
`detachDevice` re-reads the instance and `PUT`s it back under the ETag the caller holds. A volume
the file API touched stays mounted for about 15 s after; `renameVolume` waits that out.

## Real tests

[`tests/real/`](tests/real/README.md) runs the client against a real Incus in a throwaway
restricted project: `TALE_INCUS_DIR=… bun run --filter @tale/incus test:real`.

## The fake

`FakeIncus` models async operations, ETag preconditions, ephemeral instances deleted on stop,
volumes in use, project limits and a restricted project that refuses what a real one refuses.
What runs inside an instance is the image's business: by default its main process boots at once
with the instance's environment, and a test describes anything else through `guest` (the sandbox
models its standby instances this way). An exec runs nothing: a test says what a command does through
`exec` (by default it exits 0 and writes nothing), after the fake took off the client's stdin-file
and `timeout` wrappers. A websocket exec is served for real by a `Bun.serve` on the loopback,
started at the first session; `close()` stops it. The file APIs keep owner and mode and write an
empty file for a body that is not octet-stream, a running console is consumed by a read, and an
exec operation cannot be cancelled, as on Incus.
