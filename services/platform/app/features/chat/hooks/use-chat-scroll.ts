/**
 * Chat scroll state machine — see {@link useChatScroll} for the behavioral
 * doctrine (only user actions scroll; generation growth never does).
 *
 * Min-height coordination with `use-response-slack` (two writers, two
 * elements, one geometry):
 *  - THIS hook is the only writer of the content wrapper's (`contentRef`)
 *    `style.minHeight`: a branch switch freezes the wrapper at its pre-switch
 *    height — set in the render body, pre-paint, so the list can't visibly
 *    collapse while the message subscription swaps — and marks the position
 *    hold `releaseMinHeight`; `cancelHold` clears the freeze
 *    (`style.minHeight = ''`) when that hold ends (timer release, user
 *    takeover, or a replacing hold).
 *  - `useResponseSlack` is the only writer of the response area's
 *    `style.minHeight` (a child INSIDE the wrapper): the slack that keeps the
 *    last user message anchorable at the viewport top. Neither side ever
 *    touches the other's element.
 *  - They coordinate through geometry, not callbacks: both derive the top
 *    inset from the SAME live `contentRef` padding-top via `resolveTopInset`,
 *    so the slack height and the snap target always agree; slack writes reach
 *    this hook only as content RESIZES (the ResizeObserver re-pins the active
 *    hold through the settle window), while the MutationObserver deliberately
 *    ignores pure `style` attribute mutations so a min-height write alone
 *    never counts as a content change.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react';

import { useAutoScroll } from '@/app/hooks/use-auto-scroll';
import { usePrefersReducedMotion } from '@/app/hooks/use-prefers-reduced-motion';

import { resolveTopInset } from '../scroll-constants';

export interface UseChatScrollParams {
  /** URL root thread id — drives per-thread position memory and the
   *  thread-open scroll (restore or first-open anchor). */
  threadId: string | undefined;
  /** Rendered sibling (branch) thread id — drives branch-switch scroll
   *  preservation. */
  dataThreadId: string | undefined;
  /** Number of rendered messages (thread-open scroll waits for non-empty). */
  messagesLength: number;
  /** A turn is generating (or optimistically pending) — clears the scroll
   *  intent when streaming ends. */
  isLoading: boolean;
  /** Edit-and-branch marker: skip branch-switch preservation and snap the
   *  edited message to the top instead. */
  pendingEditedMessageId: string | undefined;
  /** The last user message row — the send-snap scrolls it to the viewport
   *  top. */
  lastUserMessageRef: RefObject<HTMLLIElement | null>;
  /**
   * Caller-owned force-snap signal: truthy ⇒ scroll the just-sent user
   * message to the viewport top (content padding-top inset) on the next
   * content settle, REGARDLESS of whether the user had scrolled away. This is
   * the ONLY thing that scrolls the chat besides explicit user actions — AI
   * generation growth never does.
   *
   *  - `true`  → INSTANT snap (the FIRST message of a chat — it must render
   *    at its position without any visible scrolling).
   *  - `'smooth'` → animated snap for follow-up sends and edits: a
   *    retargeting rAF loop that re-reads the live anchor position every
   *    frame, easing toward it. A one-shot `behavior: 'smooth'` would
   *    animate against the still-settling response slack and stall
   *    part-way; the retargeting loop lands exactly, smoothly. Cancelled by
   *    any user scroll intent.
   *
   * The caller owns the ref (it writes the intent right before arming each
   * send/edit); this hook only consumes it — reset to `false` when the snap
   * arms, when the user takes over, and when streaming ends.
   */
  scrollIntentRef: MutableRefObject<boolean | 'smooth'>;
}

/**
 * Minimum upward scroll (px) that counts as a deliberate "escape" from the
 * stick-to-bottom lock. A small dead-zone so sub-pixel/anchoring jitter or a
 * trackpad micro-movement during streaming doesn't accidentally stop the
 * auto-follow. A real scroll-up moves far more than this.
 */
const SCROLL_UP_ESCAPE_THRESHOLD_PX = 4;

