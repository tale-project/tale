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
});
