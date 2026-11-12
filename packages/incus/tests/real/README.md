# Real-Incus tests of `@tale/incus`

`real.test.ts` drives a real Incus node through the client: exec in all three modes (the exit
code, record-output, a websocket session over mutual TLS with a 16 MiB stdin), the instance and
volume file APIs with owner and mode, freeze and unfreeze, a stop, volume snapshots and the restore
aside (detach under an ETag, rename with the snapshot history, copy a snapshot into a fresh volume,
attach), log files, the console, image aliases, and the project and pool reads a restore's space
check needs.

The plain `bun run --filter @tale/incus test` skips this file. It runs only with
`TALE_INCUS_REAL=1`, and then refuses to start without `TALE_INCUS_DIR`, so a run that was asked
for never passes empty:

```bash
TALE_INCUS_DIR=/path/to/pki bun run --filter @tale/incus test:real
```

| Variable | Default | What |
| --- | --- | --- |
| `TALE_INCUS_DIR` | none (required) | `client.crt`, `client.key` and `server.crt`: a client certificate restricted to the test project, and the node's certificate it is pinned to (self-signed with `CA:TRUE`, see the package README) |
| `TALE_INCUS_ENDPOINT` | `https://127.0.0.1:8443` | the node's API |
| `TALE_INCUS_PROJECT` | `ti-03` | a throwaway restricted project |
| `TALE_INCUS_POOL` | `ti-03` | a ZFS pool the project may use |
| `TALE_INCUS_NETWORK` | `ti-03-app` | a managed bridge the project may use |
| `TALE_INCUS_PROFILE` | `tale-stack` | a profile with a root disk and the project's default limits |
| `TALE_INCUS_IMAGE_SERVER`, `TALE_INCUS_IMAGE` | `https://mirror.gcr.io`, `library/alpine:3.22` | the OCI image the test instance runs; the project's `restricted.images.servers` must name the server's host exactly as in the URL (`mirror.gcr.io`, no port) |
| `TALE_INCUS_SOCKET` | none | the node's Unix socket; set it only when running as a member of `incus-admin`, to prove the bootstrap transport |

The project is restricted the way a Tale stack project is: isolated idmaps, no nesting, no
interception, no low-level keys, managed NICs and disks only, snapshots allowed, backups blocked,
and `limits.memory`/`limits.processes` with defaults on the profile. Every object the run makes
is named `real-<run>` and is deleted at the end, the pulled image included.

What the run measured on Incus 7.6 and the client follows:

- A record-output exec cannot be cancelled (`DELETE` of its operation is refused), so modes 1-2
  rely on the image's `timeout` (exit 143 after the budget), and a websocket session ends when its
  control socket closes (exit 137).
- Record-output files are listed under `logs/exec-output` until deleted; the client deletes them.
- A volume the file API touched stays mounted for about 15 s; a rename in that window fails with
  "device or resource busy", which `renameVolume` waits out.
- An instance `PATCH` merges devices and cannot remove one, so `detachDevice` re-reads the instance
  and `PUT`s it back under its ETag.
