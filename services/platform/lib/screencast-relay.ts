// Platform-side browser→spawner screencast WebSocket relay.
//
// The full chain (Part A of the browser-observability work):
//
//   browser noVNC
//     → wss://<site>/screencast/<threadId>
//     → [THIS MODULE, hosted by server.ts]   (browser WS terminated here)
//     → ws://<sandbox>/v1/sessions/<sessionId>/screencast  (spawner WS, HMAC)
//     → [spawner screencast-relay]            (WS ↔ raw HTTP/1.1-Upgrade tunnel)
//     → runnerd raw-VNC tunnel
//     → x11vnc (:5900 raw RFB)
//
// The platform is the ONLY browser-facing WS termination. It authenticates the
// browser (cookie+org, via the `/api/sandbox/screencast-auth` Convex oracle —
// done in server.ts BEFORE the upgrade), then opens a WS *client* to the
// spawner and relays raw binary frames in both directions. Both legs carry raw
// RFB bytes (websockify framing); this is a byte-faithful binary WS↔WS relay —
// no re-encoding (RFB is binary; any reframing would corrupt the protocol).
//
// Auth to the spawner reproduces session_client.ts's HMAC contract exactly:
//   signedString = `${METHOD}\n${path}\n${timestamp}\n${nonce}\n${sha256Hex(body)}`
//   signature    = HMAC-SHA256(SANDBOX_TOKEN, signedString)
// on a GET to `/v1/sessions/<sessionId>/screencast` with an EMPTY body (the GET
// has no body, so sha256('')). Headers: x-tale-sandbox-signature +
// x-tale-sandbox-timestamp + x-tale-sandbox-nonce (a fresh per-request nonce so
// repeated handshakes don't collide in the spawner's replay cache). The
// spawner's `authorize()` verifies over `pathname + search`; this path has no
// query, so signing the bare path is identical. When SANDBOX_TOKEN is unset we
// send no signature (dev mode, matching the spawner's opt-in HMAC verification).

import { createHash, createHmac, randomUUID } from 'node:crypto';

const SIGNATURE_HEADER = 'x-tale-sandbox-signature';
const TIMESTAMP_HEADER = 'x-tale-sandbox-timestamp';
const NONCE_HEADER = 'x-tale-sandbox-nonce';

/**
 * Reproduce session_client.ts `signRequest`: HMAC-SHA256 over
 * `${METHOD}\n${path}\n${timestamp}\n${nonce}\n${sha256Hex(body)}`. The nonce
 * binds a per-request random value so this empty-body GET can't false-positive
 * against the spawner's replay cache. Exported for the unit test that pins
 * byte-for-byte parity with the spawner's `sign()`.
 */
export function signScreencastRequest(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  body: string,
  token: string,
): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const signedString = `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
  return createHmac('sha256', token).update(signedString).digest('hex');
}

/**
 * Build the HMAC headers for a GET to the spawner's screencast route with an
 * EMPTY body. When `token` is null (SANDBOX_TOKEN unset) returns `{}` — the
 * spawner skips HMAC verification in that dev mode. The timestamp is bound into
 * the signature and must be sent so the spawner can verify + bound the replay
 * window (30s tolerance), so it's computed here at handshake time.
 */
export function buildScreencastAuthHeaders(
  path: string,
  token: string | null,
): Record<string, string> {
  if (token === null) return {};
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  return {
    [SIGNATURE_HEADER]: signScreencastRequest(
      'GET',
      path,
      timestamp,
      nonce,
      '',
      token,
    ),
    [TIMESTAMP_HEADER]: timestamp,
    [NONCE_HEADER]: nonce,
  };
}

/** Trim so a whitespace-only token is treated as unset — must match the
 * spawner (config.ts) + session_client trim, or a padded token would derive a
 * different HMAC key on each side. */
export function resolveSandboxToken(): string | null {
  const token = process.env.SANDBOX_TOKEN?.trim();
  return token && token.length > 0 ? token : null;
}

/**
 * Convert the `http(s)://host:port` SANDBOX_URL into the `ws(s)://` base for the
 * spawner WS client. Defaults to the compose service name when unset (parity
 * with session_client.ts `getSpawnerUrl`).
 */
export function spawnerScreencastUrl(
  sessionId: string,
  control = false,
): string {
  const base = process.env.SANDBOX_URL ?? 'http://localhost:8003';
  // Swap only the scheme; host:port + everything else is preserved. http→ws,
  // https→wss. Falls back to a string replace if the URL doesn't parse.
  let wsBase: string;
  try {
    const u = new URL(base);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    wsBase = u.toString().replace(/\/$/, '');
  } catch {
    wsBase = base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  }
  return `${wsBase}${spawnerScreencastPath(sessionId, control)}`;
}

