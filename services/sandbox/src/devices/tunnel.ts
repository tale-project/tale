// The device tunnel — HTTP exchanges multiplexed over ONE WebSocket between
// the hub (the deployment's spawner) and a device (a spawner on a machine an
// organization connected). The device dials out, so it works from behind NAT
// with nothing but outbound HTTPS. Either side opens streams: the hub
// forwards the platform's session calls to the device, and the device relays
// its sessions' calls back to the platform's backend and LLM gateway.
//
// Frame: [u8 type][u32 BE stream id][payload]. Connection-level frames use
// stream 0 and carry JSON. A stream is one HTTP exchange:
//
//   initiator → OPEN (request head, JSON) → DATA* → END      (request body)
//   responder → HEAD (response head, JSON) → DATA* → END     (response body)
//   either    → RESET (JSON {code, message}) aborts the exchange
//
// DATA is flow-controlled per stream and direction: the sender spends a credit
// window (INITIAL_WINDOW_BYTES) and the receiver replenishes it with WINDOW
// frames as ITS consumer reads, so a slow reader on either end (a platform
// worker draining an exec stream, a session uploading a file) backs pressure
// up to the producer instead of making the other side buffer without bound.
// Hub-initiated stream ids are odd, device-initiated ids even, so the two
// sides never race for an id.

export const TUNNEL_PROTOCOL_VERSION = 1;

export const FRAME = {
  HELLO: 0x01,
  WELCOME: 0x02,
  STATUS: 0x03,
  RENEW: 0x04,
  /** The hub's answer to STATUS: keeps the device's silence watchdog fed. */
  STATUS_ACK: 0x06,
  OPEN: 0x10,
  HEAD: 0x11,
  DATA: 0x12,
  END: 0x13,
  RESET: 0x14,
  WINDOW: 0x15,
} as const;

/** The connection-level frames: stream 0, a JSON object each. */
export type ControlFrameType =
  | typeof FRAME.HELLO
  | typeof FRAME.WELCOME
  | typeof FRAME.STATUS
  | typeof FRAME.RENEW
  | typeof FRAME.STATUS_ACK;

const CONTROL_TYPES: ReadonlySet<number> = new Set([
  FRAME.HELLO,
  FRAME.WELCOME,
  FRAME.STATUS,
  FRAME.RENEW,
  FRAME.STATUS_ACK,
]);

function isControlType(type: number): type is ControlFrameType {
  return CONTROL_TYPES.has(type);
}

/** WebSocket close codes the tunnel uses (4000–4999 is the application range). */
export const TUNNEL_CLOSE = {
  /** Another connection authenticated as the same device. */
  REPLACED: 4001,
  /** The organization removed the device. */
  REVOKED: 4003,
  /** The connect ticket expired without a renewal. */
  TICKET_EXPIRED: 4008,
  /** The peer broke the framing rules. */
  PROTOCOL_ERROR: 4400,
  /** This side could not send a frame (its socket buffer overflowed). */
  SEND_FAILED: 1011,
  /** The hub is shutting down. */
  GOING_AWAY: 1001,
} as const;

/** Largest DATA payload a sender emits (and a receiver accepts). */
export const MAX_DATA_BYTES = 64 * 1024;
/** Largest JSON payload (OPEN, HEAD, RESET, control frames). */
export const MAX_JSON_BYTES = 64 * 1024;
/** Credit each direction of a new stream starts with. */
export const INITIAL_WINDOW_BYTES = 256 * 1024;
/** Streams one side may have open at once; the next open is refused. */
export const MAX_STREAMS_PER_SIDE = 256;
/** Pause pumping while the socket holds more than this unsent. */
const TRANSPORT_HIGH_WATER_BYTES = 4 * 1024 * 1024;
const MAX_HEADERS = 100;
const MAX_HEADER_VALUE_BYTES = 8 * 1024;
const HEADER_BYTES = 5;

export type HeaderList = Array<[string, string]>;

/** A stream's request head. `relay` names the upstream of a device-opened
 * stream (see relay-policy.ts); hub-opened streams never carry one. */
export interface OpenHead {
  method: string;
  path: string;
  headers: HeaderList;
  relay?: string;
}

