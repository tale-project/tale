/** Timestamped native compositor frames shared by narrated docs and silent marketing clips. */
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import type { CDPSession } from '@playwright/test';
export interface FrameLogEntry {
  readonly file: string;
  /** Milliseconds since the first captured frame. */
  readonly tMs: number;
}

/** Collects screencast frames to disk and acks each one (flow control). */
export function attachScreencastSink(
  cdp: CDPSession,
  dir: string,
): {
  frames: FrameLogEntry[];
  firstFrameAt: () => Promise<number>;
} {
  const frames: FrameLogEntry[] = [];
  let t0: number | null = null;
  let resolveFirst: ((ts: number) => void) | null = null;
  const firstFrame = new Promise<number>((resolve) => {
    resolveFirst = resolve;
  });

  cdp.on(
    'Page.screencastFrame',
    (event: {
      data: string;
      sessionId: number;
      metadata: { timestamp?: number };
    }) => {
      const timestamp = event.metadata.timestamp ?? 0;
      if (t0 === null) {
        t0 = timestamp;
        resolveFirst?.(timestamp);
      }
      const file = `f${String(frames.length + 1).padStart(6, '0')}.jpg`;
      writeFileSync(path.join(dir, file), Buffer.from(event.data, 'base64'));
      frames.push({ file, tMs: Math.round((timestamp - t0) * 1000) });
      cdp
        .send('Page.screencastFrameAck', { sessionId: event.sessionId })
        .catch((error) => {
          console.warn('screencastFrameAck failed:', error);
        });
    },
  );

  return { frames, firstFrameAt: () => firstFrame };
}
