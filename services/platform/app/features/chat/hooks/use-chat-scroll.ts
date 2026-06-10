import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react';

import { useAutoScroll } from '@/app/hooks/use-auto-scroll';
import { usePrefersReducedMotion } from '@/app/hooks/use-prefers-reduced-motion';

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
 * How long after a snap the position keeps re-pinning through layout ticks.
 * The response-slack min-height settles within a frame or two of the snap;
 * this window only needs to cover that (plus the edit-and-branch swap, whose
 * release re-arms the snap itself). Content growth outside the window never
 * scrolls.
 */
const SNAP_SETTLE_MS = 700;

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
  /**
   * Force-snap signal: forces a scroll-to-bottom on the next content settle,
   * REGARDLESS of whether the user had scrolled away. This is the ONLY thing
   * that scrolls the chat besides explicit user actions — AI generation
   * growth never does.
   *
   *  - `true`  → INSTANT snap (thread-init, the FIRST message of a chat —
   *    which must render at its position without any visible scrolling).
   *  - `'smooth'` → animated snap for follow-up sends and edits: a
   *    retargeting rAF loop that re-reads the live `scrollHeight` every
   *    frame, easing toward the moving bottom. A one-shot
   *    `behavior: 'smooth'` would animate against the still-settling
   *    response slack and stall part-way down; the retargeting loop lands
   *    exactly, smoothly. Cancelled by any user scroll intent.
   *
   * Returned (not private) because `useSendMessage` writes it via its
   * `scrollIntentRef` prop RIGHT BEFORE each `setPendingMessage`, and the
   * edit-and-branch handler sets it too.
   */
  scrollIntentRef: MutableRefObject<boolean | 'smooth'>;
  handleLoadMore: (count: number) => void;
}

