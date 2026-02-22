import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useStreamBuffer } from '../use-stream-buffer';

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
    setupAnimationMocks();
    vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('non-streaming (historical messages)', () => {
    it('shows all text immediately when not streaming', () => {
      const { result } = renderHook(() =>
        useStreamBuffer({
          text: 'Hello world, this is a complete message.',
          isStreaming: false,
        }),
      );

      expect(result.current.displayLength).toBe(40);
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

      // Add more text to meet character threshold
      rerender({
        text: 'short text that exceeds twenty chars easily',
        isStreaming: true,
      });

      // Advance past initial buffer time
      act(() => advanceFrames(60));
      expect(result.current.displayLength).toBeGreaterThan(0);
    });
  });

  describe('rate-matched output', () => {
    it('reveals text steadily without aggressive catch-up', () => {
      const longText =
        'The quick brown fox jumps over the lazy dog. ' +
        'This is a longer piece of text that should be revealed at a steady rate. ' +
        'We want to verify that the output speed remains steady and predictable. ' +
        'No sudden bursts or pauses should occur during the reveal animation.';

      const { result } = renderHook(() =>
        useStreamBuffer({
          text: longText,
          isStreaming: true,
          initialBufferChars: 3,
        }),
      );

      // Advance past initial buffer
      act(() => advanceFrames(60));
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
      const { result } = renderHook(() =>
        useStreamBuffer({
          text: 'Hello world test words five six seven eight',
          isStreaming: true,
          targetCPS: 800,
          initialBufferChars: 3,
        }),
      );

      // Advance many frames to drain buffer completely
      act(() => advanceFrames(120));

      // Should have caught up to end of text
      expect(result.current.displayLength).toBe(43);
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
  });

  describe('reduced motion', () => {
    it('shows all text instantly when reduced motion is preferred', () => {
      vi.mocked(usePrefersReducedMotion).mockReturnValue(true);

      const { result } = renderHook(() =>
        useStreamBuffer({
          text: 'Hello world this is some streaming text content here now',
          isStreaming: true,
          initialBufferChars: 5,
        }),
      );

      act(() => advanceFrames(1));

      expect(result.current.displayLength).toBe(56);
      expect(result.current.isTyping).toBe(false);
    });
  });
});