export interface ResponseHead {
  status: number;
  headers: HeaderList;
}

/** What one side of the tunnel sends frames through — a WebSocket in
 * production, an in-memory pipe in the tests. */
export interface TunnelTransport {
  send(frame: Uint8Array): void;
  /** Bytes queued in the socket but not yet written. */
  bufferedAmount(): number;
  close(code: number, reason: string): void;
}

/** A stream the peer opened, as the local handler sees it. */
export interface IncomingStream {
  readonly id: number;
  readonly head: OpenHead;
  /** The request body; errors if the peer resets the stream. */
  readonly body: ReadableStream<Uint8Array>;
  /** Aborted when the peer resets the stream or the tunnel closes. */
  readonly signal: AbortSignal;
  /** Send the response head, then stream the body (null = empty). */
  respond(head: ResponseHead, body: ReadableStream<Uint8Array> | null): void;
  reset(code: string, message?: string): void;
}

export interface TunnelResponse {
  status: number;
  headers: HeaderList;
  body: ReadableStream<Uint8Array>;
}

export interface TunnelHandlers {
  /** A stream the peer opened. Must eventually `respond` or `reset`. */
  onStream(stream: IncomingStream): void;
  /** A connection-level frame. */
  onControl(type: ControlFrameType, payload: Record<string, unknown>): void;
}

export class TunnelClosedError extends Error {
  constructor(message = 'device tunnel closed') {
    super(message);
    this.name = 'TunnelClosedError';
  }
}

export class TunnelStreamResetError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ? `${code}: ${message}` : code);
    this.name = 'TunnelStreamResetError';
  }
}

export class TunnelBusyError extends Error {
  constructor() {
    super(`device tunnel has ${MAX_STREAMS_PER_SIDE} streams open`);
    this.name = 'TunnelBusyError';
  }
}

