/**
 * Shared helper functions for extraction modules.
 */

import type { VisionClient } from './vision_client';

export const MIN_IMAGE_SIZE = 10_000; // ~100x100 pixels

/** A simple async concurrency limiter (the asyncio.Semaphore replacement). */
export class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      const next = this.waiters.shift();
      if (next) {
        next();
      }
    }
  }
}

/**
 * Describe a single image via the vision client, gated by `semaphore`. Skips
 * images below {@link MIN_IMAGE_SIZE} and swallows per-image failures (logged)
 * so one bad image does not abort a whole document.
 */
export async function describeImageBytes(
  imageBytes: Uint8Array,
  semaphore: Semaphore,
  visionClient: VisionClient,
): Promise<string> {
  return semaphore.run(async () => {
    try {
      if (imageBytes.length < MIN_IMAGE_SIZE) {
        return '';
      }
      return await visionClient.describeImage(imageBytes);
    } catch (err) {
      console.warn(
        `Failed to describe image: ${err instanceof Error ? err.message : String(err)}`,
      );
      return '';
    }
  });
}

/** Render a grid of cell strings as pipe-joined rows. */
export function extractTableText(rows: string[][]): string {
  return rows
    .map((row) => row.map((cell) => cell.trim()).join(' | '))
    .join('\n');
}
