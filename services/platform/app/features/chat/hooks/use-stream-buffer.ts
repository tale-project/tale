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
 * 1. ADAPTIVE STREAMING RATE: Base targetCPS (default 40 ≈ 8 wps) for a
 *    typewriter feel when the stream is keeping pace. Scales up with
 *    buffer depth (linearly above streamingBufferTargetChars) when the
 *    server gets ahead of the reveal. Capped at streamingCPSMax (100)
 *    ≈ 20 wps so fast streams stay word-by-word, not a dump.
 *
 * 2. INITIAL BUFFERING: Waits for enough characters before starting
 *    - Builds a small reservoir to smooth the first few seconds
 *    - Character-based threshold (works for CJK and Latin)
 *
 * 3. BUFFER EMPTY: Keeps animation loop running
 *    - Cursor stays visible while waiting for next chunk
 *    - Resumes at the same rate when text arrives
 *
 * 4. BACKLOG OVERFLOW (stream phase): When the buffer exceeds
 *    sentenceModeMinChars (≈ 300) while streaming is still active, reveal
 *    switches from word-mode to sentence-mode chunks AND the effective CPS
 *    is lifted to streamSentenceModeMinCPS (≈ 400) — so sentences arrive
 *    as a steady stream (~125 ms/tick, ~8 sentences/sec) that visibly
 *    shrinks the backlog, rather than trickling at the drain-style
 *    ~500 ms pace. Drops back to word-mode (and the regular
 *    streamingCPSMax cap) once the buffer drains below the threshold.
 *
 * 5. STREAM ENDS: Drain remaining buffer. Three regimes by tail size:
 *    - Short (< drainShortRemainingChars ≈ 80): base targetCPS,
 *      word-mode. A one-sentence reply types out at reading speed.
 *    - Medium (< sentenceModeMinChars ≈ 300): CPS tuned to
 *      drainMsPerChar (≈ 83 CPS), capped at drainMaxTotalMs total,
 *      word-mode. A few-sentence reply reveals briskly but word-by-word.
 *    - Long (≥ sentenceModeMinChars): same CPS calculation,
 *      sentence-mode chunking — a paragraph reads as calm sentence
 *      ticks (~600 ms each) instead of a racing word stream at high CPS.
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
  /** Base characters per second — the "typewriter" rate used when the
   *  buffer is shallow (shallow = stream is keeping pace, nothing to catch
   *  up on). 40 CPS ≈ 8 English words / 24 CJK chars per second — slow
   *  enough to unambiguously read word-by-word. The effective CPS scales
   *  up from this base when the stream gets ahead of the reveal
   *  (see streamingBufferTargetChars/streamingCPSMax) and during drain
   *  for moderate/long tails. */
  targetCPS: 40,
  /** Characters to buffer before starting reveal */
  initialBufferChars: 30,
  /** Average characters per word-tick — used to convert targetCPS to tick
   *  interval. 5 matches average English word length including trailing space. */
  avgWordChars: 5,
  /** Hard cap on chars revealed in a single tick (word mode). Sized so a
   *  typical long code token / URL fits in one tick (no mid-token flicker);
   *  genuinely huge identifiers (>80 chars) still get chunked across frames. */
  maxChunkChars: 80,
  /** Average characters per sentence-tick — used during long-tail drain to
   *  translate drain CPS into a sentence-paced interval. */
  avgSentenceChars: 50,
  /** Hard cap on chars revealed in a single tick (sentence mode). Bigger
   *  than word-mode cap so most sentences fit in one tick; oversized
   *  sentences get chunked at the cap with scan-back to the nearest space. */
  maxSentenceChunkChars: 200,
  /** During streaming, effective CPS scales up when the buffer grows past
   *  this depth — keeps the reveal from falling behind a fast server
   *  stream and piling backlog into the drain phase. */
  streamingBufferTargetChars: 30,
  /** Upper cap on streaming effective CPS. 100 CPS ≈ 20 English words per
   *  second — still discernibly word-by-word; above this human eyes can't
   *  track individual words and the reveal looks like a dump. */
  streamingCPSMax: 100,
  /** At or below this remaining buffer size, drain uses the base targetCPS
   *  so a short reply types out naturally. Above it, drain bumps CPS to
   *  fit the drainMaxTotalMs budget, still word-by-word. */
  drainShortRemainingChars: 80,
  /** Minimum buffered chars before switching from word-mode to per-sentence
   *  chunks. Applies in both phases: during streaming it caps the backlog
   *  by letting big paragraphs catch up a sentence at a time, and during
   *  drain it keeps long tails from racing through as a word blur. Below
   *  this threshold, reveal stays word-by-word so short content doesn't
   *  flash whole-sentence. Set high enough (≈ 6+ avg sentences) that only
   *  genuinely large backlogs trigger sentence-mode. */
  sentenceModeMinChars: 300,
  /** Minimum effective CPS when sentence-mode activates mid-stream
   *  (backlog ≥ sentenceModeMinChars with the stream still open). Lifts
   *  the reveal well above streamingCPSMax so sentences arrive as a
   *  steady stream (≈ 125 ms/tick with avgSentenceChars = 50, ~8
   *  sentences/sec) and the backlog visibly shrinks, instead of the
   *  calm ≈ 500 ms drain-style pace. Doesn't apply in the drain phase —
   *  drain keeps the relaxed post-stream rhythm. */
  streamSentenceModeMinCPS: 400,
  /** Target ms per char for medium/long drains. 12 ms/char ≈ 83 CPS —
   *  near the base typewriter rate so drain still feels like typing rather
   *  than racing. Sentence-mode (≥ sentenceModeMinChars) uses the
   *  same CPS, which translates to one-sentence-per-tick ≈ 600 ms/sentence
   *  — calm paragraph reveal instead of a rapid word blur. */
  drainMsPerChar: 12,
  /** Hard cap on total drain time (ms). Beyond this, CPS scales up with
   *  remaining chars so very large buffers don't sit for minutes. */
  drainMaxTotalMs: 8000,
  /** Maximum delta time (ms) to prevent jumps after tab switching */
  maxDeltaTime: 100,
};

