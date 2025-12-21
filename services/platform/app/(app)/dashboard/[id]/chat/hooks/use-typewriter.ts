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

interface BufferMetrics {
  lastUpdateTime: number;
  textLengthHistory: Array<{ time: number; length: number }>;
  incomingRate: number; // characters per second
}

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

  // Buffer metrics for adaptive speed
  const metricsRef = useRef<BufferMetrics>({
    lastUpdateTime: 0,
    textLengthHistory: [],
    incomingRate: 0,
  });

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

  // Update metrics when text changes
  const updateMetrics = useCallback((newTextLength: number) => {
    const now = performance.now();
    const metrics = metricsRef.current;

    // Add to history
    metrics.textLengthHistory.push({ time: now, length: newTextLength });

    // Keep only last 500ms of history
    const cutoff = now - 500;
    metrics.textLengthHistory = metrics.textLengthHistory.filter(
      (h) => h.time > cutoff,
    );

    // Calculate incoming rate (chars per second)
    if (metrics.textLengthHistory.length >= 2) {
      const oldest = metrics.textLengthHistory[0];
      const newest =
        metrics.textLengthHistory[metrics.textLengthHistory.length - 1];
      const timeDelta = (newest.time - oldest.time) / 1000; // Convert to seconds
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

      const textLength = targetTextRef.current.length;
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
        const newDisplayed = Math.min(
          currentDisplayed + charsToAdd,
          textLength,
        );

        if (newDisplayed !== displayedLengthRef.current) {
          displayedLengthRef.current = newDisplayed;
          setDisplayedLength(newDisplayed);
          setIsTyping(true);
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
      metricsRef.current = {
        lastUpdateTime: 0,
        textLengthHistory: [],
        incomingRate: 0,
      };
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
