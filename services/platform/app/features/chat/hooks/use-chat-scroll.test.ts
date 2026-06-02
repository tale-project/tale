import { describe, expect, it } from 'vitest';

import {
  resolveStickToBottom,
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