/**
 * How long after a snap the position keeps re-pinning through layout ticks.
 * The response-slack min-height settles within a frame or two of the snap;
 * this window only needs to cover that (plus the edit-and-branch swap, whose
 * release re-arms the snap itself). Content growth outside the window never
 * scrolls.
 */
const SNAP_SETTLE_MS = 700;

/**
 * How long a POSITION hold (branch switch, thread-open restore) keeps
 * re-applying its scrollTop through content churn. Switching the message
 * subscription empties and refills the list over ~1s (and history bubbles
 * re-measure from their content-visibility estimates), so this window must
 * outlive that settling.
 */
const POSITION_HOLD_MS = 2000;

/** Cap on remembered per-thread scroll positions (LRU). */
const MAX_SAVED_THREAD_POSITIONS = 50;

// ============================================================================
// PER-THREAD SCROLL POSITION MEMORY
// ============================================================================
// Module-level Map, write-through to sessionStorage so positions survive
// chat-surface remounts, route round-trips AND page reloads — but stay
// scoped to the tab (sessionStorage), so a stale position from last week or
// another tab never leaks in. Loaded lazily (SSR-safe) on first access.

const SCROLL_POSITIONS_STORAGE_KEY = 'tale_chat_scroll_positions';

let savedThreadScrollTopsCache: Map<string, number> | null = null;

function readPersistedScrollTops(): Map<string, number> {
  const map = new Map<string, number>();
  if (typeof window === 'undefined') return map;
  try {
    const raw = window.sessionStorage.getItem(SCROLL_POSITIONS_STORAGE_KEY);
    if (!raw) return map;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
          map.set(key, value);
        }
      }
    }
  } catch (error) {
    // Corrupt entry or storage unavailable (e.g. privacy mode) — start fresh.
    console.warn('Failed to read persisted chat scroll positions:', error);
  }
  return map;
}

function getSavedThreadScrollTops(): Map<string, number> {
  savedThreadScrollTopsCache ??= readPersistedScrollTops();
  return savedThreadScrollTopsCache;
}

function persistScrollTops(map: Map<string, number>) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      SCROLL_POSITIONS_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(map)),
    );
  } catch (error) {
    // Storage full or unavailable — the in-memory map still works for the
    // session; only reload survival is lost.
    console.warn('Failed to persist chat scroll positions:', error);
  }
}

function saveThreadScrollTop(threadId: string, top: number) {
  if (!Number.isFinite(top) || top < 0) return;
  const map = getSavedThreadScrollTops();
  map.delete(threadId);
  map.set(threadId, top);
  while (map.size > MAX_SAVED_THREAD_POSITIONS) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  persistScrollTops(map);
}

function getSavedThreadScrollTop(threadId: string): number | undefined {
  return getSavedThreadScrollTops().get(threadId);
}

// ============================================================================
// SCROLL HOLD
// ============================================================================

/**
 * The ONE primitive that moves the chat view. A hold pins the viewport to a
 * target through content-churn layout ticks until it expires or the user
 * takes over:
 *  - 'position'      → an absolute scrollTop (branch switch, thread-open
 *                       restore). The raw saved top is kept and re-clamped
 *                       per tick, so late-resolving history heights converge
 *                       on the true position.
 *  - 'bottom'        → the live bottom.
 *  - 'last-user-top' → the last user message's top at the live top inset
 *                       (content padding-top / TOP_INSET fallback — send/edit
 *                       snap, thread first-open). Re-resolved per tick
 *                       against the live element, so response-slack
 *                       corrections and late-settling content keep the
 *                       message exactly anchored; degrades to the bottom
 *                       when the anchor is missing or can't reach the top.
 */
export type ScrollHoldKind = 'position' | 'bottom' | 'last-user-top';

export interface ScrollHold {
  kind: ScrollHoldKind;
  /** Absolute target scrollTop — only for kind 'position'. */
  top?: number;
  /** Expiry deadline (epoch ms). After it, content growth never scrolls. */
  until: number;
  /** Release the content min-height freeze when this hold ends. */
  releaseMinHeight?: boolean;
}

/**
 * Pure target resolution for a hold against live container geometry.
 * Exported for unit testing.
 */
