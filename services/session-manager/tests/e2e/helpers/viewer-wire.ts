import { randomBytes } from 'node:crypto';
import net from 'node:net';

import type { ClientMessage } from '../../../lib/live-view';

/** How the server said goodbye: the code of its closing frame, and the reason it gave. */
export interface Goodbye {
  code: number;
  reason: string;
}

/** The end of the head of an HTTP message. */
const HEAD_END = '\r\n\r\n';
/** The opcodes of a WebSocket frame that this client needs to tell apart (RFC 6455, 5.2). */
const OPCODE_TEXT = 0x1;
const OPCODE_CLOSE = 0x8;
/** The longest payload a frame header holds in its 7 bits; 126 says that two more bytes hold the length, 127 that eight do. */
const LENGTH_IN_HEADER = 125;
const LENGTH_IN_TWO_BYTES = 126;
const LENGTH_IN_EIGHT_BYTES = 127;
const LARGEST_TWO_BYTES = 0xffff;
/** The code of a closing frame that says nothing (RFC 6455, 7.1.5). */
const NO_STATUS = 1005;

/**
 * A viewer made of a bare TCP socket, for what a browser would never do: it
 * stops reading. It speaks as much of the WebSocket protocol as that takes (the
 * handshake, text frames it sends, and the frames it is sent, which it only
 * looks through for the closing one), and after the handshake it reads nothing
 * until it is asked to: the server's messages wait in the buffers of the
 * socket, as they would for a page whose tab is frozen.
 */
export class RawViewer {
  /** What has been read and has not been taken apart yet. */
  #received: Buffer;

  private constructor(
    private readonly socket: net.Socket,
    afterHandshake: Buffer,
  ) {
    this.#received = afterHandshake;
  }

  /** Opens the live view of the session, as the app's own page does (its host, its origin), and stops reading. */
  static async connect(options: {
    /** The backend's port: the worker's own (`server.port`). */
    port: number;
    sessionId: number;
  }): Promise<RawViewer> {
    const host = `localhost:${options.port}`;
    const socket = net.connect(options.port, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    socket.write(
      [
        `GET /api/sessions/${options.sessionId}/stream HTTP/1.1`,
        `Host: ${host}`,
        `Origin: http://${host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n'),
    );
    const answer = await new Promise<Buffer>((resolve, reject) => {
      let head = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        head = Buffer.concat([head, chunk]);
        if (!head.includes(HEAD_END)) return;
        socket.off('data', onData);
        socket.off('error', reject);
        resolve(head);
      };
      socket.on('data', onData);
      socket.once('error', reject);
    });
    // Reading stops here: what the server sends from now on is not taken from the socket.
    socket.pause();
    const end = answer.indexOf(HEAD_END) + HEAD_END.length;
    const status = answer.subarray(0, answer.indexOf('\r\n')).toString();
    if (!status.includes(' 101 ')) {
      socket.destroy();
      throw new Error(`The live view did not open: ${status}`);
    }
    return new RawViewer(socket, answer.subarray(end));
  }

  /** Sends a message of the live view: a text frame, masked as the frames of a client must be. */
  send(message: ClientMessage): void {
    const payload = Buffer.from(JSON.stringify(message));
    const mask = randomBytes(4);
    const masked = Buffer.from(payload);
    for (const [index, byte] of masked.entries()) {
      masked[index] = byte ^ (mask[index % mask.length] ?? 0);
    }
    const fin = 0x80;
    const hasMask = 0x80;
    let head: Buffer;
    if (payload.length <= LENGTH_IN_HEADER) {
      head = Buffer.from([fin | OPCODE_TEXT, hasMask | payload.length]);
    } else if (payload.length <= LARGEST_TWO_BYTES) {
      head = Buffer.alloc(4);
      head[0] = fin | OPCODE_TEXT;
      head[1] = hasMask | LENGTH_IN_TWO_BYTES;
      head.writeUInt16BE(payload.length, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = fin | OPCODE_TEXT;
      head[1] = hasMask | LENGTH_IN_EIGHT_BYTES;
      head.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    this.socket.write(Buffer.concat([head, mask, masked]));
  }

  /**
   * Starts reading again, and resolves with what the server said as it ended
   * the connection: everything it sent before is read and let go of.
   */
  untilGoodbye(timeoutMs: number): Promise<Goodbye> {
    return new Promise<Goodbye>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('The server did not end the connection'));
      }, timeoutMs);
      const finish = (outcome: () => void) => {
        clearTimeout(timer);
        outcome();
      };
      const look = () => {
        const goodbye = this.#goodbyeAmongFrames();
        if (goodbye !== null) finish(() => resolve(goodbye));
      };
      this.socket.on('data', (chunk: Buffer) => {
        this.#received = Buffer.concat([this.#received, chunk]);
        look();
      });
      this.socket.once('close', () => {
        finish(() => {
          reject(new Error('The connection closed without a closing frame'));
        });
      });
      this.socket.once('error', (error) => finish(() => reject(error)));
      look();
      this.socket.resume();
    });
  }

  destroy(): void {
    this.socket.destroy();
  }

  /** Takes the frames that have come whole apart, and returns what the closing one says, if it is among them. */
  #goodbyeAmongFrames(): Goodbye | null {
    for (;;) {
      const frame = this.#takeFrame();
      if (frame === null) return null;
      if (frame.opcode !== OPCODE_CLOSE) continue;
      const { payload } = frame;
      return {
        code: payload.length >= 2 ? payload.readUInt16BE(0) : NO_STATUS,
        reason: payload.subarray(2).toString('utf8'),
      };
    }
  }

  /** The first frame that has come whole, taken out of what was read; null while it has not. */
  #takeFrame(): { opcode: number; payload: Buffer } | null {
    const bytes = this.#received;
    if (bytes.length < 2) return null;
    const opcode = (bytes[0] ?? 0) & 0x0f;
    let length = (bytes[1] ?? 0) & 0x7f;
    let start = 2;
    if (length === LENGTH_IN_TWO_BYTES) {
      if (bytes.length < 4) return null;
      length = bytes.readUInt16BE(2);
      start = 4;
    } else if (length === LENGTH_IN_EIGHT_BYTES) {
      if (bytes.length < 10) return null;
      length = Number(bytes.readBigUInt64BE(2));
      start = 10;
    }
    if (bytes.length < start + length) return null;
    this.#received = bytes.subarray(start + length);
    return { opcode, payload: bytes.subarray(start, start + length) };
  }
}
