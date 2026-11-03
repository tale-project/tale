import { useToast } from '@tale/ui/use-toast';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { runningSession } from '@/tests/utils/fixtures';
import { renderHookApp } from '@/tests/utils/render';
import { openToasts } from '@/tests/utils/toasts';

import { useCheckIp } from './use-check-ip';

function useCheckAndToasts() {
  const { toasts } = useToast();
  return { ...useCheckIp(), toasts: openToasts(toasts) };
}

describe('useCheckIp', () => {
  it('says that the exit IP is the one the time zone and location are for', async () => {
    const api = installFakeApi({
      'POST /sessions/:id/check-ip': runningSession({ id: 4 }),
    });
    const { result } = renderHookApp(useCheckAndToasts);

    act(() => result.current.check(4));

    await waitFor(() => expect(result.current.toasts).toHaveLength(1));
    expect(api.callsTo('POST /sessions/:id/check-ip')[0]?.params.id).toBe('4');
    expect(result.current.toasts[0]).toMatchObject({
      variant: 'success',
      title: 'Exit IP unchanged',
      description:
        'The proxy still exits through 203.0.113.7. The time zone and location still match.',
    });
  });

  it('warns that the proxy exits through another IP now, and what to do', async () => {
    const running = runningSession({ id: 4 });
    installFakeApi({
      'POST /sessions/:id/check-ip': {
        ...running,
        proxy: running.proxy && { ...running.proxy, exitIp: '198.51.100.9' },
        location: running.location && { ...running.location, inSync: false },
      },
    });
    const { result } = renderHookApp(useCheckAndToasts);

    act(() => result.current.check(4));

    await waitFor(() => expect(result.current.toasts).toHaveLength(1));
    expect(result.current.toasts[0]).toMatchObject({
      variant: 'warning',
      title: 'Exit IP changed',
      description:
        'The proxy now exits through 198.51.100.9, not 203.0.113.7. Restart the session to update its time zone and location.',
    });
  });

  it('says nothing when the answer has no place to compare the IP with', async () => {
    const api = installFakeApi({
      'POST /sessions/:id/check-ip': runningSession({ id: 4, location: null }),
    });
    const { result } = renderHookApp(useCheckAndToasts);

    act(() => result.current.check(4));

    await waitFor(() =>
      expect(api.callsTo('POST /sessions/:id/check-ip')).toHaveLength(1),
    );
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.toasts).toHaveLength(0);
  });

  it('is pending while the proxy is looked at', async () => {
    let answer: (value: ReturnType<typeof runningSession>) => void = () => {};
    installFakeApi({
      'POST /sessions/:id/check-ip': () =>
        new Promise<ReturnType<typeof runningSession>>((resolve) => {
          answer = resolve;
        }),
    });
    const { result } = renderHookApp(useCheckAndToasts);
    expect(result.current.isPending).toBe(false);

    act(() => result.current.check(4));
    await waitFor(() => expect(result.current.isPending).toBe(true));

    await act(async () => answer(runningSession({ id: 4 })));
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });

  it('tells a proxy that does not answer once, as a failure', async () => {
    installFakeApi({
      'POST /sessions/:id/check-ip': failure(502, 'proxy_unreachable'),
    });
    const { result } = renderHookApp(useCheckAndToasts);

    act(() => result.current.check(4));

    await waitFor(() => expect(result.current.toasts).toHaveLength(1));
    expect(result.current.toasts[0]).toMatchObject({
      variant: 'destructive',
      title: "Couldn't check the IP",
    });
  });
});
