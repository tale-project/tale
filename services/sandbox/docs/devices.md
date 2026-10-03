# Sandbox devices

A **device** is a machine an organization connected (Settings → Sandboxes →
Add device → `tale sandbox connect`) so its sandboxes run there instead of on
the deployment's host. It runs this same image in **device mode**; the
deployment's spawner runs the **hub** that devices dial into. Sessions keep
the one contract of [sessions.md](sessions.md): the platform calls the
deployment's spawner exactly as before, and the hub decides whether a call is
served locally or forwarded to a device.

```
platform ──signed API──▶ spawner (hub) ◀══ WebSocket /sandbox/tunnel ══ device spawner ──▶ session containers
                            │  relays ▲                                    ▲ relay listeners
                            ▼         └──── backend-api / llm-gateway ─────┘ (sessions' calls)
                     backend-api, sandbox-llm-gateway
```

The device dials out over HTTPS, so it works behind NAT with nothing
listening. Code: `src/devices/` (hub, device agent, tunnel, tickets,
placements, relay policy, device stack).

## Hub

The hub runs inside the spawner when `SANDBOX_HUB_PORT` is set (compose and
the CLI's generator set `8004`; `0` or unset turns it off). It needs the
Docker backend: placements live on the spawner's disk and a tunnel lands on
one process, which holds across neither Kubernetes replicas nor a device.

| Variable                       | Default                                                              | Meaning                                                                                                                                          |
| ------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SANDBOX_HUB_PORT`             | `0` (off)                                                            | Port of the tunnel door. Only `GET /health` and the WebSocket upgrade at `/sandbox/tunnel` answer there; the signed API stays on `SANDBOX_PORT`. |
| `SANDBOX_HUB_STATE_DIR`        | `<dirname(SANDBOX_HOST_SESSION_ROOT)>/hub`                           | Where `placements.json` lives (`/var/lib/tale-sandbox/hub`, inside the host bind mount, so it survives redeploys).                               |
| `SANDBOX_HUB_API_UPSTREAM`     | `SANDBOX_HTTP_API_BASE_URL`, else `http://backend-api:3005`          | Where the `api` relay goes.                                                                                                                      |
| `SANDBOX_HUB_GATEWAY_UPSTREAM` | `EXTERNAL_AGENT_GATEWAY_URL`, else `http://sandbox-llm-gateway:8080` | Where the `gateway` relay goes.                                                                                                                  |

The proxy publishes the door at `<site>/sandbox/tunnel` (`services/proxy/Caddyfile`,
`SANDBOX_HUB_UPSTREAM`); the operator-facing settings are in the
[environment reference](../../../docs/en/self-hosted/configuration/environment-reference.md#sandbox-devices).

### Signed API additions

- `POST /v1/sessions` takes an optional `placement`: `'device'` lets a NEW
  session start on one of the organization's devices; `'server'` (render
  sessions) or no hint keeps it local.
- `GET /v1/limits?organizationId=` adds `deviceSessions`: the slots the
  organization's connected, release-compatible devices offer. The platform's
  quota ceiling is `maxSessions + deviceSessions`.
- `GET /v1/capacity?organizationId=` adds `placements` (session → device) and
  reports device sessions in `runtimeSessions` with their `deviceId`.
- `GET /v1/devices?organizationId=` — `{hub, devices[]}`: the connected
  devices with release, compatibility, slots, running counts, resources,
  platform and update state.
- `POST /v1/devices/:id/disconnect` — the organization removed the device:
  close its tunnel (4003), forget its placements and refuse its still-valid
  tickets (for as long as any could live). The platform repeats the call
  from its sandbox watchdog until it succeeds, so a spawner that was down at
  removal time still lets go.

### Placement

- A create with `placement: 'device'` goes to the organization's
  release-compatible device with the most free slots. A device that answers
  429 or a 5xx created nothing usable (a spawner rolls a failed create
  back), and one that drops before answering is treated the same: the
  placement is released and the next device tried, then the local backend. A
  device that failed a create outright sits out new ones for a minute. A
  session id the server already holds is never moved.
- A create the platform abandons (its timeout, a restarting worker) keeps its
  placement and is tried nowhere else: the device may still finish it, and a
  retried create for the id lands on that copy.
- A create for an id placed in another organization is refused with 403
  `placement_conflict` — never 409, which the platform reads as "it exists,
  acquire it".
- Placements are **sticky** and persisted (`placements.json`, serialized
  atomic writes; a corrupt file is moved aside as `.corrupt-<ts>`). Every
  later call for the session goes to its device.
- A device that is not connected answers **503 `{"error":"device_offline"}`**
  with `x-tale-sandbox-device: <id>`, never a 404 — the platform reads 404 as
  "gone" and would create a fresh workspace elsewhere. The platform surfaces
  this as `SandboxDeviceOfflineError`.
- A destroy whose answer confirms the workspace's bytes are gone
  (`deletion: done`, not `busy`) forgets the placement — unless a create for
  the same id was forwarded while it ran (the next turn), which made the
  session anew there. Any other answer — the device still deleting
  (`pending`, `failed`), or a device older than the `deletion` contract, whose
  answer says nothing about the bytes — keeps the placement, marked deleting
  in `placements.json`: no session lives there (the capacity overlay leaves it
  out), but the platform's next destroy of the id, an erasure's Retry
  included, still reaches the device that holds them. A fresh create under the
  id goes back to that device while it is connected with room, and is placed
  anew otherwise, letting go of that route.
- Only placements the hub made route anywhere: a device's report of what it
  holds never claims a session id (another organization's included), and the
  capacity overlay only shows reported sessions the hub placed there. If the
  placement file is lost, those sessions' next calls reach the local backend,
  which answers 404, and the platform starts them afresh.
- A device offers at most 256 sandboxes (`maxSessions`): the number raises its
  organization's quota ceiling, so the hub refuses a HELLO or STATUS claiming
  more.
- A device on another release than the hub (both being releases; `dev` builds
  are always compatible) takes no new sessions and adds no slots until it
  updates. Its existing sessions keep being served.

## Tickets

The platform mints a connect ticket for a device secret
(`POST /api/sandbox-devices/ticket`); the hub verifies it offline with the
shared `SANDBOX_TOKEN`:

```
tdt1.<base64url(JSON {d: deviceId, o: organizationId, i: issuedAtMs, e: expiresAtMs})>.<hex HMAC-SHA256(SANDBOX_TOKEN, "device-ticket-v1:" + <base64url part>)>
```

Tickets live 15 minutes (the hub refuses more than an hour). The device
renews every 5 minutes in-band (`RENEW` with a freshly minted ticket); the
hub closes a tunnel whose ticket expired (4008) or that stayed silent for
three status intervals. A removed device gets no new ticket, so it is cut off
within one ticket lifetime even if the disconnect call never reached the
hub. `src/devices/ticket.test.ts` and the platform's `ticket.test.ts` pin the
same vector.

## Tunnel protocol

HTTP exchanges multiplexed over one WebSocket (binary frames,
`maxPayload` 1 MiB). Frame: `[u8 type][u32 BE stream id][payload]`.

| Type   | Frame        | Direction    | Payload                                                                 |
| ------ | ------------ | ------------ | ----------------------------------------------------------------------- |
| `0x01` | `HELLO`      | device → hub | protocol, release, slots, platform, held sessions, update state         |
| `0x02` | `WELCOME`    | hub → device | protocol, hub release, ids, `statusIntervalMs`                          |
| `0x03` | `STATUS`     | device → hub | slots, running/starting, sessions, resources, update state (every 15 s) |
| `0x04` | `RENEW`      | device → hub | `{ticket}`                                                              |
| `0x06` | `STATUS_ACK` | hub → device | `{}` — keeps the device's silence watchdog fed                          |
| `0x10` | `OPEN`       | initiator    | request head (JSON: method, path, headers, relay)                       |
| `0x11` | `HEAD`       | responder    | response head (JSON: status, headers)                                   |
| `0x12` | `DATA`       | both         | body bytes, at most 64 KiB                                              |
| `0x13` | `END`        | both         | end of that direction's body                                            |
| `0x14` | `RESET`      | both         | `{code, message}` — aborts the exchange                                 |
| `0x15` | `WINDOW`     | both         | credit: u32 BE bytes                                                    |

Control frames use stream 0 and carry JSON; HELLO comes once per connection.
Hub-opened streams have odd ids, device-opened streams even ids. `DATA` is
flow-controlled per stream and direction: a 256 KiB credit window the
receiver replenishes as its consumer reads, so a slow reader backs pressure up
to the producer. A responder that has sent its whole answer while the
request body is still arriving resets the stream: the handler is done with
the body, and a requester blocked on credit would otherwise hold the stream
on both sides. Close codes: 4001 replaced by a newer connection of the same
device, 4003 revoked, 4008 ticket expired, 4400 protocol error, 1001 hub
shutting down, 1011 a frame could not be sent (the socket is closed with
it).

## Relays

Sessions on a device call the same addresses as sessions on the server
(`backend-api:3005`, `sandbox-llm-gateway:8080`, `llm-gateway:8080`). The
device's spawner answers them on the device network (network aliases of the
device container) and relays each call through the tunnel; the hub forwards
it upstream only along the allowlist (`src/devices/relay-policy.ts`):

| Relay     | Paths                                                   |
| --------- | ------------------------------------------------------- |
| `api`     | `/api/tools…`, `/api/connectors…`, `/api/sandbox-blob…` |
| `gateway` | `/openai/…`, `/anthropic/…`, `/genai/…`                 |

The path must already be canonical: anything a URL parser or the upstream's
router would rewrite — control characters (a parser silently drops them, so
`/.<TAB>./` would become `/../` after a naive check), dot segments, a second
leading slash, backslashes, a fragment, escapes that decode to a separator —
is refused rather than normalized, and the hub sends upstream exactly the
path it judged. Only ordinary methods pass (`GET`, `HEAD`, `POST`, `PUT`,
`PATCH`, `DELETE`, `OPTIONS`). Hop-by-hop and `x-tale-sandbox-*` headers are
dropped both ways, and a relayed request never carries cookies or a claim
about the client address (`Forwarded`, `X-Forwarded-*`, `X-Real-IP`, …),
which the backend trusts from private networks. The gateway's management API
is never reachable. The session's own credentials (scoped tokens, the gateway
key) authenticate the call upstream exactly as on the server. The hub relays
the upstream's bytes as sent (no decompression, so a `content-encoding`
stays true) and never reuses a connection a streamed body may have left
half-written.

