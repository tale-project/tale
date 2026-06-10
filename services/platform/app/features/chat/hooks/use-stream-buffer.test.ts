import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  clearDisplayPositionCache,
  consumeFrozenDisplayText,
  findCachedPosition,
  freezeActiveStream,
  isStreamFrozen,
  resetGlobalFreeze,
  saveToCache,
  useStreamBuffer,
} from './use-stream-buffer';

// Mock reduced motion — default to no preference
vi.mock('@/app/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: vi.fn(() => false),
}));

import { usePrefersReducedMotion } from '@/app/hooks/use-prefers-reduced-motion';

// ============================================================================
// rAF MOCK — allows advancing animation frames manually
// ============================================================================

let rafCallbacks: Map<number, FrameRequestCallback>;
let rafId: number;
let mockNow: number;

function setupAnimationMocks() {
  rafCallbacks = new Map();
  rafId = 0;
  mockNow = 0;

  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((cb: FrameRequestCallback) => {
      const id = ++rafId;
      rafCallbacks.set(id, cb);
      return id;
    }),
  );

  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => {
      rafCallbacks.delete(id);
    }),
  );

  vi.spyOn(performance, 'now').mockImplementation(() => mockNow);
}

/**
 * Advance time and run all pending rAF callbacks.
 * Each call simulates one frame at ~60fps (16.67ms).
 */
