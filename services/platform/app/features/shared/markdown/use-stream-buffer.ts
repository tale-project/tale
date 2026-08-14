'use client';

/**
 * Stream Buffer Hook — Smooth Segment-by-Segment Reveal
 *
 * Manages the buffer between incoming streamed text and displayed text and
 * reveals it ONE SEGMENT AT A TIME (Gemini-style): prose appears in clause
 * parts (bounded by `, . : ; ! ?` + whitespace), code line by line, table
 * rows row by row — see `findRevealSegmentEnd`. Pacing is still charged PER
 * CHARACTER (a long clause "costs" proportionally more time than a short
 * one), so the average rate is the configured CPS. The rate scales with
 * buffer depth: a shallow buffer reveals at a relaxed pace; a deep buffer
 * ramps up so the user isn't left watching text trickle long after the
 * server has finished.
 *
 * STRATEGY:
 * =========
 * 1. ADAPTIVE RATE: Base targetCPS (default 40) for a steady, readable
 *    reveal speed when the stream is keeping pace. The effective CPS scales
 *    up with buffer depth (smoothed via an EMA, above
 *    streamingBufferTargetChars) when the server gets ahead of the reveal,
 *    capped at streamingCPSMax (220). Each revealed segment consumes
 *    `segmentLength × (1000 / effectiveCPS)` ms from a small time bank.
 *
 * 2. INITIAL BUFFERING: Waits for enough characters before starting
 *    - Builds a small reservoir to smooth the first few seconds
 *    - Character-based threshold (works for CJK and Latin)
 *
 * 3. BUFFER EMPTY / MID-SEGMENT: Keeps animation loop running
 *    - An incomplete clause/line is HELD until its boundary arrives, so a
 *      partial part never flashes in and then grows awkwardly
 *    - Cursor stays visible while waiting for the next delta
 *
 * 4. STREAM ENDS: Drain the remaining buffer, still segment-by-segment.
 *    - Short tail (< drainShortRemainingChars ≈ 80): base targetCPS — a short
 *      reply reveals at reading speed.
 *    - Larger tail: CPS tuned to drainMsPerChar (≈ 83 CPS), scaling up to fit
 *      the drainMaxTotalMs budget so big tails don't trickle for minutes.
 *    - Reduced motion: reveals immediately (no animation).
 *
 * MARKDOWN SAFETY: link/image/code constructs are revealed atomically and
 * ambiguous partial lines (unclosed fences/rules/emphasis) are held — so raw
 * markdown syntax never flashes mid-construct (see findSyntaxSkipEnd /
 * isAmbiguousPartialLine usage below).
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
} from './line-buffer';
import { findRevealSegmentEnd } from './reveal-segment';

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG = {
  /** Base characters per second — the steady "typewriter" rate used when the
   *  buffer is shallow (stream keeping pace, nothing to catch up on). Text is
   *  revealed one CHARACTER at a time at this cadence for a smooth, continuous
   *  flow (not word/sentence chunks). 40 CPS ≈ a relaxed, readable type speed.
   *  The effective CPS scales up smoothly from this base when the stream gets
   *  ahead of the reveal (see streamingBufferTargetChars/streamingCPSMax) and
   *  during drain. */
  targetCPS: 40,
  /** Characters to buffer before starting the reveal. This is a reservoir
   *  for pacing, not first paint: a short "Paris." still HOLDS at
   *  displayLength 0 while streaming because the period is a clause-end
   *  without a trailing space (see findClauseEnd). The thinking shell
   *  stays up until that first reveal, not until this gate. */
  initialBufferChars: 4,
  /** Max chars scanned past a chunk while extending through an ambiguous
   *  markdown prefix (partial fences/rules) before giving up and holding.
   *  Bounds the per-tick line-buffer extension. */
  maxChunkChars: 80,
  /** During streaming, effective CPS scales up when the buffer grows past
   *  this depth — keeps the reveal from falling behind a fast server
   *  stream and piling backlog into the drain phase. */
  streamingBufferTargetChars: 30,
  /** Upper cap on streaming effective CPS. 220 CPS revealed character-by-
   *  character (~3.7 chars/frame at 60fps) reads as fast-but-smooth typing
   *  used to catch up to a fast server, never a chunked dump. */
  streamingCPSMax: 220,
  /** At or below this remaining buffer size, drain uses the base targetCPS
   *  so a short reply types out naturally. Above it, drain bumps CPS to
   *  fit the drainMaxTotalMs budget, still character-by-character. */
  drainShortRemainingChars: 80,
  /** Target ms per char for medium/long drains. 12 ms/char ≈ 83 CPS — brisk
   *  but still clearly typing rather than an instant dump. Large tails scale
   *  above this to fit drainMaxTotalMs, capped per frame by maxCharsPerFrame. */
  drainMsPerChar: 12,
  /** Hard cap on characters revealed in a single animation frame. The tick
   *  cadence (1000/effectiveCPS) paces normal reveal; this only bounds extreme
   *  catch-up (deep backlog / large drain) so even then it stays progressive
   *  (16 chars/frame ≈ 960 CPS) rather than dumping the whole buffer at once. */
  maxCharsPerFrame: 16,
  /** Hard cap on total drain time (ms). Beyond this, CPS scales up with
   *  remaining chars so very large buffers don't sit for minutes. */
  drainMaxTotalMs: 8000,
  /** Maximum delta time (ms) to prevent jumps after tab switching */
  maxDeltaTime: 100,
  /** Cap on banked reveal time. While a segment is held (mid-clause, waiting
   *  for its separator) the frame deltas keep accruing; without a cap the
   *  bank could grow unbounded and fire several segments back-to-back when
   *  the hold resolves. A small bank keeps the post-hold cadence gentle
   *  (roughly one short clause of credit). */
  maxTimeBankMs: 250,
  /** Cap on reveal-time DEBT. Revealing a long segment (a full code line, a
   *  long clause) charges its whole character cost at once, going negative;
   *  uncapped, a very long line could silence the reveal for seconds. This
   *  bounds the pause after any single segment. */
  maxTimeDebtMs: 600,
  /** EMA smoothing factor for the buffer depth that drives the streaming CPS
   *  ramp. The backend flushes deltas in ~250 ms throttled bursts, so a single
   *  push can drop ~80 chars into the buffer at once; reading raw bufferSize
   *  each frame would snap CPS up then back down ~4×/sec (a visible "surge then
   *  settle"). Smoothing the depth with a low alpha eases the speed change over
   *  ~5-7 frames (~100 ms) so the reveal accelerates and decelerates gently.
   *  Frame-rate-normalized at use (scaled by delta/16.67). alpha=1 reproduces
   *  the old instantaneous behavior (escape hatch). Only affects the CPS ramp —
   *  the empty-check and reveal bound use the real bufferSize so the buffer
   *  still drains exactly. */
  bufferEmaAlpha: 0.15,
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
// Snapshotted displayed length at freeze time (in chars of the active
// typewriter's text). Read by the stop-generating flow so the backend can
// truncate the persisted message content WITHOUT having to flatten its
// structured parts. Cleared by `consumeFrozenDisplayLength()`.
let frozenDisplayLength: number | null = null;

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
    frozenDisplayLength = activeDisplayedLengthRef.current;
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
  frozenDisplayLength = null;
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