export function resolveSnapTargetTop(opts: {
  kind: ScrollHoldKind;
  top?: number;
  scrollHeight: number;
  clientHeight: number;
  lastUserTop?: number;
  topInset: number;
}): number {
  const maxTop = Math.max(0, opts.scrollHeight - opts.clientHeight);
  if (opts.kind === 'position') {
    return Math.min(Math.max(opts.top ?? 0, 0), maxTop);
  }
  if (opts.kind === 'last-user-top' && opts.lastUserTop !== undefined) {
    return Math.min(Math.max(opts.lastUserTop - opts.topInset, 0), maxTop);
  }
  // 'bottom' — and the 'last-user-top' fallback when the anchor element is
  // missing (e.g. the optimistic bubble hasn't committed): with the response
  // slack in place the bottom lands at (nearly) the same position for short
  // messages.
  return maxTop;
}

/**
 * Pure decision for where a thread opens: a remembered position when the
 * thread was visited before (this tab), otherwise the last user message
 * anchored at the viewport top — which the clamp degrades to the bottom when
 * the reply after it is shorter than the viewport or the thread has no user
 * message at all. Exported for unit testing.
 */
export function resolveThreadOpenTarget(opts: {
  savedTop: number | undefined;
  scrollHeight: number;
  clientHeight: number;
  lastUserTop: number | undefined;
  topInset: number;
}): { kind: 'position' | 'last-user-top'; top: number } {
  const maxTop = Math.max(0, opts.scrollHeight - opts.clientHeight);
  if (opts.savedTop !== undefined) {
    return {
      kind: 'position',
      top: Math.min(Math.max(opts.savedTop, 0), maxTop),
    };
  }
  return {
    kind: 'last-user-top',
    top: resolveSnapTargetTop({
      kind: 'last-user-top',
      scrollHeight: opts.scrollHeight,
      clientHeight: opts.clientHeight,
      lastUserTop: opts.lastUserTop,
      topInset: opts.topInset,
    }),
  };
}

/**
 * Whether the scroll-to-bottom button should ANIMATE (smooth) or JUMP
 * (instant). Smooth motion is reserved for a settled conversation on an OS
 * that allows motion: while the assistant is still streaming we instant-snap
 * so the view catches up to the live bottom and the pin follows subsequent
 * growth (a smooth animation would lag behind it), and we always honor the
 * `prefers-reduced-motion` accessibility setting. Exported for unit testing.
 */
export function shouldAnimateScrollToBottom(opts: {
  isStreaming: boolean;
  prefersReducedMotion: boolean;
}): boolean {
  return !opts.isStreaming && !opts.prefersReducedMotion;
}

/**
 * Pure decision for the stick-to-bottom latch on a scroll event. Ported from
 * use-stick-to-bottom's algorithm:
 *  - a deliberate upward scroll (> threshold) that is NOT caused by content
 *    shrinking is a user escape → stop following;
 *  - reaching the bottom re-engages following;
 *  - otherwise the latch is unchanged.
 * Exported for unit testing — the hook wires it to live scroll events.
 */
export function resolveStickToBottom(opts: {
  sticking: boolean;
  currentTop: number;
  prevTop: number;
  currentHeight: number;
  prevHeight: number;
  atBottom: boolean;
}): boolean {
  const shrank = opts.currentHeight < opts.prevHeight;
  const scrolledUp =
    opts.prevTop - opts.currentTop > SCROLL_UP_ESCAPE_THRESHOLD_PX;
  if (scrolledUp && !shrank) return false; // deliberate user scroll-up
  if (opts.atBottom) return true; // returned to / reached bottom
  return opts.sticking;
}

export interface ChatScroll {
  containerRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  scrollToBottom: () => void;
  showScrollButton: boolean;
}

