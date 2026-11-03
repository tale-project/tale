import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { proxy, sessionRef } from '@/tests/utils/fixtures';

vi.mock('@tanstack/react-router', async () => {
  const { createLinkingRouterStub } = await import('@/tests/utils/router-stub');
  return createLinkingRouterStub('/proxies');
});

import { renderInShell } from '@/tests/utils/render';

import { DeleteProxyFlow } from './delete-proxy-flow';

function renderFlow(row = proxy({ id: 4 })) {
  const onOpenChange = vi.fn();
  const view = renderInShell(
    <DeleteProxyFlow proxy={row} open onOpenChange={onOpenChange} />,
  );
  return { ...view, onOpenChange };
}

const confirm = () => screen.getByRole('button', { name: 'Delete proxy' });

describe('DeleteProxyFlow', () => {
  it('asks what the table says is to ask, and deletes with the answer', async () => {
    const api = installFakeApi({ 'DELETE /proxies/:id': undefined });
    const { user, onOpenChange } = renderFlow();

    expect(screen.getByRole('dialog', { name: 'Delete proxy?' })).toBeVisible();
    await user.click(confirm());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.callsTo('DELETE /proxies/:id')[0]?.query.get('force')).toBe(
      'false',
    );
  });

  it('asks what the server says once it knows better, and goes on with the answer', async () => {
    const session = sessionRef({ id: 7, name: 'work', status: 'stopped' });
    const api = installFakeApi({
      'DELETE /proxies/:id': ({ query }) =>
        query.get('force') === 'true'
          ? undefined
          : failure(409, 'proxy_in_use', 'x', { session }),
    });
    const { user, onOpenChange } = renderFlow();

    await user.click(confirm());
    expect(
      await screen.findByRole('dialog', { name: 'Delete a proxy in use?' }),
    ).toBeVisible();
    expect(onOpenChange).not.toHaveBeenCalled();
    await user.click(confirm());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(
      api.callsTo('DELETE /proxies/:id').map((call) => call.query.get('force')),
    ).toEqual(['false', 'true']);
  });

  it('turns a running session into the advice to stop it, and keeps the session of the table when the refusal names none', async () => {
    installFakeApi({
      'DELETE /proxies/:id': failure(409, 'proxy_busy', 'x'),
    });
    const { user } = renderFlow(
      proxy({
        id: 4,
        session: sessionRef({ id: 7, name: 'work', status: 'stopped' }),
      }),
    );

    // The table believed the session stopped: it asks to go ahead...
    expect(
      screen.getByRole('dialog', { name: 'Delete a proxy in use?' }),
    ).toBeVisible();
    await user.click(confirm());

    // ...and the server says it runs: stop it first, and the way to it.
    expect(
      await screen.findByRole('dialog', { name: 'Stop the session first' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open session' })).toHaveAttribute(
      'href',
      '/sessions/7',
    );
  });
});
