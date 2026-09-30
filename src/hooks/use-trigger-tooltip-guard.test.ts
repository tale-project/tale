import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTriggerTooltipGuard } from './use-trigger-tooltip-guard';

describe('useTriggerTooltipGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens and closes on request while the popover is shut', () => {
    const { result } = renderHook(() => useTriggerTooltipGuard(false));
    act(() => result.current.onOpenChange(true));
    expect(result.current.open).toBe(true);
    act(() => result.current.onOpenChange(false));
    expect(result.current.open).toBe(false);
  });

  it('stays shut while the popover is open', () => {
    const { result, rerender } = renderHook(
      ({ popoverOpen }) => useTriggerTooltipGuard(popoverOpen),
      { initialProps: { popoverOpen: false } },
    );
    act(() => result.current.onOpenChange(true));
    rerender({ popoverOpen: true });
    expect(result.current.open).toBe(false);
  });

  it('swallows exactly one open after the popover closes', () => {
    const { result } = renderHook(() => useTriggerTooltipGuard(false));
    act(() => result.current.suppressNextOpen());
    // The focus restore that follows the close.
    act(() => result.current.onOpenChange(true));
    expect(result.current.open).toBe(false);
    // A later hover opens the tip again.
    act(() => result.current.onOpenChange(true));
    expect(result.current.open).toBe(true);
  });

  it('releases the guard when no focus restore arrives', () => {
    const { result } = renderHook(() => useTriggerTooltipGuard(false));
    act(() => result.current.suppressNextOpen());
    act(() => {
      vi.advanceTimersByTime(500);
    });
    act(() => result.current.onOpenChange(true));
    expect(result.current.open).toBe(true);
  });

  it('closes a tip that was open when the guard is armed', () => {
    const { result } = renderHook(() => useTriggerTooltipGuard(false));
    act(() => result.current.onOpenChange(true));
    act(() => result.current.suppressNextOpen());
    expect(result.current.open).toBe(false);
  });
});
