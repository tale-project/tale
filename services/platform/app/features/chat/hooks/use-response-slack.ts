/**
 * Response "slack": the dynamic empty space under the last user message that
 * lets the send-snap anchor that message at the viewport top while the answer
 * streams into the space below (assistant-ui's ViewportSlack pattern). Once
 * the response outgrows the viewport the slack is 0 and the content simply
 * flows past the fold.
 *
 * The slack is a SPACER after the single message list, never a wrapper around
 * the reply rows. Wrapping them in their own region made every send move the
 * previous turn's rows between lists, which remounts them (React cannot move
 * a node between parents) — and a freshly inserted `content-visibility: auto`
 * row spends its first frames at the 200px placeholder size, so the content
 * above the new message jumped by the difference on every send and, after a
 * long reply, clamped the scroll position out from under the send glide.
 *
 * The spacer gives back the reply's growth in the SAME frame the reply grows:
 * the reply's text lands as DOM mutations, and the mutation microtask runs
 * before the frame lays out, so the total height never bounces. (A
 * frame-deferred correction made `scrollHeight` flick up and back down on
 * every streamed chunk — a wobbling scrollbar thumb on every reply.)
 *
 * Geometry coordination with `use-chat-scroll` (two writers, two elements,
 * one geometry):
 *  - THIS hook is the only writer of the spacer's (`slackRef`) `style.height`
 *    — {@link computeSlackPx}, gated by `slackEnabled` (an opened/switched
 *    settled thread gets `0px` so it lands at its natural bottom).
 *  - `useChatScroll` is the only writer of the content wrapper's
 *    (`contentRef`) `style.minHeight`: its branch-switch freeze, released via
 *    the hold's `releaseMinHeight` flag. Neither side ever touches the
 *    other's element.
 *  - They coordinate through geometry, not callbacks: both derive the top
 *    inset from the SAME live `contentRef` padding-top via
 *    {@link resolveTopInset}, so the slack height and the send-snap target
 *    always agree. This hook's observers are registered from a layout effect,
 *    the machine's from a passive one, so on a streamed chunk the spacer is
 *    settled before the machine measures; the machine's MutationObserver
 *    deliberately ignores pure `style` attribute mutations, so a slack write
 *    alone never counts as a content change.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from 'react';

import { resolveTopInset } from '../scroll-constants';

/**
 * Pure slack formula: how tall the spacer after the list must be so that
 * scrolling to the bottom positions the last user message at the viewport top
 * (with the live top inset). `afterRowsH` is everything the list already
 * renders below that message — the reply rows and the list gaps between them
 * — so the spacer gives back exactly what the reply takes and reaches 0 once
 * the reply fills the viewport. A user message taller than the viewport
 * naturally yields 0 — its top still anchors at the viewport top via the
 * send-snap scroll target. Exported for unit testing.
 */
export function computeSlackPx(opts: {
  viewportH: number;
  userMsgH: number;
  afterRowsH: number;
  padBottom: number;
  topInset: number;
}): number {
  return Math.max(
    0,
    opts.viewportH -
      opts.topInset -
      opts.userMsgH -
      opts.afterRowsH -
      opts.padBottom,
  );
}

function computeSlackHeight(
  container: HTMLElement,
  content: HTMLElement,
  list: HTMLElement,
  userMsg: HTMLElement | null,
): number {
  if (!userMsg) return 0;

  // `container` is the dedicated scroller (the chat input footer is a flex
  // SIBLING outside it), so clientHeight is exactly the visible viewport.
  const userRect = userMsg.getBoundingClientRect();
  // The rows after the last user message (and the list gaps between them)
  // end at the list's bottom edge; nothing but the spacer follows the list.
  const afterRowsH = Math.max(
    0,
    list.getBoundingClientRect().bottom - userRect.bottom,
  );
  // `content` is the padded wrapper (the scroller's direct child): its
  // padding-bottom is the breathing room below the spacer; its padding-top is
  // the clearance for the floating glass header on md+ (`md:pt-19`) and must
  // match use-chat-scroll's send-snap inset — both go through resolveTopInset
  // so they cannot drift.
  const contentStyle = getComputedStyle(content);
  const padBottom = parseFloat(contentStyle.paddingBottom) || 0;
  const padTop = parseFloat(contentStyle.paddingTop) || 0;

  return computeSlackPx({
    viewportH: container.clientHeight,
    userMsgH: userRect.height,
    afterRowsH,
    padBottom,
    topInset: resolveTopInset(padTop),
  });
}

/**
 * Whether the response slack (the spacer that anchors the last USER message
 * at the viewport top) is enabled this render, plus the sticky session-active
 * flag to carry forward.
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
 * Applies the response slack: keeps the spacer after the message list sized so
 * the last user message can anchor at the viewport top (see the module docs
 * for the coordination contract with `useChatScroll`).
 */
