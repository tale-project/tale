import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { useStableStreamText } from '../typewriter-text';

describe('useStableStreamText', () => {
  it('passes text through when not streaming', () => {
    const { result } = renderHook(() =>
      useStableStreamText('Hello world', false),
    );
    expect(result.current).toBe('Hello world');
  });

  it('passes text through when streaming and text grows', () => {
    const { result, rerender } = renderHook(
      ({ text, isStreaming }) => useStableStreamText(text, isStreaming),
      { initialProps: { text: 'Hello', isStreaming: true } },
    );

    expect(result.current).toBe('Hello');

    rerender({ text: 'Hello world', isStreaming: true });
    expect(result.current).toBe('Hello world');

    rerender({ text: 'Hello world, how are you?', isStreaming: true });
    expect(result.current).toBe('Hello world, how are you?');
  });

  it('returns cached text when streaming text regresses', () => {
    const longText = 'Hello world, this is a long streaming message.';
    const shortText = 'Hello world';

    const { result, rerender } = renderHook(
      ({ text, isStreaming }) => useStableStreamText(text, isStreaming),
      { initialProps: { text: longText, isStreaming: true } },
    );

    expect(result.current).toBe(longText);

    // Text regresses during reconnection
    rerender({ text: shortText, isStreaming: true });
    expect(result.current).toBe(longText);
  });

  it('recovers when text grows back after regression', () => {
    const phase1 = 'Hello world, streaming text. ';
    const regressed = 'Hello world';
    const phase2 = 'Hello world, streaming text. And more content arrives.';

    const { result, rerender } = renderHook(
      ({ text, isStreaming }) => useStableStreamText(text, isStreaming),
      { initialProps: { text: phase1, isStreaming: true } },
    );

    // Regression
    rerender({ text: regressed, isStreaming: true });
    expect(result.current).toBe(phase1);

    // Recovery with longer text
    rerender({ text: phase2, isStreaming: true });
    expect(result.current).toBe(phase2);
  });

  it('resets cache when streaming ends', () => {
    const streamedText = 'Long streamed message content here.';

    const { result, rerender } = renderHook(
      ({ text, isStreaming }) => useStableStreamText(text, isStreaming),
      { initialProps: { text: streamedText, isStreaming: true } },
    );

    // Streaming ends
    rerender({ text: streamedText, isStreaming: false });
    expect(result.current).toBe(streamedText);

    // New shorter message (not streaming) — should NOT use stale cache
    const newText = 'Short.';
    rerender({ text: newText, isStreaming: false });
    expect(result.current).toBe(newText);
  });

  it('accepts shorter text when not streaming (final committed text)', () => {
    const streamedText = 'Streaming message with trailing whitespace.  ';
    const finalText = 'Streaming message with trailing whitespace.';

    const { result, rerender } = renderHook(
      ({ text, isStreaming }) => useStableStreamText(text, isStreaming),
      { initialProps: { text: streamedText, isStreaming: true } },
    );

    // Streaming ends, final text is slightly shorter (trimmed)
    rerender({ text: finalText, isStreaming: false });
    expect(result.current).toBe(finalText);
  });

  it('handles multiple regression cycles during streaming', () => {
    const { result, rerender } = renderHook(
      ({ text, isStreaming }) => useStableStreamText(text, isStreaming),
      { initialProps: { text: 'A'.repeat(100), isStreaming: true } },
    );

    // First regression
    rerender({ text: 'A'.repeat(30), isStreaming: true });
    expect(result.current).toBe('A'.repeat(100));

    // Recovery
    rerender({ text: 'A'.repeat(150), isStreaming: true });
    expect(result.current).toBe('A'.repeat(150));

    // Second regression
    rerender({ text: 'A'.repeat(80), isStreaming: true });
    expect(result.current).toBe('A'.repeat(150));

    // Final recovery
    rerender({ text: 'A'.repeat(200), isStreaming: true });
    expect(result.current).toBe('A'.repeat(200));
  });

  it('full lifecycle: grow, regress, recover, end', () => {
    // In practice each message gets its own TypewriterText (keyed by
    // message.key), so cross-session cache leaks don't apply. This test
    // verifies the complete single-session lifecycle.
    const { result, rerender } = renderHook(
      ({ text, isStreaming }) => useStableStreamText(text, isStreaming),
      { initialProps: { text: 'Hello', isStreaming: true } },
    );

    // Normal growth
    rerender({ text: 'Hello world, this is streaming.', isStreaming: true });
    expect(result.current).toBe('Hello world, this is streaming.');

    // Reconnection regression — protected
    rerender({ text: 'Hello world', isStreaming: true });
    expect(result.current).toBe('Hello world, this is streaming.');

    // Recovery with even more text
    rerender({
      text: 'Hello world, this is streaming. And it continues!',
      isStreaming: true,
    });
    expect(result.current).toBe(
      'Hello world, this is streaming. And it continues!',
    );

    // Streaming ends — cache accepts final text
    rerender({
      text: 'Hello world, this is streaming. And it continues!',
      isStreaming: false,
    });
    expect(result.current).toBe(
      'Hello world, this is streaming. And it continues!',
    );
  });
});
