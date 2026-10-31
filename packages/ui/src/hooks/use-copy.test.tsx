import { toast, useToast } from '@tale/ui/use-toast';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCopy } from './use-copy';

vi.mock('@tale/ui/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  // The toast store outlives a render: close what a test raised, so the next
  // test cannot pass on a toast it did not raise.
  act(() => toast({ title: '' }).dismiss());
});

/** Mounts one copy button's hook and counts how often its host rendered. */
function mountCopyButton() {
  let renders = 0;
  const hook = renderHook(() => {
    renders += 1;
    return useCopy();
  });
  return {
    renders: () => renders,
    copy: (value: string) => hook.result.current.copy(value),
  };
}

// Every copy button, code block and message toolbar calls this hook. Through
// `useToast()` each of them subscribed to the toast list, so one toast (a
// refused send, a failed save) re-rendered all of them at once: in a long chat,
// one toolbar per reply (#4121).
describe('useCopy', () => {
  it('re-renders nothing for a toast raised elsewhere', () => {
    const button = mountCopyButton();
    expect(button.renders()).toBe(1);

    act(() => {
      toast({ title: 'Message not sent', variant: 'destructive' }).dismiss();
    });

    expect(button.renders()).toBe(1);
  });

  it('still raises its own toast when the copy fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const button = mountCopyButton();
    const toasts = renderHook(() => useToast());

    let copied: boolean | undefined;
    await act(async () => {
      copied = await button.copy('a value');
    });

    expect(copied).toBe(false);
    expect(toasts.result.current.toasts.map((item) => item.title)).toEqual([
      'errors.failedToCopy',
    ]);
    expect(button.renders()).toBe(1);
  });
});