export function useResponseSlack(opts: {
  containerRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  /** The single message list — its bottom edge bounds the rows after the
   * last user message. Absent while the conversation is empty. */
  listRef: RefObject<HTMLElement | null>;
  /** The empty spacer after the list — this hook's only write target. */
  slackRef: RefObject<HTMLDivElement | null>;
  lastUserMessageRef: RefObject<HTMLLIElement | null>;
  /** True while a send/stream session is active for the current thread —
   * the slack is applied only then. */
  slackEnabled: boolean;
}): void {
  const {
    containerRef,
    contentRef,
    listRef,
    slackRef,
    lastUserMessageRef,
    slackEnabled,
  } = opts;

  // Last applied height — the no-op guard that keeps observer callbacks and
  // re-measures from writing (and thus resizing) when nothing changed.
  const prevHeightRef = useRef('');
  // Which (last-user-message element, gating) pair the current height was
  // measured for — the every-render layout effect below bails out unless one
  // of them changed.
  const measuredForRef = useRef<{
    el: HTMLElement | null;
    enabled: boolean;
  } | null>(null);
  const correctionRafRef = useRef<number | null>(null);
  // The gating flag as the mount-once observers read it.
  const slackEnabledRef = useRef(slackEnabled);
  slackEnabledRef.current = slackEnabled;

  const measure = useCallback((): string => {
    const container = containerRef.current;
    const content = contentRef.current;
    const list = listRef.current;
    if (!slackEnabledRef.current || !container || !content || !list)
      return '0px';
    return `${computeSlackHeight(container, content, list, lastUserMessageRef.current)}px`;
  }, [containerRef, contentRef, listRef, lastUserMessageRef]);

  /** Measure, and write only when the value moved — the one write path. */
  const apply = useCallback((): void => {
    const slack = slackRef.current;
    if (!slack) return;
    const next = measure();
    if (prevHeightRef.current === next) return;
    prevHeightRef.current = next;
    slack.style.height = next;
  }, [measure, slackRef]);

  // Height computation: set before paint so the spacer fills the viewport
  // below the user message the moment a send commits. Scrolling is handled by
  // useChatScroll's content observers + scroll-intent ref (assistant-ui
  // pattern). Gated on slackEnabled — an opened/switched thread gets 0 so it
  // lands at the natural bottom rather than anchoring the last user message
  // at the top.
  //
  // Runs on EVERY render with an identity bail-out: the measurement must
  // re-run when the LAST USER MESSAGE element changes (a send anchors a new
  // row), and this hook only holds refs — there is no message key to depend
  // on. The bail-out (same element, same gating) makes the per-render cost
  // two comparisons; the reply's growth is tracked by the observers below,
  // never by re-rendering.
  useLayoutEffect(() => {
    const slack = slackRef.current;
    if (!slack) return;
    const userMsg = lastUserMessageRef.current;
    const measured = measuredForRef.current;
    if (
      measured &&
      measured.el === userMsg &&
      measured.enabled === slackEnabled
    )
      return;
    measuredForRef.current = { el: userMsg, enabled: slackEnabled };

    const next = measure();
    prevHeightRef.current = next;
    slack.style.height = next;

    // Accurate correction after layout completes (the footer may not have its
    // final size during useLayoutEffect). A newly scheduled correction
    // supersedes a pending one; unmount cancellation lives in the mount
    // effect below (this effect has no dep array, so a per-render cleanup
    // would cancel corrections that still have to land).
    if (correctionRafRef.current !== null)
      cancelAnimationFrame(correctionRafRef.current);
    correctionRafRef.current = requestAnimationFrame(() => {
      correctionRafRef.current = null;
      apply();
    });
  });

  // Cancel a still-pending correction frame when the hook unmounts.
  useEffect(() => {
    return () => {
      if (correctionRafRef.current !== null)
        cancelAnimationFrame(correctionRafRef.current);
    };
  }, []);

  // Keep the spacer current as the geometry moves. Registered ONCE, from a
  // layout effect: MutationObservers notify in registration order, and
  // use-chat-scroll registers its observers from a passive effect, so on a
  // streamed chunk the spacer is settled before the machine measures.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return undefined;

    // 1. The reply's text lands as DOM mutations; answered in the mutation
    //    microtask, before the frame lays out, so the spacer gives back the
    //    growth in the same frame and scrollHeight never bounces. The list
    //    may mount after this effect (an empty conversation), so the
    //    wrapper is observed, not the list.
    const mutations = new MutationObserver(apply);
    mutations.observe(content, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    // 2. The viewport itself: window resizes, and the footer growing with a
    //    multiline draft (the input is a flex sibling OUTSIDE the scroller,
    //    so its growth shrinks the scroller). Written inside the callback:
    //    the container is shallower than the wrapper, so the wrapper's own
    //    observers still receive this frame's follow-up notification.
    const viewport = new ResizeObserver(apply);
    viewport.observe(container);

    // 3. Growth without a mutation (an image inside the reply decoding): a
    //    frame-deferred write — writing inside the wrapper's own resize
    //    callback would re-enter the observer at the same depth. The no-op
    //    guard makes this a free pass whenever (1) already settled the frame.
    let rafId: number | null = null;
    const growth = new ResizeObserver(() => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        apply();
      });
    });
    growth.observe(content);

    return () => {
      mutations.disconnect();
      viewport.disconnect();
      growth.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [containerRef, contentRef, apply]);
}
