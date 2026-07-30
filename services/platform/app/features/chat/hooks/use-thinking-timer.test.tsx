// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  messageThinkingAnchor,
  toSeconds,
  useThinkingTimer,
  type ThinkingAnchor,
} from './use-thinking-timer';

function makeAnchor(partial: Partial<ThinkingAnchor>): ThinkingAnchor {
  return {
    clientStartMs: null,
    serverStartClientMs: null,
    reanchorKey: 'k',
    ...partial,
  };
}

function Probe({
  anchor,
  thinking,
}: {
  anchor?: ThinkingAnchor;
  thinking: boolean;
}) {
  const { liveElapsedMs } = useThinkingTimer(anchor, thinking);
  return (
    <span>
      {liveElapsedMs === null ? 'null' : String(toSeconds(liveElapsedMs))}
    </span>
  );
}

describe('messageThinkingAnchor', () => {
  it('anchors a row born from this client to the SEND moment its key carries', () => {
    // The adopted row keeps the optimistic shell's key forever, so the send
    // time survives adoption — and the client anchor must win over the
    // (later) server creation time, which therefore stays null.
    expect(
      messageThinkingAnchor(
        {
          key: 'pending-assistant-1700000000000',
          createdAt: 1_700_000_009_000,
        },
        (serverMs) => serverMs - 2_000,
      ),
    ).toEqual({
      clientStartMs: 1_700_000_000_000,
      serverStartClientMs: null,
      reanchorKey: 'pending-assistant-1700000000000',
    });
  });

  it('falls back to the server start mapped into the client frame on a reload row', () => {
    expect(
      messageThinkingAnchor(
        { key: 'm42', createdAt: 1_700_000_005_000 },
        (serverMs) => serverMs - 2_000,
      ),
    ).toEqual({
      clientStartMs: null,
      serverStartClientMs: 1_700_000_003_000,
      reanchorKey: 'm42',
    });
  });
});

// `renderToStaticMarkup` renders WITHOUT running effects, so it captures the
// exact first paint the user sees — the frame the interval/effect has not yet
// corrected. That's the frame the flicker lived in.
describe('useThinkingTimer — first paint (SSR, no effects)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('exposes the elapsed on the very FIRST render while thinking mid-turn', () => {
    // Regression (flicker ~1s after send): the timeline header mounts and
    // takes over from the pre-answer dots the instant the first
    // reasoning/tool part lands. A fresh `useState(null)` made its first
    // paint show a bare "Thinking" (no "· Ns"). Anchored to the SAME anchor,
    // the elapsed must be present immediately.
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const html = renderToStaticMarkup(
      <Probe
        anchor={makeAnchor({ clientStartMs: now - 3000, reanchorKey: 'c' })}
        thinking
      />,
    );
    expect(html).toBe('<span>3</span>');
  });

  it('PREFERS the client send anchor over the server value (never swaps clocks → no rewind)', () => {
    // The rewind's root: a live turn must count from the immutable client
    // send time, not the later server row-creation time. With BOTH present
    // the client value (3s) wins over the server value (which would read 1s).
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const html = renderToStaticMarkup(
      <Probe
        anchor={makeAnchor({
          clientStartMs: now - 3000,
          serverStartClientMs: now - 1000,
          reanchorKey: 'c',
        })}
        thinking
      />,
    );
    expect(html).toBe('<span>3</span>');
  });

  it('uses the server (client-frame) anchor on reload when there is no client anchor', () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const html = renderToStaticMarkup(
      <Probe
        anchor={makeAnchor({
          clientStartMs: null,
          serverStartClientMs: now - 4000,
          reanchorKey: 's',
        })}
        thinking
      />,
    );
    expect(html).toBe('<span>4</span>');
  });

  it('falls back to the client clock on the first render when no anchor yet', () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const html = renderToStaticMarkup(<Probe thinking />);
    expect(html).toBe('<span>1</span>');
  });

  it('stays null on the first render once the turn has settled (not thinking)', () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const html = renderToStaticMarkup(
      <Probe
        anchor={makeAnchor({ clientStartMs: now - 3000, reanchorKey: 'c' })}
        thinking={false}
      />,
    );
    expect(html).toBe('<span>null</span>');
  });
});

describe('useThinkingTimer — ticking over time', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('never rewinds when the anchor value wobbles under an unchanged reanchorKey', () => {
    // Simulate prod: the client send anchor is present from the start; a
    // moment later the adoption swaps the row's `createdAt` and a re-derived
    // anchor carries a LATER server value — same reanchorKey (same row key),
    // so the timer must hold its latched frame and keep counting up, never
    // dropping.
    const t0 = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(t0);

    const { result, rerender } = renderHook(
      ({ anchor }: { anchor: ThinkingAnchor }) =>
        useThinkingTimer(anchor, true),
      {
        initialProps: {
          anchor: makeAnchor({ clientStartMs: t0, reanchorKey: `c:${t0}` }),
        },
      },
    );

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    const before = toSeconds(result.current.liveElapsedMs ?? 0);
    expect(before).toBeGreaterThanOrEqual(3); // ~3s elapsed since the send

    // A later server value materialises — same reanchorKey.
    rerender({
      anchor: makeAnchor({
        clientStartMs: t0,
        serverStartClientMs: t0 + 1500,
        reanchorKey: `c:${t0}`,
      }),
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const after = toSeconds(result.current.liveElapsedMs ?? 0);

    // Monotonic: the displayed seconds never decreased across the transition.
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('re-anchors exactly once when the reanchorKey changes (a new turn)', () => {
    const t0 = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(t0);

    const { result, rerender } = renderHook(
      ({ anchor }: { anchor: ThinkingAnchor }) =>
        useThinkingTimer(anchor, true),
      {
        initialProps: {
          anchor: makeAnchor({ clientStartMs: t0, reanchorKey: `c:${t0}` }),
        },
      },
    );

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(toSeconds(result.current.liveElapsedMs ?? 0)).toBeGreaterThanOrEqual(
      5,
    );

    // A follow-up turn 5s in — new send time, new key. The timer
    // deliberately resets to count from the follow-up.
    const t1 = t0 + 5000;
    rerender({
      anchor: makeAnchor({ clientStartMs: t1, reanchorKey: `c:${t1}` }),
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // ~1s since the follow-up, not ~6s since the original send.
    expect(toSeconds(result.current.liveElapsedMs ?? 0)).toBeLessThanOrEqual(2);
  });
});
