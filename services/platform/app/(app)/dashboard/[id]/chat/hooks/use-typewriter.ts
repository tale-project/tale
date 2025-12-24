'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface UseTypewriterOptions {
  text: string;
  isStreaming?: boolean;
  /**
   * Target characters per second for display.
   * The animation will auto-adjust around this value based on buffer state.
   */
  targetCPS?: number;
  /**
   * Minimum buffer size (in characters) to maintain before displaying.
   * Helps prevent stuttering when text arrives slowly.
   */
  minBufferSize?: number;
  /**
   * How aggressively to catch up when buffer grows too large.
   * Higher values = faster catch-up (1.0 = normal, 2.0 = 2x speed).
   */
  catchUpMultiplier?: number;
}

// Ring buffer for metrics tracking - avoids array allocations/GC pressure
const HISTORY_SIZE = 30; // ~500ms at 60fps

interface MetricsEntry {
  time: number;
  length: number;
}

class RingBuffer {
  private buffer: MetricsEntry[] = new Array(HISTORY_SIZE);
  private writeIndex = 0;
  private count = 0;

  push(entry: MetricsEntry) {
    this.buffer[this.writeIndex] = entry;
    this.writeIndex = (this.writeIndex + 1) % HISTORY_SIZE;
    if (this.count < HISTORY_SIZE) this.count++;
  }

  getOldestNewerThan(cutoffTime: number): MetricsEntry | null {
    if (this.count === 0) return null;

    // Find oldest entry newer than cutoff
    for (let i = 0; i < this.count; i++) {
      const idx =
        (this.writeIndex - this.count + i + HISTORY_SIZE) % HISTORY_SIZE;
      const entry = this.buffer[idx];
      if (entry.time > cutoffTime) {
        return entry;
      }
    }
    return null;
  }

  getNewest(): MetricsEntry | null {
    if (this.count === 0) return null;
    return this.buffer[(this.writeIndex - 1 + HISTORY_SIZE) % HISTORY_SIZE];
  }

  clear() {
    this.writeIndex = 0;
    this.count = 0;
  }
}

interface BufferMetrics {
  lastUpdateTime: number;
  history: RingBuffer;
  incomingRate: number; // characters per second
}

// Check if position is at a word boundary (space, newline, punctuation)
function isAtWordBoundary(text: string, pos: number): boolean {
  if (pos >= text.length) return true;
  const char = text[pos];
  return (
    char === ' ' ||
    char === '\n' ||
    char === '.' ||
    char === ',' ||
    char === '!' ||
    char === '?' ||
    char === ';' ||
    char === ':'
  );
}

// Throttle interval for React state updates (ms)
const STATE_UPDATE_INTERVAL = 50;

/**
 * Improved typewriter hook with buffering and self-adjusting speed.
 *
 * Features:
 * - Uses requestAnimationFrame for smooth 60fps animation
 * - Tracks incoming text rate to auto-adjust display speed
 * - Maintains a buffer to prevent stuttering
 * - Catches up smoothly when buffer grows too large
 * - Consistent animation regardless of network conditions
 */
