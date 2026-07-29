/**
 * Response-area "slack": the dynamic min-height under the last user message
 * that lets the send-snap anchor that message at the viewport top while the
 * answer streams into the space below (assistant-ui's ViewportSlack pattern).
 * Once the response outgrows the viewport the min-height becomes irrelevant —
 * the content simply flows past the fold.
 *
 * Min-height coordination with `use-chat-scroll` (two writers, two elements,
 * one geometry):
 *  - THIS hook is the only writer of the response area's (`responseAreaRef`)
 *    `style.minHeight` — the slack computed by {@link computeSlackPx}, gated
 *    by `slackEnabled` (an opened/switched settled thread gets `0px` so it
 *    lands at its natural bottom).
 *  - `useChatScroll` is the only writer of the content wrapper's
 *    (`contentRef`) `style.minHeight`: its branch-switch freeze, released via
 *    the hold's `releaseMinHeight` flag. Neither side ever touches the
 *    other's element.
 *  - They coordinate through geometry, not callbacks: both derive the top
 *    inset from the SAME live `contentRef` padding-top via
 *    {@link resolveTopInset}, so the slack height and the send-snap target
 *    always agree; and this hook's min-height writes reach the scroll machine
 *    only as content RESIZES (its ResizeObserver re-pins the active hold
 *    through the settle window) — its MutationObserver deliberately ignores
 *    pure `style` attribute mutations, so a slack write alone never counts as
 *    a content change.
 */

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

import { resolveTopInset } from '../scroll-constants';

/**
 * Pure slack formula: how tall the response area must be so that scrolling
 * to the bottom positions the last user message at the viewport top (with
 * the live top inset). Matches assistant-ui's ViewportSlack pattern.
 * A user message taller than the viewport naturally yields 0 — its top still
 * anchors at the viewport top via the send-snap scroll target.
 * Exported for unit testing.
 */
export function computeSlackPx(opts: {
  viewportH: number;
  userMsgH: number;
  gap: number;
  padBottom: number;
  topInset: number;
}): number {
  return Math.max(
    0,
    opts.viewportH - opts.userMsgH - opts.gap - opts.padBottom - opts.topInset,
  );
}

function computeResponseMinHeight(
  container: HTMLElement,
  content: HTMLElement,
  responseArea: HTMLElement,
  userMsg: HTMLElement | null,
): number {
  if (!userMsg) return 0;

  // `container` is the dedicated scroller (the chat input footer is a flex
  // SIBLING outside it), so clientHeight is exactly the visible viewport.
  const userMsgH = userMsg.getBoundingClientRect().height;
  const flexParent = responseArea.parentElement;
  const gap = flexParent
    ? parseFloat(getComputedStyle(flexParent).gap) || 0
    : 0;
  // `content` is the padded wrapper (the scroller's direct child): its
  // padding-bottom is the breathing room below the response area; its
  // padding-top is the clearance for the floating glass header on md+
  // (`md:pt-19`) and must match use-chat-scroll's send-snap inset — both go
  // through resolveTopInset so they cannot drift.
  const contentStyle = getComputedStyle(content);
  const padBottom = parseFloat(contentStyle.paddingBottom) || 0;
  const padTop = parseFloat(contentStyle.paddingTop) || 0;

  return computeSlackPx({
    viewportH: container.clientHeight,
    userMsgH,
    gap,
    padBottom,
    topInset: resolveTopInset(padTop),
  });
}

/**
 * Whether the response-area "slack" (the min-height that anchors the last USER
 * message at the viewport top) is enabled this render, plus the sticky
 * session-active flag to carry forward.
 *
 * The slack belongs to a turn the user is ACTIVELY engaged in — a message they
 * just sent (optimistic bubble still pending), one that is generating, or one
 * that completed during this viewing session (kept anchored ChatGPT-style so
 * it doesn't jump on completion). A thread the user just OPENED or SWITCHED to
 * has no active turn, so the slack is disabled and the conversation opens at
 * its NATURAL bottom (last reply just above the composer) instead of with the
 * last user message pinned to the top and a gap below a short reply.
 *
 * `sessionActive` latches true once the thread sends/generates this session and
 * resets only when the thread changes. Pure + exported for unit testing — the
 * consumer derives `slackEnabled` with it and passes the result to
 * {@link useResponseSlack}.
 */
export function resolveResponseSlackEnabled(opts: {
  threadChanged: boolean;
  isLoading: boolean;
  prevSessionActive: boolean;
  lastUserMessagePending: boolean;
}): { slackEnabled: boolean; sessionActive: boolean } {
  const sessionActive = opts.threadChanged
    ? opts.isLoading
    : opts.prevSessionActive || opts.isLoading;
  return {
    slackEnabled: sessionActive || opts.lastUserMessagePending,
    sessionActive,
  };
}

