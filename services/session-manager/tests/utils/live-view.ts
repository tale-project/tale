// Stand-ins for what jsdom does not have, for the tests of the live view: it
// lays nothing out, observes no resizing and draws no pictures.

import { vi, type Mock } from 'vitest';

import type {
  ClientMessageInput,
  FrameListener,
  LiveView,
  SelectionListener,
} from '@/app/features/session-viewer/hooks/use-live-view';
import { HeldKeys } from '@/app/features/session-viewer/lib/keys';

export interface Room {
  width: number;
  height: number;
}

/**
 * Gives elements the room that `room(element)` says: jsdom lays nothing out,
 * so every element is zero pixels wide and high.
 */
export function stubLayout(room: (element: Element) => Room): void {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(
    function (this: Element) {
      return room(this).width;
    },
  );
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(
    function (this: Element) {
      return room(this).height;
    },
  );
}

/** The same room for every element. */
export function stubRoom(width: number, height: number): void {
  stubLayout(() => ({ width, height }));
}

/** What an observer reports of an element: jsdom has no layout, so no size in it. */
function entryOf(target: Element): ResizeObserverEntry {
  const box = [{ inlineSize: 0, blockSize: 0 }];
  return {
    target,
    contentRect: target.getBoundingClientRect(),
    borderBoxSize: box,
    contentBoxSize: box,
    devicePixelContentBoxSize: box,
  };
}

/** A `ResizeObserver` that reports when the test says the elements were resized. */
export class ControlledResizeObserver implements ResizeObserver {
  static instances: ControlledResizeObserver[] = [];

  /** Tells every observer that something it watches was resized. */
  static resizeAll(): void {
    for (const observer of ControlledResizeObserver.instances) {
      observer.callback(observer.targets.map(entryOf), observer);
    }
  }

  static install(): void {
    ControlledResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', ControlledResizeObserver);
  }

  /** What it was asked to watch. */
  readonly targets: Element[] = [];
  observe = vi.fn((target: Element) => {
    this.targets.push(target);
  });
  unobserve = vi.fn();
  disconnect = vi.fn();

  constructor(private readonly callback: ResizeObserverCallback) {
    ControlledResizeObserver.instances.push(this);
  }
}

/** Bytes that start like a JPEG: the page never looks inside. */
export function jpegBytes(...more: number[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array([0xff, 0xd8, ...more, 0xff, 0xd9]);
}

export interface Bitmap {
  width: number;
  height: number;
  close: () => void;
}

export interface Drawing {
  /** What was drawn on the canvas, picture by picture. */
  drawImage: Mock<(bitmap: Bitmap, x: number, y: number) => void>;
  /** The decoded pictures that were let go. */
  close: Mock<() => void>;
  /** The decoding of a picture: what was asked to be decoded is in `mock.calls`. */
  createImageBitmap: Mock<(picture: Blob) => Promise<Bitmap>>;
  restore: () => void;
}

/**
 * Lets pictures be decoded and drawn: `createImageBitmap` answers with a
 * bitmap of `size`, and a canvas has a context that records `drawImage`.
 */
export function stubDrawing(
  size: Room = { width: 1280, height: 800 },
): Drawing {
  const drawImage = vi.fn<(bitmap: Bitmap, x: number, y: number) => void>();
  const close = vi.fn<() => void>();
  const createImageBitmap = vi.fn<(picture: Blob) => Promise<Bitmap>>(
    async () => ({ width: size.width, height: size.height, close }),
  );
  vi.stubGlobal('createImageBitmap', createImageBitmap);
  const original = Object.getOwnPropertyDescriptor(
    HTMLCanvasElement.prototype,
    'getContext',
  );
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({ drawImage })),
  });
  return {
    drawImage,
    close,
    createImageBitmap,
    restore: () => {
      if (original) {
        Object.defineProperty(
          HTMLCanvasElement.prototype,
          'getContext',
          original,
        );
      }
    },
  };
}

export interface FakeLive {
  live: LiveView;
  /** What the page sent, as the messages of the protocol. */
  send: ReturnType<typeof vi.fn<(message: ClientMessageInput) => boolean>>;
  /** The server sends a picture. */
  emitFrame: (...bytes: number[]) => void;
  /** The server answers a copy. */
  emitSelection: (text: string, cut?: boolean) => void;
}

/**
 * A live view that the test drives by hand: `emitFrame` and `emitSelection`
 * are what the server sends, `send` records what the page sends back. It is
 * live, with a page of 1280 x 800, unless `overrides` say otherwise.
 */
export function fakeLive(overrides: Partial<LiveView> = {}): FakeLive {
  const frames = new Set<FrameListener>();
  const selections = new Set<SelectionListener>();
  const send = vi.fn<(message: ClientMessageInput) => boolean>(() => true);
  const live: LiveView = {
    state: 'live',
    failures: 0,
    end: null,
    tabs: [],
    view: { tab: 1, w: 1280, h: 800 },
    dialogs: [],
    selectMenu: null,
    send,
    onFrame: (listener) => {
      frames.add(listener);
      return () => {
        frames.delete(listener);
      };
    },
    onSelection: (listener) => {
      selections.add(listener);
      return () => {
        selections.delete(listener);
      };
    },
    answerDialog: vi.fn(),
    pickOption: vi.fn(),
    heldKeys: new HeldKeys(),
    retry: vi.fn(),
    ...overrides,
  };
  return {
    live,
    send,
    emitFrame: (...bytes) => {
      for (const listener of frames) listener(jpegBytes(...bytes).buffer);
    },
    emitSelection: (text, cut = false) => {
      for (const listener of selections) listener({ text, cut });
    },
  };
}