/**
 * Chat scroll state machine.
 *
 * Implements the Gemini-style behavior: scrolling happens ONLY in response
 * to user actions — submitting a message (snap the new user message to the
 * viewport top: instant for the first message of a chat, a smooth glide for
 * follow-ups), opening a thread, switching branches, or pressing the
 * scroll-to-bottom button. AI text generation NEVER scrolls the view; the
 * response streams into the slack below the user message and past the fold
 * when it outgrows the viewport.
 *
 * Design notes:
 *  - After a snap lands, a short SETTLE WINDOW keeps the position pinned
 *    while the response-slack min-height finishes its correction ticks (it
 *    settles across a couple of layout frames) — without it the snap would
 *    land short. Outside that window, content growth never scrolls.
 *  - The smooth send-snap is a retargeting rAF loop (re-reads the live
 *    scrollHeight each frame) rather than a one-shot `behavior: 'smooth'`,
 *    which would animate against the still-settling slack and stall.
 *  - Any user scroll intent (wheel, touch, an upward scroll) cancels the
 *    animation, the settle window, and any pending snap — the user always
 *    wins.
 *
 * Plus: thread-init scroll, streaming-end intent clear, branch-switch scroll
 * preservation (captured DURING render — see below), and load-more prepend
 * preservation.
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
  const prefersReducedMotion = usePrefersReducedMotion();

  const [showScrollButton, setShowScrollButton] = useState(false);

  // Force-snap signal: truthy ⇒ snap to bottom on the next content settle,
  // overriding a prior user scroll-up ('smooth' animates, true jumps — see
  // ChatScroll.scrollIntentRef). Written externally by useSendMessage /
  // edit-branch right before each setPendingMessage; consumed by the scroll
  // machine once the snap lands.
  const forceScrollRef = useRef<boolean | 'smooth'>(false);
  // "User hasn't taken over" latch: true while the view is under snap
  // control. The user escapes via wheel/touch or an upward scroll (see
  // resolveStickToBottom) — escaping cancels the snap animation and the
  // settle window. NOTE: this no longer drives any auto-follow; generation
  // growth never scrolls.
  const pinnedRef = useRef(true);
  // Post-snap settle deadline (epoch ms). While set and the user hasn't
  // escaped, slack-correction layout ticks re-pin instantly so the snapped
  // user message stays exactly at the viewport top. 0 = inactive.
  const settleUntilRef = useRef(0);
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

    const pinToBottom = () => {
      // Explicit 'instant' — the auto-follow must never animate (it would
      // chase the still-settling slack / streaming growth and land short).
      container.scrollTo({ top: container.scrollHeight, behavior: 'instant' });
    };

    // Send-snap animation: ease toward the bottom while RE-READING the live
    // target every frame, so the still-settling response slack / streaming
    // growth is followed rather than raced (a one-shot smooth scroll stalls
    // part-way). Cancels itself if the user escapes the pin mid-flight.
    let smoothSnapRafId: number | null = null;
    const smoothSnapToBottom = () => {
      if (prefersReducedMotion) {
        pinToBottom();
        return;
      }
      if (smoothSnapRafId !== null) return; // already gliding; it retargets
      const step = () => {
        smoothSnapRafId = null;
        if (!pinnedRef.current) return; // user scrolled away — stop
        const target = container.scrollHeight - container.clientHeight;
        const remaining = target - container.scrollTop;
        if (remaining <= 1) {
          if (remaining > 0) container.scrollTop = target;
          return;
        }
        // Exponential ease-out toward the (possibly moving) target.
        container.scrollTop += Math.max(1, remaining * 0.18);
        smoothSnapRafId = requestAnimationFrame(step);
      };
      smoothSnapRafId = requestAnimationFrame(step);
    };

    const updateButton = () => {
      setShowScrollButton(!isAtBottom());
    };

    const onContentChange = () => {
      // During branch switch: override all scroll behavior with saved position.
      if (branchScrollSaveRef.current !== null) {
        // Explicit 'instant' — the container would otherwise animate toward the
        // saved position on every ResizeObserver tick → a visible wobble.
        container.scrollTo({
          top: branchScrollSaveRef.current,
          behavior: 'instant',
        });
        setShowScrollButton(!isAtBottom());
        return;
      }
      // Forced snap (user action: send / thread-init / edit-branch): head to
      // the bottom even if the user had scrolled away. Sends ('smooth') glide
      // via the retargeting animation; thread-init / edit-branch (true) jump
      // instantly. Consumed once; the settle window below carries the
      // slack-correction ticks that follow.
      if (forceScrollRef.current) {
        pinnedRef.current = true;
        const smooth = forceScrollRef.current === 'smooth';
        forceScrollRef.current = false;
        settleUntilRef.current = Date.now() + SNAP_SETTLE_MS;
        if (smooth) smoothSnapToBottom();
        else pinToBottom();
        updateButton();
        return;
      }
      // Post-snap settle window: the response slack corrects its min-height
      // over a couple of layout frames after the snap; keep the position
      // pinned through those ticks (instantly — unless the smooth glide is
      // still in flight, which retargets on its own). OUTSIDE this window,
      // content growth never scrolls: AI generation streams below the fold
      // and only explicit user actions move the view.
      if (
        pinnedRef.current &&
        settleUntilRef.current !== 0 &&
        Date.now() < settleUntilRef.current
      ) {
        if (smoothSnapRafId === null) pinToBottom();
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

      // Just escaped → cancel any pending forced (send/init) snap and the
      // settle window so we don't yank the user back after they deliberately
      // scrolled away.
      if (!nextPinned && wasPinned) {
        forceScrollRef.current = false;
        settleUntilRef.current = 0;
      }
      setShowScrollButton(!atBottom);
    };

    // Direct user scroll intent (wheel / touch) interrupts everything: the
    // smooth glide, the settle window, and any pending snap. These events
    // only ever come from the user (our programmatic scrolls don't fire
    // them), so they're an unambiguous "I'm taking over".
    const onUserScrollIntent = () => {
      if (
        smoothSnapRafId !== null ||
        settleUntilRef.current !== 0 ||
        forceScrollRef.current
      ) {
        pinnedRef.current = false;
        forceScrollRef.current = false;
        settleUntilRef.current = 0;
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
  }, [containerRef, contentRef, isAtBottom, isArenaMode, prefersReducedMotion]);

  // Clear the force-snap intent when streaming ends — covers the case where
  // the ref stayed set throughout the entire streaming session.
  const prevIsLoadingRef = useRef(isLoading);
  useEffect(() => {
    if (prevIsLoadingRef.current && !isLoading) {
      forceScrollRef.current = false;
    }
    prevIsLoadingRef.current = isLoading;
  }, [isLoading]);

  // Scroll to bottom on thread initial load.
  const scrolledForThreadRef = useRef<string | null>(null);
  useEffect(() => {
    if (!threadId) {
      // Left a thread (→ new chat). Clear the guard so returning to the same
      // thread re-runs the initial scroll-to-bottom even if this hook instance
      // survives the round trip (it isn't always remounted).
      scrolledForThreadRef.current = null;
      return;
    }
    if (messagesLength === 0) return;
    if (scrolledForThreadRef.current === threadId) return;

    scrolledForThreadRef.current = threadId;
    forceScrollRef.current = true;
    pinnedRef.current = true;

    const c = containerRef.current;
    if (c) {
      c.scrollTo({ top: c.scrollHeight, behavior: 'instant' });
      // Re-seed the scroll trackers to THIS thread's geometry. The hook
      // persists across thread→thread switches, so a leftover prev-thread
      // scrollTop/scrollHeight could make the next onScroll misread the switch
      // as a user scroll-up and clear the forced snap before the new thread
      // settles at the bottom.
      lastScrollTopRef.current = c.scrollTop;
      lastScrollHeightRef.current = c.scrollHeight;
    }
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
  const prevThreadIdRef = useRef(threadId);
  if (
    prevDataThreadIdRef.current !== dataThreadId &&
    prevDataThreadIdRef.current !== undefined
  ) {
    // A genuine branch switch keeps the URL `threadId` constant and only
    // changes `dataThreadId` (activeBranchThreadId). Ordinary thread→thread
    // navigation (clicking another chat) changes BOTH — and ChatInterface is
    // NOT remounted on that transition (keyed `chat-${newChatCount}`, only
    // bumped thread→new), so this hook persists. Preserving thread A's
    // scrollTop onto thread B would pin B at the wrong offset and defeat the
    // thread-init scroll-to-bottom below. Only preserve for a real branch
    // switch; on thread nav fall through to the clear path.
    const threadChanged = prevThreadIdRef.current !== threadId;
    // Skip scroll preservation for edit-and-branch — we want scroll-to-bottom
    // so the edited message and incoming AI response are visible.
    if (!pendingEditedMessageId && !threadChanged) {
      branchScrollSaveRef.current = containerRef.current?.scrollTop ?? null;
      // Freeze the content height for the switch window. Switching branches
      // re-subscribes the message query to the other branch thread, so the
      // list briefly EMPTIES (observed: height 3574→668→4247 over ~1s) before
      // the new branch's messages arrive — that collapse-then-expand is the
      // visible "jump" the user sees (the fork message reflows out and back).
      // Pinning min-height to the pre-switch height keeps the list from
      // collapsing; the saved scrollTop then lands the fork message exactly
      // where it was. Released when the switch settles (below). Set in the
      // render body — like the scrollTop capture above — so it lands BEFORE the
      // browser paints the emptied list.
      const contentEl = contentRef.current;
      if (contentEl) contentEl.style.minHeight = `${contentEl.offsetHeight}px`;
      // Clear after content settles
      if (branchScrollTimerRef.current)
        clearTimeout(branchScrollTimerRef.current);
      branchScrollTimerRef.current = setTimeout(() => {
        branchScrollSaveRef.current = null;
        branchScrollTimerRef.current = null;
        if (contentRef.current) contentRef.current.style.minHeight = '';
        // Reconcile the follow latch to where the view actually ended up. The
        // override held scrollTop at the saved (often non-bottom) position, so
        // the latch could still read `true` from before the switch — without
        // this, the next content tick (e.g. a still-streaming branch) would
        // snap to the bottom. Re-seed the scroll trackers too so the next
        // onScroll diff is correct.
        const c = containerRef.current;
        if (c) {
          pinnedRef.current = isAtBottom();
          lastScrollTopRef.current = c.scrollTop;
          lastScrollHeightRef.current = c.scrollHeight;
        }
      }, 2000);
    } else {
      // edit-and-branch OR thread navigation: clear any stale saved position
      // so onContentChange doesn't override the intended scroll-to-bottom, and
      // release any frozen height so the new thread isn't pinned tall.
      branchScrollSaveRef.current = null;
      if (contentRef.current) contentRef.current.style.minHeight = '';
      if (branchScrollTimerRef.current) {
        clearTimeout(branchScrollTimerRef.current);
        branchScrollTimerRef.current = null;
      }
    }
  }
  prevDataThreadIdRef.current = dataThreadId;
  prevThreadIdRef.current = threadId;

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
      const rows =
        container.querySelectorAll<HTMLElement>('[data-message-key]');
      const prevRowCount = rows.length;
      let anchorKey: string | null = null;
      let anchorOffset = 0;
      for (const row of rows) {
        const r = row.getBoundingClientRect();
        if (r.bottom > containerTop) {
          anchorKey = row.getAttribute('data-message-key');
          anchorOffset = r.top - containerTop;
          break;
        }
      }
      const prevScrollHeight = container.scrollHeight;

      const applyCorrection = () => {
        // Explicit 'instant' — a position-restore must not animate and visibly
        // slide the viewport.
        if (anchorKey) {
          const el = container.querySelector<HTMLElement>(
            `[data-message-key="${CSS.escape(anchorKey)}"]`,
          );
          if (el) {
            const newOffset =
              el.getBoundingClientRect().top -
              container.getBoundingClientRect().top;
            container.scrollTo({
              top: container.scrollTop + (newOffset - anchorOffset),
              behavior: 'instant',
            });
            return;
          }
        }
        // Fallback: raw scrollHeight delta (anchor not found).
        container.scrollTo({
          top:
            container.scrollTop + (container.scrollHeight - prevScrollHeight),
          behavior: 'instant',
        });
      };

      let rafId = 0;
      const observer = new MutationObserver(() => {
        // Fire only once the prepend actually lands (row count grows). A
        // streaming token mutates the existing bubble's markdown subtree without
        // adding a [data-message-key] row, so it must NOT trigger the one-shot
        // correction early (which would no-op, then miss the real prepend).
        //
        // NOTE: this row-count gate assumes the NON-windowed DOM. Under the
        // experimental virtualized path (localStorage tale_virtualized_messages
        // ='1', VirtualizedChatMessageList) a prepend grows items.length but the
        // virtualizer keeps ~constant mounted rows, so this gate stays true and
        // load-more position restoration is a no-op there. If virtualization
        // graduates from the flag, drive restoration off the virtualizer's
        // topmost visible item index+start instead of this DOM row-count gate.
        if (
          container.querySelectorAll('[data-message-key]').length <=
          prevRowCount
        ) {
          return;
        }
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

  // Scroll-to-bottom button: re-engage the pin and land at the bottom. Motion
  // is chosen by shouldAnimateScrollToBottom — smooth only on a settled
  // conversation with motion allowed; while streaming we instant-snap so the
  // view catches up to the live bottom and the pin follows subsequent growth
  // (a smooth animation would lag behind it). Either way the pin is
  // re-engaged, so from here resolveStickToBottom drives follow/escape on the
  // next scroll/content event — no separate "animation in progress" state is
  // needed (and a content change mid-animation just instant-pins to the
  // bottom, the intended destination).
  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    pinnedRef.current = true;
    forceScrollRef.current = false;
    const animate = shouldAnimateScrollToBottom({
      isStreaming: isLoading,
      prefersReducedMotion,
    });
    container.scrollTo({
      top: container.scrollHeight,
      behavior: animate ? 'smooth' : 'instant',
    });
  }, [containerRef, isLoading, prefersReducedMotion]);

  return {
    containerRef,
    contentRef,
    scrollToBottom,
    showScrollButton,
    scrollIntentRef: forceScrollRef,
    handleLoadMore,
  };
}
