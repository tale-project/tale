'use client';

/**
 * Stream Buffer Hook
 *
 * This hook manages the buffer between incoming text from streaming and
 * displayed text in the UI. It provides smooth animation by:
 *
 * 1. ADAPTIVE SPEED: Adjusts reveal speed based on buffer size
 *    - Large buffer → faster reveal to catch up
 *    - Small buffer → slower reveal to prevent stuttering
 *
 * 2. WORD BOUNDARY SNAPPING: Reveals text word-by-word for natural reading
 *    - Calculates next word boundary and snaps to it
 *    - Includes punctuation with the preceding word
 *
 * 3. TAB VISIBILITY: Pauses animation when tab is hidden
 *    - Tracks hidden duration
 *    - Catches up smoothly when tab becomes visible again
 *
 * 4. REDUCED MOTION: Respects user's accessibility preferences
 *    - Shows text instantly if prefers-reduced-motion is enabled
 *
 * 5. FRAME-BASED ANIMATION: Uses requestAnimationFrame for 60fps
 *    - Fractional character accumulation for sub-pixel precision
 *    - Delta time normalization for consistent speed across frame rates
 *
 * USAGE:
 * ------
 * const { displayLength, isTyping, progress } = useStreamBuffer({
 *   text: streamingText,
 *   isStreaming: true,
 *   targetCPS: 120, // characters per second
 * });
 *
 * // Render text up to displayLength
 * <span>{text.slice(0, displayLength)}</span>
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Default timing parameters for the animation.
 * These are tuned for a natural reading experience.
 */
