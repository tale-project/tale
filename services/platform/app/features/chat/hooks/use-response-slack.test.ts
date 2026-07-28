import { describe, expect, it } from 'vitest';

import {
  computeSlackPx,
  resolveResponseSlackEnabled,
} from './use-response-slack';

describe('resolveResponseSlackEnabled', () => {
  it('disables slack when opening/switching to a settled thread (no active turn)', () => {
    // Freshly opened thread → lands at the natural conversation bottom.
    expect(
      resolveResponseSlackEnabled({
        threadChanged: true,
        isLoading: false,
        prevSessionActive: false,
        lastUserMessagePending: false,
      }),
    ).toEqual({ slackEnabled: false, sessionActive: false });
  });

  it('does NOT carry a previous thread active state across a switch', () => {
    // prevSessionActive from thread A must not leak into thread B on switch.
    expect(
      resolveResponseSlackEnabled({
        threadChanged: true,
        isLoading: false,
        prevSessionActive: true,
        lastUserMessagePending: false,
      }),
    ).toEqual({ slackEnabled: false, sessionActive: false });
  });

  it('enables slack immediately while the optimistic message is pending (send)', () => {
    // Covers new-chat first send + first send after opening — no flash.
    expect(
      resolveResponseSlackEnabled({
        threadChanged: false,
        isLoading: false,
        prevSessionActive: false,
        lastUserMessagePending: true,
      }),
    ).toEqual({ slackEnabled: true, sessionActive: false });
  });

  it('enables slack while generating', () => {
    expect(
      resolveResponseSlackEnabled({
        threadChanged: false,
        isLoading: true,
        prevSessionActive: false,
        lastUserMessagePending: false,
      }),
    ).toEqual({ slackEnabled: true, sessionActive: true });
  });

  it('keeps slack after completion in the same session (no jump)', () => {
    // sessionActive latched true earlier; generation ended (isLoading false).
    expect(
      resolveResponseSlackEnabled({
        threadChanged: false,
        isLoading: false,
        prevSessionActive: true,
        lastUserMessagePending: false,
      }),
    ).toEqual({ slackEnabled: true, sessionActive: true });
  });

  it('anchors the active turn when opening a thread mid-generation', () => {
    expect(
      resolveResponseSlackEnabled({
        threadChanged: true,
        isLoading: true,
        prevSessionActive: false,
        lastUserMessagePending: false,
      }),
    ).toEqual({ slackEnabled: true, sessionActive: true });
  });
});

describe('computeSlackPx', () => {
  it('fills the viewport below a short user message (minus gap, padding, inset)', () => {
    expect(
      computeSlackPx({
        viewportH: 800,
        userMsgH: 60,
        gap: 12,
        padBottom: 24,
        topInset: 16,
      }),
    ).toBe(800 - 60 - 12 - 24 - 16);
  });

  it('still grants slack for a tall user message (top-anchor stays reachable)', () => {
    // No clamp threshold: a 300px message in an 800px viewport gets the
    // remaining space so the send-snap top-anchor position exists.
    expect(
      computeSlackPx({
        viewportH: 800,
        userMsgH: 300,
        gap: 12,
        padBottom: 24,
        topInset: 16,
      }),
    ).toBe(800 - 300 - 12 - 24 - 16);
  });

  it('degrades to 0 when the user message exceeds the viewport', () => {
    expect(
      computeSlackPx({
        viewportH: 800,
        userMsgH: 900,
        gap: 12,
        padBottom: 24,
        topInset: 16,
      }),
    ).toBe(0);
  });
});
