import { describe, expect, it } from 'vitest';

import { resolveTopInset, TOP_INSET } from '../scroll-constants';
import {
  resolveSnapTargetTop,
  resolveStickToBottom,
  resolveThreadOpenTarget,
  shouldAnimateScrollToBottom,
} from './use-chat-scroll';

/**
 * Locks the stick-to-bottom escape/re-engage decision — the logic that fixes
 * "manual scroll gets reset" (R1) and "scroll re-lands on its own" without
 * letting content growth or shrink override the user.
 */
describe('resolveStickToBottom', () => {
  const base = {
    sticking: true,
    currentTop: 500,
    prevTop: 500,
    currentHeight: 1000,
    prevHeight: 1000,
    atBottom: false,
  };

  it('R1: a deliberate user scroll-up escapes the lock', () => {
    expect(
      resolveStickToBottom({ ...base, currentTop: 480, prevTop: 500 }),
    ).toBe(false);
  });

  it('a deliberate scroll-up escapes even while still within the at-bottom band', () => {
    // 30px up but still "at bottom" (within the 100px band). Escape must beat
    // the band so the latch disengages (the hook then shows the scroll button).
    expect(
      resolveStickToBottom({
        ...base,
        sticking: true,
        currentTop: 470,
        prevTop: 500,
        atBottom: true,
      }),
    ).toBe(false);
  });

  it('a sub-threshold scroll-up (jitter) does NOT escape the lock', () => {
    // 2px up — below the dead-zone — must keep following (no jitter escape).
    expect(
      resolveStickToBottom({
        ...base,
        sticking: true,
        currentTop: 498,
        prevTop: 500,
      }),
    ).toBe(true);
  });

  it('R2: returning to the bottom re-engages following', () => {
    expect(
      resolveStickToBottom({
        ...base,
        sticking: false,
        currentTop: 520,
        prevTop: 500,
        atBottom: true,
      }),
    ).toBe(true);
  });

  it('does NOT escape when scrollTop drops because content shrank', () => {
    // scrollHeight fell (e.g. the "Thinking…" indicator was removed); the
    // browser clamps scrollTop down — that must not be read as a user scroll.
    expect(
      resolveStickToBottom({
        ...base,
        sticking: true,
        currentTop: 400,
        prevTop: 500,
        currentHeight: 900,
        prevHeight: 1000,
        atBottom: true,
      }),
    ).toBe(true);
  });

  it('keeps following on downward scroll while content grows', () => {
    expect(
      resolveStickToBottom({
        ...base,
        currentTop: 600,
        prevTop: 500,
        currentHeight: 1100,
        prevHeight: 1000,
        atBottom: true,
      }),
    ).toBe(true);
  });

  it('keeps following on the streaming frame before the instant pin re-applies', () => {
    // A streamed token grew scrollHeight below the fold but scrollTop hasn't
    // moved yet (the pin's instant scrollTo runs on the next content tick), so
    // atBottom momentarily reads false. No scroll-up happened — the latch must
    // hold so the pin keeps engaging.
    expect(
      resolveStickToBottom({
        ...base,
        sticking: true,
        currentTop: 500,
        prevTop: 500,
        currentHeight: 1200,
        prevHeight: 1000,
        atBottom: false,
      }),
    ).toBe(true);
  });

  it('stays escaped when scrolling down but not yet at the bottom', () => {
    expect(
      resolveStickToBottom({
        ...base,
        sticking: false,
        currentTop: 550,
        prevTop: 500,
        atBottom: false,
      }),
    ).toBe(false);
  });

  it('stays following when at bottom with no movement (our own pin)', () => {
    expect(resolveStickToBottom({ ...base, atBottom: true })).toBe(true);
  });

  it('a further scroll-up while already escaped stays escaped', () => {
    expect(
      resolveStickToBottom({
        ...base,
        sticking: false,
        currentTop: 300,
        prevTop: 480,
      }),
    ).toBe(false);
  });
});

/**
 * Locks the scroll-to-bottom button's motion choice: smooth is reserved for a
 * settled conversation on a motion-allowing OS; streaming or reduced-motion
 * force an instant snap (so the view catches up to the live bottom and honors
 * the accessibility preference, rather than animating against growing content).
 */
describe('shouldAnimateScrollToBottom', () => {
  it('animates on a settled conversation when motion is allowed', () => {
    expect(
      shouldAnimateScrollToBottom({
        isStreaming: false,
        prefersReducedMotion: false,
      }),
    ).toBe(true);
  });

  it('jumps instantly while the assistant is still streaming', () => {
    expect(
      shouldAnimateScrollToBottom({
        isStreaming: true,
        prefersReducedMotion: false,
      }),
    ).toBe(false);
  });

  it('jumps instantly when the OS prefers reduced motion', () => {
    expect(
      shouldAnimateScrollToBottom({
        isStreaming: false,
        prefersReducedMotion: true,
      }),
    ).toBe(false);
  });

  it('jumps instantly when both streaming and reduced motion apply', () => {
    expect(
      shouldAnimateScrollToBottom({
        isStreaming: true,
        prefersReducedMotion: true,
      }),
    ).toBe(false);
  });
});

