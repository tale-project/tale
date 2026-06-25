import { describe, expect, it, vi } from 'vitest';

// The module pulls in `components` from the generated API and the agent SDK at
// import time; stub them so we can import the pure `emptyStreamsResult` helper
// without a full Convex test harness.
vi.mock('../_generated/api', () => ({ components: { agent: {} } }));
vi.mock('../_generated/server', () => ({}));

const { emptyStreamsResult } = await import('./get_thread_messages_streaming');

describe('emptyStreamsResult', () => {
  it('returns undefined when the client did not request streams', () => {
    // No `streamArgs` → the agent client treats `streams: undefined` as "no
    // streaming", which is exactly what the non-streaming fallback wants.
    expect(emptyStreamsResult(undefined)).toBeUndefined();
  });

  it('returns an empty list payload for a list request', () => {
    // Must match the shape the client reads (`streams.messages`). Returning a
    // bespoke sentinel here is what crashed `useDeltaStreams` (.messages was
    // undefined → `.filter` of undefined).
    expect(emptyStreamsResult({ kind: 'list' })).toEqual({
      kind: 'list',
      messages: [],
    });
  });

  it('returns an empty deltas payload for a deltas request', () => {
    expect(emptyStreamsResult({ kind: 'deltas', cursors: [] })).toEqual({
      kind: 'deltas',
      deltas: [],
    });
  });
});
