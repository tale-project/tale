'use client';

/**
 * TypewriterText Component
 *
 * A high-performance streaming text component that renders AI-generated text
 * with a smooth typewriter animation. Uses a hybrid approach:
 *
 * ANIMATION STRATEGY:
 * ===================
 * 1. CSS MASK: GPU-accelerated text reveal using mask-image gradient
 *    - The full text is rendered but masked beyond the reveal point
 *    - Updates a CSS custom property (--reveal-chars) for smooth animation
 *    - No React re-renders during character-by-character animation
 *
 * 2. JS PRECISION: JavaScript handles word boundary snapping
 *    - Calculates the next reveal position based on buffer state
 *    - Snaps to word boundaries for natural reading flow
 *    - Throttles React state updates to reduce re-renders
 *
 * 3. INCREMENTAL MARKDOWN: Splits content for optimal parsing
 *    - Stable portion: Complete blocks, memoized, no re-parsing
 *    - Streaming portion: Current block, re-rendered on updates
 *
 * PERFORMANCE OPTIMIZATIONS:
 * ==========================
 * - requestAnimationFrame for 60fps animation
 * - Ring buffer for metrics (no GC pressure)
 * - Refs for animation state (no re-renders)
 * - Memoized markdown components
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

import { memo, useRef, useEffect, useCallback, type ComponentType } from 'react';
import { useStreamBuffer } from '../hooks/use-stream-buffer';
import { IncrementalMarkdown } from './incremental-markdown';
import { cn } from '@/lib/utils/cn';

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
  // biome-ignore lint/suspicious/noExplicitAny: Required for react-markdown component types
  components?: Record<string, ComponentType<any>>;
  /** Additional CSS classes */
  className?: string;
}

// ============================================================================
// ANIMATION CONFIGURATION
// ============================================================================

/**
 * Timing parameters for the typewriter animation.
 * These are optimized for readability and smoothness.
 */
const TYPEWRITER_CONFIG = {
  /** Characters per second (600 WPM reading speed) */
  targetCPS: 120,
  /** Minimum words to buffer before starting */
  minBufferWords: 3,
  /** Speed multiplier for catch-up mode */
  catchUpMultiplier: 2.5,
};

// ============================================================================
// CURSOR COMPONENT
// ============================================================================

/**
 * Animated cursor that appears during typing.
 * Uses CSS animation for smooth blinking without JS overhead.
 */
const TypewriterCursor = memo(function TypewriterCursor() {
  return (
    <span
      className="inline-block w-0.5 h-[1.1em] bg-current ml-0.5 align-text-bottom animate-cursor-blink"
      aria-hidden="true"
    />
  );
});

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * TypewriterText renders streaming text with a smooth reveal animation.
 *
 * The component uses a hybrid CSS+JS approach:
 * - CSS handles the actual reveal animation (GPU-accelerated)
 * - JS handles timing, word boundaries, and state management
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
  // Use the stream buffer hook for animation management
  const { displayLength, anchorPosition, isTyping, progress } = useStreamBuffer({
    text,
    isStreaming,
    targetCPS: TYPEWRITER_CONFIG.targetCPS,
    minBufferWords: TYPEWRITER_CONFIG.minBufferWords,
    catchUpMultiplier: TYPEWRITER_CONFIG.catchUpMultiplier,
  });

  // Ref for the streaming container (used for CSS variable updates)
  const containerRef = useRef<HTMLDivElement>(null);

  // Track completion to fire onComplete callback
  const hasCompletedRef = useRef(false);

  // Fire onComplete when animation finishes
  useEffect(() => {
    if (progress === 1 && !isStreaming && !hasCompletedRef.current && onComplete) {
      hasCompletedRef.current = true;
      onComplete();
    }

    // Reset completion tracking when streaming starts again
    if (isStreaming) {
      hasCompletedRef.current = false;
    }
  }, [progress, isStreaming, onComplete]);

  // Update CSS custom property for reveal position
  // This is called frequently but doesn't cause React re-renders
  const updateRevealPosition = useCallback((chars: number) => {
    if (containerRef.current) {
      containerRef.current.style.setProperty('--reveal-chars', String(chars));
    }
  }, []);

  // Keep CSS variable in sync with display length
  useEffect(() => {
    updateRevealPosition(displayLength);
  }, [displayLength, updateRevealPosition]);

  // Don't show cursor if there's no text
  const showCursor = isStreaming && isTyping && text.length > 0;

  return (
    <div
      ref={containerRef}
      className={cn('typewriter-container', className)}
      style={{
        // Initialize CSS custom property
        '--reveal-chars': displayLength,
      } as React.CSSProperties}
    >
      {/* Render text with incremental markdown parsing */}
      <IncrementalMarkdown
        content={text}
        revealPosition={displayLength}
        anchorPosition={anchorPosition}
        isStreaming={isStreaming}
        components={components}
      />

      {/* Animated cursor */}
      {showCursor && <TypewriterCursor />}
    </div>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * Memoized TypewriterText component.
 *
 * Only re-renders when text content or streaming state changes,
 * not on every parent render.
 */
export const TypewriterText = memo(TypewriterTextComponent, (prevProps, nextProps) => {
  return (
    prevProps.text === nextProps.text &&
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.className === nextProps.className
  );
});

export default TypewriterText;
