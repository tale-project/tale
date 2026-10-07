import { render, renderHook } from '@testing-library/react';
import { memo, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ClockOffsetProvider,
  useClockOffset,
  useReportServerNow,
  type ClockOffset,
} from './use-clock-offset';

function wrapper({ children }: { children: ReactNode }) {
  return <ClockOffsetProvider>{children}</ClockOffsetProvider>;
}

/** Report a server sample then read the resulting clock in one hook. */
function useProbe(serverNow?: number) {
  useReportServerNow(serverNow);
  return useClockOffset();
}

describe('useClockOffset', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is the identity clock outside a provider', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const { result } = renderHook(() => useClockOffset());
    expect(result.current.offsetMs).toBe(0);
    expect(result.current.toClientEpoch(5000)).toBe(5000);
    expect(result.current.serverEpochNow()).toBe(1000);
    expect(result.current.clientEpochNow()).toBe(1000);
  });

  it('learns offset = serverNow - clientNow from the first sample', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const { result, rerender } = renderHook(
      ({ serverNow }: { serverNow?: number }) => useProbe(serverNow),
      {
        wrapper,
        initialProps: { serverNow: undefined as number | undefined },
      },
    );
    // No sample yet → identity.
    expect(result.current.offsetMs).toBe(0);

    // Server is 8s ahead of the client.
    rerender({ serverNow: 9000 });
    expect(result.current.offsetMs).toBe(8000);
    // A server epoch maps back into the client frame…
    expect(result.current.toClientEpoch(9000)).toBe(1000);
    // …and "now" is available in both frames.
    expect(result.current.serverEpochNow()).toBe(9000);
    expect(result.current.clientEpochNow()).toBe(1000);
  });

  it('converts with a learned offset without re-rendering its readers', () => {
    // Every assistant row of a long transcript reads the clock: a new value
    // per sample re-rendered all of them, toolbars included, the moment the
    // first turn's live text reported the server clock (#4121).
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    // Every value the reader rendered with, one per render.
    const seen: ClockOffset[] = [];
    const Reader = memo(function Reader() {
      seen.push(useClockOffset());
      return null;
    });
    function Reporter({ serverNow }: { serverNow?: number }) {
      useReportServerNow(serverNow);
      return null;
    }
    const tree = (serverNow?: number) => (
      <ClockOffsetProvider>
        <Reader />
        <Reporter serverNow={serverNow} />
      </ClockOffsetProvider>
    );
    const { rerender } = render(tree());
    expect(seen).toHaveLength(1);
    const clock = seen[0]!;

    // The first sample: server 8 s ahead.
    rerender(tree(9000));
    expect(seen).toHaveLength(1);
    expect(clock.offsetMs).toBe(8000);
    expect(clock.toClientEpoch(9000)).toBe(1000);
    expect(clock.serverEpochNow()).toBe(9000);

    // A real re-sync is adopted the same way.
    rerender(tree(20000));
    expect(seen).toHaveLength(1);
    expect(clock.toClientEpoch(20000)).toBe(1000);
  });

  it('ignores jitter within the threshold but adopts a real re-sync', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const { result, rerender } = renderHook(
      ({ serverNow }: { serverNow?: number }) => useProbe(serverNow),
      { wrapper, initialProps: { serverNow: 9000 } },
    );
    expect(result.current.offsetMs).toBe(8000);

    // +100ms of latency jitter → ignored, frame stays put.
    rerender({ serverNow: 9100 });
    expect(result.current.offsetMs).toBe(8000);

    // A genuine clock correction (> threshold) → adopted.
    rerender({ serverNow: 20000 });
    expect(result.current.offsetMs).toBe(19000);
  });
});