/**
 * Applies the response-area slack: keeps `responseAreaRef`'s min-height sized
 * so the last user message can anchor at the viewport top (see the module
 * docs for the coordination contract with `useChatScroll`).
 */
export function useResponseSlack(opts: {
  containerRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  responseAreaRef: RefObject<HTMLDivElement | null>;
  lastUserMessageRef: RefObject<HTMLLIElement | null>;
  /** True while a send/stream session is active for the current thread —
   * the slack min-height is applied only then. */
  slackEnabled: boolean;
}): void {
  const {
    containerRef,
    contentRef,
    responseAreaRef,
    lastUserMessageRef,
    slackEnabled,
  } = opts;

  // Last applied min-height — the no-op guard that keeps observer callbacks
  // and re-measures from writing (and thus resizing) when nothing changed.
  const prevMinHeightRef = useRef('');
  // Which (last-user-message element, gating) pair the current min-height was
  // measured for — the every-render layout effect below bails out unless one
  // of them changed.
  const measuredForRef = useRef<{
    el: HTMLElement | null;
    enabled: boolean;
  } | null>(null);
  const correctionRafRef = useRef<number | null>(null);

  // Min-height computation: set before paint so the response area fills the
  // viewport below the user message. Scrolling is handled by useChatScroll's
  // content ResizeObserver + scroll-intent ref (assistant-ui pattern). Gated
  // on slackEnabled — an opened/switched thread gets 0 so it lands at the
  // natural bottom rather than anchoring the last user message at the top.
  //
  // Runs on EVERY render with an identity bail-out: the measurement must
  // re-run when the LAST USER MESSAGE element changes (a send swaps in a new
  // row), and this hook only holds refs — there is no message key to depend
  // on. The bail-out (same element, same gating) makes the per-render cost
  // two comparisons; streamed tokens re-render but never re-measure.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    const responseArea = responseAreaRef.current;
    if (!container || !content || !responseArea) return;
    const userMsg = lastUserMessageRef.current;
    const measured = measuredForRef.current;
    if (
      measured &&
      measured.el === userMsg &&
      measured.enabled === slackEnabled
    )
      return;
    measuredForRef.current = { el: userMsg, enabled: slackEnabled };

    const next = slackEnabled
      ? `${computeResponseMinHeight(container, content, responseArea, userMsg)}px`
      : '0px';
    prevMinHeightRef.current = next;
    responseArea.style.minHeight = next;

    // Accurate correction after layout completes (the footer may not have its
    // final size during useLayoutEffect). A newly scheduled correction
    // supersedes a pending one; unmount cancellation lives in the mount
    // effect below (this effect has no dep array, so a per-render cleanup
    // would cancel corrections that still have to land).
    if (correctionRafRef.current !== null)
      cancelAnimationFrame(correctionRafRef.current);
    correctionRafRef.current = requestAnimationFrame(() => {
      correctionRafRef.current = null;
      const corrected = slackEnabled
        ? `${computeResponseMinHeight(container, content, responseArea, lastUserMessageRef.current)}px`
        : '0px';
      if (prevMinHeightRef.current !== corrected) {
        prevMinHeightRef.current = corrected;
        responseArea.style.minHeight = corrected;
      }
    });
  });

  // Cancel a still-pending correction frame when the hook unmounts.
  useEffect(() => {
    return () => {
      if (correctionRafRef.current !== null)
        cancelAnimationFrame(correctionRafRef.current);
    };
  }, []);

  // Keep min-height updated on window/footer resize.
  // Guards against feedback loops by skipping when the value is unchanged.
  // Uses a rAF guard to coalesce rapid-fire ResizeObserver callbacks into
  // a single layout recalculation per frame, preventing scrolling jitter.
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    const responseArea = responseAreaRef.current;
    if (!container || !content || !responseArea) return undefined;

    let rafId: number | null = null;

    const update = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const next = slackEnabled
          ? `${computeResponseMinHeight(container, content, responseArea, lastUserMessageRef.current)}px`
          : '0px';
        if (prevMinHeightRef.current === next) return;
        prevMinHeightRef.current = next;
        responseArea.style.minHeight = next;
      });
    };

    const ro = new ResizeObserver(update);
    // The chat input footer is a flex sibling OUTSIDE the scroller, so footer
    // growth (multiline input) shrinks the scroller itself — observing the
    // container covers it.
    ro.observe(container);

    return () => {
      ro.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [
    containerRef,
    contentRef,
    responseAreaRef,
    lastUserMessageRef,
    slackEnabled,
  ]);
}
