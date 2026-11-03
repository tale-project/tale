import { ThemeProvider } from '@tale/ui/theme';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { failure, installFakeApi, list } from '@/tests/utils/fake-api';
import { meta, proxy, session } from '@/tests/utils/fixtures';
import { renderApp } from '@/tests/utils/render';

import { createAppRouter } from '../router';

/*
 * What a person started goes on when they leave the page they started it on:
 * the proxy flow lives in the root route, over the real route tree.
 */

function renderAt(path: string, routes: Parameters<typeof installFakeApi>[0]) {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const api = installFakeApi({
    'GET /meta': meta({ counts: { sessions: 1, proxies: 0 } }),
    'GET /sessions': list([session({ id: 1, name: 'Shop' })]),
    'GET /proxies': list([]),
    'GET /secrets': list([]),
    ...routes,
  });
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const view = renderApp(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  return { ...view, router, api };
}

afterEach(async () => {
  vi.restoreAllMocks();
  localStorage.clear();
  await i18n.changeLanguage('en');
});

describe('the proxy flow in the root route', () => {
  it('asks for proxies where the app is, and starts the session once they were added, opening its page', async () => {
    let starts = 0;
    const { user, router, api } = renderAt('/sessions', {
      'POST /sessions/:id/start': () =>
        ++starts === 1
          ? failure(409, 'no_free_proxy')
          : session({ id: 1, name: 'Shop', status: 'starting' }),
      'POST /proxies/import': {
        added: [proxy({ id: 9 })],
        duplicates: [],
        errors: [],
        summary: 'Added 1',
      },
      'GET /sessions/:id': session({ id: 1, name: 'Shop', status: 'running' }),
    });

    await user.click(await screen.findByRole('button', { name: 'Start Shop' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'No free proxy available',
    });
    await user.click(
      within(dialog).getByRole('textbox', { name: 'Proxies, one per line' }),
    );
    await user.paste('198.51.100.9:8080');
    await user.click(
      within(dialog).getByRole('button', { name: 'Add proxies' }),
    );

    await waitFor(() =>
      expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(2),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/sessions/1'),
    );
  });

  it('goes on with the flow when the person leaves the page meanwhile', async () => {
    let starts = 0;
    const { user, router, api } = renderAt('/sessions', {
      'POST /sessions/:id/start': () =>
        ++starts === 1
          ? failure(409, 'no_free_proxy')
          : session({ id: 1, name: 'Shop', status: 'starting' }),
      'POST /proxies/import': {
        added: [proxy({ id: 9 })],
        duplicates: [],
        errors: [],
        summary: 'Added 1',
      },
      'GET /sessions/:id': session({ id: 1, name: 'Shop', status: 'running' }),
    });
    await user.click(await screen.findByRole('button', { name: 'Start Shop' }));
    await screen.findByRole('dialog', { name: 'No free proxy available' });

    // Another page of the app is opened under the dialog.
    await act(() => router.navigate({ to: '/proxies' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/proxies'),
    );
    const dialog = screen.getByRole('dialog', {
      name: 'No free proxy available',
    });
    await user.click(
      within(dialog).getByRole('textbox', { name: 'Proxies, one per line' }),
    );
    await user.paste('198.51.100.9:8080');
    await user.click(
      within(dialog).getByRole('button', { name: 'Add proxies' }),
    );

    await waitFor(() =>
      expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(2),
    );
    // The session was started for this person: its page opens.
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/sessions/1'),
    );
  });
});
