// The live view of a running session over a WebSocket at
// `/api/sessions/:id/stream`: the server takes the handshake apart (path,
// origin), Bun runs the connection, a `SessionSocket` per connection does the
// rest. `createLiveViewSocket` is what `startReactServer({ websocket })` takes.

import type { ReactServerWebSocket } from '@tale/ui/server';

import type { ServerMessage } from '../../../lib/live-view.ts';
import { AppError } from '../../errors.ts';
import type { Refusal } from '../../security.ts';
import type { Remote } from '../browser/remote.ts';
import type { Manager } from '../sessions/manager.ts';
import { SessionSocket } from './session-socket.ts';

/** What every handler of one connection finds in `ws.data`. */
export interface LiveViewData {
  readonly sessionId: number;
}

export interface LiveViewOptions {
  manager: Manager;
  /** The `Host` values the app answers to. */
  allowedHosts: ReadonlySet<string>;
  /** `security.ts`: why the handshake is refused, or null when it comes from the app's own page (or from a program). */
  websocketRefusal: (
    headers: Headers,
    hosts: ReadonlySet<string>,
  ) => Refusal | null;
}

const STREAM_PATH = /^\/api\/sessions\/(\d{1,15})\/stream$/;

/**
 * The largest message a client may send. The longest is a `text` of
 * `MAX_TEXT` (100,000) characters: JSON escapes can make each of them six
 * bytes. Everything else is a few dozen bytes.
 */
const MAX_PAYLOAD_LENGTH = 1024 * 1024;

/**
 * Seconds without a message, ping or pong before Bun closes a connection. A
 * viewer who only watches sends nothing, but its browser answers Bun's pings.
 */
const IDLE_TIMEOUT = 600;

export function createLiveViewSocket(
  options: LiveViewOptions,
): ReactServerWebSocket<LiveViewData> {
  const { manager, allowedHosts, websocketRefusal } = options;
  const connections = new WeakMap<LiveViewData, SessionSocket>();

  function refuse(ws: Bun.ServerWebSocket<LiveViewData>, error: unknown): void {
    if (!(error instanceof AppError)) {
      console.error(
        `could not open the live view of session ${ws.data.sessionId}`,
        error,
      );
      ws.close(1011, 'The live view failed.');
      return;
    }
    // The page learns from this message that there is nothing to connect to
    // (not running, no such session) and does not try again.
    const message: ServerMessage = {
      t: 'error',
      code: error.code,
      message: error.message,
    };
    ws.send(JSON.stringify(message));
    ws.close(1000);
  }

  return {
    upgrade(request, url) {
      const match = STREAM_PATH.exec(url.pathname);
      if (match === null) return null;
      // The HTTP middleware does not see WebSockets, and any web page may
      // open one to this address.
      const refusal = websocketRefusal(request.headers, allowedHosts);
      if (refusal !== null) {
        return Response.json(
          { error: refusal.code, message: refusal.message },
          { status: 403 },
        );
      }
      return { data: { sessionId: Number(match[1]) } };
    },

    handler: {
      maxPayloadLength: MAX_PAYLOAD_LENGTH,
      // The pictures are JPEGs already; compressing them costs a core.
      perMessageDeflate: false,
      idleTimeout: IDLE_TIMEOUT,

      open(ws) {
        let remote: Remote;
        try {
          remote = manager.remote(ws.data.sessionId);
        } catch (error) {
          refuse(ws, error);
          return;
        }
        const connection = new SessionSocket(ws, remote, ws.data.sessionId);
        connections.set(ws.data, connection);
        connection.start();
      },

      message(ws, data) {
        connections.get(ws.data)?.receive(data);
      },

      drain(ws) {
        connections.get(ws.data)?.drain();
      },

      close(ws) {
        connections.get(ws.data)?.close();
        connections.delete(ws.data);
      },
    },
  };
}
