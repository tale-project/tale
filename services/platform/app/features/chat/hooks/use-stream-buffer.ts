'use client';

/**
 * Stream Buffer Hook — Constant Drain Rate
 *
 * Manages the buffer between incoming streamed text and displayed text,
 * using a constant output rate with the buffer as a shock absorber.
 * This produces a smooth, steady typing rhythm regardless of how
 * irregularly the server delivers chunks.
 *
 * STRATEGY:
 * =========
 * 1. CONSTANT RATE: Text is revealed at a fixed speed (default 50 CPS)
 *    - Buffer absorbs server timing variations
 *    - No adaptive speed or catch-up multiplier
 *
 * 2. INITIAL BUFFERING: Waits for enough characters before starting
 *    - Builds a small reservoir to smooth the first few seconds
 *    - Character-based threshold (works for CJK and Latin)
 *
 * 3. BUFFER EMPTY: Keeps animation loop running
 *    - Cursor stays visible while waiting for next chunk
 *    - Resumes at the same constant rate when text arrives
 *
 * 4. STREAM ENDS: Drains remaining buffer at same rate
 *    - No instant jump to end — finishes revealing naturally
 *
 * USAGE:
 * ------
 * const { displayLength, isTyping, progress } = useStreamBuffer({
 *   text: streamingText,
 *   isStreaming: true,
 * });
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

import { usePrefersReducedMotion } from '@/app/hooks/use-prefers-reduced-motion';

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG = {
  /** Target characters per second */
  targetCPS: 50,
  /** Characters to buffer before starting reveal */
  initialBufferChars: 30,
  /** Interval between React state updates (ms) */
  stateUpdateInterval: 50,
  /** Maximum delta time (ms) to prevent jumps after tab switching */
  maxDeltaTime: 100,
};

// ============================================================================
// TYPES
// ============================================================================

interface UseStreamBufferOptions {
  /** The full text to display (updates as streaming progresses) */
  text: string;
  /** Whether the text is currently being streamed */
  isStreaming?: boolean;
  /** Target characters per second for reveal animation */
  targetCPS?: number;
  /** Characters to buffer before starting reveal */
  initialBufferChars?: number;
}