The addresses come with the join; `GET /api/sandbox-devices/self` returns the
current ones, and `tale sandbox update` lays them out when the operator
changed `SANDBOX_HTTP_API_BASE_URL` or `EXTERNAL_AGENT_GATEWAY_URL`.

## Device mode

`SANDBOX_DEVICE_CONFIG=<path>` switches the spawner into device mode: it
reads the config `tale sandbox connect` wrote (`src/devices/device-config.ts`
parses the shape the CLI writes; both suites pin one example), binds its own
API to `127.0.0.1` (the platform never calls a device directly), runs as
instance `device`, starts the relay listeners and keeps the tunnel up with
jittered backoff (1 s → 60 s); an upgrade nobody answers within 30 s is given
up on and dialled again. A 401 answer carrying `DEVICE_REVOKED` (the
organization removed the device) closes the tunnel and leaves only an hourly
re-check; any other failure is retried (a missing credential is
`DEVICE_CREDENTIAL_MISSING`, not a removal). When Docker does not answer an
observation, the device reports the last one that worked rather than
falling silent, so a busy daemon never costs the tunnel.

The stack (`src/devices/apply.ts`, run as `device-apply <config> --version
<release>` from the image, by the CLI and by the updater alike):

| Resource              | Role                                                                               |
| --------------------- | ---------------------------------------------------------------------------------- |
| `tale-device-net`     | Internal network: session containers, egress, the device spawner.                  |
| `tale-device-uplink`  | The egress proxy's and the spawner's way out.                                      |
| `tale-device-egress`  | Egress proxy (`sandbox-egress` alias); blocks private addresses like the server's. |
| `tale-device-sandbox` | The device spawner (this image in device mode), with the relay aliases.            |
| `tale-device-updater` | One-shot updater container (below).                                                |