// CJK ranges: Hiragana, Katakana, CJK Ext-A, CJK Unified, Hangul Syllables, halfwidth kana
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯ｦ-ﾟ]/;
// CJK punctuation and fullwidth ASCII punctuation
const CJK_PUNCT_RE = /[　-〿！-･]/;
/** Consecutive CJK chars before we insert a soft boundary in word mode (keeps
 *  CJK text chunking in small groups instead of appearing in one burst). */
const CJK_SOFT_BOUNDARY_RUN = 3;

/** Sentence-terminating punctuation: ASCII (.!?) + CJK fullwidth (。！？) +
 *  newline. Used for per-sentence drain reveal when the remaining tail is
 *  long enough that sentence chunks feel calmer than racing word chunks. */
const SENTENCE_BOUNDARY_RE = /[.!?。！？\n]/;

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
 * Find the next "chunk end" for word/CJK-aware reveal (used during STREAMING).
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
  return text.length;
}

/**
 * Find the next "chunk end" for sentence-paced reveal (used when the
 * buffered backlog is long — see sentenceModeMinChars; applies during
 * both stream-phase overflow and drain of long tails).
 *
 * Returns a position > startPos where the next sentence ends:
 * - After ASCII sentence-terminating punctuation (`.`, `!`, `?`)
 * - After CJK sentence-terminating punctuation (`。`, `！`, `？`)
 * - After a newline (paragraph / list-item / hard-line break)
 * - At maxChunkChars (forced chunk; scans back to the nearest space to
 *   avoid mid-word cut; falls through to maxChunkChars if no space)
 * - At text.length (reveal remaining tail chunk)
 */
