import { useToast } from '@tale/ui/use-toast';
import { act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useSessionActions } from '@/app/features/sessions/hooks/use-session-actions';
import { ApiError } from '@/app/lib/api/client';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { resetLanguage, showLanguage } from '@/tests/utils/language';
import { renderHookApp } from '@/tests/utils/render';
import { openToasts } from '@/tests/utils/toasts';

afterEach(resetLanguage);

function useActionsAndToasts() {
  const { toasts } = useToast();
  return { actions: useSessionActions(), toasts: openToasts(toasts) };
}

const CAUSE = 'the proxy rejected the credentials (HTTP 407)';

// A refusal that names why (the cause of a proxy that does not answer, what a
// busy session is doing) says it in the one toast a failed write raises.
describe('the toast of a refused write', () => {
  it.each([
    ['restart', 'POST /sessions/:id/restart', "Couldn't restart the session"],
    ['checkIp', 'POST /sessions/:id/check-ip', "Couldn't check the IP"],
  ] as const)(
    'says why the proxy does not work when %s is refused',
    async (action, route, title) => {
      installFakeApi({
        [route]: failure(
          502,
          'proxy_unreachable',
          `The proxy of session shop (http://192.0.2.1:8080) is not working: ${CAUSE}.`,
          { proxyId: 4, reason: CAUSE },
        ),
      });
      const { result } = renderHookApp(useActionsAndToasts);

      await act(async () => {
        await expect(
          result.current.actions[action].mutateAsync({ id: 4 }),
        ).rejects.toBeInstanceOf(ApiError);
      });

      await waitFor(() => expect(result.current.toasts).toHaveLength(1));
      expect(result.current.toasts[0]).toMatchObject({
        variant: 'destructive',
        title,
        description: `This session's proxy isn't working: ${CAUSE}. Choose Rotate IP to give the session another proxy.`,
      });
    },
  );

  it('says what the session is doing when it is busy', async () => {
    installFakeApi({
      'POST /sessions/:id/rotate': failure(409, 'session_busy', 'x', {
        doing: 'stopping',
      }),
    });
    const { result } = renderHookApp(useActionsAndToasts);

    await act(async () => {
      await expect(
        result.current.actions.rotate.mutateAsync({ id: 4 }),
      ).rejects.toBeInstanceOf(ApiError);
    });

    await waitFor(() => expect(result.current.toasts).toHaveLength(1));
    expect(result.current.toasts[0]).toMatchObject({
      title: "Couldn't rotate the IP",
      description: 'This session is stopping. Try again in a moment.',
    });
  });

  it('says only that the proxy does not work when the answer names no cause', async () => {
    installFakeApi({
      'POST /sessions/:id/check-ip': failure(502, 'proxy_unreachable', 'x', {
        proxyId: 4,
      }),
    });
    const { result } = renderHookApp(useActionsAndToasts);

    await act(async () => {
      await expect(
        result.current.actions.checkIp.mutateAsync({ id: 4 }),
      ).rejects.toBeInstanceOf(ApiError);
    });

    await waitFor(() => expect(result.current.toasts).toHaveLength(1));
    expect(result.current.toasts[0]?.description).toBe(
      "This session's proxy isn't working. Choose Rotate IP to give the session another proxy.",
    );
  });

  it('says it in German', async () => {
    await showLanguage('de');
    installFakeApi({
      'POST /sessions/:id/check-ip': failure(502, 'proxy_unreachable', 'x', {
        reason: CAUSE,
      }),
    });
    const { result } = renderHookApp(useActionsAndToasts);

    await act(async () => {
      await expect(
        result.current.actions.checkIp.mutateAsync({ id: 4 }),
      ).rejects.toBeInstanceOf(ApiError);
    });

    await waitFor(() => expect(result.current.toasts).toHaveLength(1));
    expect(result.current.toasts[0]?.description).toBe(
      `Der Proxy dieser Sitzung funktioniert nicht: ${CAUSE}. Wähle IP wechseln, damit die Sitzung einen anderen Proxy bekommt.`,
    );
  });
});
