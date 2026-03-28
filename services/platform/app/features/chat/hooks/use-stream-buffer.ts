'use client';

/**
 * Stream Buffer Hook — Adaptive Drain Rate
 *
 * Manages the buffer between incoming streamed text and displayed text,
 * using an adaptive output rate that scales with buffer depth.
 * Small buffers drain at a relaxed typing speed for a natural feel;
 * large buffers ramp up so the user isn't left watching text trickle
 * long after the server has finished.
 *
 * STRATEGY:
 * =========
 * 1. CONSTANT RATE: Fixed CPS (default 20) for a steady, readable
 *    typing feel regardless of buffer depth.
 *
 * 2. INITIAL BUFFERING: Waits for enough characters before starting
 *    - Builds a small reservoir to smooth the first few seconds
 *    - Character-based threshold (works for CJK and Latin)
 *
 * 3. BUFFER EMPTY: Keeps animation loop running
 *    - Cursor stays visible while waiting for next chunk
 *    - Resumes at the same rate when text arrives
 *
 * 4. STREAM ENDS: Drains remaining buffer at 3× the streaming CPS
 *    - Fast enough to clear the backlog, slow enough to stay readable
 *    - Reduced motion: reveals immediately (no animation)
 *
 * USAGE:
 * ------
 * const { displayLength, isTyping, progress } = useStreamBuffer({
 *   text: streamingText,
 *   isStreaming: true,
 * });
 */

import { useState, useEffect, useRef, useCallback } from 'react';

import { usePrefersReducedMotion } from '@/app/hooks/use-prefers-reduced-motion';

import {
  findSyntaxSkipEnd,
  isAmbiguousPartialLine,
  isAtTrailingEmptyMarker,
} from '../utils/line-buffer';

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG = {
  /** Characters per second for reveal animation */
  targetCPS: 20,
  /** Characters to buffer before starting reveal */
  initialBufferChars: 30,
  /** Interval between React state updates (ms) */
  stateUpdateInterval: 30,
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
  /** Base characters per second for reveal animation */
  targetCPS?: number;
  /** Characters to buffer before starting reveal */
  initialBufferChars?: number;
}

interface UseStreamBufferResult {
  /** Current number of characters to display */
  displayLength: number;
  /** Progress from 0 to 1 */
  progress: number;
  /** Whether animation is currently active */
  isTyping: boolean;
  /** Number of characters remaining in buffer */
  bufferSize: number;
  /** True while the buffer still has content to reveal after streaming ends */
  isDraining: boolean;
  /** Freeze the display at its current position. No more text will be revealed until the next streaming session. */
  freeze: () => void;
}

// ============================================================================
// DISPLAY POSITION CACHE
// ============================================================================
// Module-level cache that decouples animation state from component lifecycle.
// When a component remounts (step transitions, marker branching, SDK rebuilds),
// the new instance reads the cached position instead of restarting from 0.
// Keyed by text prefix — survives key changes across step transitions.

const CACHE_PREFIX_LEN = 50;
const MAX_CACHE_ENTRIES = 20;
const displayPositionCache = new Map<string, number>();

function getCacheKey(text: string): string | null {
  return text.length >= CACHE_PREFIX_LEN
    ? text.slice(0, CACHE_PREFIX_LEN)
    : null;
}

export function findCachedPosition(text: string): number {
  for (const [prefix, position] of displayPositionCache) {
    if (text.startsWith(prefix) && position <= text.length) {
      return position;
    }
  }
  return 0;
}

export function saveToCache(text: string, position: number) {
  const key = getCacheKey(text);
  if (!key || position <= 0) return;
  displayPositionCache.delete(key);
  displayPositionCache.set(key, position);
  while (displayPositionCache.size > MAX_CACHE_ENTRIES) {
    const oldest = displayPositionCache.keys().next().value;
    if (oldest !== undefined) displayPositionCache.delete(oldest);
  }
}

export function clearDisplayPositionCache() {
  displayPositionCache.clear();
}

