import { readFile } from 'node:fs/promises';
/**
 * Verify the stream delta throttle configuration.
 *
 * The saveStreamDeltas.throttleMs value trades off two concerns:
 * - First-token latency: the SDK flushes the first delta immediately
 *   (initial #latestWrite=0 makes the throttle check pass on the first
 *    addParts call), so this knob does NOT affect TTFT.
 * - Stream row volume + main-thread cost: each Convex push triggers a
 *   full UIMessage rebuild from cursor=0 in the agent SDK's
 *   `useStreamingUIMessages` hook. With huge tool inputs the per-push
 *   cost becomes O(N²) over the delta count. A larger throttle reduces
 *   N proportionally.
 *
 * Tale settled on 250ms (the SDK default) after a 2-round review found
 * that 100ms produced enough rows for `useStreamingUIMessages` to stall
 * the main thread on long artifact_create calls, while 500ms showed
 * visible chunkiness because Tale has no inter-push smoothing layer
 * (`useStreamBuffer` smooths within a buffer, not between Convex pushes).
 *
 * This test reads the source file to verify the configuration value,
 * ensuring it stays at the chosen level and isn't accidentally reverted.
 */
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

const GENERATE_RESPONSE_PATH = resolve(
  import.meta.dirname,
  'generate_response.ts',
);

describe('saveStreamDeltas throttle configuration', () => {
  it('uses throttleMs of 250 to balance row volume and stream smoothness', async () => {
    const source = await readFile(GENERATE_RESPONSE_PATH, 'utf-8');

    // Match the saveStreamDeltas config line
    const match = source.match(
      /saveStreamDeltas:\s*\{[^}]*throttleMs:\s*(\d+)/,
    );
    expect(match).not.toBeNull();

    const throttleMs = Number(match?.[1]);
    expect(throttleMs).toBe(250);
  });

  it('stays within the [100, 400] band — outside this range either TTFT regresses or streaming feels chunky', async () => {
    const source = await readFile(GENERATE_RESPONSE_PATH, 'utf-8');

    const match = source.match(
      /saveStreamDeltas:\s*\{[^}]*throttleMs:\s*(\d+)/,
    );
    expect(match).not.toBeNull();

    const throttleMs = Number(match?.[1]);
    expect(throttleMs).toBeGreaterThanOrEqual(100);
    expect(throttleMs).toBeLessThanOrEqual(400);
  });
});
