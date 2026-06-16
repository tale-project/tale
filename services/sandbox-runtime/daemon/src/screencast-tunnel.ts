// Raw VNC tunnel — bridges an inbound HTTP/1.1 Upgrade connection to the
// session's local x11vnc RFB port (127.0.0.1:5900).
//
// The spawner opens a plain HTTP/1.1 `GET /screencast` Upgrade request carrying
// the per-session runnerd token. We validate the token, dial x11vnc, complete
// the 101 handshake, and then pipe raw bytes both ways with backpressure. There
// is deliberately NO WebSocket framing here: this is a transparent TCP relay,
// which keeps runnerd zero-dependency (no `ws`). The WS framing lives at the
// platform's browser leg, above the spawner.
//
// node: built-ins only (this whole daemon is bundled with `bun build
// --target=node`, no npm deps).

import type { IncomingMessage } from 'node:http';
import { connect } from 'node:net';
import type { Duplex } from 'node:stream';

/** Default x11vnc RFB endpoint inside the session container. */
const VNC_HOST = '127.0.0.1';
const VNC_PORT = 5900;

/** Resolve the dial target. Read from the environment per-connection so unit
 * tests can point the tunnel at a stub TCP server on an ephemeral port (same
 * spirit as TALE_WORKSPACE_ROOT) without re-importing the module. */
function targetHost(): string {
  return process.env.TALE_SCREENCAST_TARGET_HOST ?? VNC_HOST;
}
function targetPort(): number {
  return Number(process.env.TALE_SCREENCAST_TARGET_PORT ?? '') || VNC_PORT;
}

/** Upgrade protocol token echoed back in the 101 response. Cosmetic — the
 * relayed bytes are raw RFB, not a WebSocket subprotocol. */
const UPGRADE_PROTOCOL = 'tale-vnc';

let activeScreencasts = 0;

/** Count of screencast tunnels currently piping (post-101). Reported in
 * /healthz so an operator (and the spawner) can see live viewer attachments. */
export function getActiveScreencasts(): number {
  return activeScreencasts;
}

function writeRaw(socket: Duplex, text: string): void {
  try {
    socket.write(text);
  } catch (err) {
    console.warn('[runnerd] screencast handshake write failed:', err);
  }
}

interface ScreencastDeps {
  /** Same auth predicate as the JSON router's tokenOk (empty token = dev mode
   * allow). Passed in so the handler stays decoupled from main.ts module state
   * and is unit-testable. */
  tokenOk: (req: IncomingMessage) => boolean;
  /** Activity bump — a freshly attached viewer should refresh last-activity so
   * the idle reaper does not stop a session someone is actively watching. */
  touch: () => void;
}

/**
 * Handle a `GET /screencast` HTTP/1.1 Upgrade. The caller has already matched
 * the path; we own auth + the byte relay from here.
 *
 *  - bad/missing token → 401 + close (no dial to x11vnc).
 *  - x11vnc unreachable (ECONNREFUSED etc.) → 502 + close (never hang).
 *  - on connect → 101 Switching Protocols, then full-duplex pipe with
 *    backpressure (Node's Socket.pipe handles pause/resume on drain).
 */
export function handleScreencastUpgrade(
  req: IncomingMessage,
  // The http server's 'upgrade' event types this as Duplex (it is a net.Socket
  // at runtime); we only need Duplex byte-stream semantics on the client leg.
  socket: Duplex,
  head: Buffer,
  deps: ScreencastDeps,
): void {
  if (!deps.tokenOk(req)) {
    writeRaw(socket, 'HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  // Dial x11vnc FIRST: only after a successful connect do we send 101, so a
  // down backend surfaces as a clean 502 instead of a half-open tunnel.
  const vnc = connect(targetPort(), targetHost());

  // True once the 101 handshake has gone out and we are piping; flips the
  // 'error' handling from "answer 502" to "tear the live tunnel down".
  let piping = false;
  // Guards the teardown so each side is destroyed exactly once and the active
  // count is decremented exactly once.
  let closed = false;

  const teardown = (): void => {
    if (closed) return;
    closed = true;
    if (piping) {
      activeScreencasts -= 1;
    }
    vnc.destroy();
    socket.destroy();
  };

  vnc.once('connect', () => {
    writeRaw(
      socket,
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: ${UPGRADE_PROTOCOL}\r\nConnection: Upgrade\r\n\r\n`,
    );
    // Any bytes buffered after the request headers belong to the RFB stream —
    // forward them before wiring the live pipe so nothing is dropped/reordered.
    if (head.length > 0) {
      vnc.write(head);
    }
    piping = true;
    activeScreencasts += 1;
    deps.touch();
    // pipe() applies backpressure (pause the source when the dest buffer fills,
    // resume on drain) on both legs.
    socket.pipe(vnc);
    vnc.pipe(socket);
  });

  vnc.on('error', (err) => {
    if (piping) {
      // Live-tunnel error: just tear down (client already past 101).
      teardown();
      return;
    }
    // Pre-connect error (e.g. ECONNREFUSED when x11vnc is not running): answer
    // 502 so the client is not left hanging, then close.
    console.warn('[runnerd] screencast x11vnc connect failed:', err.message);
    writeRaw(socket, 'HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    socket.destroy();
    teardown();
  });

  // Either side closing/ending/erroring tears the other down exactly once.
  for (const ev of ['close', 'end', 'error'] as const) {
    socket.on(ev, teardown);
    vnc.on(ev, teardown);
  }
}