export function encodeFrame(
  type: number,
  streamId: number,
  payload?: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(HEADER_BYTES + (payload?.byteLength ?? 0));
  out[0] = type;
  new DataView(out.buffer).setUint32(1, streamId);
  if (payload) out.set(payload, HEADER_BYTES);
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(payload: Uint8Array): Record<string, unknown> | null {
  if (payload.byteLength > MAX_JSON_BYTES) return null;
  try {
    const value: unknown = JSON.parse(decoder.decode(payload));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function parseHeaders(value: unknown): HeaderList | null {
  if (!Array.isArray(value) || value.length > MAX_HEADERS) return null;
  const out: HeaderList = [];
  for (const entry of value) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'string' ||
      typeof entry[1] !== 'string' ||
      entry[0].length === 0 ||
      entry[1].length > MAX_HEADER_VALUE_BYTES
    ) {
      return null;
    }
    out.push([entry[0], entry[1]]);
  }
  return out;
}

export function parseOpenHead(value: Record<string, unknown>): OpenHead | null {
  const { method, path, relay } = value;
  const headers = parseHeaders(value.headers);
  if (
    typeof method !== 'string' ||
    !/^[A-Z]{1,16}$/.test(method) ||
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path.length > 8192 ||
    headers === null ||
    (relay !== undefined && typeof relay !== 'string')
  ) {
    return null;
  }
  return relay === undefined
    ? { method, path, headers }
    : { method, path, headers, relay };
}

function parseResponseHead(
  value: Record<string, unknown>,
): ResponseHead | null {
  const { status } = value;
  const headers = parseHeaders(value.headers);
  if (
    typeof status !== 'number' ||
    !Number.isInteger(status) ||
    status < 100 ||
    status > 599 ||
    headers === null
  ) {
    return null;
  }
  return { status, headers };
}

/** The receive side of one stream direction: frames in, a pull-based
 * ReadableStream out. Credit is granted back only when the consumer takes a
 * chunk, which is what makes the window a real backpressure signal. */
class InboundBody {
  private readonly chunks: Uint8Array[] = [];
  private ended = false;
  private failure: Error | null = null;
  private wake: (() => void) | null = null;
  /** Bytes received and not yet taken by the consumer. */
  unread = 0;
  readonly stream: ReadableStream<Uint8Array>;

  constructor(
    onConsumed: (bytes: number) => void,
    onCancel: (reason: unknown) => void,
  ) {
    this.stream = new ReadableStream<Uint8Array>(
      {
        pull: async (controller) => {
          for (;;) {
            const chunk = this.chunks.shift();
            if (chunk !== undefined) {
              this.unread -= chunk.byteLength;
              controller.enqueue(chunk);
              onConsumed(chunk.byteLength);
              return;
            }
            if (this.failure !== null) {
              controller.error(this.failure);
              return;
            }
            if (this.ended) {
              controller.close();
              return;
            }
            await new Promise<void>((resolve) => {
              this.wake = resolve;
            });
          }
        },
        cancel: (reason) => {
          this.chunks.length = 0;
          this.unread = 0;
          onCancel(reason);
        },
      },
      // Zero: pull only runs for a pending read, so nothing is taken (and no
      // credit granted) ahead of the consumer.
      { highWaterMark: 0 },
    );
  }

  push(chunk: Uint8Array): void {
    this.chunks.push(chunk);
    this.unread += chunk.byteLength;
    this.notify();
  }

  end(): void {
    this.ended = true;
    this.notify();
  }

  fail(error: Error): void {
    if (this.failure !== null || this.ended) return;
    this.failure = error;
    this.chunks.length = 0;
    this.unread = 0;
    this.notify();
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }
}

interface StreamState {
  id: number;
  local: boolean;
  sendWindow: number;
  creditWaiters: Array<() => void>;
  inbound: InboundBody;
  sentEnd: boolean;
  receivedEnd: boolean;
  receivedHead: boolean;
  reset: boolean;
  abort: AbortController;
  /** The body being pumped out, cancelled when the stream dies. */
  source: { cancel(reason?: unknown): Promise<void> } | null;
  onHead:
    | {
        resolve: (response: TunnelResponse) => void;
        reject: (error: Error) => void;
      }
    | undefined;
}

/** Stops a pump once its stream (or the whole tunnel) is gone. */
class PumpStopped extends Error {}

function toBodyStream(
  body: ReadableStream<Uint8Array> | Uint8Array | string | null | undefined,
): ReadableStream<Uint8Array> | null {
  if (body === null || body === undefined) return null;
  if (body instanceof ReadableStream) return body;
  const bytes = typeof body === 'string' ? encoder.encode(body) : body;
  if (bytes.byteLength === 0) return null;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/**
 * One side of a tunnel. Feed it every frame the transport receives
 * (`receive`) and tell it when the transport closes (`close`); it opens
 * streams (`request`), answers the peer's (`TunnelHandlers.onStream`) and
 * carries connection-level JSON (`sendControl` / `onControl`).
 */
export class TunnelEndpoint {
  private readonly streams = new Map<number, StreamState>();
  private nextId: number;
  private closedWith: Error | null = null;
  private readonly drainWaiters = new Set<() => void>();

  constructor(
    private readonly role: 'hub' | 'device',
    private readonly transport: TunnelTransport,
    private readonly handlers: TunnelHandlers,
  ) {
    this.nextId = role === 'hub' ? 1 : 2;
  }

  get closed(): boolean {
    return this.closedWith !== null;
  }

  /** Streams this side opened that are still in flight. */
  get localStreamCount(): number {
    let n = 0;
    for (const s of this.streams.values()) if (s.local) n++;
    return n;
  }

  get streamCount(): number {
    return this.streams.size;
  }

  sendControl(type: ControlFrameType, payload: Record<string, unknown>): void {
    if (this.closed) return;
    this.sendFrame(type, 0, encoder.encode(JSON.stringify(payload)));
  }

  /** The transport drained below its buffer bound (a WebSocket `drain`). */
  notifyDrained(): void {
    const waiters = [...this.drainWaiters];
    this.drainWaiters.clear();
    for (const w of waiters) w();
  }

  /** Open a stream: send the head and body, resolve with the response head
   * and a body stream. Rejects on a reset before the head or a closed tunnel;
   * aborting `signal` resets the stream. */
  request(
    head: OpenHead,
    body?: ReadableStream<Uint8Array> | Uint8Array | string | null,
    signal?: AbortSignal,
  ): Promise<TunnelResponse> {
    if (this.closedWith !== null) return Promise.reject(this.closedWith);
    if (this.localStreamCount >= MAX_STREAMS_PER_SIDE) {
      return Promise.reject(new TunnelBusyError());
    }
    if (signal?.aborted) {
      return Promise.reject(new TunnelStreamResetError('cancelled'));
    }
    const id = this.nextId;
    this.nextId += 2;
    const state = this.newStream(id, true);
    const response = new Promise<TunnelResponse>((resolve, reject) => {
      state.onHead = { resolve, reject };
    });
    this.streams.set(id, state);
    this.sendFrame(FRAME.OPEN, id, encoder.encode(JSON.stringify(head)));
    if (signal) {
      signal.addEventListener(
        'abort',
        () => this.resetStream(state, 'cancelled', 'aborted by caller', true),
        { once: true },
      );
    }
    void this.pump(state, toBodyStream(body));
    return response;
  }

  /** Feed one received frame. Malformed framing closes the tunnel. */
  receive(data: Uint8Array): void {
    if (this.closed) return;
    if (data.byteLength < HEADER_BYTES) {
      this.protocolError('short frame');
      return;
    }
    const type = data[0] ?? 0;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const id = view.getUint32(1);
    const payload = data.subarray(HEADER_BYTES);

    if (isControlType(type)) {
      if (id !== 0) {
        this.protocolError('control frame on a stream');
        return;
      }
      const json = parseJson(payload);
      if (json === null) {
        this.protocolError('malformed control frame');
        return;
      }
      this.handlers.onControl(type, json);
      return;
    }
    if (id === 0) {
      this.protocolError('stream frame on stream 0');
      return;
    }

    if (type === FRAME.OPEN) {
      this.receiveOpen(id, payload);
      return;
    }
    const state = this.streams.get(id);
    // A late frame for a stream this side already finished or reset is
    // expected (the peer had it in flight) and harmless — drop it.
    if (state === undefined) return;

    switch (type) {
      case FRAME.HEAD:
        this.receiveHead(state, payload);
        return;
      case FRAME.DATA:
        this.receiveData(state, payload);
        return;
      case FRAME.END:
        if (state.receivedEnd || (state.local && !state.receivedHead)) {
          this.protocolError('unexpected END');
          return;
        }
        state.receivedEnd = true;
        state.inbound.end();
        this.retireIfDone(state);
        return;
      case FRAME.RESET: {
        const json = parseJson(payload);
        const code =
          json !== null && typeof json.code === 'string' ? json.code : 'reset';
        const message =
          json !== null && typeof json.message === 'string'
            ? json.message
            : undefined;
        this.resetStream(state, code, message, false);
        return;
      }
      case FRAME.WINDOW: {
        if (payload.byteLength !== 4) {
          this.protocolError('malformed WINDOW');
          return;
        }
        const increment = new DataView(
          payload.buffer,
          payload.byteOffset,
          4,
        ).getUint32(0);
        state.sendWindow += increment;
        const waiters = state.creditWaiters;
        state.creditWaiters = [];
        for (const w of waiters) w();
        return;
      }
      default:
        this.protocolError(`unknown frame type ${type}`);
    }
  }

  /** The transport is gone: fail every stream. Idempotent. */
  close(error: Error = new TunnelClosedError()): void {
    if (this.closedWith !== null) return;
    this.closedWith = error;
    for (const state of this.streams.values()) {
      this.teardown(state, error);
    }
    this.streams.clear();
    this.notifyDrained();
  }

  private newStream(id: number, local: boolean): StreamState {
    const state: StreamState = {
      id,
      local,
      sendWindow: INITIAL_WINDOW_BYTES,
      creditWaiters: [],
      inbound: new InboundBody(
        (bytes) => {
          if (!state.receivedEnd && !state.reset && !this.closed) {
            const increment = new Uint8Array(4);
            new DataView(increment.buffer).setUint32(0, bytes);
            this.sendFrame(FRAME.WINDOW, id, increment);
          }
        },
        () => this.resetStream(state, 'cancelled', 'body cancelled', true),
      ),
      sentEnd: false,
      receivedEnd: false,
      receivedHead: false,
      reset: false,
      abort: new AbortController(),
      source: null,
      onHead: undefined,
    };
    return state;
  }

  private receiveOpen(id: number, payload: Uint8Array): void {
    const peerParity = this.role === 'hub' ? 0 : 1;
    if (id % 2 !== peerParity || this.streams.has(id)) {
      this.protocolError('stream id out of turn');
      return;
    }
    const json = parseJson(payload);
    const head = json === null ? null : parseOpenHead(json);
    if (head === null) {
      this.protocolError('malformed OPEN');
      return;
    }
    let remoteOpen = 0;
    for (const s of this.streams.values()) if (!s.local) remoteOpen++;
    if (remoteOpen >= MAX_STREAMS_PER_SIDE) {
      this.sendFrame(
        FRAME.RESET,
        id,
        encoder.encode(JSON.stringify({ code: 'busy' })),
      );
      return;
    }
    const state = this.newStream(id, false);
    this.streams.set(id, state);
    let responded = false;
    const incoming: IncomingStream = {
      id,
      head,
      body: state.inbound.stream,
      signal: state.abort.signal,
      respond: (responseHead, body) => {
        if (responded || state.reset || this.closed) return;
        responded = true;
        this.sendFrame(
          FRAME.HEAD,
          id,
          encoder.encode(JSON.stringify(responseHead)),
        );
        void this.pump(state, body);
      },
      reset: (code, message) => {
        responded = true;
        this.resetStream(state, code, message, true);
      },
    };
    try {
      this.handlers.onStream(incoming);
    } catch (err) {
      console.warn('[sandbox.devices] tunnel stream handler threw:', err);
      this.resetStream(state, 'internal', 'handler failed', true);
    }
  }

  private receiveHead(state: StreamState, payload: Uint8Array): void {
    if (!state.local || state.receivedHead) {
      this.protocolError('unexpected HEAD');
      return;
    }
    const json = parseJson(payload);
    const head = json === null ? null : parseResponseHead(json);
    if (head === null) {
      this.protocolError('malformed HEAD');
      return;
    }
    state.receivedHead = true;
    const waiter = state.onHead;
    state.onHead = undefined;
    waiter?.resolve({
      status: head.status,
      headers: head.headers,
      body: state.inbound.stream,
    });
  }

  private receiveData(state: StreamState, payload: Uint8Array): void {
    if (state.receivedEnd) {
      this.protocolError('DATA after END');
      return;
    }
    if (state.local && !state.receivedHead) {
      this.protocolError('DATA before HEAD');
      return;
    }
    if (payload.byteLength > MAX_DATA_BYTES) {
      this.protocolError('oversized DATA');
      return;
    }
    // The peer may never have more unread bytes in flight than the window
    // this side granted; overrunning it is a broken (or hostile) sender.
    if (state.inbound.unread + payload.byteLength > INITIAL_WINDOW_BYTES) {
      this.resetStream(state, 'flow_control', 'window exceeded', true);
      return;
    }
    if (state.reset) return;
    // Copy: the transport may reuse its receive buffer.
    state.inbound.push(payload.slice());
  }

  private async pump(
    state: StreamState,
    source: ReadableStream<Uint8Array> | null,
  ): Promise<void> {
    if (source !== null) {
      const reader = source.getReader();
      state.source = reader;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          let offset = 0;
          while (offset < value.byteLength) {
            await this.waitForCredit(state);
            await this.waitForTransport(state);
            // Re-checked with no await before the send: every pump one drain
            // woke passed the wait together, and sending them all at once
            // could overrun the socket's buffer (which drops frames).
            if (this.transport.bufferedAmount() > TRANSPORT_HIGH_WATER_BYTES) {
              continue;
            }
            const size = Math.min(
              MAX_DATA_BYTES,
              state.sendWindow,
              value.byteLength - offset,
            );
            state.sendWindow -= size;
            this.sendFrame(
              FRAME.DATA,
              state.id,
              value.subarray(offset, offset + size),
            );
            offset += size;
          }
        }
      } catch (err) {
        if (!(err instanceof PumpStopped)) {
          this.resetStream(
            state,
            'source_error',
            err instanceof Error ? err.message : String(err),
            true,
          );
        }
        return;
      } finally {
        state.source = null;
        try {
          reader.releaseLock();
        } catch (err) {
          console.warn('[sandbox.devices] body reader release failed:', err);
        }
      }
    }
    if (state.reset || this.closed) return;
    state.sentEnd = true;
    this.sendFrame(FRAME.END, state.id);
    // Answered in full while the request body is still arriving: the handler
    // is done with it, so the rest is refused — a peer blocked on credit for
    // a body nobody reads would hold the stream on both sides forever. The
    // requester keeps the complete answer it already has.
    if (!state.local && !state.receivedEnd) {
      this.resetStream(state, 'answered', 'the response is complete', true);
      return;
    }
    this.retireIfDone(state);
  }

  private async waitForCredit(state: StreamState): Promise<void> {
    for (;;) {
      if (state.reset || this.closed) throw new PumpStopped();
      if (state.sendWindow > 0) return;
      await new Promise<void>((resolve) => state.creditWaiters.push(resolve));
    }
  }

  private async waitForTransport(state: StreamState): Promise<void> {
    while (this.transport.bufferedAmount() > TRANSPORT_HIGH_WATER_BYTES) {
      if (state.reset || this.closed) throw new PumpStopped();
      // Woken by a transport `drain`; the timer covers transports (the
      // WebSocket client) that never announce one. Either way the waiter
      // leaves the set, so a stalled socket costs nothing per tick.
      await new Promise<void>((resolve) => {
        const wake = (): void => {
          clearTimeout(timer);
          this.drainWaiters.delete(wake);
          resolve();
        };
        const timer = setTimeout(wake, 10);
        this.drainWaiters.add(wake);
      });
    }
    if (state.reset || this.closed) throw new PumpStopped();
  }

  private resetStream(
    state: StreamState,
    code: string,
    message: string | undefined,
    notifyPeer: boolean,
  ): void {
    if (state.reset) return;
    if (notifyPeer && !this.closed && !(state.sentEnd && state.receivedEnd)) {
      this.sendFrame(
        FRAME.RESET,
        state.id,
        encoder.encode(JSON.stringify({ code, message })),
      );
    }
    this.teardown(state, new TunnelStreamResetError(code, message));
    this.streams.delete(state.id);
  }

  private teardown(state: StreamState, error: Error): void {
    state.reset = true;
    state.abort.abort(error);
    state.inbound.fail(error);
    const waiter = state.onHead;
    state.onHead = undefined;
    waiter?.reject(error);
    const credit = state.creditWaiters;
    state.creditWaiters = [];
    for (const w of credit) w();
    state.source?.cancel(error).catch((err: unknown) => {
      console.warn('[sandbox.devices] body source cancel failed:', err);
    });
  }

  private retireIfDone(state: StreamState): void {
    if (state.sentEnd && state.receivedEnd) this.streams.delete(state.id);
  }

  private sendFrame(type: number, id: number, payload?: Uint8Array): void {
    try {
      this.transport.send(encodeFrame(type, id, payload));
    } catch (err) {
      const reason = `device tunnel send failed: ${err instanceof Error ? err.message : String(err)}`;
      // A lost frame breaks the framing for good: drop the socket too, so
      // both sides see the tunnel gone instead of half of it.
      try {
        this.transport.close(TUNNEL_CLOSE.SEND_FAILED, 'a frame was dropped');
      } catch (closeErr) {
        console.warn('[sandbox.devices] tunnel close failed:', closeErr);
      }
      this.close(new TunnelClosedError(reason));
    }
  }

  private protocolError(reason: string): void {
    console.warn(`[sandbox.devices] tunnel protocol error: ${reason}`);
    try {
      this.transport.close(TUNNEL_CLOSE.PROTOCOL_ERROR, reason);
    } catch (err) {
      console.warn('[sandbox.devices] tunnel close failed:', err);
    }
    this.close(
      new TunnelClosedError(`device tunnel protocol error: ${reason}`),
    );
  }
}
