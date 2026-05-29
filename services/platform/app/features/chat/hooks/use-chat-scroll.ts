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
  // Scroll utility (no auto-follow — ChatGPT-style)
  const { containerRef, contentRef, scrollToBottom, isAtBottom } =
    useAutoScroll({ threshold: 100 });

  const [showScrollButton, setShowScrollButton] = useState(false);

  // Scroll intent ref: 'smooth' on send, 'instant' on thread init, null when idle.
  const scrollingToBottomBehaviorRef = useRef<ScrollBehavior | null>(null);
  // Direction-based escape: track scroll position and programmatic scrolls
  const lastScrollTopRef = useRef(0);
  const programmaticScrollRef = useRef(false);

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

    const onContentChange = () => {
      // During branch switch: override all scroll behavior with saved position
      if (branchScrollSaveRef.current !== null) {
        container.scrollTop = branchScrollSaveRef.current;
        setShowScrollButton(!isAtBottom());
        return;
      }
      const scrollBehavior = scrollingToBottomBehaviorRef.current;
      if (scrollBehavior) {
        programmaticScrollRef.current = true;
        container.scrollTo({
          top: container.scrollHeight,
          behavior: scrollBehavior,
        });
      } else if (isAtBottom()) {
        programmaticScrollRef.current = true;
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'instant',
        });
      }
      setShowScrollButton(!isAtBottom());
    };

    const onScroll = () => {
      const currentTop = container.scrollTop;
      const prevTop = lastScrollTopRef.current;
      lastScrollTopRef.current = currentTop;

      const ref = scrollingToBottomBehaviorRef.current;
      if (ref) {
        if (!programmaticScrollRef.current && currentTop < prevTop) {
          // User scrolled UP while auto-follow is active → escape
          scrollingToBottomBehaviorRef.current = null;
        } else if (ref === 'smooth' && isAtBottom()) {
          // Smooth scroll reached bottom → downgrade to instant
          // so future content-growth corrections are instantaneous
          scrollingToBottomBehaviorRef.current = 'instant';
        }
      }

      programmaticScrollRef.current = false;
      setShowScrollButton(!isAtBottom());
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

  // Load-more scroll preservation: keep viewport stable when older messages prepend
  const handleLoadMore = useCallback(
    (count: number) => {
      const container = containerRef.current;
      if (!container) {
        loadMore(count);
        return;
      }

      const prevScrollHeight = container.scrollHeight;
      const observer = new MutationObserver(() => {
        observer.disconnect();
        container.scrollTop += container.scrollHeight - prevScrollHeight;
      });
      observer.observe(container, { childList: true, subtree: true });
      loadMore(count);

      // Safety timeout to disconnect if no mutation fires
      setTimeout(() => observer.disconnect(), 2000);
    },
    [containerRef, loadMore],
  );

  return {
    containerRef,
    contentRef,
    scrollToBottom,
    showScrollButton,
    scrollIntentRef: scrollingToBottomBehaviorRef,
    handleLoadMore,
  };
}
