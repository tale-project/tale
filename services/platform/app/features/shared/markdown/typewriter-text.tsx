'use client';

/**
 * TypewriterText Component
 *
 * A streaming text component that renders AI-generated text with a smooth
 * typewriter animation using constant drain rate buffering.
 *
 * ARCHITECTURE:
 * =============
 * 1. STREAM BUFFER: Constant-rate character reveal via useStreamBuffer
 *    - Fixed CPS output with buffer as shock absorber
 *    - Word boundary snapping for natural reading flow
 *    - Throttled React state updates to reduce re-renders
 *
 * 2. INCREMENTAL MARKDOWN: Splits content for optimal parsing
 *    - Stable portion: Complete blocks, memoized, no re-parsing
 *    - Streaming portion: Only revealed slice, re-parsed on updates
 *
 * PERFORMANCE:
 * ============
 * - requestAnimationFrame for 60fps animation
 * - Refs for animation state (no re-renders during animation)
 * - Memoized markdown components with ref-based cursor wrappers
 * - Tab visibility detection (pause when hidden)
 * - Reduced motion support
 *
 * USAGE:
 * ------
 * <TypewriterText
 *   text={streamingContent}
 *   isStreaming={true}
 *   onComplete={() => console.log('Done!')}
 * />
 */

import { IncrementalMarkdown } from '@tale/ui/markdown/streaming/incremental-markdown';
import { memo, useEffect, useLayoutEffect, useRef } from 'react';

import type { MarkdownComponentMap } from '@/lib/utils/markdown-types';

import { useStreamBuffer } from './use-stream-buffer';

// ============================================================================
// TYPES
// ============================================================================

interface TypewriterTextProps {
  /** The full text to display (updates as streaming progresses) */
  text: string;
  /** Whether the text is currently being streamed */
  isStreaming?: boolean;
  /** Callback when typing animation completes */
  onComplete?: () => void;
  /** Fires once per mount when the first glyph is actually revealed
   * (`displayLength > 0`), not when the stream first carries text. */
  onFirstReveal?: () => void;
  /** Custom markdown components (passed to react-markdown) */
  components?: MarkdownComponentMap;
  /** Additional CSS classes */
  className?: string;
}

// ============================================================================
// STABLE STREAM TEXT
// ============================================================================

/**
 * During streaming, text only grows. Temporary regression (from WebSocket
 * reconnection delivering committed/shorter text while syncStreams
 * reconnects) is ignored so the animation never jumps back.
 */
export function useStableStreamText(text: string, isStreaming: boolean) {
  const ref = useRef(text);
  if (isStreaming && text.length < ref.current.length) {
    return ref.current;
  }
  ref.current = text;
  return text;
}

// ============================================================================
// REVEAL COMPLETION
// ============================================================================

/**
 * Fires `onComplete` each time the reveal animation reaches the end of the
 * (non-streaming) text, latching so it fires once per completed reveal.
 *
 * The latch resets when streaming resumes AND when the reveal regresses
 * without an SDK streaming phase: an external-agent turn grows its trailing
 * done-state text segment across persisted flushes (adjacent text coalesces
 * into ONE segment id), so `progress` drops below 1 while `isStreaming` stays
 * false. Without that reset, `onComplete` would never re-fire for the grown
 * tail and the toolbar would wait on the bubble's 10s safety timer instead of
 * the reveal signal.
 */
export function useRevealCompletion(
  progress: number,
  isStreaming: boolean,
  onComplete?: () => void,
) {
  const hasCompletedRef = useRef(false);

  useEffect(() => {
    if (
      progress === 1 &&
      !isStreaming &&
      !hasCompletedRef.current &&
      onComplete
    ) {
      hasCompletedRef.current = true;
      onComplete();
    }

    if (isStreaming || progress < 1) {
      hasCompletedRef.current = false;
    }
  }, [progress, isStreaming, onComplete]);
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * TypewriterText renders streaming text with a smooth reveal animation.
 *
 * Text is split into stable (memoized) and streaming portions for
 * optimal markdown parsing performance.
 */
function TypewriterTextComponent({
  text,
  isStreaming = false,
  onComplete,
  onFirstReveal,
  components,
  className,
}: TypewriterTextProps) {
  const stableText = useStableStreamText(text, isStreaming);

  // Use the stream buffer hook for animation management
  const { displayLength, progress, isDraining } = useStreamBuffer({
    text: stableText,
    isStreaming,
  });

  useRevealCompletion(progress, isStreaming, onComplete);

  const revealedRef = useRef(false);
  useLayoutEffect(() => {
    if (displayLength > 0 && !revealedRef.current) {
      revealedRef.current = true;
      onFirstReveal?.();
    }
  }, [displayLength, onFirstReveal]);

  // No typing cursor: the segment fade itself signals "still generating" —
  // a blinking caret on the last clause reads as noise next to it.
  return (
    <IncrementalMarkdown
      content={stableText}
      revealPosition={displayLength}
      components={components}
      className={className}
      aria-busy={isStreaming || isDraining}
    />
  );
}

/**
 * Memoized TypewriterText component.
 *
 * Only re-renders when text content or streaming state changes,
 * not on every parent render.
 */
export const TypewriterText = memo(
  TypewriterTextComponent,
  (prevProps, nextProps) => {
    return (
      prevProps.text === nextProps.text &&
      prevProps.isStreaming === nextProps.isStreaming &&
      prevProps.className === nextProps.className &&
      prevProps.components === nextProps.components &&
      prevProps.onComplete === nextProps.onComplete &&
      prevProps.onFirstReveal === nextProps.onFirstReveal
    );
  },
);