/**
 * Returns the displayed length (char count of the active typewriter's text)
 * captured at the moment of freeze, then clears it. Returns null if no freeze
 * has occurred. Used by the cancel-generation flow to ask the backend to
 * truncate the persisted message by position instead of by content string —
 * the backend can then preserve structured parts (file, reasoning, tool-call).
 */
export function consumeFrozenDisplayLength(): number | null {
  const length = frozenDisplayLength;
  frozenDisplayLength = null;
  return length;
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

  // Initial position: streaming mounts recover from the cache (survives
  // remounts mid-reveal); non-streaming mounts start FULLY revealed. A
  // completed message remounting (chat switch, branch/version switch) must
  // paint whole on its first frame — initializing to 0 and catching up in the
  // post-paint effect produced a blank frame + pop-in on every remount.
  const [cachedPosition] = useState(() =>
    isStreaming ? findCachedPosition(text) : text.length,
  );

  const [displayLength, setDisplayLength] = useState(cachedPosition);
  const [isTyping, setIsTyping] = useState(false);

  // Refs for animation state (no re-renders during animation)
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef(0);
  const displayedLengthRef = useRef(cachedPosition);
  const targetTextRef = useRef('');
  const isStreamingRef = useRef(false);
  // Accumulates elapsed ms between ticks. A tick (= one character reveal)
  // fires when this exceeds tickInterval (= 1000 / effectiveCPS).
  const accumulatedTimeRef = useRef(0);

  // Adaptive-rate specific refs
  const hasStartedRevealRef = useRef(false);
  const wasStreamingRef = useRef(false);

  // Post-stream drain: when non-zero, overrides targetCPS to finish
  // the remaining buffer in 1.5–3.5 seconds instead of dumping it all at once.
  const drainCPSRef = useRef(0);

  // EMA-smoothed buffer depth driving the streaming CPS ramp (A2). 0 is the
  // "unseeded" sentinel — re-seeded to the live bufferSize on the first frame
  // of each session so the reveal doesn't start artificially slow.
  const smoothedBufferRef = useRef(0);

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

      // Frame-rate-normalized EMA of the buffer depth (A2). Smooths the value
      // that drives the streaming CPS ramp so a bursty 250 ms delta doesn't
      // snap the speed up then back down each push. Seeded to the live
      // bufferSize on the first frame of a session (sentinel 0) so the reveal
      // doesn't start artificially slow. NOTE: only feeds the CPS ramp below —
      // every correctness check (empty, sentence threshold, reveal bound) uses
      // the real `bufferSize`.
      if (smoothedBufferRef.current <= 0) {
        smoothedBufferRef.current = bufferSize;
      } else {
        const emaAlpha = Math.min(
          1,
          DEFAULT_CONFIG.bufferEmaAlpha * (normalizedDelta / 16.67),
        );
        smoothedBufferRef.current +=
          (bufferSize - smoothedBufferRef.current) * emaAlpha;
      }

      // Effective CPS:
      //   - Streaming: ramps with buffer depth — once the stream gets ahead of
      //     the reveal (depth > streamingBufferTargetChars), CPS scales up to
      //     streamingCPSMax so a fast server is caught up via faster CHARACTER
      //     typing (never a chunked dump). Driven by the EMA-smoothed depth so
      //     the speed eases rather than jolts.
      //   - Drain: fixed at drainCPSRef (set when the stream ends).
      const safeCPS = Math.max(1, targetCPS);
      const isDrainPhase = drainCPSRef.current > 0 && !streaming;
      let effectiveCPS: number;
      if (isDrainPhase) {
        effectiveCPS = drainCPSRef.current;
      } else {
        // Ramp off the smoothed depth so the speed eases rather than jolts.
        const ratio =
          smoothedBufferRef.current / DEFAULT_CONFIG.streamingBufferTargetChars;
        effectiveCPS = Math.min(
          DEFAULT_CONFIG.streamingCPSMax,
          Math.max(safeCPS, safeCPS * ratio),
        );
      }
      // Ms charged per revealed character. Segments reveal whole, but each
      // consumes its character cost from the time bank, so a long clause is
      // followed by a proportionally longer pause and the AVERAGE rate stays
      // at effectiveCPS. Clamped so a very low CPS still makes progress.
      const msPerChar = Math.min(500, 1000 / effectiveCPS);
      // Bound for the line-buffer extension scan below.
      const chunkCap = DEFAULT_CONFIG.maxChunkChars;

      // Token-bucket pacing: deltas accrue into a small bank (capped, so a
      // long mid-clause hold can't dump several segments at once when it
      // resolves); revealing a segment spends its character cost, allowed to
      // go negative (capped debt) so the next segment waits its turn.
      accumulatedTimeRef.current = Math.min(
        accumulatedTimeRef.current + normalizedDelta,
        DEFAULT_CONFIG.maxTimeBankMs,
      );

      let newDisplayed = currentDisplayed;
      let revealedChars = 0;
      // Per-frame char cap. The `maxCharsPerFrame` floor keeps normal streaming
      // gentle, but a large drain computes a high effectiveCPS to fit
      // drainMaxTotalMs — so scale the cap to the chars this frame actually
      // budgeted (effectiveCPS × elapsed). Without this the flat 16-char/frame
      // cap throttles drain to ~960 CPS and a long message would trickle for
      // tens of seconds, defeating the drain budget.
      const frameCharBudget = Math.max(
        DEFAULT_CONFIG.maxCharsPerFrame,
        Math.ceil((effectiveCPS * normalizedDelta) / 1000),
      );
      while (
        accumulatedTimeRef.current > 0 &&
        newDisplayed < textLength &&
        revealedChars < frameCharBudget
      ) {
        // Advance one SEGMENT: a prose clause (`, . : ; ! ?` + whitespace), a
        // code line, or a table row — see findRevealSegmentEnd. Returns the
        // current position to signal "hold" while a part is still incomplete.
        let candidate = Math.min(
          findRevealSegmentEnd(targetText, newDisplayed, streaming),
          textLength,
        );
        if (candidate <= newDisplayed) break;

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
        const extendCap = Math.min(candidate + chunkCap, textLength);
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

        const segmentLength = candidate - newDisplayed;
        accumulatedTimeRef.current -= segmentLength * msPerChar;
        newDisplayed = candidate;
        revealedChars += segmentLength;
        // While LIVE-streaming, reveal at most ONE segment per frame: two
        // segments committed in the same frame mount together and their
        // fades read as a single big chunk (visible after a mid-clause hold
        // banked credit). One per frame staggers consecutive fades while
        // still allowing ~60 segments/s. The drain is exempt — its CPS is
        // budgeted to finish within drainMaxTotalMs, and capping it to one
        // segment per frame could overrun that for huge fine-grained tails.
        if (streaming) break;
      }
      // Bound the debt a single long segment can leave behind so the pause
      // before the next segment never stretches past maxTimeDebtMs.
      accumulatedTimeRef.current = Math.max(
        accumulatedTimeRef.current,
        -DEFAULT_CONFIG.maxTimeDebtMs,
      );

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
          const fullText = targetTextRef.current;
          let newDisplayed = Math.min(
            displayedLengthRef.current + catchUpChars,
            fullText.length,
          );
          // The animate loop never lands mid-construct, but this fast catch-up
          // bypasses it — so re-apply the same guards before committing, or the
          // jump can land between a surrogate pair (broken emoji / U+FFFD) or
          // inside link/fence markup (raw-syntax flash).
          if (newDisplayed < fullText.length && newDisplayed > 0) {
            const code = fullText.charCodeAt(newDisplayed - 1);
            if (code >= 0xd800 && code <= 0xdbff) {
              newDisplayed = Math.min(newDisplayed + 1, fullText.length);
            }
          }
          const streaming = isStreamingRef.current;
          newDisplayed = Math.min(
            findSyntaxSkipEnd(fullText, newDisplayed),
            fullText.length,
          );
          if (
            newDisplayed < fullText.length &&
            (isAmbiguousPartialLine(fullText, newDisplayed, streaming) ||
              isAtTrailingEmptyMarker(fullText, newDisplayed, streaming))
          ) {
            // Would land on an ambiguous partial line — hold at the previous
            // safe position and let the guarded animate loop reveal the rest.
            newDisplayed = displayedLengthRef.current;
          }
          if (newDisplayed !== displayedLengthRef.current) {
            displayedLengthRef.current = newDisplayed;
            setDisplayLength(newDisplayed);
          }
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

      if (prefersReducedMotion && text.length > 0) {
        // Same-commit dump so the thinking shell can drop with the first
        // text, not one rAF later.
        displayedLengthRef.current = text.length;
        setDisplayLength(text.length);
        setIsTyping(false);
      }

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
        // Reset adaptive-smoothing state so a new turn doesn't inherit the
        // previous turn's buffer depth.
        smoothedBufferRef.current = 0;
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
        // Stream ended — compute a drain CPS for the remaining buffer. Reveal
        // stays character-by-character; only the rate changes by tail size:
        //   Short tail (< drainShortRemainingChars): base targetCPS so a short
        //     reply types out at reading speed.
        //   Larger tail: target drainMsPerChar per char (≈ base rate) up to
        //     drainMaxTotalMs total — for very large buffers the CPS scales
        //     above base (bounded per frame by maxCharsPerFrame) so we don't
        //     wait minutes, while still typing rather than dumping.
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

  const visibleLength =
    prefersReducedMotion && text.length > 0 ? text.length : displayLength;

  const progress = text.length > 0 ? visibleLength / text.length : 1;
  const bufferSize = text.length - visibleLength;

  // Freeze the display at its current position.
  // After calling freeze(), displayLength will not advance even as more text arrives.
  // The freeze is automatically cleared when the next streaming session begins.
  const freeze = useCallback(() => {
    freezeActiveStream();
    setIsTyping(false);
  }, []);

  return {
    displayLength: visibleLength,
    progress,
    isTyping,
    bufferSize,
    isDraining:
      wasStreamingRef.current && !isStreaming && visibleLength < text.length,
    freeze,
  };
}