function advanceFrames(count: number) {
  for (let i = 0; i < count; i++) {
    mockNow += 16.67;
    const callbacks = new Map(rafCallbacks);
    rafCallbacks.clear();
    for (const [, cb] of callbacks) {
      cb(mockNow);
    }
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('useStreamBuffer', () => {
  beforeEach(() => {
    resetGlobalFreeze();
    clearDisplayPositionCache();
    setupAnimationMocks();
    vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
  });

  afterEach(() => {
    resetGlobalFreeze();
    clearDisplayPositionCache();
    vi.restoreAllMocks();
  });

  describe('non-streaming (historical messages)', () => {
    it('shows all text immediately when not streaming', () => {
      const text = 'Hello world, this is a complete message.';
      const { result } = renderHook(() =>
        useStreamBuffer({
          text,
          isStreaming: false,
        }),
      );

      expect(result.current.displayLength).toBe(text.length);
      expect(result.current.progress).toBe(1);
      expect(result.current.isTyping).toBe(false);
    });

    it('shows empty text without error', () => {
      const { result } = renderHook(() =>
        useStreamBuffer({ text: '', isStreaming: false }),
      );

      expect(result.current.displayLength).toBe(0);
      expect(result.current.progress).toBe(1);
    });

    it('is fully revealed on the FIRST render, before effects (no blank frame)', () => {
      // A completed message remounting (chat switch, branch/version switch)
      // must paint whole on its very first frame. Capture the render-phase
      // value — renderHook's result only reflects the post-effect state.
      const text =
        'A completed message that remounts on chat or branch switch.';
      const renderPhaseLengths: number[] = [];
      renderHook(() => {
        const res = useStreamBuffer({ text, isStreaming: false });
        renderPhaseLengths.push(res.displayLength);
        return res;
      });

      expect(renderPhaseLengths[0]).toBe(text.length);
    });

    it('continues reveal from the mounted length when streaming starts later', () => {
      // Non-streaming mount (fully revealed), then late chunks arrive and
      // isStreaming flips true with longer text: the reveal must continue
      // from the existing position, not restart at 0.
      const initial = 'Initial complete text, already shown in full.';
      const extended = `${initial} And now a late continuation arrives, with more clauses.`;
      const { result, rerender } = renderHook(
        ({ text, isStreaming }) => useStreamBuffer({ text, isStreaming }),
        { initialProps: { text: initial, isStreaming: false } },
      );

      expect(result.current.displayLength).toBe(initial.length);

      rerender({ text: extended, isStreaming: true });
      act(() => advanceFrames(5));

      expect(result.current.displayLength).toBeGreaterThanOrEqual(
        initial.length,
      );
    });
  });

  describe('initial buffering', () => {
    it('delays reveal until enough characters are buffered', () => {
      const { result } = renderHook(() =>
        useStreamBuffer({
          text: 'Hi',
          isStreaming: true,
          initialBufferChars: 50,
        }),
      );

      // Advance several frames — should not start revealing with only 2 chars
      act(() => advanceFrames(10));

      expect(result.current.displayLength).toBe(0);
    });

    it('starts reveal once initial buffer threshold is met', () => {
      const { result, rerender } = renderHook(
        ({ text, isStreaming }) =>
          useStreamBuffer({ text, isStreaming, initialBufferChars: 20 }),
        { initialProps: { text: 'short', isStreaming: true } },
      );

      act(() => advanceFrames(5));
      expect(result.current.displayLength).toBe(0);

      mockNow += 200;

      // Add more text to meet character threshold. Includes a clause
      // separator so a complete segment is available to reveal.
      rerender({
        text: 'short text, that exceeds twenty chars easily.',
        isStreaming: true,
      });

      // Advance past initial buffer time
      act(() => advanceFrames(60));
      expect(result.current.displayLength).toBeGreaterThan(0);
    });
  });

  describe('rate-matched output', () => {
    it('reveals text steadily without aggressive catch-up', () => {
      // Use a long text (2000+ chars) so the adaptive CPS never catches up
      // within the test's frame budget, preventing delta === 0 false failures.
      const longText = 'The quick brown fox jumps over the lazy dog. '.repeat(
        50,
      );

      const { result } = renderHook(() =>
        useStreamBuffer({
          text: longText,
          isStreaming: true,
          initialBufferChars: 3,
        }),
      );

      // Advance past initial buffer
      act(() => advanceFrames(30));
      const len1 = result.current.displayLength;

      act(() => advanceFrames(30));
      const len2 = result.current.displayLength;

      act(() => advanceFrames(30));
      const len3 = result.current.displayLength;

      // Both intervals should reveal roughly similar amounts (steady rate)
      const delta1 = len2 - len1;
      const delta2 = len3 - len2;

      // Ensure animation actually progressed in both intervals
      expect(delta1).toBeGreaterThan(0);
      expect(delta2).toBeGreaterThan(0);

      // Allow ±80% tolerance for word-boundary snapping and rate ramping
      expect(delta2).toBeGreaterThan(delta1 * 0.2);
      expect(delta2).toBeLessThan(delta1 * 1.8);
    });
  });

  describe('buffer empty during streaming', () => {
    it('keeps animation loop running when buffer empties', () => {
      // Trailing newline: the last segment is line-bounded, so the whole
      // buffer is revealable mid-stream (a bare unpunctuated tail would be
      // HELD as an incomplete clause until the stream ends).
      const text = 'Hello world, test words.\nfive six seven eight.\n';
      const { result } = renderHook(() =>
        useStreamBuffer({
          text,
          isStreaming: true,
          targetCPS: 800,
          initialBufferChars: 3,
        }),
      );

      // Advance many frames to drain buffer completely
      act(() => advanceFrames(120));

      // Should have caught up to end of text
      expect(result.current.displayLength).toBe(text.length);
      // rAF should still be active (not stopped)
      expect(rafCallbacks.size).toBeGreaterThan(0);
    });
  });

  describe('stream ends with remaining buffer', () => {
    it('drains remaining buffer after stream ends', () => {
      const fullText =
        'one two three four five six seven eight nine ten eleven twelve';

      const { result, rerender } = renderHook(
        ({ text, isStreaming }) =>
          useStreamBuffer({ text, isStreaming, initialBufferChars: 3 }),
        { initialProps: { text: fullText, isStreaming: true } },
      );

      // Start revealing
      act(() => advanceFrames(60));
      const lenBeforeEnd = result.current.displayLength;
      expect(lenBeforeEnd).toBeGreaterThan(0);

      // Stream ends
      rerender({ text: fullText, isStreaming: false });

      // Advance more frames to let it drain
      act(() => advanceFrames(300));
      expect(result.current.displayLength).toBe(fullText.length);
      expect(result.current.isTyping).toBe(false);
    });

    it('reveals a multi-sentence tail in multiple clause parts, not one dump', () => {
      // The drain reveals one SEGMENT per tick (clause parts bounded by
      // separators), so a multi-sentence reply produces several distinct
      // intermediate displayLengths as it reveals — never one full dump.
      const frenchText =
        "C'est très gentil à vous, merci beaucoup ! Je suis ravi de savoir " +
        "que mon aide vous satisfait. N'hésitez pas si vous avez besoin de " +
        "quoi que ce soit d'autre !";

      const { result, rerender } = renderHook(
        ({ text, isStreaming }) =>
          useStreamBuffer({ text, isStreaming, initialBufferChars: 3 }),
        { initialProps: { text: frenchText, isStreaming: true } },
      );

      // Reveal a little during streaming, then end the stream.
      act(() => advanceFrames(4));
      rerender({ text: frenchText, isStreaming: false });

      // Sample displayLength across drain — clause-chunked reveal should
      // pass through several intermediate boundaries.
      const seen = new Set<number>();
      for (let i = 0; i < 40; i++) {
        act(() => advanceFrames(2));
        seen.add(result.current.displayLength);
      }
      const intermediates = [...seen].filter(
        (n) => n > 0 && n < frenchText.length,
      );
      expect(intermediates.length).toBeGreaterThanOrEqual(3);

      // Finishes eventually.
      act(() => advanceFrames(60));
      expect(result.current.displayLength).toBe(frenchText.length);
    });

    it('reveals a short multi-clause tail in clause steps, not one dump', () => {
      // Short reply scenario: text is below the initialBufferChars gate so
      // streaming never starts the reveal; the whole buffer is handed to the
      // drain phase, which reveals it clause part by clause part.
      const shortText = 'Hello there, my friend, it works.';

      const { result, rerender } = renderHook(
        ({ text, isStreaming }) =>
          useStreamBuffer({ text, isStreaming, initialBufferChars: 50 }),
        { initialProps: { text: shortText, isStreaming: true } },
      );

      // During streaming, text length (33) < initialBufferChars (50) — no reveal.
      act(() => advanceFrames(10));
      expect(result.current.displayLength).toBe(0);

      // Stream ends — drain engages.
      rerender({ text: shortText, isStreaming: false });

      // Sample reveal progression. This test passes no targetCPS, so the
      // default 40 CPS applies; each clause charges its character cost
      // (~25 ms/char), so the three clauses surface as distinct steps.
      const samples: number[] = [];
      for (let i = 0; i < 10; i++) {
        act(() => advanceFrames(3));
        samples.push(result.current.displayLength);
      }
      const intermediate = samples.filter((n) => n > 0 && n < shortText.length);
      const distinctIntermediate = new Set(intermediate);
      expect(distinctIntermediate.size).toBeGreaterThanOrEqual(2);

      // Finishes eventually.
      act(() => advanceFrames(40));
      expect(result.current.displayLength).toBe(shortText.length);
      expect(result.current.isTyping).toBe(false);
    });
  });

  describe('targetCPS edge cases', () => {
    it('still reveals text when targetCPS is 0', () => {
      const text = 'Hello world this is a complete message for testing.';
      const { result } = renderHook(() =>
        useStreamBuffer({
          text,
          isStreaming: true,
          targetCPS: 0,
          initialBufferChars: 3,
        }),
      );

      act(() => advanceFrames(120));
      expect(result.current.displayLength).toBeGreaterThan(0);
    });

    it('drains remaining buffer when targetCPS is 0 and stream ends', () => {
      const drainText = 'Short text here for drain test.';
      const { result, rerender } = renderHook(
        (props) =>
          useStreamBuffer({ ...props, targetCPS: 0, initialBufferChars: 3 }),
        { initialProps: { text: drainText, isStreaming: true } },
      );

      act(() => advanceFrames(60));

      rerender({ text: drainText, isStreaming: false });
      // targetCPS:0 clamps to 1 CPS; char-by-char reveal at the 500ms tick
      // floor needs ample frames to drain this short tail fully.
      act(() => advanceFrames(1000));

      expect(result.current.displayLength).toBe(drainText.length);
    });
  });

  describe('reduced motion', () => {
    it('shows all text instantly when reduced motion is preferred', () => {
      vi.mocked(usePrefersReducedMotion).mockReturnValue(true);

      const text = 'Hello world this is some streaming text content here now';
      const { result } = renderHook(() =>
        useStreamBuffer({
          text,
          isStreaming: true,
          initialBufferChars: 5,
        }),
      );

      act(() => advanceFrames(1));

      expect(result.current.displayLength).toBe(text.length);
      expect(result.current.isTyping).toBe(false);
    });
  });
});

// ============================================================================
// reconnection resilience
// ============================================================================

describe('useStreamBuffer — reconnection resilience', () => {
  beforeEach(() => {
    setupAnimationMocks();
    vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
  });

  afterEach(() => {
    resetGlobalFreeze();
    clearDisplayPositionCache();
    vi.restoreAllMocks();
  });

  it('displayLength does not regress when isStreaming toggles false→true', () => {
    // Use a long text so the animation hasn't caught up before the toggle
    const text =
      'Streaming message that is being revealed character by character. ' +
      'This text is intentionally long so the animation buffer does not ' +
      'fully drain before we test the isStreaming toggle behavior during ' +
      'a simulated WebSocket reconnection event that briefly interrupts.';

    const { result, rerender } = renderHook(
      (props) =>
        useStreamBuffer({ ...props, initialBufferChars: 3, targetCPS: 200 }),
      { initialProps: { text, isStreaming: true } },
    );

    // Advance partially — not enough to drain the full buffer
    act(() => advanceFrames(30));
    const lenBefore = result.current.displayLength;
    expect(lenBefore).toBeGreaterThan(10);
    expect(lenBefore).toBeLessThan(text.length);

    // isStreaming briefly goes false (reconnection)
    rerender({ text, isStreaming: false });

    // displayLength should not have decreased
    expect(result.current.displayLength).toBeGreaterThanOrEqual(lenBefore);

    // isStreaming comes back
    rerender({ text, isStreaming: true });

    // Animation should continue from where it left off
    act(() => advanceFrames(30));
    expect(result.current.displayLength).toBeGreaterThan(lenBefore);
  });
});

// ============================================================================
// Display Position Cache
// ============================================================================
// Display Position Cache
// ============================================================================

describe('display position cache', () => {
  beforeEach(() => {
    clearDisplayPositionCache();
  });

  describe('findCachedPosition', () => {
    it('returns 0 for empty cache', () => {
      expect(findCachedPosition('any text that is long enough here')).toBe(0);
    });

    it('returns cached position when text starts with cached prefix', () => {
      const text =
        'Here is an AI response that is long enough to create a valid cache key for testing purposes.';
      saveToCache(text, 42);
      expect(findCachedPosition(text)).toBe(42);
    });

    it('matches when text grows beyond cached prefix', () => {
      const shortText =
        'Here is an AI response that is long enough to create a valid cache key.';
      saveToCache(shortText, 30);

      const longerText =
        shortText + ' Additional content appended during streaming.';
      expect(findCachedPosition(longerText)).toBe(30);
    });

    it('returns 0 when text does not match any cache entry', () => {
      saveToCache(
        'First message that is long enough for a cache key to be generated.',
        50,
      );
      expect(
        findCachedPosition(
          'Completely different text that does not share the same prefix.',
        ),
      ).toBe(0);
    });

    it('returns 0 when cached position exceeds current text length', () => {
      const text =
        'A short prefix that is long enough for caching but the position is beyond.';
      saveToCache(text, 500);
      // Shorter text with same prefix but position is out of bounds
      expect(findCachedPosition(text.slice(0, 60))).toBe(0);
    });
  });

  describe('saveToCache', () => {
    it('ignores text shorter than CACHE_PREFIX_LEN', () => {
      saveToCache('short', 10);
      expect(findCachedPosition('short')).toBe(0);
    });

    it('ignores position <= 0', () => {
      const text =
        'Long enough text to generate a valid cache key for this test.';
      saveToCache(text, 0);
      expect(findCachedPosition(text)).toBe(0);

      saveToCache(text, -5);
      expect(findCachedPosition(text)).toBe(0);
    });

    it('overwrites existing entry for same prefix', () => {
      const text =
        'Some AI response text that is long enough to be cached properly.';
      saveToCache(text, 20);
      saveToCache(text, 40);
      expect(findCachedPosition(text)).toBe(40);
    });

    it('evicts oldest entry when exceeding MAX_CACHE_ENTRIES', () => {
      // Fill cache with 20 entries (MAX_CACHE_ENTRIES)
      for (let i = 0; i < 20; i++) {
        const text = `Entry number ${String(i).padStart(3, '0')} that is long enough for a cache key.`;
        saveToCache(text, i + 1);
      }

      // All 20 should be present
      expect(
        findCachedPosition(
          'Entry number 000 that is long enough for a cache key.',
        ),
      ).toBe(1);

      // Add one more — oldest (entry 0) should be evicted
      saveToCache(
        'Brand new entry number 020 that is long enough for a cache key.',
        21,
      );
      expect(
        findCachedPosition(
          'Entry number 000 that is long enough for a cache key.',
        ),
      ).toBe(0);

      // Newest should be present
      expect(
        findCachedPosition(
          'Brand new entry number 020 that is long enough for a cache key.',
        ),
      ).toBe(21);
    });
  });

  describe('clearDisplayPositionCache', () => {
    it('empties the cache', () => {
      const text =
        'Some cached text that is long enough to produce a valid key.';
      saveToCache(text, 25);
      expect(findCachedPosition(text)).toBe(25);

      clearDisplayPositionCache();
      expect(findCachedPosition(text)).toBe(0);
    });
  });
});

// ============================================================================
// Stream Buffer Freeze (Stop Generating)
// ============================================================================

describe('useStreamBuffer — flush (freeze)', () => {
  beforeEach(() => {
    setupAnimationMocks();
    vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
  });

  afterEach(() => {
    resetGlobalFreeze();
    clearDisplayPositionCache();
    vi.restoreAllMocks();
  });

  it('freezes display at current position when flush is called', () => {
    const text =
      'Streaming text that is long enough to not finish revealing immediately ' +
      'during the animation loop, giving us time to call flush and verify ' +
      'that the display length stays frozen at the exact position.';

    const { result, rerender } = renderHook(
      (props) => useStreamBuffer({ ...props, initialBufferChars: 3 }),
      { initialProps: { text, isStreaming: true } },
    );

    // Advance to reveal some text
    act(() => advanceFrames(30));
    const frozenLength = result.current.displayLength;
    expect(frozenLength).toBeGreaterThan(0);
    expect(frozenLength).toBeLessThan(text.length);

    // Call flush to freeze
    act(() => result.current.freeze());

    // Advance more frames — display should NOT advance
    act(() => advanceFrames(60));
    expect(result.current.displayLength).toBe(frozenLength);

    // Even when more text arrives, display stays frozen
    const longerText =
      text + ' Even more content being streamed from the server.';
    rerender({ text: longerText, isStreaming: true });
    act(() => advanceFrames(60));
    expect(result.current.displayLength).toBe(frozenLength);
  });

  it('resets freeze on new streaming session', () => {
    const text =
      'First message that is long enough for the animation buffer to work ' +
      'properly and give us time to test the freeze and reset behavior.';

    const { result, rerender } = renderHook(
      (props) => useStreamBuffer({ ...props, initialBufferChars: 3 }),
      { initialProps: { text, isStreaming: true } },
    );

    // Advance and freeze
    act(() => advanceFrames(30));
    act(() => result.current.freeze());

    // Stream ends (aborted)
    rerender({ text, isStreaming: false });

    // New streaming session starts with new text
    const newText =
      'Second response that should stream normally without being frozen ' +
      'because the freeze was cleared when the new session started up.';
    rerender({ text: newText, isStreaming: true });
    act(() => advanceFrames(60));

    // Display should advance — the freeze was cleared by the new session.
    expect(result.current.displayLength).toBeGreaterThan(0);
    // End the second stream (the unpunctuated tail is held while live) and
    // drain — a still-frozen buffer would stay pinned at frozenLength.
    rerender({ text: newText, isStreaming: false });
    act(() => advanceFrames(300));
    expect(result.current.displayLength).toBe(newText.length);
  });
});

// ============================================================================
// Global freeze (freezeActiveStream)
// ============================================================================

describe('useStreamBuffer — freezeActiveStream (module-level)', () => {
  beforeEach(() => {
    setupAnimationMocks();
    vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
  });

  afterEach(() => {
    resetGlobalFreeze();
    clearDisplayPositionCache();
    vi.restoreAllMocks();
  });

  it('stops display advancement when global freeze is set', () => {
    const text =
      'Global freeze test text that is long enough for the animation loop ' +
      'to work properly and allow us to test the freeze behavior here.';

    const { result } = renderHook(() =>
      useStreamBuffer({ text, isStreaming: true, initialBufferChars: 3 }),
    );

    // Advance to reveal some text
    act(() => advanceFrames(30));
    const frozenLength = result.current.displayLength;
    expect(frozenLength).toBeGreaterThan(0);
    expect(frozenLength).toBeLessThan(text.length);

    // Set global freeze
    act(() => freezeActiveStream());

    // Advance more frames — display should NOT advance
    act(() => advanceFrames(60));
    expect(result.current.displayLength).toBe(frozenLength);
  });

  it('clears global freeze on new streaming session', () => {
    const text =
      'First message for global freeze testing that needs to be long ' +
      'enough for the buffer to work and the animation to progress.';

    const { result, rerender } = renderHook(
      (props) => useStreamBuffer({ ...props, initialBufferChars: 3 }),
      { initialProps: { text, isStreaming: true } },
    );

    // Advance and freeze globally
    act(() => advanceFrames(30));
    act(() => freezeActiveStream());

    // Stream ends
    rerender({ text, isStreaming: false });

    // New streaming session
    const newText =
      'New response after global freeze was cleared by the new session ' +
      'starting up, which should allow normal streaming to continue.';
    rerender({ text: newText, isStreaming: true });
    act(() => advanceFrames(60));

    expect(result.current.displayLength).toBeGreaterThan(0);
  });
});

// ============================================================================
// Adaptive CPS — base rate for shallow buffers, scales with buffer depth
// ============================================================================

describe('useStreamBuffer — adaptive CPS', () => {
  beforeEach(() => {
    setupAnimationMocks();
    vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
  });

  afterEach(() => {
    resetGlobalFreeze();
    clearDisplayPositionCache();
    vi.restoreAllMocks();
  });

  it('reveals near base CPS when buffer is shallow', () => {
    const text =
      'A relatively short streaming message that fits within a small buffer.';

    const { result } = renderHook(() =>
      useStreamBuffer({
        text,
        isStreaming: true,
        targetCPS: 50,
        initialBufferChars: 3,
      }),
    );

    // Run 60 frames = 1 second. Buffer stays shallow (text length ≈ target
    // buffer depth), so effective CPS should hover near base 50.
    act(() => advanceFrames(60));

    expect(result.current.displayLength).toBeGreaterThan(30);
    expect(result.current.displayLength).toBeLessThanOrEqual(text.length);
  });

  it('scales CPS above base when buffer is deep', () => {
    // Large text → big buffer depth → adaptive CPS should ramp well above
    // base. Comparing against a shallow-buffer run at the same base CPS:
    // the deep-buffer run should reveal meaningfully more in the same time.
    const longText = 'word '.repeat(500); // 2500 chars

    const { result: deep } = renderHook(() =>
      useStreamBuffer({
        text: longText,
        isStreaming: true,
        targetCPS: 50,
        initialBufferChars: 3,
      }),
    );
    const { result: shallow } = renderHook(() =>
      useStreamBuffer({
        text: 'word '.repeat(6), // ~30 chars — shallow buffer
        isStreaming: true,
        targetCPS: 50,
        initialBufferChars: 3,
      }),
    );

    act(() => advanceFrames(60));

    // Deep buffer run reveals substantially more than the shallow-buffer
    // baseline (which is capped by its own length).
    expect(deep.current.displayLength).toBeGreaterThan(
      shallow.current.displayLength * 2,
    );
  });

  it('slows back toward base CPS as buffer drains', () => {
    // 200-char text — buffer starts moderately deep, drains as reveal runs.
    // Reveal rate in the first interval should exceed reveal rate in the
    // second interval (by then buffer is shallower → CPS fell back).
    const text = 'word '.repeat(40); // 200 chars

    const { result } = renderHook(() =>
      useStreamBuffer({
        text,
        isStreaming: true,
        targetCPS: 50,
        initialBufferChars: 3,
      }),
    );

    act(() => advanceFrames(15));
    const afterFirst = result.current.displayLength;

    act(() => advanceFrames(15));
    const afterSecond = result.current.displayLength;

    const firstDelta = afterFirst;
    const secondDelta = afterSecond - afterFirst;

    expect(firstDelta).toBeGreaterThan(0);
    // Second interval runs on a shallower buffer (or a fully-drained one),
    // so reveal slowed — second delta must not exceed the first.
    expect(secondDelta).toBeLessThanOrEqual(firstDelta);
  });

  it('respects custom targetCPS parameter', () => {
    const text =
      'A streaming message for custom CPS test that needs to be long enough ' +
      'to not fully drain in a few frames of animation at slower speeds.';

    // Low CPS
    const { result: slowResult } = renderHook(() =>
      useStreamBuffer({
        text,
        isStreaming: true,
        targetCPS: 20,
        initialBufferChars: 3,
      }),
    );

    // High CPS
    const { result: fastResult } = renderHook(() =>
      useStreamBuffer({
        text,
        isStreaming: true,
        targetCPS: 200,
        initialBufferChars: 3,
      }),
    );

    act(() => advanceFrames(30));

    // Fast CPS should reveal more text than slow CPS
    expect(fastResult.current.displayLength).toBeGreaterThan(
      slowResult.current.displayLength,
    );
  });
});

// ============================================================================
// ADAPTIVE SMOOTHING — EMA CPS ramp + character-by-character reveal (WS3 / R7)
// ============================================================================

describe('useStreamBuffer — adaptive smoothing + character reveal', () => {
  beforeEach(() => {
    resetGlobalFreeze();
    clearDisplayPositionCache();
    setupAnimationMocks();
    vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
  });

  afterEach(() => {
    resetGlobalFreeze();
    clearDisplayPositionCache();
    vi.restoreAllMocks();
  });

  it('holds an incomplete token while streaming, reveals it whole on drain', () => {
    // A 26-char token with no clause boundary. Segment reveal HOLDS it while
    // the stream is live (a partial token must never flash in and then grow),
    // then reveals it whole once the stream ends.
    const word = 'abcdefghijklmnopqrstuvwxyz';
    const { result, rerender } = renderHook(
      ({ text, isStreaming }: { text: string; isStreaming: boolean }) =>
        useStreamBuffer({
          text,
          isStreaming,
          targetCPS: 40,
          initialBufferChars: 3,
        }),
      { initialProps: { text: word, isStreaming: true } },
    );

    act(() => advanceFrames(20));
    expect(result.current.displayLength).toBe(0);

    // Stream ends — the drain reveals the token in full.
    rerender({ text: word, isStreaming: false });
    act(() => advanceFrames(400));
    expect(result.current.displayLength).toBe(word.length);
  });

  it('reveals link markdown atomically (no raw syntax flash mid-construct)', () => {
    // A clause boundary INSIDE the link text would land the reveal mid-link;
    // the syntax-skip must jump the whole [text](url) in one step instead.
    const text = 'see [the docs, part two](https://example.com/page) now, ok.';
    const { result, rerender } = renderHook(
      ({ text: t, isStreaming }: { text: string; isStreaming: boolean }) =>
        useStreamBuffer({
          text: t,
          isStreaming,
          targetCPS: 1000, // fast so it advances into the link quickly
          initialBufferChars: 1,
        }),
      { initialProps: { text, isStreaming: true } },
    );

    // Sample reveal positions across frames; none may land inside the link
    // markup (between the opening '[' and the closing ')').
    const linkStart = text.indexOf('[');
    const linkEnd = text.indexOf(')') + 1;
    const checkOutsideLink = () => {
      const len = result.current.displayLength;
      const insideLink = len > linkStart && len < linkEnd;
      expect(insideLink).toBe(false);
    };
    for (let i = 0; i < 40; i++) {
      act(() => advanceFrames(1));
      checkOutsideLink();
    }
    // Drain the held tail after the stream ends — still never inside the link.
    rerender({ text, isStreaming: false });
    for (let i = 0; i < 20; i++) {
      act(() => advanceFrames(1));
      checkOutsideLink();
    }
    expect(result.current.displayLength).toBe(text.length);
  });

  /**
   * Simulate the backend's ~250 ms throttled delta cadence: append a fixed
   * slice of `full` every `framesPerPush` frames while streaming. The EMA must
   * absorb the burstiness without ever revealing past what has actually
   * arrived, and the buffer must still fully drain once streaming ends.
   */
  it('fully reveals a bursty, throttle-style multi-push stream', () => {
    const full = 'word '.repeat(120); // 600 chars
    const pushChars = 80;
    const pushes = Math.ceil(full.length / pushChars);

    const { result, rerender } = renderHook(
      ({ text, isStreaming }: { text: string; isStreaming: boolean }) =>
        useStreamBuffer({ text, isStreaming, initialBufferChars: 3 }),
      { initialProps: { text: full.slice(0, pushChars), isStreaming: true } },
    );

    for (let p = 1; p <= pushes; p++) {
      rerender({ text: full.slice(0, pushChars * p), isStreaming: true });
      act(() => advanceFrames(15)); // ~250 ms between pushes
      // Never reveal past what has actually streamed in.
      expect(result.current.displayLength).toBeLessThanOrEqual(
        Math.min(pushChars * p, full.length),
      );
    }

    // Stream ends; drain to completion.
    rerender({ text: full, isStreaming: false });
    act(() => advanceFrames(800));

    expect(result.current.displayLength).toBe(full.length);
    expect(result.current.isTyping).toBe(false);
  });

  it('does not dump a large mid-stream burst in a single frame', () => {
    const base = 'word '.repeat(6); // 30 chars
    const burst = base + 'alpha '.repeat(120); // +720 chars

    const { result, rerender } = renderHook(
      ({ text, isStreaming }: { text: string; isStreaming: boolean }) =>
        useStreamBuffer({ text, isStreaming, initialBufferChars: 3 }),
      { initialProps: { text: base, isStreaming: true } },
    );

    act(() => advanceFrames(6));

    // A large burst lands at once (throttled delta). The reveal stays paced —
    // one frame cannot expose the whole backlog.
    rerender({ text: burst, isStreaming: true });
    const before = result.current.displayLength;
    act(() => advanceFrames(1));
    const afterOneFrame = result.current.displayLength;

    expect(afterOneFrame).toBeLessThan(burst.length);
    expect(afterOneFrame - before).toBeLessThan(burst.length - before);

    // …and once the stream ends, the drain catches up fully over time (the
    // unpunctuated tail is held while streaming, by design).
    rerender({ text: burst, isStreaming: false });
    act(() => advanceFrames(800));
    expect(result.current.displayLength).toBe(burst.length);
  });

  it('drains a large deep-buffer backlog to completion', () => {
    // Large backlog: the adaptive CPS ramps up for fast char-by-char catch-up.
    const full = 'This is a sentence. '.repeat(40); // 800 chars

    const { result, rerender } = renderHook(
      ({ text, isStreaming }: { text: string; isStreaming: boolean }) =>
        useStreamBuffer({ text, isStreaming, initialBufferChars: 3 }),
      { initialProps: { text: full, isStreaming: true } },
    );

    // Reveal a chunk while streaming (deep buffer → high adaptive CPS).
    act(() => advanceFrames(60));
    expect(result.current.displayLength).toBeGreaterThan(0);
    expect(result.current.displayLength).toBeLessThanOrEqual(full.length);

    // End the stream and drain fully — hysteresis must not strand the tail.
    rerender({ text: full, isStreaming: false });
    act(() => advanceFrames(2000));
    expect(result.current.displayLength).toBe(full.length);
  });
});

// ============================================================================
// Frame time clamping (maxDeltaTime)
// ============================================================================

describe('useStreamBuffer — frame time clamping', () => {
  beforeEach(() => {
    setupAnimationMocks();
    vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
  });

  afterEach(() => {
    resetGlobalFreeze();
    clearDisplayPositionCache();
    vi.restoreAllMocks();
  });

  it('clamps large delta time to prevent jumps after tab switch', () => {
    const text = 'x'.repeat(2000);

    const { result } = renderHook(() =>
      useStreamBuffer({
        text,
        isStreaming: true,
        targetCPS: 50,
        initialBufferChars: 3,
      }),
    );

    // Run a few normal frames to start animation
    act(() => advanceFrames(5));
    const lenAfterNormal = result.current.displayLength;

    // Simulate a long gap (e.g., tab was hidden for 5 seconds)
    // maxDeltaTime is 100ms, so even though 5s passed the effective
    // delta should be clamped to 100ms
    mockNow += 5000;
    const callbacks = new Map(rafCallbacks);
    rafCallbacks.clear();
    for (const [, cb] of callbacks) {
      cb(mockNow);
    }

    const lenAfterGap = result.current.displayLength;
    const jumpedChars = lenAfterGap - lenAfterNormal;

    // With maxDeltaTime=100ms and CPS=50 (small buffer), max chars per clamped frame
    // would be (100/16.67) * (50/60) ≈ 5 chars. Even with adaptive acceleration
    // the jump should be reasonable (not 5000ms worth of chars).
    expect(jumpedChars).toBeLessThan(100);
  });
});

// ============================================================================
// consumeFrozenDisplayText integration
// ============================================================================

describe('useStreamBuffer — consumeFrozenDisplayText', () => {
  beforeEach(() => {
    setupAnimationMocks();
    vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
  });

  afterEach(() => {
    resetGlobalFreeze();
    clearDisplayPositionCache();
    vi.restoreAllMocks();
  });

  it('captures displayed text at freeze time', () => {
    const text =
      'This streaming text will be frozen partway through to verify ' +
      'that consumeFrozenDisplayText returns the exact visible portion.';

    const { result } = renderHook(() =>
      useStreamBuffer({ text, isStreaming: true, initialBufferChars: 3 }),
    );

    // Advance to reveal partial text
    act(() => advanceFrames(30));
    const frozenLength = result.current.displayLength;
    expect(frozenLength).toBeGreaterThan(0);
    expect(frozenLength).toBeLessThan(text.length);

    // Freeze and consume
    act(() => freezeActiveStream());
    const captured = consumeFrozenDisplayText();

    // Captured text is a valid prefix of the source text. Its length may
    // exceed frozenLength because the ref advances between state flushes.
    expect(captured).not.toBeNull();
    const frozenText = captured ?? '';
    expect(text.startsWith(frozenText)).toBe(true);
    expect(frozenText.length).toBeGreaterThanOrEqual(frozenLength);
  });

  it('returns null when consumed twice', () => {
    const text =
      'Streaming text for double consume test that needs to be long ' +
      'enough for the animation to progress before freezing occurs.';

    renderHook(() =>
      useStreamBuffer({ text, isStreaming: true, initialBufferChars: 3 }),
    );

    act(() => advanceFrames(20));
    act(() => freezeActiveStream());

    // First consume should return captured text
    const first = consumeFrozenDisplayText();
    expect(first).not.toBeNull();
    expect(typeof first).toBe('string');

    // Second consume should return null (already consumed)
    const second = consumeFrozenDisplayText();
    expect(second).toBeNull();
  });

  it('returns null when no freeze has occurred', () => {
    const captured = consumeFrozenDisplayText();
    expect(captured).toBeNull();
  });

  it('captures empty string when freeze is called before any text is revealed', () => {
    const text =
      'Buffering text that has not started revealing yet because the ' +
      'initial buffer threshold has not been met so display is zero.';

    renderHook(() =>
      useStreamBuffer({
        text,
        isStreaming: true,
        initialBufferChars: 999, // very high threshold — reveal won't start
      }),
    );

    act(() => advanceFrames(5)); // not enough to start reveal

    act(() => freezeActiveStream());
    const captured = consumeFrozenDisplayText();

    // Should capture empty string (displayedLength is 0, text.slice(0,0) = '')
    expect(captured).toBe('');
  });
});

// ============================================================================
// isStreamFrozen
// ============================================================================

describe('useStreamBuffer — isStreamFrozen', () => {
  beforeEach(() => {
    setupAnimationMocks();
    vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
  });

  afterEach(() => {
    resetGlobalFreeze();
    clearDisplayPositionCache();
    vi.restoreAllMocks();
  });

  it('returns false initially', () => {
    renderHook(() =>
      useStreamBuffer({
        text: 'some text',
        isStreaming: true,
        initialBufferChars: 3,
      }),
    );

    act(() => advanceFrames(5));
    expect(isStreamFrozen()).toBe(false);
  });

  it('returns true after freezeActiveStream is called', () => {
    renderHook(() =>
      useStreamBuffer({
        text: 'streaming text long enough for animation to progress and test',
        isStreaming: true,
        initialBufferChars: 3,
      }),
    );

    act(() => advanceFrames(10));
    act(() => freezeActiveStream());
    expect(isStreamFrozen()).toBe(true);
  });

  it('returns false after a new streaming session clears the freeze', () => {
    const { rerender } = renderHook(
      (props) => useStreamBuffer({ ...props, initialBufferChars: 3 }),
      {
        initialProps: {
          text: 'first streaming message with enough text for buffer',
          isStreaming: true,
        },
      },
    );

    act(() => advanceFrames(10));
    act(() => freezeActiveStream());
    expect(isStreamFrozen()).toBe(true);

    // End stream, then start new session
    rerender({
      text: 'first streaming message with enough text for buffer',
      isStreaming: false,
    });
    rerender({
      text: 'new streaming message starting a fresh session now',
      isStreaming: true,
    });

    expect(isStreamFrozen()).toBe(false);
  });

  it('resetGlobalFreeze clears the freeze without needing a new streaming session', () => {
    renderHook(() =>
      useStreamBuffer({
        text: 'streaming text long enough for animation to progress and test',
        isStreaming: true,
        initialBufferChars: 3,
      }),
    );

    act(() => advanceFrames(10));
    act(() => freezeActiveStream());
    expect(isStreamFrozen()).toBe(true);

    act(() => resetGlobalFreeze());
    expect(isStreamFrozen()).toBe(false);
  });

  it('resetGlobalFreeze allows non-streaming text to show immediately', () => {
    const { rerender, result } = renderHook(
      (props) => useStreamBuffer({ ...props, initialBufferChars: 3 }),
      {
        initialProps: {
          text: 'first streaming message with enough text for buffer',
          isStreaming: true,
        },
      },
    );

    act(() => advanceFrames(10));
    act(() => freezeActiveStream());
    const frozenLen = result.current.displayLength;

    // End stream — display stays frozen because globalFrozen is true
    rerender({
      text: 'first streaming message with enough text for buffer',
      isStreaming: false,
    });
    expect(result.current.displayLength).toBe(frozenLen);

    // Reset freeze externally (simulates onBeforeSend → resetCancelled)
    act(() => resetGlobalFreeze());

    // Now render a new non-streaming message — should show immediately
    rerender({
      text: 'new completed response loaded from DB after reload',
      isStreaming: false,
    });
    expect(result.current.displayLength).toBe(
      'new completed response loaded from DB after reload'.length,
    );
  });
});

// ============================================================================
// Freeze edge cases
// ============================================================================

describe('useStreamBuffer — freeze edge cases', () => {
  beforeEach(() => {
    setupAnimationMocks();
    vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
  });

  afterEach(() => {
    resetGlobalFreeze();
    clearDisplayPositionCache();
    vi.restoreAllMocks();
  });

  it('freezeActiveStream cancels the in-flight rAF', () => {
    const text =
      'Text for rAF cancellation test long enough for animation progress.';

    renderHook(() =>
      useStreamBuffer({ text, isStreaming: true, initialBufferChars: 3 }),
    );

    act(() => advanceFrames(10));

    // Before freeze, rAF should be active
    expect(rafCallbacks.size).toBeGreaterThan(0);

    act(() => freezeActiveStream());

    // After freeze, the pending rAF should be cancelled
    expect(rafCallbacks.size).toBe(0);
  });

  it('multiple rapid freezeActiveStream calls are idempotent', () => {
    const text =
      'Text for multiple freeze calls test that is sufficiently long ' +
      'for the animation to have progressed when we freeze it here.';

    const { result } = renderHook(() =>
      useStreamBuffer({ text, isStreaming: true, initialBufferChars: 3 }),
    );

    act(() => advanceFrames(20));
    const lengthBefore = result.current.displayLength;

    // Freeze multiple times in rapid succession
    act(() => {
      freezeActiveStream();
      freezeActiveStream();
      freezeActiveStream();
    });

    // Should still be frozen at the same length
    act(() => advanceFrames(60));
    expect(result.current.displayLength).toBe(lengthBefore);

    // consumeFrozenDisplayText should still work (returns text from first freeze)
    const captured = consumeFrozenDisplayText();
    expect(captured).not.toBeNull();
    const frozenText = captured ?? '';
    expect(text.startsWith(frozenText)).toBe(true);
    expect(frozenText.length).toBeGreaterThanOrEqual(lengthBefore);
  });

  it('freezeActiveStream before any hook is mounted (no registered refs)', () => {
    // This tests the case where freezeActiveStream is called when no stream
    // buffer hook is mounted (e.g., the component unmounted before stop was clicked)
    act(() => freezeActiveStream());

    // Should not throw, and consumeFrozenDisplayText should return null
    // because there are no active refs to read from
    const captured = consumeFrozenDisplayText();
    expect(captured).toBeNull();
    expect(isStreamFrozen()).toBe(true);
  });

  it('instance freeze() also cancels rAF and stops animation', () => {
    const text =
      'Long enough text for the instance-level freeze test to work ' +
      'properly and verify that the animation loop is actually stopped.';

    const { result } = renderHook(() =>
      useStreamBuffer({ text, isStreaming: true, initialBufferChars: 3 }),
    );

    act(() => advanceFrames(20));
    const frozenLen = result.current.displayLength;

    act(() => result.current.freeze());

    // rAF should be cancelled
    expect(rafCallbacks.size).toBe(0);
    // isTyping should be false
    expect(result.current.isTyping).toBe(false);

    // Further frames should not advance
    act(() => advanceFrames(60));
    expect(result.current.displayLength).toBe(frozenLen);
  });

  it('does not re-register RAF after freeze when text updates', () => {
    const text =
      'Initial text for RAF re-registration test that is long enough ' +
      'for the animation to be actively running when freeze triggers.';

    const { rerender } = renderHook(
      (props) => useStreamBuffer({ ...props, initialBufferChars: 3 }),
      { initialProps: { text, isStreaming: true } },
    );

    act(() => advanceFrames(10));
    expect(rafCallbacks.size).toBeGreaterThan(0);

    act(() => freezeActiveStream());
    expect(rafCallbacks.size).toBe(0);

    // Simulate more text arriving from backend after freeze
    const updatedText = text + ' More text arriving after stop was clicked.';
    rerender({ text: updatedText, isStreaming: true });

    // RAF should NOT be re-registered because freeze is active
    expect(rafCallbacks.size).toBe(0);

    // Further frames should not advance display
    act(() => advanceFrames(30));
    expect(rafCallbacks.size).toBe(0);
  });
});

// ============================================================================
// Progress and isDraining
// ============================================================================

describe('useStreamBuffer — progress and isDraining', () => {
  beforeEach(() => {
    setupAnimationMocks();
    vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
  });

  afterEach(() => {
    resetGlobalFreeze();
    clearDisplayPositionCache();
    vi.restoreAllMocks();
  });

  it('progress starts at 0 and reaches 1 when fully revealed', () => {
    const text = 'Short streaming message for progress tracking test.';

    const { result, rerender } = renderHook(
      ({ isStreaming }: { isStreaming: boolean }) =>
        useStreamBuffer({
          text,
          isStreaming,
          targetCPS: 800,
          initialBufferChars: 3,
        }),
      { initialProps: { isStreaming: true } },
    );

    // Initially (after buffering), progress should be low
    act(() => advanceFrames(5));
    expect(result.current.progress).toBeGreaterThanOrEqual(0);
    expect(result.current.progress).toBeLessThanOrEqual(1);

    // End the stream (the trailing clause is held while live) and drain fully.
    rerender({ isStreaming: false });
    act(() => advanceFrames(300));
    expect(result.current.progress).toBe(1);
  });

  it('isDraining is true while buffer drains after stream ends', () => {
    const longText =
      'A longer message that will not fully drain before the stream ends ' +
      'so we can verify the isDraining flag is set correctly during drain. ' +
      'Adding extra content to ensure the buffer has plenty of remaining ' +
      'characters after thirty frames of animation at the constant rate.';

    const { result, rerender } = renderHook(
      (props) =>
        useStreamBuffer({ ...props, targetCPS: 200, initialBufferChars: 3 }),
      { initialProps: { text: longText, isStreaming: true } },
    );

    // Partially reveal
    act(() => advanceFrames(30));
    expect(result.current.displayLength).toBeLessThan(longText.length);

    // End stream while buffer still has content
    rerender({ text: longText, isStreaming: false });

    // Drain phase: buffer drains gradually instead of instant reveal
    expect(result.current.isDraining).toBe(true);
    expect(result.current.displayLength).toBeLessThan(longText.length);

    // Advance enough frames to fully drain
    act(() => advanceFrames(300));
    expect(result.current.isDraining).toBe(false);
    expect(result.current.displayLength).toBe(longText.length);
    expect(result.current.isTyping).toBe(false);
  });

  it('bufferSize decreases as text is revealed', () => {
    const text = 'word '.repeat(100); // 500 chars

    const { result } = renderHook(() =>
      useStreamBuffer({
        text,
        isStreaming: true,
        targetCPS: 200,
        initialBufferChars: 3,
      }),
    );

    act(() => advanceFrames(10));
    const buf1 = result.current.bufferSize;

    act(() => advanceFrames(30));
    const buf2 = result.current.bufferSize;

    expect(buf2).toBeLessThan(buf1);
  });
});

// ============================================================================
// Smooth drain on stream end
// ============================================================================

describe('useStreamBuffer — smooth drain', () => {
  beforeEach(() => {
    setupAnimationMocks();
    vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reduced motion skips drain and reveals immediately', () => {
    vi.mocked(usePrefersReducedMotion).mockReturnValue(true);

    const content = 'word '.repeat(50); // 250 chars

    const { result, rerender } = renderHook(
      (props) => useStreamBuffer({ ...props, initialBufferChars: 3 }),
      { initialProps: { text: content, isStreaming: true } },
    );

    // Let some chars reveal
    act(() => advanceFrames(10));

    // End stream — reduced motion should reveal everything immediately
    rerender({ text: content, isStreaming: false });
    expect(result.current.displayLength).toBe(content.length);
    expect(result.current.isDraining).toBe(false);
    expect(result.current.isTyping).toBe(false);
  });

  it('new streaming session during drain resets drain state', () => {
    // Use a very long text so the buffer is never fully drained in 30 frames
    const text1 = 'word '.repeat(400); // 2000 chars

    const { result, rerender } = renderHook(
      (props) => useStreamBuffer({ ...props, initialBufferChars: 3 }),
      { initialProps: { text: text1, isStreaming: true } },
    );

    // Partially reveal — only a small fraction at default CPS
    act(() => advanceFrames(30));
    expect(result.current.displayLength).toBeLessThan(text1.length);

    // End stream — enters drain phase
    rerender({ text: text1, isStreaming: false });
    expect(result.current.isDraining).toBe(true);

    // New streaming session starts
    const text2 = 'new message content here and more';
    rerender({ text: text2, isStreaming: true });

    // Drain should be reset, now streaming fresh content
    expect(result.current.isDraining).toBe(false);
  });
});

// ============================================================================
// LINE BUFFERING — ambiguous markdown line starts
// ============================================================================

describe('line buffering', () => {
  it('never reveals partial thematic break line during streaming', () => {
    // Text has a thematic break "---" starting at position 12 (after "Some text.\n")
    const text = 'Some text.\n---\nMore content here and beyond';

    const { result } = renderHook(() =>
      useStreamBuffer({
        text,
        isStreaming: true,
        targetCPS: 200,
        initialBufferChars: 3,
      }),
    );

    // Run many frames to let animation progress
    for (let frame = 0; frame < 200; frame++) {
      act(() => advanceFrames(1));
      const len = result.current.displayLength;

      // displayLength should never be 12, 13, or 14 (partial "---" line)
      // It can be <= 11 (before the line) or >= 15 (past "---\n")
      if (len > 11 && len < 15) {
        throw new Error(
          `displayLength ${len} reveals partial thematic break "---" ` +
            `(positions 12-14). Expected <= 11 or >= 15.`,
        );
      }
    }

    // Should have advanced past the thematic break
    expect(result.current.displayLength).toBeGreaterThanOrEqual(15);
  });

  it('never reveals partial code fence during streaming', () => {
    const text = 'Hello.\n```js\nconsole.log("hi");\n```\nDone.';

    const { result } = renderHook(() =>
      useStreamBuffer({
        text,
        isStreaming: true,
        targetCPS: 200,
        initialBufferChars: 3,
      }),
    );

    for (let frame = 0; frame < 200; frame++) {
      act(() => advanceFrames(1));
      const len = result.current.displayLength;

      // Positions 7 and 8 are partial backtick fence (` and ``)
      // Position 7 = `, 8 = ``, 9 = ``` (still ambiguous until non-backtick)
      if (len === 8) {
        throw new Error(
          `displayLength ${len} reveals partial code fence. ` +
            `Should hold before the fence line or advance past the ambiguous prefix.`,
        );
      }
    }
  });

  it('reveals normally after ambiguous line resolves', () => {
    // A list item "- item" is ambiguous at "- " but resolves at "- i"
    const text = 'Hello.\n- item text here, and more words after.\n';

    const { result } = renderHook(() =>
      useStreamBuffer({
        text,
        isStreaming: true,
        targetCPS: 200,
        initialBufferChars: 3,
      }),
    );

    // Run enough frames to pass through the list item
    act(() => advanceFrames(200));

    // Should have advanced well past the list item
    expect(result.current.displayLength).toBeGreaterThan(15);
  });
});