/**
 * Chat scroll state machine.
 *
 * Implements the Gemini-style behavior: scrolling happens ONLY in response
 * to user actions — submitting a message (snap the new user message to the
 * viewport top: instant for the first message of a chat, a smooth glide for
 * follow-ups), opening a thread (restore its remembered position, or the
 * bottom on first open), switching branches, or pressing the
 * scroll-to-bottom button. AI text generation NEVER scrolls the view; the
 * response streams into the slack below the user message and past the fold
 * when it outgrows the viewport.
 *
 * Every programmatic movement is a ScrollHold (see type above): one
 * mechanism for the send-snap settle window, branch-switch preservation,
 * and thread-open restore. Holds re-pin through content-churn layout ticks
 * until they expire; any user scroll intent (wheel, touch, an upward
 * scroll) cancels the hold, the glide, and any pending snap — the user
 * always wins.
 *
 * Plus: per-thread scroll position memory (session-only) and streaming-end
 * intent clear.
 */
export function useChatScroll({
  threadId,
  dataThreadId,
  messagesLength,
  isLoading,
  pendingEditedMessageId,
  lastUserMessageRef,
  scrollIntentRef,
}: UseChatScrollParams): ChatScroll {
  // Scroll utility — refs + isAtBottom. We own the follow logic below.
  const { containerRef, contentRef, isAtBottom } = useAutoScroll({
    threshold: 100,
  });
  const prefersReducedMotion = usePrefersReducedMotion();

  const [showScrollButton, setShowScrollButton] = useState(false);

  // "User hasn't taken over" latch: true while the view is under snap
  // control. The user escapes via wheel/touch or an upward scroll (see
  // resolveStickToBottom) — escaping cancels the snap animation and any
  // active hold. NOTE: this no longer drives any auto-follow; generation
  // growth never scrolls.
  const pinnedRef = useRef(true);
  // The single active hold (or none). See ScrollHold.
  const holdRef = useRef<ScrollHold | null>(null);
  // Timed release for POSITION holds (branch switch / thread restore):
  // reconciles the follow latch to where the view actually ended up and
  // releases the min-height freeze.
  const holdReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Track scrollTop + scrollHeight across scroll events so a scrollTop drop
  // caused by content SHRINKING (browser clamps scrollTop) isn't misread as a
  // user scroll-up (which would falsely escape the lock).
  const lastScrollTopRef = useRef(0);
  const lastScrollHeightRef = useRef(0);

  /** Reseed the scroll trackers so the next onScroll diff is correct. */
  const reseedScrollTrackers = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    lastScrollTopRef.current = c.scrollTop;
    lastScrollHeightRef.current = c.scrollHeight;
  }, [containerRef]);

  /**
   * Drop the active hold WITHOUT touching the follow latch — used when the
   * user takes over (their escape already resolved the latch) and when a
   * thread navigation invalidates a stale hold.
   */
  const cancelHold = useCallback(() => {
    if (holdReleaseTimerRef.current) {
      clearTimeout(holdReleaseTimerRef.current);
      holdReleaseTimerRef.current = null;
    }
    if (holdRef.current?.releaseMinHeight && contentRef.current) {
      contentRef.current.style.minHeight = '';
    }
    holdRef.current = null;
  }, [contentRef]);

  /**
   * Timed release for position holds: the hold held scrollTop at a (often
   * non-bottom) position, so the follow latch could still read `true` from
   * before — without reconciling, the next content tick of a still-streaming
   * thread would snap to the bottom.
   */
  const releaseHoldAndReconcile = useCallback(() => {
    cancelHold();
    pinnedRef.current = isAtBottom();
    reseedScrollTrackers();
  }, [cancelHold, isAtBottom, reseedScrollTrackers]);

  /** Arm a hold (replacing any current one). Position holds get a timed
   *  release; settle holds simply expire. */
  const beginHold = useCallback(
    (hold: ScrollHold, releaseAfterMs?: number) => {
      cancelHold();
      holdRef.current = hold;
      if (releaseAfterMs !== undefined) {
        holdReleaseTimerRef.current = setTimeout(
          releaseHoldAndReconcile,
          releaseAfterMs,
        );
      }
    },
    [cancelHold, releaseHoldAndReconcile],
  );

  // Scroll + resize handler — applies holds, consumes the force-snap signal,
  // and keeps the scroll-button visibility current.
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return undefined;

    // Live anchor read: the last user message's top in scroll coordinates.
    const getLastUserTop = (): number | undefined => {
      const el = lastUserMessageRef.current;
      if (!el || !container.contains(el)) return undefined;
      return (
        el.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop
      );
    };

    // Match response-slack: content padding-top clears the floating glass
    // header on md+ (`md:pt-19`). A hardcoded TOP_INSET alone lands short
    // bubbles under the blur.
    const getTopInset = (): number =>
      resolveTopInset(parseFloat(getComputedStyle(content).paddingTop) || 0);

    const resolveHoldTarget = (hold: ScrollHold): number =>
      resolveSnapTargetTop({
        kind: hold.kind,
        top: hold.top,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        lastUserTop:
          hold.kind === 'last-user-top' ? getLastUserTop() : undefined,
        topInset: getTopInset(),
      });

    const applyHold = (hold: ScrollHold) => {
      // Explicit 'instant' — a hold re-pin must never animate (it would
      // chase the still-settling slack / streaming growth and land short).
      container.scrollTo({ top: resolveHoldTarget(hold), behavior: 'instant' });
    };

    // Send-snap animation: ease toward the hold target while RE-READING the
    // live anchor every frame, so the still-settling response slack /
    // streaming growth is followed rather than raced (a one-shot smooth
    // scroll stalls part-way). Cancels itself if the user escapes the pin.
    let smoothSnapRafId: number | null = null;
    const smoothSnapToTarget = () => {
      if (prefersReducedMotion) {
        if (holdRef.current) applyHold(holdRef.current);
        return;
      }
      if (smoothSnapRafId !== null) return; // already gliding; it retargets
      const step = () => {
        smoothSnapRafId = null;
        if (!pinnedRef.current) return; // user scrolled away — stop
        const hold = holdRef.current;
        const target = hold
          ? resolveHoldTarget(hold)
          : container.scrollHeight - container.clientHeight;
        const remaining = target - container.scrollTop;
        if (Math.abs(remaining) <= 1) {
          if (remaining !== 0) container.scrollTop = target;
          return;
        }
        // Exponential ease-out toward the (possibly moving) target.
        container.scrollTop +=
          Math.sign(remaining) * Math.max(1, Math.abs(remaining) * 0.18);
        smoothSnapRafId = requestAnimationFrame(step);
      };
      smoothSnapRafId = requestAnimationFrame(step);
    };

    const updateButton = () => {
      setShowScrollButton(!isAtBottom());
    };

    const onContentChange = () => {
      // Active hold: keep the viewport pinned to its (re-resolved) target
      // through this layout tick — instantly, unless the smooth glide is
      // still in flight (it retargets on its own).
      const hold = holdRef.current;
      if (hold) {
        if (Date.now() < hold.until) {
          if (smoothSnapRafId === null) applyHold(hold);
          updateButton();
          return;
        }
        // Expired settle hold (position holds release via their timer) —
        // drop it and fall through. OUTSIDE any hold, content growth never
        // scrolls: AI generation streams below the fold and only explicit
        // user actions move the view.
        cancelHold();
      }
      // Forced snap (user action: send / edit-branch): anchor the last user
      // message at the viewport top even if the user had scrolled away.
      // Sends ('smooth') glide via the retargeting animation; the first
      // message of a chat (true) jumps instantly. Consumed once; the settle
      // hold carries the slack-correction ticks that follow.
      if (scrollIntentRef.current) {
        pinnedRef.current = true;
        const smooth = scrollIntentRef.current === 'smooth';
        scrollIntentRef.current = false;
        const snapHold: ScrollHold = {
          kind: 'last-user-top',
          until: Date.now() + SNAP_SETTLE_MS,
        };
        beginHold(snapHold);
        if (smooth) smoothSnapToTarget();
        else applyHold(snapHold);
        updateButton();
        return;
      }
      updateButton();
    };

    const onScroll = () => {
      const currentTop = container.scrollTop;
      const currentHeight = container.scrollHeight;
      const prevTop = lastScrollTopRef.current;
      const prevHeight = lastScrollHeightRef.current;
      lastScrollTopRef.current = currentTop;
      lastScrollHeightRef.current = currentHeight;
      const atBottom = isAtBottom();

      const wasPinned = pinnedRef.current;
      const nextPinned = resolveStickToBottom({
        sticking: wasPinned,
        currentTop,
        prevTop,
        currentHeight,
        prevHeight,
        atBottom,
      });
      pinnedRef.current = nextPinned;

      // Just escaped → cancel any pending forced snap and the active hold so
      // we don't yank the user back after they deliberately scrolled away.
      if (!nextPinned && wasPinned) {
        scrollIntentRef.current = false;
        cancelHold();
      }
      setShowScrollButton(!atBottom);
    };

    // Direct user scroll intent (wheel / touch) interrupts everything: the
    // smooth glide, the active hold, and any pending snap. These events
    // only ever come from the user (our programmatic scrolls don't fire
    // them), so they're an unambiguous "I'm taking over".
    const onUserScrollIntent = () => {
      if (
        smoothSnapRafId !== null ||
        holdRef.current !== null ||
        scrollIntentRef.current
      ) {
        pinnedRef.current = false;
        scrollIntentRef.current = false;
        cancelHold();
        if (smoothSnapRafId !== null) {
          cancelAnimationFrame(smoothSnapRafId);
          smoothSnapRafId = null;
        }
      }
    };

    const resizeObserver = new ResizeObserver(onContentChange);
    resizeObserver.observe(content);

    const mutationObserver = new MutationObserver((mutations) => {
      const hasRelevant = mutations.some(
        (mut) => mut.type !== 'attributes' || mut.attributeName !== 'style',
      );
      if (hasRelevant) onContentChange();
    });
    mutationObserver.observe(content, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    container.addEventListener('scroll', onScroll, { passive: true });
    container.addEventListener('wheel', onUserScrollIntent, { passive: true });
    container.addEventListener('touchmove', onUserScrollIntent, {
      passive: true,
    });
    // Seed scroll tracking so the first real scroll event compares against the
    // current position/height, not 0 (which would spuriously read as growth).
    lastScrollTopRef.current = container.scrollTop;
    lastScrollHeightRef.current = container.scrollHeight;
    onContentChange();

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      container.removeEventListener('scroll', onScroll);
      container.removeEventListener('wheel', onUserScrollIntent);
      container.removeEventListener('touchmove', onUserScrollIntent);
      if (smoothSnapRafId !== null) cancelAnimationFrame(smoothSnapRafId);
    };
  }, [
    containerRef,
    contentRef,
    isAtBottom,
    prefersReducedMotion,
    lastUserMessageRef,
    scrollIntentRef,
    beginHold,
    cancelHold,
  ]);

  // Clear the force-snap intent when streaming ends — covers the case where
  // the ref stayed set throughout the entire streaming session.
  const prevIsLoadingRef = useRef(isLoading);
  useEffect(() => {
    if (prevIsLoadingRef.current && !isLoading) {
      scrollIntentRef.current = false;
    }
    prevIsLoadingRef.current = isLoading;
  }, [isLoading, scrollIntentRef]);

  // Thread-open scroll: restore the thread's remembered position, or anchor
  // the LAST USER MESSAGE at the viewport top on its first open (falling back
  // to the bottom when the thread has no user message or the anchor can't
  // reach the top yet — the clamp degrades naturally). A LAYOUT effect
  // (pre-paint) on the first non-empty messages render, so the user never
  // sees the list at a wrong position followed by a delayed jump. The hold
  // then carries the correction ticks while the subscription settles and
  // history bubbles resolve their content-visibility height estimates — the
  // 'last-user-top' kind re-resolves the live element each tick, so it
  // self-heals even when this first measurement ran against stale content.
  //
  // The open is keyed on (threadId, container NODE): a Suspense fallback swap
  // (a lazy child suspending mid-session) or StrictMode replay remounts the
  // scroller at scrollTop 0 while this component instance — and the
  // once-per-thread guard ref — survive. Without the node check the view
  // would silently stay reset to the top. On a same-thread node swap the
  // LIVE tracker position (where the user actually was) wins over the
  // persisted save.
  const scrolledForThreadRef = useRef<string | null>(null);
  const openedContainerNodeRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!threadId) {
      // Left a thread (→ new chat). Clear the guard so returning to the same
      // thread re-runs the thread-open scroll even if this hook instance
      // survives the round trip (it isn't always remounted).
      scrolledForThreadRef.current = null;
      return;
    }
    if (messagesLength === 0) return;
    const c = containerRef.current;
    if (!c) return; // container not mounted yet — retry on next render
    const sameThread = scrolledForThreadRef.current === threadId;
    // A Suspense round-trip can keep the NODE but zero its scrollTop (hidden
    // via display:none). If the tracker says the user was somewhere else and
    // the container reads 0, the reset came from outside — re-apply. A user
    // actually scrolling to the top updates the tracker first, so this never
    // fights a deliberate scroll.
    const externallyReset =
      sameThread && c.scrollTop === 0 && lastScrollTopRef.current > 0;
    if (sameThread && openedContainerNodeRef.current === c && !externallyReset)
      return;
    scrolledForThreadRef.current = threadId;
    openedContainerNodeRef.current = c;

    const savedTop = sameThread
      ? lastScrollTopRef.current
      : getSavedThreadScrollTop(threadId);
    const lastUserEl = lastUserMessageRef.current;
    const lastUserTop =
      lastUserEl && c.contains(lastUserEl)
        ? lastUserEl.getBoundingClientRect().top -
          c.getBoundingClientRect().top +
          c.scrollTop
        : undefined;
    const contentEl = contentRef.current;
    const topInset = resolveTopInset(
      contentEl ? parseFloat(getComputedStyle(contentEl).paddingTop) || 0 : 0,
    );
    const decision = resolveThreadOpenTarget({
      savedTop,
      scrollHeight: c.scrollHeight,
      clientHeight: c.clientHeight,
      lastUserTop,
      topInset,
    });
    // Keep the RAW saved top in a position hold (not the clamped first
    // target): content below the estimate-based fold grows as real heights
    // resolve, and each tick re-clamps toward the true position.
    beginHold(
      decision.kind === 'position'
        ? {
            kind: 'position',
            top: savedTop,
            until: Date.now() + POSITION_HOLD_MS,
          }
        : { kind: 'last-user-top', until: Date.now() + POSITION_HOLD_MS },
      POSITION_HOLD_MS,
    );
    // The timed release reconciles the follow latch to where the view
    // actually settled (isAtBottom); until then the open is hold-controlled.
    pinnedRef.current = false;
    c.scrollTo({ top: decision.top, behavior: 'instant' });
    reseedScrollTrackers();
  }, [
    threadId,
    messagesLength,
    containerRef,
    contentRef,
    lastUserMessageRef,
    beginHold,
    reseedScrollTrackers,
  ]);

  // Branch-switch scroll preservation + thread-nav position save.
  //
  // NOTE: this runs in the hook's render body (NOT an effect) on purpose — the
  // scrollTop snapshot must be captured before the browser paints the new
  // branch's/thread's content; an effect would run after paint and capture the
  // already-clamped position.
  const prevDataThreadIdRef = useRef(dataThreadId);
  const prevThreadIdRef = useRef(threadId);
  if (
    prevDataThreadIdRef.current !== dataThreadId &&
    prevDataThreadIdRef.current !== undefined
  ) {
    // A genuine branch switch keeps the URL `threadId` constant and only
    // changes `dataThreadId` (the rendered sibling). Ordinary thread→thread
    // navigation (clicking another chat) changes BOTH — and the chat surface
    // is not necessarily remounted on that transition, so this hook can
    // persist across it.
    const threadChanged = prevThreadIdRef.current !== threadId;
    // Skip scroll preservation for edit-and-branch — we want the snap so the
    // edited message and incoming AI response are visible.
    if (!pendingEditedMessageId && !threadChanged) {
      const top = containerRef.current?.scrollTop;
      if (top !== undefined) {
        // Freeze the content height for the switch window. Switching branches
        // re-subscribes the message query to the other branch thread, so the
        // list briefly EMPTIES (observed: height 3574→668→4247 over ~1s)
        // before the new branch's messages arrive — that collapse-then-expand
        // is the visible "jump" (the fork message reflows out and back).
        // Pinning min-height to the pre-switch height keeps the list from
        // collapsing; the position hold then lands the fork message exactly
        // where it was. Both set in the render body — like the scrollTop
        // capture — so they land BEFORE the browser paints the emptied list.
        beginHold(
          {
            kind: 'position',
            top,
            until: Date.now() + POSITION_HOLD_MS,
            releaseMinHeight: true,
          },
          POSITION_HOLD_MS,
        );
        const contentEl = contentRef.current;
        if (contentEl)
          contentEl.style.minHeight = `${contentEl.offsetHeight}px`;
      }
    } else {
      // Edit-and-branch OR thread navigation: remember the outgoing thread's
      // position (thread nav only, and only when this instance actually
      // OPENED it — otherwise the reading is meaningless and would clobber
      // the persisted value) and clear any stale hold so onContentChange
      // doesn't override the intended snap/restore, releasing any frozen
      // height so the new thread isn't pinned tall.
      if (
        threadChanged &&
        prevThreadIdRef.current &&
        scrolledForThreadRef.current === prevThreadIdRef.current &&
        containerRef.current
      ) {
        saveThreadScrollTop(
          prevThreadIdRef.current,
          containerRef.current.scrollTop,
        );
      }
      cancelHold();
    }
  }
  prevDataThreadIdRef.current = dataThreadId;
  prevThreadIdRef.current = threadId;

  // Save the open thread's position when this hook unmounts entirely
  // (navigating away from the chat route) — the render-body capture above
  // only sees in-chat transitions. Uses the tracker ref (kept current by the
  // scroll listener) instead of reading the DOM node, which may already be
  // detached when this cleanup runs.
  //
  // BOTH implicit saves are gated on "this instance actually OPENED the
  // thread" (the thread-open effect ran). Without the gate, a StrictMode
  // double-mount or a Suspense effect replay fires this cleanup while the
  // tracker still reads its initial 0 — clobbering the real persisted
  // position with 0, which then "restores" the thread to its very top.
  const liveThreadIdRef = useRef(threadId);
  liveThreadIdRef.current = threadId;
  useEffect(() => {
    return () => {
      const id = liveThreadIdRef.current;
      if (id && scrolledForThreadRef.current === id) {
        saveThreadScrollTop(id, lastScrollTopRef.current);
      }
    };
  }, []);

  // Page reload / tab close: React cleanups never run, so capture the live
  // position on `pagehide` (more reliable than beforeunload — it also fires
  // on bfcache navigations) and write it through to sessionStorage.
  useEffect(() => {
    const onPageHide = () => {
      const id = liveThreadIdRef.current;
      if (id && scrolledForThreadRef.current === id) {
        saveThreadScrollTop(id, lastScrollTopRef.current);
      }
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  // Scroll-to-bottom button: re-engage the pin and land at the bottom. Motion
  // is chosen by shouldAnimateScrollToBottom — smooth only on a settled
  // conversation with motion allowed; while streaming we instant-snap so the
  // view catches up to the live bottom and the pin follows subsequent growth
  // (a smooth animation would lag behind it). Either way the pin is
  // re-engaged, so from here resolveStickToBottom drives follow/escape on the
  // next scroll/content event — no separate "animation in progress" state is
  // needed. Any active hold is dropped: the button is an explicit override.
  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    pinnedRef.current = true;
    scrollIntentRef.current = false;
    cancelHold();
    const animate = shouldAnimateScrollToBottom({
      isStreaming: isLoading,
      prefersReducedMotion,
    });
    container.scrollTo({
      top: container.scrollHeight,
      behavior: animate ? 'smooth' : 'instant',
    });
  }, [
    containerRef,
    isLoading,
    prefersReducedMotion,
    scrollIntentRef,
    cancelHold,
  ]);

  return {
    containerRef,
    contentRef,
    scrollToBottom,
    showScrollButton,
  };
}
