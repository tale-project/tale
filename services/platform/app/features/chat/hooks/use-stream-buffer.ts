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
 * 4. STREAM ENDS: Drains remaining buffer at whichever is faster:
 *    3× the streaming CPS or the rate needed to finish in ≤ 2 seconds.
 *    - Small buffers drain at 3× CPS for a natural feel
 *    - Large buffers ramp up to guarantee ≤ 2 s total drain time
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
  /** Effective characters per second. Translated internally to a word-tick
   *  cadence via AVG_WORD_CHARS — text reveals in word/CJK-punct chunks, not
   *  per character, so the effect feels like ChatGPT's token-by-token stream. */
  targetCPS: 60,
  /** Characters to buffer before starting reveal */
  initialBufferChars: 30,
  /** Average characters per word-tick — used to convert targetCPS to tick
   *  interval. 5 matches average English word length including trailing space. */
  avgWordChars: 5,
  /** Hard cap on chars revealed in a single tick. Prevents a long code token
   *  (e.g. a 200-char identifier) from dumping in one frame. */
  maxChunkChars: 40,
  /** Maximum delta time (ms) to prevent jumps after tab switching */
  maxDeltaTime: 100,
};

// CJK ranges: Hiragana, Katakana, CJK Ext-A, CJK Unified, Hangul Syllables, halfwidth kana
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯ｦ-ﾟ]/;
// CJK punctuation and fullwidth ASCII punctuation
const CJK_PUNCT_RE = /[　-〿！-･]/;
/** Consecutive CJK chars before we insert a soft boundary (keeps CJK text
 *  chunking in small groups instead of appearing in one burst). */
const CJK_SOFT_BOUNDARY_RUN = 3;

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
const displayPositionCache = new Map();

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

/**
 * Find the next "chunk end" for word/CJK-aware reveal.
 *
 * Returns a position > startPos where the next chunk ends:
 * - After a Western word boundary (space/newline/punct)
 * - After any CJK punctuation
 * - After {CJK_SOFT_BOUNDARY_RUN} consecutive CJK characters (soft boundary)
 * - At maxChunkChars (force chunk for long code tokens / URLs)
 * - At text.length (reveal remaining tail chunk)
 */
function findNextWordBoundary(
  text: string,
  startPos: number,
  maxChunkChars: number,
): number {
  if (startPos >= text.length) return startPos;
  const maxEnd = Math.min(startPos + maxChunkChars, text.length);
  let cjkRun = 0;
  for (let i = startPos; i < maxEnd; i++) {
    const ch = text[i];
    if (CJK_PUNCT_RE.test(ch)) return i + 1;
    if (CJK_RE.test(ch)) {
      cjkRun++;
      if (cjkRun >= CJK_SOFT_BOUNDARY_RUN) return i + 1;
      continue;
    }
    cjkRun = 0;
    if (isWordBoundary(ch)) return i + 1;
  }
  // No natural boundary within the window.
  if (maxEnd < text.length) {
    // Force a chunk at maxChunkChars — prevents hanging on long code tokens.
    return maxEnd;
  }
  // Reached end of buffered text — reveal the remaining partial chunk.
  // If more text arrives later, the next scan starts from text.length.
  return text.length;
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
  const lastFrameTimeRef = useRef(0);
  const displayedLengthRef = useRef(cachedPosition);
  const targetTextRef = useRef('');
  const isStreamingRef = useRef(false);
  // Accumulates elapsed ms between ticks. A tick (= one word/chunk reveal)
  // fires when this exceeds tickInterval. Replaces the old per-char accumulator.
  const accumulatedTimeRef = useRef(0);

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

      // Convert effective CPS → tick interval (ms per word chunk).
      // Default 60 CPS ÷ 5 chars/word = 12 WPS → ~83ms per tick.
      const safeCPS = Math.max(1, targetCPS);
      const effectiveCPS =
        drainCPSRef.current > 0 && !streaming ? drainCPSRef.current : safeCPS;
      // Upper-clamp so very low CPS still produces visible progress.
      const tickInterval = Math.min(
        500,
        (DEFAULT_CONFIG.avgWordChars * 1000) / effectiveCPS,
      );

      accumulatedTimeRef.current += normalizedDelta;

      let newDisplayed = currentDisplayed;
      let ticks = 0;
      // Safety cap: in case of huge catch-up (shouldn't happen with maxDeltaTime
      // clamp, but keeps the loop bounded).
      const maxTicksPerFrame = 8;
      while (
        accumulatedTimeRef.current >= tickInterval &&
        newDisplayed < textLength &&
        ticks < maxTicksPerFrame
      ) {
        let candidate = findNextWordBoundary(
          targetText,
          newDisplayed,
          DEFAULT_CONFIG.maxChunkChars,
        );

        if (candidate <= newDisplayed) break;
        candidate = Math.min(candidate, textLength);

        // Avoid splitting surrogate pairs — emoji and other supplementary
        // characters use two UTF-16 code units. Slicing between them produces
        // an invalid string that causes react-markdown to misparse.
        if (candidate < textLength && candidate > 0) {
          const code = targetText.charCodeAt(candidate - 1);
          if (code >= 0xd800 && code <= 0xdbff) {
            candidate = Math.min(candidate + 1, textLength);
          }
        }

        // Skip past complete link/image/checkbox syntax so these elements
        // appear atomically instead of flickering from plain text to styled.
        const syntaxEnd = findSyntaxSkipEnd(targetText, candidate);
        if (syntaxEnd > candidate) {
          candidate = Math.min(syntaxEnd, textLength);
        }

        // Line buffering: if candidate lands inside an ambiguous markdown
        // prefix (partial ---, ```, === etc.) or on a trailing empty marker
        // (**, *, ~~), extend char-by-char (bounded by maxChunkChars) until
        // the prefix resolves. If it won't resolve within budget, hold.
        const extendCap = Math.min(
          newDisplayed + DEFAULT_CONFIG.maxChunkChars,
          textLength,
        );
        while (
          candidate < extendCap &&
          (isAmbiguousPartialLine(targetText, candidate, streaming) ||
            isAtTrailingEmptyMarker(targetText, candidate, streaming))
        ) {
          candidate++;
        }
        // Re-apply surrogate pair protection after char-level extension.
        if (candidate < textLength && candidate > 0) {
          const code = targetText.charCodeAt(candidate - 1);
          if (code >= 0xd800 && code <= 0xdbff) {
            candidate = Math.min(candidate + 1, textLength);
          }
        }
        if (
          candidate < textLength &&
          (isAmbiguousPartialLine(targetText, candidate, streaming) ||
            isAtTrailingEmptyMarker(targetText, candidate, streaming))
        ) {
          // Still ambiguous — hold and wait for more text.
          break;
        }

        accumulatedTimeRef.current -= tickInterval;
        newDisplayed = candidate;
        ticks++;
      }

      if (newDisplayed !== displayedLengthRef.current) {
        displayedLengthRef.current = newDisplayed;
        setDisplayLength(newDisplayed);
        setIsTyping(true);
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
        accumulatedTimeRef.current = 0;
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
        accumulatedTimeRef.current = 0;
        setDisplayLength(text.length);
        setIsTyping(false);
      } else {
        // Stream ended — drain remaining buffer quickly.
        // Use whichever is faster: 3× CPS or the rate to finish in ≤ 2 seconds.
        const remaining = text.length - displayedLengthRef.current;
        const drainInTwoSecs = remaining / 2;
        drainCPSRef.current = Math.max(
          Math.max(1, targetCPS) * 3,
          drainInTwoSecs,
        );
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
      accumulatedTimeRef.current = 0;
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
