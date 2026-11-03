// A real server and a real client for the tests of the live view: a `Bun.serve`
// that does what `startReactServer` does with a `websocket` option (judge the
// handshake, upgrade, hand the connection to Bun's handler), and a `Viewer`
// that is a WebSocket client reading what the server sends.
//
//     afterEach(closeLiveView);
//
//     const live = serveLiveView(manager, websocketRefusal);
//     const viewer = await Viewer.open(live.streamUrl(sessionId));
//     await viewer.nextOf('tabs');          // the next JSON message of that type
//     await viewer.next();                  // the next message: JSON, or a picture as its text
//     viewer.send({ t: 'key', a: 'down', k: 'a' });
//     await viewer.closed;                  // { code, reason }
//
// `until(condition, what)` polls for something to happen on the server's side.

import { serverMessageSchema } from '../../lib/live-view.ts';
import type { ServerMessage } from '../../lib/live-view.ts';
import { createLiveViewSocket } from '../domains/live_view/index.ts';
import type { LiveViewData } from '../domains/live_view/index.ts';
import type { Manager } from '../domains/sessions/manager.ts';
import type { Refusal } from '../security.ts';

const decoder = new TextDecoder();

const WAIT_MS = 5000;

/** Polls until `condition` holds; fails after `timeoutMs` saying what it waited for. */
export async function until(
  condition: () => boolean,
  what: string,
  timeoutMs = WAIT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 2);
    });
  }
}

// -- the server -----------------------------------------------------------------

export interface LiveServer {
  readonly port: number;
  readonly live: ReturnType<typeof createLiveViewSocket>;
  /** `ws://<host>:<port>/api/sessions/<id>/stream`. */
  streamUrl(sessionId: number, host?: string): string;
  /** The same address for a plain HTTP request. */
  httpUrl(sessionId: number): string;
}

const servers: { stop(closeActiveConnections?: boolean): unknown }[] = [];
const viewers: Viewer[] = [];

/**
 * Serves the live view of `manager`'s sessions on a free port. The hosts it
 * allows are `127.0.0.1:<port>` and `localhost:<port>`.
 */
export function serveLiveView(
  manager: Manager,
  websocketRefusal: (
    headers: Headers,
    hosts: ReadonlySet<string>,
  ) => Refusal | null,
): LiveServer {
  const allowedHosts = new Set<string>();
  const live = createLiveViewSocket({
    manager,
    allowedHosts,
    websocketRefusal,
  });
  const server = Bun.serve<LiveViewData>({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request, bunServer) {
      const verdict = await live.upgrade(request, new URL(request.url));
      if (verdict instanceof Response) return verdict;
      if (verdict === null)
        return new Response('not a socket', { status: 404 });
      if (bunServer.upgrade(request, { data: verdict.data })) return undefined;
      return new Response('upgrade failed', { status: 400 });
    },
    websocket: live.handler,
  });
  servers.push(server);
  const port = server.port ?? 0;
  allowedHosts.add(`127.0.0.1:${port}`);
  allowedHosts.add(`localhost:${port}`);
  return {
    port,
    live,
    streamUrl: (sessionId, host = '127.0.0.1') =>
      `ws://${host}:${port}/api/sessions/${sessionId}/stream`,
    httpUrl: (sessionId) =>
      `http://127.0.0.1:${port}/api/sessions/${sessionId}/stream`,
  };
}

/** Closes every viewer and stops every server that `serveLiveView` started. */
export async function closeLiveView(): Promise<void> {
  for (const viewer of viewers.splice(0)) viewer.close();
  for (const server of servers.splice(0)) await server.stop(true);
}

// -- the client -------------------------------------------------------------------

/** A message of the server (a picture as the text the fake browser drew it from). */
export type Received = ServerMessage | string;

function isOfType<T extends ServerMessage['t']>(
  message: Received,
  type: T,
): message is Extract<ServerMessage, { t: T }> {
  return typeof message !== 'string' && message.t === type;
}

export class Viewer {
  readonly socket: WebSocket;
  readonly inbox: Received[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  #read = 0;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('message', (event: MessageEvent<unknown>) => {
      const { data } = event;
      if (typeof data === 'string') {
        this.inbox.push(serverMessageSchema.parse(JSON.parse(data)));
      } else if (data instanceof ArrayBuffer) {
        this.inbox.push(decoder.decode(data));
      } else {
        throw new Error('the server sent something that is neither');
      }
    });
    this.closed = new Promise((resolve) => {
      socket.addEventListener('close', (event) => {
        resolve({ code: event.code, reason: event.reason });
      });
    });
  }

  /** Connects; rejects when the handshake is refused. */
  static open(
    url: string,
    headers: Record<string, string> = {},
  ): Promise<Viewer> {
    return new Promise((resolve, reject) => {
      // @ts-expect-error Bun's WebSocket takes the headers of the handshake (a program, unlike a web page, may send any Origin); the DOM types this service is checked with do not know the option
      const socket = new WebSocket(url, { headers });
      const viewer = new Viewer(socket);
      viewers.push(viewer);
      socket.addEventListener('open', () => {
        resolve(viewer);
      });
      socket.addEventListener('error', () => {
        reject(new Error('the handshake was refused'));
      });
    });
  }

  /** The next message that has not been read yet. */
  async next(): Promise<Received> {
    await until(() => this.inbox.length > this.#read, 'a message');
    const message = this.inbox[this.#read];
    this.#read += 1;
    if (message === undefined) throw new Error('no message');
    return message;
  }

  /** The next JSON message of this type (pictures and others in between are skipped). */
  async nextOf<T extends ServerMessage['t']>(
    type: T,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    for (;;) {
      const message = await this.next();
      if (isOfType(message, type)) return message;
    }
  }

  send(message: unknown): void {
    this.socket.send(
      typeof message === 'string' ? message : JSON.stringify(message),
    );
  }

  get open(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.socket.close();
  }
}