export function useTypewriter({
  text,
  isStreaming = false,
  targetCPS = 80, // Characters per second
  minBufferSize = 5,
  catchUpMultiplier = 1.5,
}: UseTypewriterOptions) {
  const [displayedLength, setDisplayedLength] = useState(0);
  const [isTyping, setIsTyping] = useState(false);

  // Refs for animation state (avoid re-renders during animation)
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const displayedLengthRef = useRef(0);
  const targetTextRef = useRef('');
  const isStreamingRef = useRef(false);

  // Buffer metrics for adaptive speed (using ring buffer to avoid GC)
  const metricsRef = useRef<BufferMetrics>({
    lastUpdateTime: 0,
    history: new RingBuffer(),
    incomingRate: 0,
  });

  // Throttle ref for state updates
  const lastStateUpdateRef = useRef<number>(0);

  // Accumulated fractional characters (for sub-character-per-frame precision)
  const accumulatedCharsRef = useRef(0);

  // Calculate adaptive speed based on buffer state
  const calculateCharsPerFrame = useCallback(
    (bufferSize: number, incomingRate: number): number => {
      // Base rate: targetCPS / 60 (for 60fps)
      const baseCharsPerFrame = targetCPS / 60;

      // If buffer is getting too large, speed up to catch up
      // If buffer is too small, slow down to build buffer
      const bufferRatio = bufferSize / Math.max(minBufferSize * 2, 20);

      let speedMultiplier: number;
      if (bufferRatio > 2) {
        // Large buffer - catch up aggressively
        speedMultiplier = Math.min(catchUpMultiplier * 2, bufferRatio);
      } else if (bufferRatio > 1) {
        // Moderate buffer - catch up gradually
        speedMultiplier = 1 + (bufferRatio - 1) * (catchUpMultiplier - 1);
      } else if (bufferRatio < 0.5 && incomingRate > 0) {
        // Small buffer and still receiving - slow down slightly
        speedMultiplier = Math.max(0.5, bufferRatio + 0.5);
      } else {
        speedMultiplier = 1;
      }

      return baseCharsPerFrame * speedMultiplier;
    },
    [targetCPS, minBufferSize, catchUpMultiplier],
  );

  // Update metrics when text changes (using ring buffer - no allocations)
  const updateMetrics = useCallback((newTextLength: number) => {
    const now = performance.now();
    const metrics = metricsRef.current;

    // Add to ring buffer (no array allocation)
    metrics.history.push({ time: now, length: newTextLength });

    // Calculate incoming rate from ring buffer
    const cutoff = now - 500;
    const oldest = metrics.history.getOldestNewerThan(cutoff);
    const newest = metrics.history.getNewest();

    if (oldest && newest && oldest !== newest) {
      const timeDelta = (newest.time - oldest.time) / 1000;
      const charsDelta = newest.length - oldest.length;
      metrics.incomingRate = timeDelta > 0 ? charsDelta / timeDelta : 0;
    }

    metrics.lastUpdateTime = now;
  }, []);

  // Animation loop
  const animate = useCallback(
    (currentTime: number) => {
      if (!isStreamingRef.current) {
        // Not streaming - show all text immediately
        if (displayedLengthRef.current !== targetTextRef.current.length) {
          displayedLengthRef.current = targetTextRef.current.length;
          setDisplayedLength(displayedLengthRef.current);
          setIsTyping(false);
        }
        animationFrameRef.current = null;
        return;
      }

      const text = targetTextRef.current;
      const textLength = text.length;
      const currentDisplayed = displayedLengthRef.current;
      const bufferSize = textLength - currentDisplayed;

      // If we've caught up and streaming stopped, we're done
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

      // Normalize delta time (cap at 100ms to handle tab switching)
      const normalizedDelta = Math.min(deltaTime, 100);
      const frameRatio = normalizedDelta / 16.67; // Ratio compared to 60fps

      // Calculate how many characters to show this frame
      const charsPerFrame = calculateCharsPerFrame(
        bufferSize,
        metricsRef.current.incomingRate,
      );

      // Accumulate fractional characters for smooth sub-character precision
      accumulatedCharsRef.current += charsPerFrame * frameRatio;

      // Extract whole characters to display
      const charsToAdd = Math.floor(accumulatedCharsRef.current);
      if (charsToAdd > 0) {
        accumulatedCharsRef.current -= charsToAdd;
        let newDisplayed = Math.min(currentDisplayed + charsToAdd, textLength);

        // Snap to word boundary if we're close (within 3 chars of a space)
        // This creates a more natural word-by-word feel
        const lookAhead = Math.min(newDisplayed + 3, textLength);
        for (let i = newDisplayed; i <= lookAhead; i++) {
          if (isAtWordBoundary(text, i)) {
            // Found word boundary, snap to it (include the space)
            newDisplayed = Math.min(i + 1, textLength);
            break;
          }
        }

        // Update internal ref immediately
        if (newDisplayed !== displayedLengthRef.current) {
          displayedLengthRef.current = newDisplayed;

          // Throttle React state updates to reduce re-renders
          // Update if: enough time passed OR at word boundary OR caught up
          const timeSinceLastUpdate = currentTime - lastStateUpdateRef.current;
          const shouldUpdate =
            timeSinceLastUpdate >= STATE_UPDATE_INTERVAL ||
            isAtWordBoundary(text, newDisplayed) ||
            newDisplayed === textLength;

          if (shouldUpdate) {
            lastStateUpdateRef.current = currentTime;
            setDisplayedLength(newDisplayed);
            setIsTyping(true);
          }
        }
      }

      // Continue animation
      animationFrameRef.current = requestAnimationFrame(animate);
    },
    [calculateCharsPerFrame],
  );

  // Start/restart animation when text changes
  useEffect(() => {
    targetTextRef.current = text;
    isStreamingRef.current = isStreaming;

    if (isStreaming) {
      updateMetrics(text.length);

      // Start animation if not already running
      if (!animationFrameRef.current) {
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    } else {
      // Not streaming - show all text immediately
      displayedLengthRef.current = text.length;
      accumulatedCharsRef.current = 0;
      setDisplayedLength(text.length);
      setIsTyping(false);

      // Reset metrics
      metricsRef.current.history.clear();
      metricsRef.current.lastUpdateTime = 0;
      metricsRef.current.incomingRate = 0;
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

  const displayText = text.slice(0, displayedLength);
  const progress = text.length > 0 ? displayedLength / text.length : 1;

  return {
    displayText,
    isTyping,
    progress,
  };
}