// ============================================================================
// MODULE-LEVEL FREEZE SIGNAL
// ============================================================================
// Allows external callers (e.g. stop generating) to freeze all active stream
// buffer instances without prop drilling. Only one stream is active at a time,
// so a single global flag is sufficient. Cleared when a new streaming session
// begins.

let globalFrozen = false;
let frozenDisplayText: string | null = null;

// The active streaming hook instance registers its refs here so
// freezeActiveStream() can snapshot the displayed text and cancel animation.
// Invariant: only one hook instance should be active (streaming) at a time.
let activeTextRef: { current: string } | null = null;
let activeDisplayedLengthRef: { current: number } | null = null;
let activeFrozenRef: { current: boolean } | null = null;
let activeAnimationFrameRef: { current: number | null } | null = null;
let activeWasStreamingRef: { current: boolean } | null = null;
let activeInstanceId: string | null = null;

let instanceCounter = 0;

/**
 * Freeze all active stream buffers. Called by the stop generating flow.
 * Captures the currently displayed text so it can be sent to the backend.
 * Also cancels the in-flight animation frame and sets the instance-level
 * frozen flag so no further chars are revealed before React flushes.
 */
export function freezeActiveStream() {
  globalFrozen = true;

  // Cancel the active RAF so no more displayedLengthRef advances happen
  if (activeAnimationFrameRef?.current) {
    cancelAnimationFrame(activeAnimationFrameRef.current);
    activeAnimationFrameRef.current = null;
  }

  // Set instance-level frozen flag (belt-and-suspenders with globalFrozen)
  if (activeFrozenRef) {
    activeFrozenRef.current = true;
  }

  if (activeTextRef && activeDisplayedLengthRef) {
    frozenDisplayText = activeTextRef.current.slice(
      0,
      activeDisplayedLengthRef.current,
    );
  }
}

/**
 * Check whether the global freeze is active.
 */
export function isStreamFrozen() {
  return globalFrozen;
}

/**
 * Reset the global freeze flag. Called before sending a new message so that
 * a previous stop doesn't prevent the next response from rendering.
 */
export function resetGlobalFreeze() {
  globalFrozen = false;
  frozenDisplayText = null;
  if (activeFrozenRef) {
    activeFrozenRef.current = false;
  }
  if (activeWasStreamingRef) {
    activeWasStreamingRef.current = false;
  }
}

/**
 * Returns the displayed text captured at the moment of freeze, then clears it.
 * Returns null if no freeze has occurred or text was already consumed.
 */
