import { vi } from 'vitest';

/**
 * A stand-in for the browser's `WebSocket` in tests of the live view. The test
 * plays the server: `emitOpen()`, `emitMessage(...)` and `emitClose()` deliver
 * what the server would, `sent` and `messages` hold what the page sent.
 *
 * ```ts
 * beforeEach(() => FakeWebSocket.install());
 * afterEach(() => vi.unstubAllGlobals());
 *
 * const socket = FakeWebSocket.last;
 * socket.emitOpen();
 * socket.emitMessage({ t: 'tabs', tabs: [] }); // a JSON text message
 * socket.emitMessage(jpegBytes); // a binary message
 * ```
 *
 * It behaves like the real thing where a page could trip: sending before the
 * connection is open throws, `close()` only starts closing (the `close` event
 * comes with `emitClose()`), and a binary message arrives as a `Blob` unless
 * the page asked for `binaryType = 'arraybuffer'`.
 */
export class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  /** Every socket opened since the last `reset`, oldest first. */
  static instances: FakeWebSocket[] = [];

  /** The socket opened last. Throws when none was opened: the test expected one. */
  static get last(): FakeWebSocket {
    const socket = FakeWebSocket.instances.at(-1);
    if (socket === undefined) throw new Error('no WebSocket was opened');
    return socket;
  }

  /** Forgets the sockets opened so far. */
  static reset(): void {
    FakeWebSocket.instances = [];
  }

  /** Replaces the global `WebSocket` (undo with `vi.unstubAllGlobals()`). */
  static install(): typeof FakeWebSocket {
    FakeWebSocket.reset();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    return FakeWebSocket;
  }

  readonly CONNECTING = FakeWebSocket.CONNECTING;
  readonly OPEN = FakeWebSocket.OPEN;
  readonly CLOSING = FakeWebSocket.CLOSING;
  readonly CLOSED = FakeWebSocket.CLOSED;

  readonly url: string;
  binaryType: BinaryType = 'blob';
  readyState: number = FakeWebSocket.CONNECTING;
  /** The text messages the page sent, as sent. */
  readonly sent: string[] = [];
  /** The binary messages the page sent. */
  readonly sentBinary: unknown[] = [];
  /** The calls of `close()`, oldest first. */
  readonly closeCalls: { code: number | undefined; reason: string }[] = [];

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  /** The text messages the page sent, parsed. */
  get messages(): Record<string, unknown>[] {
    return this.sent.map((text) => {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error(
          `the page sent something that is not an object: ${text}`,
        );
      }
      return { ...parsed };
    });
  }

  /** The messages of one kind (`t`) the page sent, parsed. */
  messagesOf(type: string): Record<string, unknown>[] {
    return this.messages.filter((message) => message.t === type);
  }

  send(data: unknown): void {
    if (this.readyState === FakeWebSocket.CONNECTING) {
      throw new DOMException('Still in CONNECTING state.', 'InvalidStateError');
    }
    // A closing or closed socket drops what is sent, silently.
    if (this.readyState !== FakeWebSocket.OPEN) return;
    if (typeof data === 'string') this.sent.push(data);
    else this.sentBinary.push(data);
  }

  close(code?: number, reason = ''): void {
    if (
      this.readyState === FakeWebSocket.CLOSING ||
      this.readyState === FakeWebSocket.CLOSED
    ) {
      return;
    }
    this.readyState = FakeWebSocket.CLOSING;
    this.closeCalls.push({ code, reason });
  }

  /** The connection is established. */
  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  /**
   * The server sent a message. A string is a text message as it is, bytes are
   * a binary message, anything else is sent as JSON text.
   */
  emitMessage(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: this.wire(data) }));
  }

  /** The connection ended (by the server, the network, or after `close()`). */
  emitClose(code = 1006, reason = ''): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(
      new CloseEvent('close', { code, reason, wasClean: code === 1000 }),
    );
  }

  emitError(): void {
    this.dispatchEvent(new Event('error'));
  }

  private wire(data: unknown): string | ArrayBuffer | Blob {
    if (typeof data === 'string') return data;
    if (data instanceof ArrayBuffer) return this.binary(data);
    if (ArrayBuffer.isView(data)) {
      // Copy out of a larger buffer: a message is exactly the bytes sent.
      const copy = new Uint8Array(data.byteLength);
      copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      return this.binary(copy.buffer);
    }
    return JSON.stringify(data);
  }

  private binary(buffer: ArrayBuffer): ArrayBuffer | Blob {
    return this.binaryType === 'arraybuffer' ? buffer : new Blob([buffer]);
  }
}
