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

import { memo, useRef, useEffect } from 'react';

import type { MarkdownComponentMap } from '@/lib/utils/markdown-types';

import { useStreamBuffer } from '../hooks/use-stream-buffer';
import { IncrementalMarkdown } from './incremental-markdown';

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
  /** Custom markdown components (passed to react-markdown) */
  components?: MarkdownComponentMap;
  /** Additional CSS classes */
  className?: string;
}

// ============================================================================
// ANIMATION CONFIGURATION
// ============================================================================

/**
 * Timing parameters for the typewriter animation.
 * Uses constant drain rate for smooth, steady output.
 */
const TYPEWRITER_CONFIG = {
  /** Target characters per second */
  targetCPS: 50,
  /** Characters to buffer before starting reveal */
  initialBufferChars: 30,
};

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
  components,
  className,
}: TypewriterTextProps) {
  const stableText = useStableStreamText(text, isStreaming);

  // Use the stream buffer hook for animation management
  const { displayLength, anchorPosition, progress, isTyping, isDraining } =
    useStreamBuffer({
      text: stableText,
      isStreaming,
      targetCPS: TYPEWRITER_CONFIG.targetCPS,
      initialBufferChars: TYPEWRITER_CONFIG.initialBufferChars,
    });

  // Track completion to fire onComplete callback
  const hasCompletedRef = useRef(false);

  // Fire onComplete when animation finishes
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

    // Reset completion tracking when streaming starts again
    if (isStreaming) {
      hasCompletedRef.current = false;
    }
  }, [progress, isStreaming, onComplete]);

  // Show cursor while text is being revealed — covers both the live streaming
  // phase (isStreaming) and the post-stream drain phase (isDraining). isTyping
  // guards against showing a cursor on a message that finished animating.
  const showCursor = (isStreaming || isDraining) && isTyping;

  return (
    <div className={className}>
      {/* Render text with incremental markdown parsing */}
      <IncrementalMarkdown
        content={stableText}
        revealPosition={displayLength}
        anchorPosition={anchorPosition}
        components={components}
        showCursor={showCursor}
      />
    </div>
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
      prevProps.className === nextProps.className
    );
  },
);
