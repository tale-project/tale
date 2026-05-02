import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  STREAM_PARSE_DELTA_BYTES,
  STREAM_PARSE_INTERVAL_MS,
  initState,
  markParsed,
  shouldParse,
} from '../stream_state';

describe('shouldParse', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('always parses while the row is not yet initialised', () => {
    const state = initState('call_pre_init', 'artifact_create');
    // Even with a tiny accumulator and no time passing, we must parse so
    // we can spot `title`/`type`/`mode` regardless of the model's field
    // order — these are needed before the placeholder row exists.
    expect(shouldParse(state, 1)).toBe(true);
    markParsed(state, 1);
    expect(shouldParse(state, 2)).toBe(true);
  });

  it('skips redundant parses inside the byte/time window after init', () => {
    const state = initState('call_init', 'artifact_create');
    state.rowInitialized = true;
    markParsed(state, 1000);
    // Below both thresholds: skip.
    vi.advanceTimersByTime(STREAM_PARSE_INTERVAL_MS - 1);
    expect(shouldParse(state, 1000 + STREAM_PARSE_DELTA_BYTES - 1)).toBe(false);
  });

  it('parses again once the byte threshold is crossed and time has passed', () => {
    const state = initState('call_byte', 'artifact_create');
    state.rowInitialized = true;
    markParsed(state, 1000);
    vi.advanceTimersByTime(STREAM_PARSE_INTERVAL_MS);
    expect(shouldParse(state, 1000 + STREAM_PARSE_DELTA_BYTES)).toBe(true);
  });

  it('still skips when bytes are large but time has not elapsed', () => {
    const state = initState('call_time', 'artifact_create');
    state.rowInitialized = true;
    markParsed(state, 1000);
    vi.advanceTimersByTime(STREAM_PARSE_INTERVAL_MS - 1);
    expect(shouldParse(state, 1000 + STREAM_PARSE_DELTA_BYTES * 10)).toBe(
      false,
    );
  });

  it('markParsed advances both the length and the timestamp', () => {
    const state = initState('call_mark', 'artifact_create');
    state.rowInitialized = true;
    markParsed(state, 500);
    expect(state.lastParsedLength).toBe(500);
    expect(state.lastParsedAt).toBe(Date.now());
  });

  it('scales the parse-gate thresholds with accumulator size', () => {
    // parsePartialJson is O(N) per call. Without scaling the gate, a 100 KB
    // accumulator would re-parse 25× per second (40 ms gate) and the action
    // becomes CPU-bound — the AI SDK queues deltas and the user perceives
    // bursty output. Above 8 KB we widen the byte threshold and the
    // minimum interval; the bigger the accumulator, the wider the window.
    // ~9 KB accumulator (just over the 8 KB large-content boundary):
    // gate is 200 bytes / 100 ms.
    const small = initState('call_scale_small', 'artifact_create');
    small.rowInitialized = true;
    markParsed(small, 9_000);
    vi.advanceTimersByTime(99); // below 100 ms gate
    expect(shouldParse(small, 9_000 + 200)).toBe(false);
    vi.advanceTimersByTime(1); // exactly 100 ms now
    expect(shouldParse(small, 9_000 + 200)).toBe(true);
    // 199 bytes is still below the byte threshold even with time elapsed.
    vi.advanceTimersByTime(1000);
    expect(shouldParse(small, 9_000 + 199)).toBe(false);

    // ~50 KB accumulator: gate is 1000 bytes / 250 ms.
    const mid = initState('call_scale_mid', 'artifact_create');
    mid.rowInitialized = true;
    markParsed(mid, 50_000);
    vi.advanceTimersByTime(249);
    expect(shouldParse(mid, 50_000 + 1_000)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(shouldParse(mid, 50_000 + 1_000)).toBe(true);

    // ~120 KB accumulator: gate is 5000 bytes / 500 ms.
    const big = initState('call_scale_big', 'artifact_create');
    big.rowInitialized = true;
    markParsed(big, 120_000);
    vi.advanceTimersByTime(499);
    expect(shouldParse(big, 120_000 + 5_000)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(shouldParse(big, 120_000 + 5_000)).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(shouldParse(big, 120_000 + 4_999)).toBe(false);
  });
});
