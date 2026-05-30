import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react';

import { useAutoScroll } from '@/app/hooks/use-auto-scroll';

interface UseChatScrollParams {
  /** URL thread id — drives the scroll-to-bottom-on-initial-load effect. */
  threadId: string | undefined;
  /** Active data thread id — drives branch-switch scroll preservation. */
  dataThreadId: string | undefined;
  /** Number of rendered messages (initial-load scroll waits for non-empty). */
  messagesLength: number;
  /** Server/optimistic generating flag — clears scroll intent when streaming ends. */
  isLoading: boolean;
  /** Re-attach observers when arena mode mounts/unmounts the scroll container. */
  isArenaMode: boolean;
  /** `pendingMessage?.editedMessageId` — edit-and-branch skips scroll preservation. */
  pendingEditedMessageId: string | undefined;
  /** Underlying pagination load-more, wrapped with prepend-scroll preservation. */
  loadMore: (count: number) => void;
}

/**
 * Minimum upward scroll (px) that counts as a deliberate "escape" from the
 * stick-to-bottom lock. A small dead-zone so sub-pixel/anchoring jitter or a
 * trackpad micro-movement during streaming doesn't accidentally stop the
 * auto-follow. A real scroll-up moves far more than this.
 */
const SCROLL_UP_ESCAPE_THRESHOLD_PX = 4;

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
  /**
   * Scroll-to-bottom intent: 'smooth' on send, 'instant' on thread init, null
   * when idle. Returned (not private) because `useSendMessage` writes to it via
   * its `scrollIntentRef` prop RIGHT BEFORE each `setPendingMessage`, and the
   * edit-and-branch handler sets it to 'smooth'. The scroll machine reads it in
   * `onContentChange`/`onScroll`.
   */
  scrollIntentRef: MutableRefObject<ScrollBehavior | null>;
  handleLoadMore: (count: number) => void;
}

/**
 * Chat scroll state machine, extracted verbatim from ChatInterface.
 *
 * Owns the ChatGPT-style "no auto-follow unless at bottom" behavior: a
 * ResizeObserver + MutationObserver on the content drive `onContentChange`,
 * a scroll listener handles the manual scroll-up escape and smooth→instant
 * downgrade, plus thread-init scroll, streaming-end intent clear, branch-switch
 * scroll preservation (captured DURING render — see below), and load-more
 * prepend preservation. Every ref here encodes a specific bug fix; the logic is
 * unchanged from the original inline implementation.
 */
