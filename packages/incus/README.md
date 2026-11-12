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

## The fake

`FakeIncus` models async operations, ETag preconditions, ephemeral instances deleted on stop,
volumes in use, project limits and a restricted project that refuses what a real one refuses.
What runs inside an instance is the image's business: by default its main process boots at once
with the instance's environment, and a test describes anything else through `guest` (the sandbox
models its standby instances this way).