export function consumeFrozenDisplayText(): string | null {
  const text = frozenDisplayText;
  frozenDisplayText = null;
  return text;
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

  // Recover display position from cache on mount (survives remounts)
  const [cachedPosition] = useState(() =>
    isStreaming ? findCachedPosition(text) : 0,
  );

  const [displayLength, setDisplayLength] = useState(cachedPosition);
  const [isTyping, setIsTyping] = useState(false);

  // Refs for animation state (no re-renders during animation)
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const displayedLengthRef = useRef(cachedPosition);
  const targetTextRef = useRef('');
  const isStreamingRef = useRef(false);
  const accumulatedCharsRef = useRef(0);
  const lastStateUpdateRef = useRef<number>(0);

  // Adaptive-rate specific refs
  const hasStartedRevealRef = useRef(false);
  const wasStreamingRef = useRef(false);

  // Post-stream drain: when non-zero, overrides targetCPS to finish
  // the remaining buffer in 1.5–3.5 seconds instead of dumping it all at once.
  const drainCPSRef = useRef(0);

  // Freeze state: when true, animation stops advancing displayLength.
  // Set by freeze(), cleared when a new streaming session begins.
  const frozenRef = useRef(false);

  // Unique instance id for dev-mode single-instance assertion
  const [instanceId] = useState(() => String(++instanceCounter));

  // Tab visibility tracking
  const isVisibleRef = useRef(true);
  const hiddenTimeRef = useRef(0);

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

      // Frozen: display was frozen (stop generating). Stop the loop entirely.
      // Check both instance-level and module-level freeze signals.
      if (frozenRef.current || globalFrozen) {
        setIsTyping(false);
        animationFrameRef.current = null;
        return;
      }

      const targetText = targetTextRef.current;
      const textLength = targetText.length;
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
        // Stream ended and buffer fully drained — done.
        // Keep wasStreamingRef true so that if new text arrives (late Convex
        // chunks), the effect's drain branch handles it instead of the
        // "show immediately" branch which would flash all content at once.
        setIsTyping(false);
        drainCPSRef.current = 0;
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

      const safeCPS = Math.max(1, targetCPS);
      const effectiveCPS =
        drainCPSRef.current > 0 && !streaming ? drainCPSRef.current : safeCPS;
      const charsPerFrame = effectiveCPS / 60;

      accumulatedCharsRef.current += charsPerFrame * frameRatio;

      const charsToAdd = Math.floor(accumulatedCharsRef.current);
      if (charsToAdd > 0) {
        accumulatedCharsRef.current -= charsToAdd;
        let newDisplayed = Math.min(currentDisplayed + charsToAdd, textLength);

        // Avoid splitting surrogate pairs — emoji and other supplementary
        // characters use two UTF-16 code units. Slicing between them produces
        // an invalid string that causes react-markdown to misparse.
        if (newDisplayed < textLength && newDisplayed > 0) {
          const code = targetText.charCodeAt(newDisplayed - 1);
          if (code >= 0xd800 && code <= 0xdbff) {
            // Last char is a high surrogate — advance past the low surrogate
            newDisplayed = Math.min(newDisplayed + 1, textLength);
          }
        }

        // Snap to next word boundary
        const nextBoundary = findNextWordBoundary(targetText, newDisplayed);
        if (nextBoundary <= textLength && nextBoundary - newDisplayed <= 3) {
          newDisplayed = nextBoundary;
        }

        // Skip past complete link/image/checkbox syntax so these elements
        // appear atomically instead of flickering from plain text to styled.
        const syntaxEnd = findSyntaxSkipEnd(targetText, newDisplayed);
        if (syntaxEnd > newDisplayed) {
          newDisplayed = Math.min(syntaxEnd, textLength);
        }

        // Line buffering: hold at current position for ambiguous line starts
        // or trailing empty formatting markers (**, *, ~~).
        // Re-credit only the debited chars (not word-boundary snap's free chars)
        // so the accumulator stays bounded and releases as a small burst.
        if (
          isAmbiguousPartialLine(targetText, newDisplayed, streaming) ||
          isAtTrailingEmptyMarker(targetText, newDisplayed, streaming)
        ) {
          accumulatedCharsRef.current += charsToAdd;
          newDisplayed = currentDisplayed;
        }

        if (newDisplayed !== displayedLengthRef.current) {
          displayedLengthRef.current = newDisplayed;

          const timeSinceLastUpdate = currentTime - lastStateUpdateRef.current;
          const atWordBoundary = isWordBoundary(
            targetText[newDisplayed - 1] || '',
          );
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
    [targetCPS, prefersReducedMotion, initialBufferChars],
  );

  // Handle tab visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      const wasVisible = isVisibleRef.current;
      isVisibleRef.current = document.visibilityState === 'visible';

      if (!wasVisible && isVisibleRef.current) {
        const hiddenDuration = performance.now() - hiddenTimeRef.current;
        const effectiveCatchUpCPS =
          drainCPSRef.current > 0 && !isStreamingRef.current
            ? drainCPSRef.current
            : Math.max(1, targetCPS);
        const catchUpChars = Math.floor(
          (hiddenDuration / 1000) * effectiveCatchUpCPS,
        );

        if (
          catchUpChars > 0 &&
          !frozenRef.current &&
          !globalFrozen &&
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
    // Capture BEFORE updating — needed for new-session detection (pitfall #5)
    const prevStreaming = isStreamingRef.current;
    isStreamingRef.current = isStreaming;

    if (isStreaming) {
      // New streaming session: clear freeze so text can flow again
      if (!prevStreaming) {
        frozenRef.current = false;
        globalFrozen = false;
        frozenDisplayText = null;
      }

      // Register this instance's refs so freezeActiveStream() can
      // snapshot the displayed text and cancel animation at freeze time.
      if (process.env.NODE_ENV === 'development') {
        if (activeInstanceId !== null && activeInstanceId !== instanceId) {
          console.warn(
            `[useStreamBuffer] Multiple streaming instances detected ` +
              `(active: ${activeInstanceId}, new: ${instanceId}). ` +
              `Module-level freeze state assumes a single active instance.`,
          );
        }
      }
      activeInstanceId = instanceId;
      activeTextRef = targetTextRef;
      activeDisplayedLengthRef = displayedLengthRef;
      activeFrozenRef = frozenRef;
      activeAnimationFrameRef = animationFrameRef;
      activeWasStreamingRef = wasStreamingRef;
      wasStreamingRef.current = true;

      // Eagerly save position for cross-mount recovery.
      // Runs during commit of each text update — guarantees cache
      // is populated BEFORE any future render that triggers remount.
      if (displayedLengthRef.current > 0) {
        saveToCache(text, displayedLengthRef.current);
      }

      if (!prevStreaming) {
        if (displayedLengthRef.current > 0) {
          hasStartedRevealRef.current = true;
        } else {
          hasStartedRevealRef.current = false;
        }
        accumulatedCharsRef.current = 0;
        drainCPSRef.current = 0;
      }

      if (!animationFrameRef.current && !frozenRef.current && !globalFrozen) {
        lastFrameTimeRef.current = 0;
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    } else if (
      wasStreamingRef.current &&
      !frozenRef.current &&
      !globalFrozen &&
      displayedLengthRef.current < text.length
    ) {
      if (prefersReducedMotion) {
        // Reduced motion: reveal immediately (no animation)
        wasStreamingRef.current = false;
        hasStartedRevealRef.current = false;
        drainCPSRef.current = 0;
        displayedLengthRef.current = text.length;
        accumulatedCharsRef.current = 0;
        setDisplayLength(text.length);
        setIsTyping(false);
      } else {
        // Stream ended — drain remaining buffer at a moderately faster rate.
        // Cap at 3× the streaming CPS so the speed-up is noticeable but not jarring.
        drainCPSRef.current = Math.max(1, targetCPS) * 3;
        if (!animationFrameRef.current) {
          lastFrameTimeRef.current = 0;
          animationFrameRef.current = requestAnimationFrame(animate);
        }
      }
    } else if (!frozenRef.current && !globalFrozen) {
      // Never was streaming or fully caught up — show immediately
      wasStreamingRef.current = false;
      hasStartedRevealRef.current = false;
      drainCPSRef.current = 0;
      displayedLengthRef.current = text.length;
      accumulatedCharsRef.current = 0;
      setDisplayLength(text.length);
      setIsTyping(false);
    }
  }, [text, isStreaming, animate, instanceId, prefersReducedMotion, targetCPS]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      // Backup save for cross-mount recovery (catches final position
      // that the streaming effect may not have saved yet)
      if (isStreamingRef.current || wasStreamingRef.current) {
        saveToCache(targetTextRef.current, displayedLengthRef.current);
      }
      // Unregister this instance's refs
      if (activeTextRef === targetTextRef) {
        activeTextRef = null;
        activeDisplayedLengthRef = null;
        activeFrozenRef = null;
        activeAnimationFrameRef = null;
        activeWasStreamingRef = null;
        activeInstanceId = null;
      }
    };
  }, []);

  const progress = text.length > 0 ? displayLength / text.length : 1;
  const bufferSize = text.length - displayLength;

  // Freeze the display at its current position.
  // After calling freeze(), displayLength will not advance even as more text arrives.
  // The freeze is automatically cleared when the next streaming session begins.
  const freeze = useCallback(() => {
    freezeActiveStream();
    setIsTyping(false);
  }, []);

  return {
    displayLength,
    progress,
    isTyping,
    bufferSize,
    isDraining:
      wasStreamingRef.current && !isStreaming && displayLength < text.length,
    freeze,
  };
}