export function useChatScroll({
  threadId,
  dataThreadId,
  messagesLength,
  isLoading,
  isArenaMode,
  pendingEditedMessageId,
  loadMore,
}: UseChatScrollParams): ChatScroll {
  // Scroll utility — refs + isAtBottom. We own the follow logic below.
  const { containerRef, contentRef, isAtBottom } = useAutoScroll({
    threshold: 100,
  });

  const [showScrollButton, setShowScrollButton] = useState(false);

  // Forced scroll-to-bottom signal: 'smooth' on send, 'instant' on thread
  // init, null when idle. Written externally by useSendMessage (its
  // `scrollIntentRef` prop) right before each setPendingMessage; read by the
  // scroll machine to force-follow even if the user had scrolled away.
  const scrollingToBottomBehaviorRef = useRef<ScrollBehavior | null>(null);
  // Stick-to-bottom latch (ported from use-stick-to-bottom's algorithm): we
  // auto-follow content growth only while this is true. The user "escapes" it
  // by scrolling UP and re-engages by returning to the bottom. Crucially, our
  // own programmatic scrolls only ever move DOWN, so an upward scroll is
  // unambiguously the user — no fragile programmatic-vs-user flag needed.
  const stickToBottomRef = useRef(true);
  // Track scrollTop + scrollHeight across scroll events so a scrollTop drop
  // caused by content SHRINKING (browser clamps scrollTop) isn't misread as a
  // user scroll-up (which would falsely escape the lock).
  const lastScrollTopRef = useRef(0);
  const lastScrollHeightRef = useRef(0);

  // Branch-switch scroll preservation refs. Declared before the observer
  // effect because `onContentChange` closes over `branchScrollSaveRef`.
  const branchScrollSaveRef = useRef<number | null>(null);
  const branchScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Scroll + resize handler — handles intentional scrolls and scroll button visibility.
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return undefined;

    const scrollToBottomNow = (behavior: ScrollBehavior) => {
      container.scrollTo({ top: container.scrollHeight, behavior });
    };

    const onContentChange = () => {
      // During branch switch: override all scroll behavior with saved position
      if (branchScrollSaveRef.current !== null) {
        container.scrollTop = branchScrollSaveRef.current;
        setShowScrollButton(!isAtBottom());
        return;
      }
      const forced = scrollingToBottomBehaviorRef.current;
      if (forced) {
        // Send / thread-init: force-follow regardless of the latch, and
        // re-engage it. A 'smooth' forced scroll stays armed until it reaches
        // the bottom (consumed in onScroll); 'instant' is one-shot.
        stickToBottomRef.current = true;
        scrollToBottomNow(forced);
        if (forced === 'instant') scrollingToBottomBehaviorRef.current = null;
      } else if (stickToBottomRef.current) {
        // Normal content growth while following: pin to bottom instantly.
        scrollToBottomNow('instant');
      }
      // Show the button whenever we're NOT actively following — including the
      // dead zone where the user escaped with a small scroll-up but is still
      // within the 100px "at bottom" band (otherwise follow is off with no
      // affordance to get back).
      setShowScrollButton(!stickToBottomRef.current || !isAtBottom());
    };

    const onScroll = () => {
      const currentTop = container.scrollTop;
      const currentHeight = container.scrollHeight;
      const prevTop = lastScrollTopRef.current;
      const prevHeight = lastScrollHeightRef.current;
      lastScrollTopRef.current = currentTop;
      lastScrollHeightRef.current = currentHeight;
      const atBottom = isAtBottom();

      const wasSticking = stickToBottomRef.current;
      const nextSticking = resolveStickToBottom({
        sticking: wasSticking,
        currentTop,
        prevTop,
        currentHeight,
        prevHeight,
        atBottom,
      });
      stickToBottomRef.current = nextSticking;

      if (!nextSticking && wasSticking) {
        // Just escaped → cancel any forced (send/init) follow too.
        scrollingToBottomBehaviorRef.current = null;
      } else if (
        nextSticking &&
        atBottom &&
        scrollingToBottomBehaviorRef.current === 'smooth'
      ) {
        // Forced-smooth scroll has reached the bottom — consume it so future
        // content growth follows instantly via the latch.
        scrollingToBottomBehaviorRef.current = null;
      }
      // Button tracks the follow latch (not just the at-bottom band) so a small
      // escape scroll within the band still surfaces the affordance.
      setShowScrollButton(!nextSticking || !atBottom);
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
    // Seed scroll tracking so the first real scroll event compares against the
    // current position/height, not 0 (which would spuriously read as growth).
    lastScrollTopRef.current = container.scrollTop;
    lastScrollHeightRef.current = container.scrollHeight;
    onContentChange();

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      container.removeEventListener('scroll', onScroll);
    };
  }, [containerRef, contentRef, isAtBottom, isArenaMode]);

  // Clear scroll intent when streaming ends — covers the case where
  // the ref stayed as 'instant' throughout the entire streaming session.
  const prevIsLoadingRef = useRef(isLoading);
  useEffect(() => {
    if (prevIsLoadingRef.current && !isLoading) {
      scrollingToBottomBehaviorRef.current = null;
    }
    prevIsLoadingRef.current = isLoading;
  }, [isLoading]);

  // Scroll to bottom on thread initial load.
  const scrolledForThreadRef = useRef<string | null>(null);
  useEffect(() => {
    if (!threadId || messagesLength === 0) return;
    if (scrolledForThreadRef.current === threadId) return;

    scrolledForThreadRef.current = threadId;
    scrollingToBottomBehaviorRef.current = 'instant';

    containerRef.current?.scrollTo({
      top: containerRef.current.scrollHeight,
      behavior: 'instant',
    });
  }, [threadId, messagesLength, containerRef]);

  // Preserve scroll position during branch switches.
  // Save scrollTop synchronously during render when dataThreadId changes.
  // The saved value is kept and restored on every onContentChange call
  // until cleared by a timeout (to handle multiple ResizeObserver fires).
  //
  // NOTE: this runs in the hook's render body (NOT an effect) on purpose — the
  // scrollTop snapshot must be captured before the browser paints the new
  // branch's content; an effect would run after paint and capture the
  // already-scrolled position.
  const prevDataThreadIdRef = useRef(dataThreadId);
  if (
    prevDataThreadIdRef.current !== dataThreadId &&
    prevDataThreadIdRef.current !== undefined
  ) {
    // Skip scroll preservation for edit-and-branch — we want scroll-to-bottom
    // so the edited message and incoming AI response are visible.
    if (!pendingEditedMessageId) {
      branchScrollSaveRef.current = containerRef.current?.scrollTop ?? null;
      // Clear after content settles
      if (branchScrollTimerRef.current)
        clearTimeout(branchScrollTimerRef.current);
      branchScrollTimerRef.current = setTimeout(() => {
        branchScrollSaveRef.current = null;
        branchScrollTimerRef.current = null;
        // Reconcile the follow latch to where the view actually ended up. The
        // override held scrollTop at the saved (often non-bottom) position, so
        // the latch could still read `true` from before the switch — without
        // this, the next content tick (e.g. a still-streaming branch) would
        // snap to the bottom. Re-seed the scroll trackers too so the next
        // onScroll diff is correct.
        const c = containerRef.current;
        if (c) {
          stickToBottomRef.current = isAtBottom();
          lastScrollTopRef.current = c.scrollTop;
          lastScrollHeightRef.current = c.scrollHeight;
        }
      }, 2000);
    } else {
      // Clear any stale scroll position from a prior branch switch so
      // onContentChange doesn't override the intended scroll-to-bottom.
      branchScrollSaveRef.current = null;
      if (branchScrollTimerRef.current) {
        clearTimeout(branchScrollTimerRef.current);
        branchScrollTimerRef.current = null;
      }
    }
  }
  prevDataThreadIdRef.current = dataThreadId;

  // Load-more scroll preservation: keep the viewport visually stable when older
  // messages prepend. We anchor to the topmost currently-VISIBLE message and
  // restore its on-screen position after the prepend, measured in a rAF so
  // layout has settled. Anchoring to a visible element is immune to the
  // intrinsic-size estimates that `content-visibility` reports for the
  // off-screen prepended bubbles — a raw scrollHeight delta would use those
  // (~200px) estimates and drift the viewport. Falls back to the delta if no
  // anchor is found.
  const handleLoadMore = useCallback(
    (count: number) => {
      const container = containerRef.current;
      if (!container) {
        loadMore(count);
        return;
      }

      const containerTop = container.getBoundingClientRect().top;
      let anchorKey: string | null = null;
      let anchorOffset = 0;
      for (const row of container.querySelectorAll<HTMLElement>(
        '[data-message-key]',
      )) {
        const r = row.getBoundingClientRect();
        if (r.bottom > containerTop) {
          anchorKey = row.getAttribute('data-message-key');
          anchorOffset = r.top - containerTop;
          break;
        }
      }
      const prevScrollHeight = container.scrollHeight;

      const applyCorrection = () => {
        if (anchorKey) {
          const el = container.querySelector<HTMLElement>(
            `[data-message-key="${CSS.escape(anchorKey)}"]`,
          );
          if (el) {
            const newOffset =
              el.getBoundingClientRect().top -
              container.getBoundingClientRect().top;
            container.scrollTop += newOffset - anchorOffset;
            return;
          }
        }
        // Fallback: raw scrollHeight delta (anchor not found).
        container.scrollTop += container.scrollHeight - prevScrollHeight;
      };

      let rafId = 0;
      const observer = new MutationObserver(() => {
        observer.disconnect();
        // Defer to after layout flush so heights/positions are settled.
        rafId = requestAnimationFrame(applyCorrection);
      });
      observer.observe(container, { childList: true, subtree: true });
      loadMore(count);

      // Safety timeout: stop observing and cancel any pending correction.
      setTimeout(() => {
        observer.disconnect();
        if (rafId) cancelAnimationFrame(rafId);
      }, 2000);
    },
    [containerRef, loadMore],
  );

  // Scroll-to-bottom button: re-engage the follow latch and smoothly land at
  // the bottom. Arming the forced ref keeps it following as content settles.
  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    stickToBottomRef.current = true;
    scrollingToBottomBehaviorRef.current = 'smooth';
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [containerRef]);

  return {
    containerRef,
    contentRef,
    scrollToBottom,
    showScrollButton,
    scrollIntentRef: scrollingToBottomBehaviorRef,
    handleLoadMore,
  };
}
