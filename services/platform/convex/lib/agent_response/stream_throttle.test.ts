import { readFile } from 'node:fs/promises';
/**
 * Verify the stream delta throttle configuration.
 *
 * The saveStreamDeltas.throttleMs value directly impacts perceived TTFT:
 * - 200ms (old): up to 200ms delay after LLM produces first token
 * - 100ms (new): halves the worst-case delay for first token persistence
 *
 * This test reads the source file to verify the configuration value,
 * ensuring it stays at the optimized level and isn't accidentally reverted.
 */
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

const GENERATE_RESPONSE_PATH = resolve(
  import.meta.dirname,
  'generate_response.ts',
);

describe('saveStreamDeltas throttle configuration', () => {
  it('uses throttleMs of 100 for faster first-token delivery', async () => {
    const source = await readFile(GENERATE_RESPONSE_PATH, 'utf-8');

    // Match the saveStreamDeltas config line
    const match = source.match(
      /saveStreamDeltas:\s*\{[^}]*throttleMs:\s*(\d+)/,
    );
    expect(match).not.toBeNull();

    const throttleMs = Number(match?.[1]);
    expect(throttleMs).toBe(100);
  });

  it('does not exceed 150ms throttle to maintain TTFT target', async () => {
    const source = await readFile(GENERATE_RESPONSE_PATH, 'utf-8');

    const match = source.match(
      /saveStreamDeltas:\s*\{[^}]*throttleMs:\s*(\d+)/,
    );
    expect(match).not.toBeNull();

    const throttleMs = Number(match?.[1]);
    expect(throttleMs).toBeLessThanOrEqual(150);
  });
});
