import { expect, type Page, type WebSocket } from '@playwright/test';

import {
  clientMessageSchema,
  serverMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from '../../../lib/live-view';
import { TIMEOUT } from './env';

/** What went over the live view's socket, parsed as each side parses it. */
export interface LiveViewWatch {
  /** The messages the page sent, in order. */
  sent(): ClientMessage[];
  /** The text messages the server sent (the view, the tabs, notices, errors). */
  received(): ServerMessage[];
  /** How many pictures the server sent. */
  pictures(): number;
}

/**
 * Watches the live view of the page from the moment it is called: call it
 * before the page opens a session.
 */
export function watchLiveView(page: Page): LiveViewWatch {
  const sent: ClientMessage[] = [];
  const received: ServerMessage[] = [];
  let pictures = 0;
  page.on('websocket', (socket: WebSocket) => {
    if (!socket.url().includes('/stream')) return;
    socket.on('framesent', ({ payload }) => {
      if (typeof payload === 'string') {
        sent.push(clientMessageSchema.parse(JSON.parse(payload)));
      }
    });
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string') {
        received.push(serverMessageSchema.parse(JSON.parse(payload)));
      } else {
        pictures += 1;
      }
    });
  });
  return {
    sent: () => sent,
    received: () => received,
    pictures: () => pictures,
  };
}

/** Resolves once the server has sent at least `count` pictures. */
export async function waitForPictures(
  watch: LiveViewWatch,
  count = 1,
): Promise<void> {
  await expect
    .poll(() => watch.pictures(), {
      timeout: TIMEOUT.PICTURE,
      message: 'the live view shows a picture',
    })
    .toBeGreaterThanOrEqual(count);
}