interface UseStreamBufferResult {
  /** Current number of characters to display */
  displayLength: number;
  /** Safe position for markdown anchor (at a block boundary) */
  anchorPosition: number;
  /** Progress from 0 to 1 */
  progress: number;
  /** Whether animation is currently active */
  isTyping: boolean;
  /** Number of characters remaining in buffer */
  bufferSize: number;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function isWordBoundary(char: string): boolean {
  return /[\s.,!?;:\-\n]/.test(char);
}

function findNextWordBoundary(text: string, startPos: number): number {
  const maxLookAhead = Math.min(startPos + 15, text.length);
  for (let i = startPos; i < maxLookAhead; i++) {
    if (isWordBoundary(text[i])) {
      return i + 1;
    }
  }
  return startPos;
}

function findSafeAnchor(text: string, currentPos: number): number {
  if (currentPos <= 0) return 0;

  const searchStart = Math.max(0, currentPos - 200);
  const searchText = text.slice(searchStart, currentPos);

  const lastParagraph = searchText.lastIndexOf('\n\n');
  const lastCodeBlockEnd = searchText.lastIndexOf('```\n');
  const bestBoundary = Math.max(lastParagraph, lastCodeBlockEnd);

  if (bestBoundary !== -1) {
    const absolutePos =
      searchStart + bestBoundary + (lastCodeBlockEnd > lastParagraph ? 4 : 2);

    const textUpToAnchor = text.slice(0, absolutePos);
    const codeBlockCount = (textUpToAnchor.match(/```/g) || []).length;

    if (codeBlockCount % 2 !== 0) {
      return 0;
    }
    return absolutePos;
  }

  return 0;
}

// ============================================================================
// MAIN HOOK
// ============================================================================

export function useStreamBuffer({
  text,
  isStreaming = false,
  targetCPS = DEFAULT_CONFIG.targetCPS,
  initialBufferChars = DEFAULT_CONFIG.initialBufferChars,
}: UseStreamBufferOptions): UseStreamBufferResult {
  const prefersReducedMotion = usePrefersReducedMotion();

  const [displayLength, setDisplayLength] = useState(0);
  const [isTyping, setIsTyping] = useState(false);

  // Refs for animation state (no re-renders during animation)
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const displayedLengthRef = useRef(0);
  const targetTextRef = useRef('');
  const isStreamingRef = useRef(false);
  const accumulatedCharsRef = useRef(0);
  const lastStateUpdateRef = useRef<number>(0);

  // Constant-rate specific refs
  const hasStartedRevealRef = useRef(false);
  const wasStreamingRef = useRef(false);

  // Tab visibility tracking
  const isVisibleRef = useRef(true);
  const hiddenTimeRef = useRef(0);

  // Constant chars per frame — never speeds up, never slows down
  const charsPerFrame = targetCPS / 60;

  // Animation loop
  const animate = useCallback(
    (currentTime: number) => {
      if (!isVisibleRef.current) {
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      // Handle reduced motion preference
      if (prefersReducedMotion) {
        if (displayedLengthRef.current !== targetTextRef.current.length) {
          displayedLengthRef.current = targetTextRef.current.length;
          setDisplayLength(targetTextRef.current.length);
          setIsTyping(false);
        }
        animationFrameRef.current = null;
        return;
      }

      const text = targetTextRef.current;
      const textLength = text.length;
      const currentDisplayed = displayedLengthRef.current;
      const bufferSize = textLength - currentDisplayed;
      const streaming = isStreamingRef.current;

      // Initial buffering: wait for enough characters before starting reveal
      if (!hasStartedRevealRef.current && streaming) {
        if (textLength < initialBufferChars) {
          animationFrameRef.current = requestAnimationFrame(animate);
          return;
        }
        hasStartedRevealRef.current = true;
      }

      // Buffer empty
      if (bufferSize <= 0) {
        if (streaming) {
          // Still streaming but buffer momentarily empty — keep waiting
          animationFrameRef.current = requestAnimationFrame(animate);
          return;
        }
        // Stream ended and buffer fully drained — done
        setIsTyping(false);
        wasStreamingRef.current = false;
        animationFrameRef.current = null;
        return;
      }

      // Calculate time delta
      const deltaTime = lastFrameTimeRef.current
        ? currentTime - lastFrameTimeRef.current
        : 16.67;
      lastFrameTimeRef.current = currentTime;

      const normalizedDelta = Math.min(deltaTime, DEFAULT_CONFIG.maxDeltaTime);
      const frameRatio = normalizedDelta / 16.67;

      accumulatedCharsRef.current += charsPerFrame * frameRatio;

      const charsToAdd = Math.floor(accumulatedCharsRef.current);
      if (charsToAdd > 0) {
        accumulatedCharsRef.current -= charsToAdd;
        let newDisplayed = Math.min(currentDisplayed + charsToAdd, textLength);

        // Snap to next word boundary
        const nextBoundary = findNextWordBoundary(text, newDisplayed);
        if (nextBoundary <= textLength && nextBoundary - newDisplayed <= 3) {
          newDisplayed = nextBoundary;
        }

        if (newDisplayed !== displayedLengthRef.current) {
          displayedLengthRef.current = newDisplayed;

          const timeSinceLastUpdate = currentTime - lastStateUpdateRef.current;
          const atWordBoundary = isWordBoundary(text[newDisplayed - 1] || '');
          const caughtUp = newDisplayed === textLength;

          const shouldUpdate =
            timeSinceLastUpdate >= DEFAULT_CONFIG.stateUpdateInterval ||
            atWordBoundary ||
            caughtUp;

          if (shouldUpdate) {
            lastStateUpdateRef.current = currentTime;
            setDisplayLength(newDisplayed);
            setIsTyping(true);
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    },
    [charsPerFrame, prefersReducedMotion, initialBufferChars],
  );

  // Handle tab visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      const wasVisible = isVisibleRef.current;
      isVisibleRef.current = document.visibilityState === 'visible';

      if (!wasVisible && isVisibleRef.current) {
        const hiddenDuration = performance.now() - hiddenTimeRef.current;
        const catchUpChars = Math.floor((hiddenDuration / 1000) * targetCPS);

        if (
          catchUpChars > 0 &&
          (isStreamingRef.current || wasStreamingRef.current)
        ) {
          const newDisplayed = Math.min(
            displayedLengthRef.current + catchUpChars,
            targetTextRef.current.length,
          );
          displayedLengthRef.current = newDisplayed;
          setDisplayLength(newDisplayed);
        }
      } else if (wasVisible && !isVisibleRef.current) {
        hiddenTimeRef.current = performance.now();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [targetCPS]);

  // Start/manage animation when text or streaming state changes
  useEffect(() => {
    targetTextRef.current = text;
    const prevStreaming = isStreamingRef.current;
    isStreamingRef.current = isStreaming;

    if (isStreaming) {
      wasStreamingRef.current = true;

      if (!prevStreaming) {
        hasStartedRevealRef.current = false;
        accumulatedCharsRef.current = 0;
      }

      if (!animationFrameRef.current) {
        lastFrameTimeRef.current = 0;
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    } else if (
      wasStreamingRef.current &&
      displayedLengthRef.current < text.length
    ) {
      // Stream ended but buffer still has content — keep draining
      if (!animationFrameRef.current) {
        lastFrameTimeRef.current = 0;
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    } else {
      // Never was streaming or fully caught up — show immediately
      wasStreamingRef.current = false;
      hasStartedRevealRef.current = false;
      displayedLengthRef.current = text.length;
      accumulatedCharsRef.current = 0;
      setDisplayLength(text.length);
      setIsTyping(false);
    }
  }, [text, isStreaming, animate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, []);

  const anchorPosition = useMemo(
    () => findSafeAnchor(text, displayLength),
    [text, displayLength],
  );

  const progress = text.length > 0 ? displayLength / text.length : 1;
  const bufferSize = text.length - displayLength;

  return {
    displayLength,
    anchorPosition,
    progress,
    isTyping,
    bufferSize,
  };
}