function findNextSentenceBoundary(
  text: string,
  startPos: number,
  maxChunkChars: number,
): number {
  if (startPos >= text.length) return startPos;
  const maxEnd = Math.min(startPos + maxChunkChars, text.length);
  for (let i = startPos; i < maxEnd; i++) {
    if (SENTENCE_BOUNDARY_RE.test(text[i])) return i + 1;
  }
  if (maxEnd < text.length) {
    for (let i = maxEnd - 1; i > startPos; i--) {
      const ch = text[i];
      if (ch === ' ' || ch === '\t') return i + 1;
    }
    return maxEnd;
  }
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

      // Effective CPS:
      //   - Streaming: scales with buffer depth — as soon as the stream
      //     gets ahead of the reveal (bufferSize > streamingBufferTargetChars),
      //     CPS ramps proportionally up to streamingCPSMax. This keeps the
      //     buffer shallow so the drain phase rarely has a big backlog.
      //   - Drain: fixed at drainCPSRef (set when stream ends).
      // Chunk boundary is word-level except when the buffered backlog is
      // large (≥ sentenceModeMinChars) — then reveal switches to sentence
      // chunks so a big paragraph catches up a sentence at a time instead
      // of racing through words. Applies in both streaming and drain.
      const safeCPS = Math.max(1, targetCPS);
      const isDrainPhase = drainCPSRef.current > 0 && !streaming;
      let effectiveCPS: number;
      if (isDrainPhase) {
        effectiveCPS = drainCPSRef.current;
      } else {
        const ratio = bufferSize / DEFAULT_CONFIG.streamingBufferTargetChars;
        effectiveCPS = Math.min(
          DEFAULT_CONFIG.streamingCPSMax,
          Math.max(safeCPS, safeCPS * ratio),
        );
      }
      const useSentenceMode = bufferSize >= DEFAULT_CONFIG.sentenceModeMinChars;
      // Stream-phase sentence-mode engages because the backlog is big and
      // word-mode can't catch up. Lift effectiveCPS well above
      // streamingCPSMax so sentences arrive as a steady stream
      // (~125 ms/tick, ~8 sentences/sec) that visibly shrinks the
      // backlog, instead of the calm ~500 ms drain-style pace. Drain
      // phase keeps its own relaxed pacing via drainCPSRef.
      if (useSentenceMode && !isDrainPhase) {
        effectiveCPS = Math.max(
          effectiveCPS,
          DEFAULT_CONFIG.streamSentenceModeMinCPS,
        );
      }
      const avgChunkChars = useSentenceMode
        ? DEFAULT_CONFIG.avgSentenceChars
        : DEFAULT_CONFIG.avgWordChars;
      const chunkCap = useSentenceMode
        ? DEFAULT_CONFIG.maxSentenceChunkChars
        : DEFAULT_CONFIG.maxChunkChars;
      const findChunkEnd = useSentenceMode
        ? findNextSentenceBoundary
        : findNextWordBoundary;
      // Upper-clamp so very low CPS still produces visible progress.
      const tickInterval = Math.min(500, (avgChunkChars * 1000) / effectiveCPS);

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
        let candidate = findChunkEnd(targetText, newDisplayed, chunkCap);

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
        // (**, *, ~~), extend char-by-char (bounded by chunkCap) until the
        // prefix resolves. If it won't resolve within budget, hold.
        const extendCap = Math.min(newDisplayed + chunkCap, textLength);
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
        // Stream ended — compute a drain CPS for the remaining buffer.
        //   Short tail (< drainShortRemainingChars): base targetCPS so a
        //     one-sentence reply types out at reading speed.
        //   Medium/long tail: target drainMsPerChar per char (≈ base rate)
        //     up to drainMaxTotalMs total — for very large buffers the CPS
        //     scales above base so we don't wait minutes. Mode-switch to
        //     sentence chunks happens in animate (≥ sentenceModeMinChars)
        //     so very long tails read as calm sentence ticks, not a word blur.
        const remaining = text.length - displayedLengthRef.current;
        const safeCPS = Math.max(1, targetCPS);
        if (remaining < DEFAULT_CONFIG.drainShortRemainingChars) {
          drainCPSRef.current = safeCPS;
        } else {
          const targetDrainMs = Math.min(
            DEFAULT_CONFIG.drainMaxTotalMs,
            remaining * DEFAULT_CONFIG.drainMsPerChar,
          );
          drainCPSRef.current = Math.max(
            safeCPS,
            (remaining * 1000) / targetDrainMs,
          );
        }
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