const DEFAULT_CONFIG = {
  /** Target characters per second (600 WPM ≈ 100 CPS) */
  targetCPS: 120,
  /** Minimum buffer size (in words) before starting animation */
  minBufferWords: 3,
  /** Speed multiplier when buffer is large (catch-up mode) */
  catchUpMultiplier: 2.5,
  /** Interval between React state updates (ms) - prevents excessive re-renders */
  stateUpdateInterval: 50,
  /** Maximum delta time (ms) to prevent jumps after tab switching */
  maxDeltaTime: 100,
  /** Frames of history for rate calculation (~500ms at 60fps) */
  historySize: 30,
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
  /** Minimum buffer size (in words) before starting animation */
  minBufferWords?: number;
  /** Speed multiplier when buffer is large */
  catchUpMultiplier?: number;
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

interface MetricsEntry {
  time: number;
  length: number;
}

// ============================================================================
// RING BUFFER
// ============================================================================

/**
 * Ring buffer for tracking metrics without array allocations.
 * This avoids garbage collection pressure during animation.
 */
class MetricsRingBuffer {
  private buffer: MetricsEntry[];
  private writeIndex = 0;
  private count = 0;
  private size: number;

  constructor(size: number) {
    this.size = size;
    this.buffer = new Array(size);
  }

  push(entry: MetricsEntry) {
    this.buffer[this.writeIndex] = entry;
    this.writeIndex = (this.writeIndex + 1) % this.size;
    if (this.count < this.size) this.count++;
  }

  getOldestNewerThan(cutoffTime: number): MetricsEntry | null {
    if (this.count === 0) return null;

    for (let i = 0; i < this.count; i++) {
      const idx = (this.writeIndex - this.count + i + this.size) % this.size;
      const entry = this.buffer[idx];
      if (entry && entry.time > cutoffTime) {
        return entry;
      }
    }
    return null;
  }

  getNewest(): MetricsEntry | null {
    if (this.count === 0) return null;
    return this.buffer[(this.writeIndex - 1 + this.size) % this.size];
  }

  clear() {
    this.writeIndex = 0;
    this.count = 0;
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if a character is a word boundary.
 */
function isWordBoundary(char: string): boolean {
  return /[\s.,!?;:\-\n]/.test(char);
}

/**
 * Find the next word boundary position after the given position.
 * Returns the position AFTER the boundary character (includes space).
 */
function findNextWordBoundary(text: string, startPos: number): number {
  // Look ahead up to 15 characters for a word boundary
  const maxLookAhead = Math.min(startPos + 15, text.length);

  for (let i = startPos; i < maxLookAhead; i++) {
    if (isWordBoundary(text[i])) {
      // Return position after the boundary (include the space/punctuation)
      return i + 1;
    }
  }

  // No boundary found, return the current position
  return startPos;
}

/**
 * Find a safe anchor position for markdown splitting.
 * The anchor should be at a block boundary (paragraph, code block end).
 */
function findSafeAnchor(text: string, currentPos: number): number {
  if (currentPos <= 0) return 0;

  // Look back from current position for safe boundaries
  const searchStart = Math.max(0, currentPos - 200);
  const searchText = text.slice(searchStart, currentPos);

  // Find last double newline (paragraph boundary)
  const lastParagraph = searchText.lastIndexOf('\n\n');

  // Find last code block end
  const lastCodeBlockEnd = searchText.lastIndexOf('```\n');

  // Use whichever is later (closer to currentPos)
  const bestBoundary = Math.max(lastParagraph, lastCodeBlockEnd);

  if (bestBoundary !== -1) {
    const absolutePos = searchStart + bestBoundary + (lastCodeBlockEnd > lastParagraph ? 4 : 2);

    // Make sure we're not inside a code block
    const textUpToAnchor = text.slice(0, absolutePos);
    const codeBlockCount = (textUpToAnchor.match(/```/g) || []).length;

    // If odd number of ```, we're inside a code block - not safe
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
  minBufferWords = DEFAULT_CONFIG.minBufferWords,
  catchUpMultiplier = DEFAULT_CONFIG.catchUpMultiplier,
}: UseStreamBufferOptions): UseStreamBufferResult {
  // Accessibility: skip animation if user prefers reduced motion
  const prefersReducedMotion = usePrefersReducedMotion();

  // State for display length (triggers re-renders)
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

  // Tab visibility tracking
  const isVisibleRef = useRef(true);
  const hiddenTimeRef = useRef(0);

  // Metrics for adaptive speed
  const metricsRef = useRef(new MetricsRingBuffer(DEFAULT_CONFIG.historySize));
  const incomingRateRef = useRef(0);

  // Calculate adaptive speed based on buffer state
  const calculateCharsPerFrame = useCallback(
    (bufferSize: number, incomingRate: number): number => {
      // Base rate: targetCPS / 60 (for 60fps)
      const baseCharsPerFrame = targetCPS / 60;

      // Convert minBufferWords to approximate characters (avg 5 chars per word)
      const minBufferChars = minBufferWords * 5;

      // Calculate buffer ratio (how full is the buffer)
      const bufferRatio = bufferSize / Math.max(minBufferChars * 2, 20);

      let speedMultiplier: number;

      if (bufferRatio > 2) {
        // Large buffer - catch up aggressively
        speedMultiplier = Math.min(catchUpMultiplier * 1.5, bufferRatio);
      } else if (bufferRatio > 1) {
        // Moderate buffer - catch up gradually
        speedMultiplier = 1 + (bufferRatio - 1) * (catchUpMultiplier - 1);
      } else if (bufferRatio < 0.5 && incomingRate > 0) {
        // Small buffer and still receiving - slow down to prevent stuttering
        speedMultiplier = Math.max(0.5, bufferRatio + 0.5);
      } else {
        speedMultiplier = 1;
      }

      return baseCharsPerFrame * speedMultiplier;
    },
    [targetCPS, minBufferWords, catchUpMultiplier]
  );

  // Update metrics when text changes
  const updateMetrics = useCallback((newTextLength: number) => {
    const now = performance.now();
    metricsRef.current.push({ time: now, length: newTextLength });

    // Calculate incoming rate from history
    const cutoff = now - 500;
    const oldest = metricsRef.current.getOldestNewerThan(cutoff);
    const newest = metricsRef.current.getNewest();

    if (oldest && newest && oldest !== newest) {
      const timeDelta = (newest.time - oldest.time) / 1000;
      const charsDelta = newest.length - oldest.length;
      incomingRateRef.current = timeDelta > 0 ? charsDelta / timeDelta : 0;
    }
  }, []);

  // Animation loop
  const animate = useCallback(
    (currentTime: number) => {
      // Check tab visibility
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

      // Not streaming - show all text immediately
      if (!isStreamingRef.current) {
        if (displayedLengthRef.current !== targetTextRef.current.length) {
          displayedLengthRef.current = targetTextRef.current.length;
          setDisplayLength(displayedLengthRef.current);
          setIsTyping(false);
        }
        animationFrameRef.current = null;
        return;
      }

      const text = targetTextRef.current;
      const textLength = text.length;
      const currentDisplayed = displayedLengthRef.current;
      const bufferSize = textLength - currentDisplayed;

      // If we've caught up, wait for more text
      if (bufferSize <= 0) {
        setIsTyping(false);
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      // Calculate time delta
      const deltaTime = lastFrameTimeRef.current
        ? currentTime - lastFrameTimeRef.current
        : 16.67; // Default to ~60fps
      lastFrameTimeRef.current = currentTime;

      // Normalize delta time (cap to prevent jumps after tab switching)
      const normalizedDelta = Math.min(deltaTime, DEFAULT_CONFIG.maxDeltaTime);
      const frameRatio = normalizedDelta / 16.67; // Ratio compared to 60fps

      // Calculate characters to reveal this frame
      const charsPerFrame = calculateCharsPerFrame(bufferSize, incomingRateRef.current);

      // Accumulate fractional characters for smooth sub-character precision
      accumulatedCharsRef.current += charsPerFrame * frameRatio;

      // Extract whole characters to display
      const charsToAdd = Math.floor(accumulatedCharsRef.current);
      if (charsToAdd > 0) {
        accumulatedCharsRef.current -= charsToAdd;
        let newDisplayed = Math.min(currentDisplayed + charsToAdd, textLength);

        // Snap to next word boundary for natural reading flow
        const nextBoundary = findNextWordBoundary(text, newDisplayed);
        if (nextBoundary <= textLength && nextBoundary - newDisplayed <= 3) {
          newDisplayed = nextBoundary;
        }

        // Update internal ref immediately
        if (newDisplayed !== displayedLengthRef.current) {
          displayedLengthRef.current = newDisplayed;

          // Throttle React state updates to reduce re-renders
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

      // Continue animation
      animationFrameRef.current = requestAnimationFrame(animate);
    },
    [calculateCharsPerFrame, prefersReducedMotion]
  );

  // Handle tab visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      const wasVisible = isVisibleRef.current;
      isVisibleRef.current = document.visibilityState === 'visible';

      if (!wasVisible && isVisibleRef.current) {
        // Tab became visible - calculate catch-up
        const hiddenDuration = performance.now() - hiddenTimeRef.current;
        const catchUpChars = Math.floor((hiddenDuration / 1000) * targetCPS);

        if (catchUpChars > 0 && isStreamingRef.current) {
          // Instantly catch up for most of the hidden duration
          const newDisplayed = Math.min(
            displayedLengthRef.current + catchUpChars,
            targetTextRef.current.length
          );
          displayedLengthRef.current = newDisplayed;
          setDisplayLength(newDisplayed);
        }
      } else if (wasVisible && !isVisibleRef.current) {
        // Tab became hidden - record time
        hiddenTimeRef.current = performance.now();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [targetCPS]);

  // Start/restart animation when text changes
  useEffect(() => {
    targetTextRef.current = text;
    isStreamingRef.current = isStreaming;

    if (isStreaming) {
      updateMetrics(text.length);

      // Start animation if not already running
      if (!animationFrameRef.current) {
        lastFrameTimeRef.current = 0;
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    } else {
      // Not streaming - show all text immediately
      displayedLengthRef.current = text.length;
      accumulatedCharsRef.current = 0;
      setDisplayLength(text.length);
      setIsTyping(false);

      // Reset metrics
      metricsRef.current.clear();
      incomingRateRef.current = 0;
    }
  }, [text, isStreaming, animate, updateMetrics]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, []);

  // Calculate anchor position (memoized to avoid recalculation)
  const anchorPosition = useMemo(
    () => findSafeAnchor(text, displayLength),
    [text, displayLength]
  );

  // Calculate progress and buffer size
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