/** The signed spawner path. A control connection carries `?control=1`; the
 * spawner verifies the HMAC over `pathname + search`, so the query MUST be part
 * of the signed path (and the URL above) or the upgrade is rejected. */
export function spawnerScreencastPath(
  sessionId: string,
  control = false,
): string {
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}/screencast`;
  return control ? `${path}?control=1` : path;
}

/**
 * Soft cap on bytes buffered toward a slow browser viewer. The high-volume leg
 * is spawner→browser (framebuffer updates). A Bun WS *client* can't be cleanly
 * paused mid-stream, and the spawner already pauses its own tunnel reads on its
 * bufferedAmount, but that backpressure only propagates back to x11vnc when the
 * platform→spawner socket also fills — which won't happen if the browser leg is
 * the bottleneck. So rather than buffer unbounded toward a hopelessly-slow
 * viewer, we drop it: once the browser ws.getBufferedAmount() exceeds this, we
 * close with 1011. 8 MiB is generous for a momentary GC/scroll stall yet bounds
 * a wedged viewer's memory; it sits under Bun's 16 MB server-WS backpressure
 * limit so we decide to drop before Bun force-closes us anyway.
 */
const BROWSER_BACKPRESSURE_DROP_BYTES = 8 * 1024 * 1024; // 8 MiB

/** Data attached to the upgraded browser WS at `server.upgrade(req, { data })`. */
export interface ScreencastWsData {
  sessionId: string;
  threadId: string;
  /** The oracle granted a WRITABLE control connection (human takeover). When
   * true the spawner leg carries `?control=1` (signed into the HMAC) so runnerd
   * dials the writable x11vnc; otherwise this is a read-only mirror. */
  control: boolean;
}

/** Per-connection relay state, hung off the browser WS in a side-map so
 * ScreencastWsData stays a plain serializable shape. */
interface RelayState {
  /** WS client to the spawner. */
  spawner: WebSocket | null;
  /** Bytes the browser sent before the spawner WS finished connecting (rare —
   * the RFB server speaks first, so the browser stays silent until after the
   * handshake). Flushed on spawner `open`. */
  pendingFromBrowser: ArrayBuffer[];
  /** Guards teardown so each side is torn down exactly once. */
  closed: boolean;
}

/** Normalize a WS frame payload to a plain `ArrayBuffer` for byte-faithful
 * relay. Bun delivers binary as ArrayBuffer (binaryType='arraybuffer'); a stray
 * text frame is forwarded as its UTF-8 bytes (RFB will reject it — harmless).
 * Returns a fresh, non-shared `ArrayBuffer` so it satisfies both the DOM-typed
 * `WebSocket.send` and Bun's `sendBinary` (`BufferSource`) without any
 * `SharedArrayBuffer` ambiguity. */
function toArrayBuffer(data: unknown): ArrayBuffer | null {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return copy.buffer;
  }
  if (typeof data === 'string') {
    const copy = new TextEncoder().encode(data);
    // .buffer is exactly the encoded bytes (no slack), so no slice needed.
    return copy.buffer;
  }
  return null;
}

/**
 * Open the spawner WS client with HMAC headers on the upgrade GET.
 *
 * Bun's WebSocket client honors the `headers` option (verified empirically and
 * against bun-types 1.3.x: `Bun.WebSocketOptions` includes
 * `headers?: OutgoingHttpHeaders`). The platform tsconfig loads the DOM lib, so
 * the GLOBAL `WebSocket` type resolves to lib.dom's constructor —
 * `(url, protocols?: string | string[])`, with no `headers` option — even
 * though the Bun runtime accepts it. We narrow the construct call through a
 * Bun-typed constructor signature so the option is type-checked against the
 * real Bun shape rather than silently cast away. The spawner's `authorize()`
 * reads the signature from request headers (not query), so this header path is
 * exactly what gates the upgrade.
 */
function openSpawnerSocket(
  url: string,
  headers: Record<string, string>,
): WebSocket {
  // The DOM-typed global constructor has no `headers` option, but the Bun
  // runtime does (Bun.WebSocketOptions). Re-type the constructor to the real
  // Bun signature so the option is checked against `Bun.WebSocketOptions`
  // rather than silently dropped — the assertion is the unavoidable bridge
  // between the lib.dom type and the actual runtime.
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const BunWebSocket = WebSocket as unknown as new (
    url: string,
    options: Bun.WebSocketOptions,
  ) => WebSocket;
  return new BunWebSocket(url, { headers });
}

/**
 * Build the Bun WebSocket *server* handler for the browser-facing screencast
 * WS. Each browser connection opens a matching WS *client* to the spawner and
 * relays raw binary frames in both directions. The sessionId was resolved +
 * authorized in server.ts before the upgrade and is carried on `ws.data`.
 */
export function createScreencastRelayHandler(): import('bun').WebSocketHandler<ScreencastWsData> {
  const relays = new WeakMap<object, RelayState>();

  const teardown = (
    ws: import('bun').ServerWebSocket<ScreencastWsData>,
    state: RelayState,
    wsCloseCode?: number,
    wsCloseReason?: string,
  ): void => {
    if (state.closed) return;
    state.closed = true;
    if (state.spawner) {
      try {
        state.spawner.close();
      } catch (err) {
        console.warn('[platform.screencast] spawner ws close failed:', err);
      }
      state.spawner = null;
    }
    if (wsCloseCode !== undefined) {
      try {
        ws.close(wsCloseCode, wsCloseReason);
      } catch (err) {
        console.warn('[platform.screencast] browser ws close failed:', err);
      }
    }
  };

  return {
    // Raw RFB is already binary; never compress (compression would also break
    // the byte-identical forwarding contract). The global Caddy
    // `-Sec-WebSocket-Extensions` strips permessage-deflate on the browser leg
    // too, but this disables it on the server side regardless.
    perMessageDeflate: false,
    // ws.data type carrier (Bun TS workaround) — never read at runtime; the
    // real data is supplied per-connection by server.upgrade(req, { data }).
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    data: undefined,

    open(ws): void {
      const { sessionId, control } = ws.data;
      const state: RelayState = {
        spawner: null,
        pendingFromBrowser: [],
        closed: false,
      };
      relays.set(ws, state);

      const url = spawnerScreencastUrl(sessionId, control);
      const path = spawnerScreencastPath(sessionId, control);
      const headers = buildScreencastAuthHeaders(path, resolveSandboxToken());

      let spawner: WebSocket;
      try {
        spawner = openSpawnerSocket(url, headers);
      } catch (err) {
        console.warn(
          '[platform.screencast] spawner WebSocket construct failed:',
          err,
        );
        teardown(ws, state, 1011, 'spawner connect failed');
        return;
      }
      // Binary both ways — ArrayBuffer is the most direct shape for relaying.
      spawner.binaryType = 'arraybuffer';
      state.spawner = spawner;

      spawner.addEventListener('open', () => {
        if (state.closed) return;
        // Flush anything the browser queued before the spawner connected.
        for (const buf of state.pendingFromBrowser) {
          try {
            spawner.send(buf);
          } catch (err) {
            console.warn('[platform.screencast] spawner flush failed:', err);
          }
        }
        state.pendingFromBrowser = [];
      });

      spawner.addEventListener('message', (ev) => {
        if (state.closed) return;
        const buf = toArrayBuffer(ev.data);
        if (buf === null) return;
        // Drop a hopelessly-slow viewer rather than buffer unbounded: a Bun WS
        // client can't be cleanly paused, and spawner-side tunnel backpressure
        // can't relieve a browser-leg bottleneck.
        if (ws.getBufferedAmount() > BROWSER_BACKPRESSURE_DROP_BYTES) {
          console.warn(
            '[platform.screencast] browser viewer too slow; dropping connection',
            { sessionId, buffered: ws.getBufferedAmount() },
          );
          teardown(ws, state, 1011, 'viewer too slow');
          return;
        }
        ws.sendBinary(buf);
      });

      spawner.addEventListener('close', () => {
        // Spawner leg gone → close the browser WS.
        teardown(ws, state, 1011, 'spawner closed');
      });

      spawner.addEventListener('error', (err) => {
        console.warn('[platform.screencast] spawner ws error:', err);
        teardown(ws, state, 1011, 'spawner error');
      });
    },

    message(ws, message): void {
      const state = relays.get(ws);
      if (!state || state.closed) return;
      const buf = toArrayBuffer(message);
      if (buf === null) return;
      const spawner = state.spawner;
      // RFB client input (mouse/keyboard) is tiny + bounded, so no backpressure
      // handling is needed in this direction.
      if (spawner && spawner.readyState === WebSocket.OPEN) {
        try {
          spawner.send(buf);
        } catch (err) {
          console.warn(
            '[platform.screencast] browser→spawner send failed:',
            err,
          );
        }
        return;
      }
      // Spawner not connected yet: buffer (the RFB server speaks first, so this
      // is rare). The browser leg's own backpressure bounds total RAM.
      state.pendingFromBrowser.push(buf);
    },

    close(ws): void {
      const state = relays.get(ws);
      if (!state) return;
      // Browser WS gone → tear the spawner leg down (no WS close — it's already
      // closing).
      teardown(ws, state);
      relays.delete(ws);
    },
  };
}
