import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { findSafeAnchor, useStreamBuffer } from '../use-stream-buffer';

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
      const text = 'Hello world test words five six seven eight';
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
// anchorPosition monotonicity (hook-level behavior)
// ============================================================================

describe('useStreamBuffer — anchor monotonicity', () => {
  beforeEach(() => {
    setupAnimationMocks();
    vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('anchorPosition never decreases when text grows into a long table', () => {
    // Start with text that has a paragraph boundary
    const shortText = 'First paragraph.\n\nSecond paragraph.';

    const { result, rerender } = renderHook(
      ({ text }) => useStreamBuffer({ text, isStreaming: false }),
      { initialProps: { text: shortText } },
    );

    const anchor1 = result.current.anchorPosition;
    expect(anchor1).toBe(18); // after "First paragraph.\n\n"

    // Add a long table (no \n\n within 200 chars of the end).
    // findSafeAnchor would return 0 for this text, but the
    // monotonic guard prevents regression.
    const tableRows = Array.from(
      { length: 20 },
      (_, i) => `| cell_${i}_long_content | data_value_${i} |`,
    ).join('\n');
    const longText =
      shortText + '\n\n| Header A | Header B |\n|---|---|\n' + tableRows;

    rerender({ text: longText });

    const anchor2 = result.current.anchorPosition;
    expect(anchor2).toBeGreaterThanOrEqual(anchor1);
  });

  it('anchorPosition never decreases inside a long code block', () => {
    const textBefore = 'Intro text.\n\n';
    const codeLines = Array.from(
      { length: 30 },
      (_, i) => `  line${i} = ${i}`,
    ).join('\n');
    const fullText = textBefore + '```python\n' + codeLines;

    const { result, rerender } = renderHook(
      ({ text }) => useStreamBuffer({ text, isStreaming: false }),
      { initialProps: { text: textBefore + 'Some text.' } },
    );

    const anchor1 = result.current.anchorPosition;
    expect(anchor1).toBeGreaterThan(0);

    // Now the text is a long code block — findSafeAnchor may return 0
    rerender({ text: fullText });

    const anchor2 = result.current.anchorPosition;
    expect(anchor2).toBeGreaterThanOrEqual(anchor1);
  });

  it('anchor starts at 0 for a fresh component (new message)', () => {
    // Each message gets its own TypewriterText component instance.
    // A fresh mount should have anchor at 0, even for text without \n\n.
    const { result } = renderHook(() =>
      useStreamBuffer({
        text: 'Single paragraph no breaks',
        isStreaming: false,
      }),
    );

    expect(result.current.anchorPosition).toBe(0);
  });
});

// ============================================================================
// findSafeAnchor
// ============================================================================

describe('findSafeAnchor', () => {
  it('returns 0 for empty text', () => {
    expect(findSafeAnchor('', 0)).toBe(0);
  });

  it('returns 0 when currentPos is 0', () => {
    expect(findSafeAnchor('Hello world', 0)).toBe(0);
  });

  it('anchors at paragraph boundary', () => {
    const text = 'First paragraph.\n\nSecond paragraph.';
    // Position deep into the second paragraph
    const anchor = findSafeAnchor(text, text.length);
    // Should anchor after \n\n (position 18)
    expect(anchor).toBe(18);
    expect(text.slice(0, anchor)).toBe('First paragraph.\n\n');
  });

  it('anchors at code block end boundary', () => {
    const text = '```js\nfoo();\n```\nAfter code.';
    const anchor = findSafeAnchor(text, text.length);
    // ```\n match at position 13, +4 chars = absolutePos 17
    expect(anchor).toBe(17);
    expect(text.slice(0, anchor)).toBe('```js\nfoo();\n```\n');
  });

  describe('inside code block (odd fence count)', () => {
    it('anchors before code block when blank line inside code block', () => {
      const text = 'Hello.\n\n```python\n# comment\n\nclass Foo:\n  pass';
      // currentPos past the \n\n inside the code block
      const anchor = findSafeAnchor(text, text.length);
      // Should anchor after "Hello.\n\n" — right before the code block
      expect(anchor).toBe(8);
      expect(text.slice(0, anchor)).toBe('Hello.\n\n');
    });

    it('returns 0 when code block is at the very start', () => {
      const text = '```python\n# comment\n\nclass Foo:\n  pass';
      const anchor = findSafeAnchor(text, text.length);
      expect(anchor).toBe(0);
    });

    it('anchors correctly with multiple code blocks', () => {
      const text =
        '```js\nfoo();\n```\n\nBetween.\n\n```python\n# comment\n\nclass Bar:';
      const anchor = findSafeAnchor(text, text.length);
      // Should anchor after "Between.\n\n" — before the second code block
      const expected = text.indexOf('```python');
      const breakBefore = text.lastIndexOf('\n\n', expected);
      expect(anchor).toBe(breakBefore + 2);
      // Verify the stable content includes the first code block
      expect(text.slice(0, anchor)).toContain('```js\nfoo();\n```');
      expect(text.slice(0, anchor)).toContain('Between.');
    });

    it('handles long code block with blank line far from currentPos', () => {
      // Code block with a blank line, but the blank line is >200 chars
      // from currentPos. The 200-char search window finds the blank line
      // inside the code block, but the fix searches the full text for the
      // opening fence.
      const longCode = 'x = 1\n'.repeat(50); // ~300 chars
      const text = `Intro.\n\n\`\`\`python\n${longCode}\n\nmore_code = True`;
      const anchor = findSafeAnchor(text, text.length);
      // Should anchor after "Intro.\n\n"
      expect(anchor).toBe(8);
      expect(text.slice(0, anchor)).toBe('Intro.\n\n');
    });

    it('keeps anchor stable during code block streaming', () => {
      // Simulate streaming: code block grows but anchor should stay fixed
      const base = 'Hello world.\n\n```python\ndef foo():\n';
      const v1 = base + '  x = 1\n\n  y = 2';
      const v2 = base + '  x = 1\n\n  y = 2\n  z = 3';

      const anchor1 = findSafeAnchor(v1, v1.length);
      const anchor2 = findSafeAnchor(v2, v2.length);

      // Both should anchor at the same position (before the code block)
      expect(anchor1).toBe(anchor2);
      expect(anchor1).toBe(14); // after "Hello world.\n\n"
    });
  });
});
