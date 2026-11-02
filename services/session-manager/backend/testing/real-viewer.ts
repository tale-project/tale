// The client side of the live view and of its pictures, for the whole-server
// tests of the real-browser lane.
//
// `RealViewer` is a WebSocket client that keeps what the server sends apart:
// JSON messages (parsed with the protocol's schema) and the pictures, which
// are real JPEGs (the `Viewer` of `live-view-client.ts` reads a binary message
// as text, which is right for the fake browser's pictures and wrong here).
//
//     const viewer = await RealViewer.open(`ws://127.0.0.1:${port}/api/sessions/${id}/stream`);
//     const view = await viewer.next('view');            // the next one not read yet
//     viewer.send({ t: 'mouse', a: 'down', x: 10, y: 20 });
//     const picture = await viewer.nextPicture();
//
// `JpegDecoder` decodes a picture the way a viewer's browser does: in a
// browser (its own headless Camoufox, with nothing to do with the sessions').

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { firefox } from 'playwright-core';
import type { BrowserContext, Page } from 'playwright-core';
import { z } from 'zod';

import {
  clientMessageSchema,
  serverMessageSchema,
} from '../../lib/live-view.ts';
import type { ServerMessage } from '../../lib/live-view.ts';
import { jpegSize } from '../domains/browser/playwright-remote.ts';

const WAIT_MS = 15_000;
const POLL_MS = 20;

function pause(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Polls until `read` gives something; fails after `timeoutMs` saying what it waited for. */
async function eventually<T>(
  read: () => T | undefined,
  what: string,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = read();
    if (found !== undefined) return found;
    if (Date.now() > deadline) {
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    }
    await pause(POLL_MS);
  }
}

/** What a viewer sends: the protocol's messages, with the defaults left out. */
export type ViewerMessage = z.input<typeof clientMessageSchema>;

/** The `view` message: the next pictures are of this tab, w x h CSS pixels. */
export type ViewMessage = Extract<ServerMessage, { t: 'view' }>;

/** A picture and the `view` that was in force when it came (null: none yet). */
export interface Picture {
  jpeg: Uint8Array;
  view: ViewMessage | null;
}

export class RealViewer {
  readonly socket: WebSocket;
  /** Every JSON message, in order. */
  readonly messages: ServerMessage[] = [];
  /** Every picture (binary message), in order. */
  readonly pictures: Picture[] = [];
  /** Resolves when the connection has closed. */
  readonly closed: Promise<{ code: number; reason: string }>;
  readonly #read = new Map<ServerMessage['t'], number>();
  #picturesRead = 0;
  #view: ViewMessage | null = null;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('message', (event: MessageEvent<unknown>) => {
      const { data } = event;
      if (typeof data === 'string') {
        const message = serverMessageSchema.parse(JSON.parse(data));
        if (message.t === 'view') this.#view = message;
        this.messages.push(message);
      } else if (data instanceof ArrayBuffer) {
        this.pictures.push({ jpeg: new Uint8Array(data), view: this.#view });
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
  static open(url: string): Promise<RealViewer> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const viewer = new RealViewer(socket);
      socket.addEventListener('open', () => {
        resolve(viewer);
      });
      socket.addEventListener('error', () => {
        reject(new Error('the handshake was refused'));
      });
    });
  }

  send(message: ViewerMessage): void {
    this.socket.send(JSON.stringify(clientMessageSchema.parse(message)));
  }

  /** The messages of this type that came so far. */
  of<T extends ServerMessage['t']>(
    type: T,
  ): Extract<ServerMessage, { t: T }>[] {
    return this.messages.filter(
      (message): message is Extract<ServerMessage, { t: T }> =>
        message.t === type,
    );
  }

  /** The next message of this type that has not been read yet. */
  async next<T extends ServerMessage['t']>(
    type: T,
    timeoutMs = WAIT_MS,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const index = this.#read.get(type) ?? 0;
    const found = await eventually(
      () => this.of(type)[index],
      `a ${type} message`,
      timeoutMs,
    );
    this.#read.set(type, index + 1);
    return found;
  }

  /** The next picture that has not been read yet. */
  async nextPicture(timeoutMs = WAIT_MS): Promise<Picture> {
    const found = await eventually(
      () => this.pictures[this.#picturesRead],
      'a picture',
      timeoutMs,
    );
    this.#picturesRead += 1;
    return found;
  }

  /** What arrives from now on is what the next picture is read from. */
  skipPictures(): void {
    this.#picturesRead = this.pictures.length;
  }

  /** The first picture from now on for which `check` holds. */
  async untilPicture(
    check: (picture: Picture) => Promise<boolean>,
    what: string,
    timeoutMs = WAIT_MS,
  ): Promise<Picture> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
      }
      const picture = await this.nextPicture(remaining);
      if (await check(picture)) return picture;
    }
  }

  close(): void {
    this.socket.close();
  }
}

// -- pictures -------------------------------------------------------------------------

/** A JPEG starts with FF D8 FF and ends with FF D9. */
export function looksLikeJpeg(bytes: Uint8Array): boolean {
  const n = bytes.length;
  return (
    n > 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[n - 2] === 0xff &&
    bytes[n - 1] === 0xd9
  );
}

/** The width and height that a JPEG says it has. */
export function sizeOfJpeg(bytes: Uint8Array): {
  width: number;
  height: number;
} {
  const size = jpegSize(bytes);
  if (size === null) throw new Error('the picture has no frame header');
  return size;
}

const decodedSchema = z.object({
  width: z.number(),
  height: z.number(),
  pixels: z.array(z.tuple([z.number(), z.number(), z.number()])),
});

/** A picture as a browser decoded it: its size and the colours (red, green, blue) at some places. */
export type DecodedPicture = z.infer<typeof decodedSchema>;

export class JpegDecoder {
  readonly #context: BrowserContext;
  readonly #page: Page;
  readonly #profile: string;

  private constructor(context: BrowserContext, page: Page, profile: string) {
    this.#context = context;
    this.#page = page;
    this.#profile = profile;
  }

  /** Starts the browser that decodes. */
  static async launch(): Promise<JpegDecoder> {
    const { launchOptions } = await import('camoufox-js');
    const options = await launchOptions({
      headless: true,
      os: 'windows',
      geoip: false,
      locale: 'en-US',
      exclude_addons: ['UBO'],
    });
    const profile = mkdtempSync(join(tmpdir(), 'sm-decoder-'));
    try {
      const context = await firefox.launchPersistentContext(profile, {
        ...options,
        viewport: null,
      });
      const page = context.pages()[0] ?? (await context.newPage());
      return new JpegDecoder(context, page, profile);
    } catch (error) {
      rmSync(profile, { recursive: true, force: true });
      throw error;
    }
  }

  /** Decodes the picture; `points` are the places whose colours are wanted. */
  async decode(
    jpeg: Uint8Array,
    points: readonly (readonly [number, number])[] = [],
  ): Promise<DecodedPicture> {
    const decoded: unknown = await this.#page.evaluate(
      async ({ base64, at }) => {
        const image = new Image();
        image.src = `data:image/jpeg;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('the canvas has no 2d context');
        context.drawImage(image, 0, 0);
        return {
          width: image.naturalWidth,
          height: image.naturalHeight,
          pixels: at.map(([x, y]) =>
            Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3)),
          ),
        };
      },
      { base64: Buffer.from(jpeg).toString('base64'), at: points },
    );
    return decodedSchema.parse(decoded);
  }

  async close(): Promise<void> {
    try {
      await this.#context.close();
    } finally {
      rmSync(this.#profile, { recursive: true, force: true });
    }
  }
}
