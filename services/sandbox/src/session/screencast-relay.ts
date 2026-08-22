// WebSocket ↔ raw-tunnel bridge for the read-only live browser view.
//
// The chain (Part A of the browser-observability work):
//
//   x11vnc(:5900 raw RFB)
//     ← runnerd raw HTTP/1.1-Upgrade tunnel  (GET /screencast on runnerd :8200)
//     ← [THIS MODULE: spawner WS↔tunnel bridge]
//     ← WebSocket  (platform connects as a WS client)
//     ← platform
//
// Only runnerd can reach x11vnc's container-loopback :5900, so the spawner is
// the bridge: it terminates the browser-facing WebSocket and, per connection,
// opens a raw TCP socket to runnerd and speaks the HTTP/1.1 Upgrade handshake
// (`Upgrade: tale-vnc`). After runnerd answers `101`, every byte is forwarded
// verbatim in BOTH directions — binary WS frames carry raw RFB (websockify
// framing), so there is deliberately no re-encoding (RFB is not text and any
// framing/merging would corrupt the protocol).
//
// Backpressure: Bun's TCP `Socket` exposes pause()/resume(), and the WS exposes
// getBufferedAmount() + a `drain` callback. tunnel→ws is the high-volume leg
// (framebuffer updates), so we pause the tunnel reads when the WS buffer is
// high and resume on `drain`. ws→tunnel is bounded by RFB client input (mouse/
// keyboard — tiny), so it needs no special handling.

import { RUNNERD_TOKEN_HEADER } from './runnerd-protocol.ts';

/** Where + how to reach a session's runnerd, resolved by the route layer. */
export interface ScreencastTarget {
  hostname: string;
  port: number;
  /** Per-session runnerd token, or '' in unsigned dev mode. */
  token: string;
}

/** Attached to the upgraded WebSocket via `server.upgrade(req, { data })`. */
export interface ScreencastWsData {
  sessionId: string;
  /** A human-control grant — already authorized + leased by the platform
   * oracle, here just forwarded to runnerd so it dials the writable x11vnc.
   * The spawner never authorizes control itself; it only relays the flag. */
  control: boolean;
}

/**
 * Pause the tunnel socket once the WS buffer climbs past this, resume on
 * `drain`. Picked well under Bun's 16 MB WS backpressure limit so a slow
 * viewer never trips closeOnBackpressureLimit; large enough that a healthy
 * viewer never thrashes pause/resume on every framebuffer update.
 */
const WS_BACKPRESSURE_PAUSE_BYTES = 1_048_576; // 1 MiB

/**
 * Hard ceiling on bytes buffered in the ws→tunnel direction BEFORE runnerd has
 * answered 101 (pre-handshake). In practice the RFB server speaks first, so the
 * client stays silent until after 101 and this stays empty — it only guards a
 * misbehaving client that floods before the handshake completes.
 */
const PRE_UPGRADE_CLIENT_BUFFER_MAX = 64 * 1024;

/** Per-connection bridge state, hung off the relay (not the WS) so the pure
 * parsing logic stays separable. */
interface BridgeState {
  socket: import('bun').Socket<undefined> | null;
  /** Accumulates the runnerd response bytes until the 101 headers terminate. */
  handshakeBuf: Uint8Array;
  /** Flips true once the `\r\n\r\n` terminator is seen and status parsed. */
  upgraded: boolean;
  /** Bytes the WS client sent before the tunnel finished its 101 (rare). */
  pendingClient: Uint8Array[];
  pendingClientBytes: number;
  /** True while the tunnel reads are paused for WS backpressure. */
  paused: boolean;
  /** Guards teardown so each side is torn down exactly once. */
  closed: boolean;
}

/**
 * Parse the leading bytes of runnerd's HTTP/1.1 Upgrade response.
 *
 *  - Returns `null` while the header block is incomplete (no `\r\n\r\n` yet) —
 *    the caller keeps accumulating.
 *  - On a complete header block returns `{ status, rest }` where `rest` is any
 *    bytes that followed the terminator (the first RFB bytes, to forward).
 *
 * Pure + synchronous so it is unit-testable without a live socket.
 */
