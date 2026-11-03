import { useToast } from '@tale/ui/use-toast';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { isRecord } from '@/lib/is-record';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { settings } from '@/tests/utils/fixtures';
import { renderHookApp } from '@/tests/utils/render';
import { openToasts } from '@/tests/utils/toasts';

import { useAiAccess } from './use-ai-access';

function useAccessAndToasts() {
  const { toasts } = useToast();
  return { access: useAiAccess(), toasts: openToasts(toasts) };
}

describe('useAiAccess', () => {
  it('is undefined until the settings are read, then what the server says', async () => {
    installFakeApi({ 'GET /settings': settings({ mcpEnabled: true }) });
    const { result } = renderHookApp(useAccessAndToasts);

    expect(result.current.access.enabled).toBeUndefined();
    await waitFor(() => expect(result.current.access.enabled).toBe(true));
  });

  it('switches AI access on and off with the one value, not through a draft', async () => {
    let stored = settings({ mcpEnabled: false });
    const api = installFakeApi({
      'GET /settings': () => stored,
      'PATCH /settings': ({ body }) => {
        stored = settings({
          mcpEnabled: isRecord(body) && body.mcpEnabled === true,
        });
        return stored;
      },
    });
    const { result } = renderHookApp(useAccessAndToasts);
    await waitFor(() => expect(result.current.access.enabled).toBe(false));

    act(() => result.current.access.setEnabled(true));
    await waitFor(() => expect(result.current.access.enabled).toBe(true));
    act(() => result.current.access.setEnabled(false));
    await waitFor(() => expect(result.current.access.enabled).toBe(false));

    expect(api.callsTo('PATCH /settings').map((call) => call.body)).toEqual([
      { mcpEnabled: true },
      { mcpEnabled: false },
    ]);
    expect(result.current.toasts).toHaveLength(0);
  });

  it('shows where the switch is going while the change is on its way', async () => {
    let finish: () => void = () => {};
    const written = new Promise<void>((resolve) => {
      finish = resolve;
    });
    installFakeApi({
      'GET /settings': settings({ mcpEnabled: false }),
      'PATCH /settings': async () => {
        await written;
        return settings({ mcpEnabled: true });
      },
    });
    const { result } = renderHookApp(useAccessAndToasts);
    await waitFor(() => expect(result.current.access.enabled).toBe(false));

    act(() => result.current.access.setEnabled(true));
    await waitFor(() => expect(result.current.access.isPending).toBe(true));
    expect(result.current.access.enabled).toBe(true);

    await act(async () => {
      finish();
      await written;
    });
    await waitFor(() => expect(result.current.access.isPending).toBe(false));
  });

  it('snaps back and tells the failure once when the server refuses', async () => {
    const api = installFakeApi({
      'GET /settings': settings({ mcpEnabled: false }),
      'PATCH /settings': failure(409, 'session_busy'),
    });
    const { result } = renderHookApp(useAccessAndToasts);
    await waitFor(() => expect(result.current.access.enabled).toBe(false));

    act(() => result.current.access.setEnabled(true));

    await waitFor(() => expect(result.current.toasts).toHaveLength(1));
    expect(result.current.toasts[0]).toMatchObject({
      variant: 'destructive',
      title: "Couldn't change AI access",
      description: 'This session is busy. Try again in a moment.',
    });
    await waitFor(() => expect(result.current.access.isPending).toBe(false));
    expect(result.current.access.enabled).toBe(false);
    expect(api.callsTo('PATCH /settings')).toHaveLength(1);
  });

  it('words a server that does not answer in the person’s language', async () => {
    installFakeApi({
      'GET /settings': settings({ mcpEnabled: true }),
      'PATCH /settings': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const { result } = renderHookApp(useAccessAndToasts);
    await waitFor(() => expect(result.current.access.enabled).toBe(true));

    act(() => result.current.access.setEnabled(false));

    await waitFor(() => expect(result.current.toasts).toHaveLength(1));
    expect(result.current.toasts[0]?.description).toBe(
      "Can't reach Session Manager. Check that it's running, then try again.",
    );
    expect(result.current.access.enabled).toBe(true);
  });
});