Containers run `--restart unless-stopped`; each carries a `tale.device-spec`
hash of its arguments (the relay addresses included), aliases and image
content ids, so re-applying the same release is a no-op and a rebuilt tag or
a changed address is picked up. State lives in the config's directory
(`~/.tale/sandbox`, mounted 1:1): `sessions/`, `state.json` (release laid
out) and `update-status.json` — both readable by the machine's user, who
runs `tale sandbox status`.

**Updates.** Each ticket answer names the server's release. When both sides
are releases and differ, and the config allows automatic updates, the device
starts `tale-device-updater` from the NEW release's image, which pulls it and
re-applies the stack (replacing the device spawner that launched it) and
records the outcome in `update-status.json`. When the new release cannot be
laid out, the updater puts the previous one back from the images still on
the machine, so a failed update never leaves the device without a spawner.
A failed attempt is retried after 30 minutes; the platform shows it as
**Update failed**. An update still "updating" after 30 minutes counts as
failed, and one whose target is the release running counts as done (its
helper may have died before saying so).

## Instance scoping

`SANDBOX_INSTANCE` labels every session container
(`tale.sandbox-instance`); session inventory, capacity, adoption and reaping
only see their own instance. A device (instance `device`) on the same Docker
daemon as a deployment never counts or reaps the deployment's sessions, and
the reverse. Empty (the default) keeps the pre-existing unlabelled behaviour for a
deployment's spawner.