export function parseUpgradeResponse(
  buf: Uint8Array,
): { status: number; rest: Uint8Array } | null {
  // Find the CRLFCRLF header terminator.
  const terminator = findHeaderEnd(buf);
  if (terminator === -1) {
    // Defensive: a peer that streams an unbounded header without a terminator
    // would otherwise grow handshakeBuf forever. The caller enforces the cap
    // and tears down; here we just say "not done yet".
    return null;
  }
  const headerBytes = buf.subarray(0, terminator);
  const rest = buf.subarray(terminator + 4);
  // The status line is ASCII (HTTP grammar), so utf-8 decoding it is safe; only
  // the headers up to the terminator are decoded — the RFB bytes in `rest` are
  // forwarded verbatim, never decoded.
  const headerText = new TextDecoder('utf-8').decode(headerBytes);
  // "HTTP/1.1 101 Switching Protocols" → 101 (the status line is everything up
  // to the first CRLF; ?? '' covers the impossible empty-header case).
  const statusLine = headerText.split('\r\n')[0] ?? '';
  const status = Number(statusLine.split(/\s+/)[1] ?? '');
  return { status: Number.isFinite(status) ? status : 0, rest };
}

/** Index of the start of the `\r\n\r\n` header terminator, or -1. */
function findHeaderEnd(buf: Uint8Array): number {
  for (let i = 0; i + 3 < buf.length; i += 1) {
    if (
      buf[i] === 0x0d &&
      buf[i + 1] === 0x0a &&
      buf[i + 2] === 0x0d &&
      buf[i + 3] === 0x0a
    ) {
      return i;
    }
  }
  return -1;
}

function appendBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Build the WebSocket handler that bridges each browser-facing WS connection to
 * a raw HTTP/1.1-Upgrade tunnel opened to the session's runnerd.
 *
 * `resolveTarget` is injected (returns the runnerd host:port + per-session
 * token, or null when the session/endpoint can't be resolved) so this module
 * stays decoupled from the registry/backend and the bridge logic is testable.
 */
export function createScreencastWebSocketHandler(
  resolveTarget: (sessionId: string) => ScreencastTarget | null,
): import('bun').WebSocketHandler<ScreencastWsData> {
  // ws.data carries only the sessionId (set at upgrade); the mutable bridge
  // state lives in this side-map keyed by the ws object, so ScreencastWsData
  // stays a plain serializable shape and the parsing helpers stay pure.
  const bridges = new WeakMap<object, BridgeState>();

  const teardown = (
    ws: import('bun').ServerWebSocket<ScreencastWsData>,
    state: BridgeState,
    wsCloseCode?: number,
    wsCloseReason?: string,
  ): void => {
    if (state.closed) return;
    state.closed = true;
    try {
      state.socket?.terminate();
    } catch (err) {
      console.warn('[sandbox.screencast] tunnel terminate failed:', err);
    }
    state.socket = null;
    if (wsCloseCode !== undefined) {
      try {
        ws.close(wsCloseCode, wsCloseReason);
      } catch (err) {
        console.warn('[sandbox.screencast] ws close failed:', err);
      }
    }
  };

  return {
    // Raw RFB is already binary; never compress (compression would also break
    // the byte-identical forwarding contract).
    perMessageDeflate: false,
    // Never read at runtime; the real data is supplied per-connection by
    // server.upgrade(req, { data }).
    data: undefined,

    open(ws): void {
      const { sessionId, control } = ws.data;
      const target = resolveTarget(sessionId);
      if (target === null) {
        ws.close(1011, 'no session');
        return;
      }
      const state: BridgeState = {
        socket: null,
        handshakeBuf: new Uint8Array(0),
        upgraded: false,
        pendingClient: [],
        pendingClientBytes: 0,
        paused: false,
        closed: false,
      };
      bridges.set(ws, state);

      const host = `${target.hostname}:${target.port}`;
      const tokenLine = target.token
        ? `${RUNNERD_TOKEN_HEADER}: ${target.token}\r\n`
        : '';
      // Forward the control grant as a query param so runnerd's tunnel dials
      // the writable :5901 instead of the read-only :5900.
      const requestPath = control ? '/screencast?control=1' : '/screencast';
      const upgradeRequest =
        `GET ${requestPath} HTTP/1.1\r\n` +
        `Host: ${host}\r\n` +
        `Upgrade: tale-vnc\r\n` +
        `Connection: Upgrade\r\n` +
        tokenLine +
        `\r\n`;

      Bun.connect({
        hostname: target.hostname,
        port: target.port,
        socket: {
          open(sock): void {
            if (state.closed) {
              sock.terminate();
              return;
            }
            state.socket = sock;
            sock.write(upgradeRequest);
          },
          data(sock, chunk): void {
            if (state.closed) return;
            if (state.upgraded) {
              // Steady state: raw RFB → binary WS frame.
              forwardToWs(ws, state, chunk);
              return;
            }
            // Still consuming the 101 response headers.
            state.handshakeBuf = appendBytes(state.handshakeBuf, chunk);
            const parsed = parseUpgradeResponse(state.handshakeBuf);
            if (parsed === null) {
              // Bound the pre-101 buffer so a peer streaming headers without a
              // terminator can't grow it unbounded.
              if (state.handshakeBuf.length > PRE_UPGRADE_CLIENT_BUFFER_MAX) {
                console.warn(
                  '[sandbox.screencast] runnerd upgrade headers exceeded cap; closing',
                );
                teardown(ws, state, 1011, 'bad upstream');
              }
              return;
            }
            if (parsed.status !== 101) {
              console.warn(
                `[sandbox.screencast] runnerd refused screencast: status=${parsed.status}`,
              );
              teardown(ws, state, 1011, 'upstream not upgraded');
              return;
            }
            // Handshake complete. Flush anything the client queued pre-101,
            // then forward any RFB bytes that rode in this same chunk.
            state.upgraded = true;
            state.handshakeBuf = new Uint8Array(0);
            for (const pending of state.pendingClient) sock.write(pending);
            state.pendingClient = [];
            state.pendingClientBytes = 0;
            if (parsed.rest.length > 0) forwardToWs(ws, state, parsed.rest);
          },
          close(): void {
            // Tunnel closed → close the browser WS (1011 only if it wasn't a
            // clean post-handshake EOF; either way the viewer is done).
            teardown(ws, state, 1011, 'tunnel closed');
          },
          error(_sock, err): void {
            console.warn('[sandbox.screencast] tunnel socket error:', err);
            teardown(ws, state, 1011, 'tunnel error');
          },
        },
      }).catch((err) => {
        // Bun.connect rejects when the TCP connect itself fails (runnerd down).
        console.warn(
          '[sandbox.screencast] Bun.connect to runnerd failed:',
          err,
        );
        teardown(ws, state, 1011, 'connect failed');
      });
    },

    message(ws, message): void {
      const state = bridges.get(ws);
      if (!state || state.closed) return;
      // RFB client → runnerd → x11vnc. Normalize to bytes (the browser sends
      // binary frames; a stray text frame is still forwarded as its UTF-8
      // bytes, which RFB will simply reject — harmless).
      const bytes =
        typeof message === 'string' ? Buffer.from(message) : message;
      if (state.upgraded && state.socket) {
        state.socket.write(bytes);
        return;
      }
      // Pre-101: buffer (bounded) and flush after the handshake. The RFB
      // server speaks first, so in practice this never fills.
      if (
        state.pendingClientBytes + bytes.length >
        PRE_UPGRADE_CLIENT_BUFFER_MAX
      ) {
        console.warn(
          '[sandbox.screencast] client flooded before handshake; closing',
        );
        teardown(ws, state, 1011, 'client flood');
        return;
      }
      state.pendingClient.push(new Uint8Array(bytes));
      state.pendingClientBytes += bytes.length;
    },

    drain(ws): void {
      // WS buffer has emptied — resume the (previously paused) tunnel reads so
      // x11vnc framebuffer updates flow again.
      const state = bridges.get(ws);
      if (!state || state.closed || !state.paused) return;
      state.paused = false;
      state.socket?.resume();
    },

    close(ws): void {
      const state = bridges.get(ws);
      if (!state) return;
      // Browser WS gone → tear the tunnel down (no WS close — it's already
      // closing).
      teardown(ws, state);
      bridges.delete(ws);
    },
  };
}

/** Send raw RFB bytes to the browser as a BINARY frame, applying tunnel→ws
 * backpressure: pause the tunnel reads when the WS buffer is high so we never
 * unbounded-buffer a slow viewer. */
function forwardToWs(
  ws: import('bun').ServerWebSocket<ScreencastWsData>,
  state: BridgeState,
  chunk: Uint8Array,
): void {
  // sendBinary returns the WS send status; a negative value means the frame is
  // queued under backpressure. Regardless, check the buffered amount and pause
  // the tunnel if it's high (resumed in `drain`).
  ws.sendBinary(chunk);
  if (!state.paused && ws.getBufferedAmount() > WS_BACKPRESSURE_PAUSE_BYTES) {
    state.paused = true;
    state.socket?.pause();
  }
}