/**
 * Locks the hold-target resolution — the one place that decides where any
 * programmatic scroll lands (send-snap, branch preservation, thread restore,
 * settle re-pins).
 */
describe('resolveSnapTargetTop', () => {
  const geometry = { scrollHeight: 4000, clientHeight: 800 };
  const maxTop = 3200;

  it("'bottom' resolves to the live bottom", () => {
    expect(
      resolveSnapTargetTop({ kind: 'bottom', ...geometry, topInset: 16 }),
    ).toBe(maxTop);
  });

  it("'position' clamps into the scrollable range", () => {
    expect(
      resolveSnapTargetTop({
        kind: 'position',
        top: 1234,
        ...geometry,
        topInset: 16,
      }),
    ).toBe(1234);
    expect(
      resolveSnapTargetTop({
        kind: 'position',
        top: 99999,
        ...geometry,
        topInset: 16,
      }),
    ).toBe(maxTop);
    expect(
      resolveSnapTargetTop({
        kind: 'position',
        top: -50,
        ...geometry,
        topInset: 16,
      }),
    ).toBe(0);
  });

  it("'last-user-top' anchors the message at the inset", () => {
    expect(
      resolveSnapTargetTop({
        kind: 'last-user-top',
        lastUserTop: 3000,
        ...geometry,
        topInset: 16,
      }),
    ).toBe(3000 - 16);
  });

  it("'last-user-top' clamps when the message sits near the end of a short thread", () => {
    // Anchor minus inset would overshoot the scrollable range (no slack yet).
    expect(
      resolveSnapTargetTop({
        kind: 'last-user-top',
        lastUserTop: 3950,
        ...geometry,
        topInset: 16,
      }),
    ).toBe(maxTop);
  });

  it("'last-user-top' falls back to the bottom when the anchor is missing", () => {
    expect(
      resolveSnapTargetTop({
        kind: 'last-user-top',
        lastUserTop: undefined,
        ...geometry,
        topInset: 16,
      }),
    ).toBe(maxTop);
  });
});

/**
 * Locks the thread-open decision: restore the remembered position when the
 * thread was visited before, otherwise anchor the last user message at the
 * viewport top (degrading to the bottom via the clamp).
 */
describe('resolveThreadOpenTarget', () => {
  const geometry = {
    scrollHeight: 4000,
    clientHeight: 800,
    lastUserTop: 3000,
    topInset: 16,
  };

  it('restores a remembered position, clamped to the current range', () => {
    expect(resolveThreadOpenTarget({ savedTop: 1500, ...geometry })).toEqual({
      kind: 'position',
      top: 1500,
    });
    expect(resolveThreadOpenTarget({ savedTop: 99999, ...geometry })).toEqual({
      kind: 'position',
      top: 3200,
    });
  });

  it('treats a remembered 0 (scrolled to the very top) as a position', () => {
    expect(resolveThreadOpenTarget({ savedTop: 0, ...geometry })).toEqual({
      kind: 'position',
      top: 0,
    });
  });

  it('anchors the last user message at the top on first open', () => {
    expect(
      resolveThreadOpenTarget({ savedTop: undefined, ...geometry }),
    ).toEqual({ kind: 'last-user-top', top: 3000 - 16 });
  });

  it('degrades to the bottom when the anchor cannot reach the top (short reply)', () => {
    expect(
      resolveThreadOpenTarget({
        savedTop: undefined,
        ...geometry,
        lastUserTop: 3950,
      }),
    ).toEqual({ kind: 'last-user-top', top: 3200 });
  });

  it('degrades to the bottom when the thread has no user message', () => {
    expect(
      resolveThreadOpenTarget({
        savedTop: undefined,
        ...geometry,
        lastUserTop: undefined,
      }),
    ).toEqual({ kind: 'last-user-top', top: 3200 });
  });
});

/**
 * Locks the shared top-inset resolution (scroll-constants) — the single value
 * the send-snap target and the response-area slack both build on.
 */
describe('resolveTopInset', () => {
  it('falls back to TOP_INSET when padding is not yet measurable', () => {
    expect(resolveTopInset(0)).toBe(TOP_INSET);
    expect(resolveTopInset(Number.NaN)).toBe(TOP_INSET);
  });

  it('uses mobile content padding as the snap inset', () => {
    // `p-4` / `sm:p-6` — ordinary breathing room, no floating header.
    expect(resolveTopInset(16)).toBe(16);
    expect(resolveTopInset(24)).toBe(24);
  });

  it('clears the floating glass header via desktop content padding', () => {
    // Regression lock for #2805: send-snap used to hardcode TOP_INSET=16
    // against a full-height scroller under an absolute h-18 glass bar, so
    // short user bubbles landed half-hidden. Desktop content uses
    // `md:pt-19` (~76px) so slack and snap stay below the blur.
    expect(resolveTopInset(76)).toBe(76);
    expect(resolveTopInset(76)).toBeGreaterThan(TOP_INSET);
  });
});
