import { useNavigate } from '@tanstack/react-router';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProxyFlowProvider } from '@/app/features/sessions/components/proxy-flow-provider';
import { queryKeys } from '@/app/lib/api/keys';
import type { Session } from '@/lib/api/schemas';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  failure,
  installFakeApi,
  list,
  type FakeRoute,
} from '@/tests/utils/fake-api';
import {
  meta,
  runningSession,
  secret,
  secretSummary,
  session,
} from '@/tests/utils/fixtures';
import { Notices } from '@/tests/utils/notices';
import { renderApp } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub('/sessions/5');
});

import { SessionPage } from './session-page';

afterEach(() => {
  vi.restoreAllMocks();
});

function routes(
  shown: Session | FakeRoute = runningSession({ id: 5, name: 'Shop' }),
) {
  return installFakeApi({
    'GET /meta': meta(),
    'GET /sessions/:id': shown,
    'GET /secrets': list([]),
    'POST /sessions/:id/show': undefined,
    'POST /sessions/:id/type': undefined,
  });
}

function show(id: number | null = 5) {
  return renderApp(
    <ProxyFlowProvider>
      <main>
        <SessionPage sessionId={id} />
      </main>
      <Notices />
    </ProxyFlowProvider>,
  );
}

describe('SessionPage', () => {
  it('holds the place of the session while it is read', async () => {
    routes(() => new Promise(() => {}));
    show();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Loading the session…').length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByRole('button', { name: 'Start session' })).toBeNull();
  });

  describe('a running session', () => {
    it('says that it runs in its own window, with the way to it, its secrets and its details', async () => {
      routes();
      show();
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Shop' }),
      ).toBeVisible();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole('heading', {
          level: 2,
          name: 'Running in its own window',
        }),
      ).toBeVisible();
      expect(screen.getByRole('button', { name: 'Show window' })).toBeVisible();
      expect(
        screen.getByRole('button', { name: 'Secrets for this session' }),
      ).toBeVisible();
      expect(
        screen.getByRole('heading', { level: 2, name: 'Session details' }),
      ).toBeVisible();
      expect(
        screen.getByRole('button', { name: 'Stop session' }),
      ).toBeVisible();
      expect(
        screen.getByRole('button', { name: 'Actions for Shop' }),
      ).toBeVisible();
    });

    it('brings its window to the front', async () => {
      const api = routes();
      const { user } = show();
      await user.click(
        await screen.findByRole('button', { name: 'Show window' }),
      );
      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/show')).toHaveLength(1),
      );
      expect(api.callsTo('POST /sessions/:id/show')[0]?.path).toBe(
        '/sessions/5/show',
      );
    });

    it('says why its window could not come to the front', async () => {
      const api = routes();
      api.on('POST /sessions/:id/show', () =>
        failure(409, 'session_not_running'),
      );
      const { user } = show();
      await user.click(
        await screen.findByRole('button', { name: 'Show window' }),
      );
      expect(
        await screen.findByText(/^Couldn't show the window: /),
      ).toBeVisible();
    });

    it('types a value of a secret into the field clicked in the window, then brings the window to the front', async () => {
      const api = routes();
      api.on(
        'GET /secrets',
        list([
          secretSummary({ id: 1, kind: 'credentials', title: 'Shop login' }),
        ]),
      );
      api.on(
        'GET /secrets/:id',
        secret({
          id: 1,
          kind: 'credentials',
          title: 'Shop login',
          fields: [{ label: 'Password', value: 'hunter2', hidden: true }],
        }),
      );
      const { user } = show();
      await user.click(
        await screen.findByRole('button', { name: 'Secrets for this session' }),
      );
      await user.click(
        await screen.findByRole('button', { name: /Shop login/ }),
      );
      await user.click(
        await screen.findByRole('button', {
          name: 'Type Password into the window',
        }),
      );
      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/show')).toHaveLength(1),
      );
      expect(api.callsTo('POST /sessions/:id/type')).toEqual([
        expect.objectContaining({
          path: '/sessions/5/type',
          body: { text: 'hunter2' },
        }),
      ]);
    });

    it('says why a value could not be typed, and leaves the window where it is', async () => {
      const api = routes();
      api.on(
        'GET /secrets',
        list([
          secretSummary({ id: 1, kind: 'credentials', title: 'Shop login' }),
        ]),
      );
      api.on(
        'GET /secrets/:id',
        secret({
          id: 1,
          kind: 'credentials',
          title: 'Shop login',
          fields: [{ label: 'Password', value: 'hunter2', hidden: true }],
        }),
      );
      api.on('POST /sessions/:id/type', () => failure(409, 'no_field_focused'));
      const { user } = show();
      await user.click(
        await screen.findByRole('button', { name: 'Secrets for this session' }),
      );
      await user.click(
        await screen.findByRole('button', { name: /Shop login/ }),
      );
      await user.click(
        await screen.findByRole('button', {
          name: 'Type Password into the window',
        }),
      );
      expect(
        await screen.findByText(
          "Couldn't type the value: Nothing in the session's window can take text. Click the field in the window first, then try again.",
        ),
      ).toBeVisible();
      expect(api.callsTo('POST /sessions/:id/show')).toHaveLength(0);
    });

    it('says when the exit IP no longer fits the session, with the restart that fits it again', async () => {
      routes(
        runningSession({
          id: 5,
          name: 'Shop',
          proxy: {
            id: 1,
            display: 'http://192.0.2.1:8080',
            exitIp: '198.51.100.9',
            country: 'DE',
            checkStatus: 'ok',
          },
          location: {
            ip: '203.0.113.7',
            country: 'DE',
            timezone: 'Europe/Berlin',
            latitude: 52.52,
            longitude: 13.405,
            inSync: false,
          },
        }),
      );
      show();
      expect(await screen.findByText('The exit IP has changed')).toBeVisible();
      expect(
        screen.getByRole('button', { name: 'Restart session' }),
      ).toBeVisible();
    });

    it('hands the keyboard to the title of the page when the session stops while a button of the card has it', async () => {
      routes();
      const { queryClient } = show();
      const button = await screen.findByRole('button', { name: 'Show window' });
      act(() => button.focus());
      expect(button).toHaveFocus();

      act(() => {
        queryClient.setQueryData(
          queryKeys.session(5),
          session({ id: 5, name: 'Shop', status: 'stopped' }),
        );
      });

      const title = await screen.findByRole('heading', {
        level: 1,
        name: 'Shop',
      });
      await waitFor(() => expect(title).toHaveFocus());
    });

    it('leaves the keyboard on the button that has it when the session stops', async () => {
      routes();
      const { queryClient } = show();
      const stop = await screen.findByRole('button', { name: 'Stop session' });
      act(() => stop.focus());

      act(() => {
        queryClient.setQueryData(
          queryKeys.session(5),
          session({ id: 5, name: 'Shop', status: 'stopped' }),
        );
      });

      await screen.findByRole('heading', {
        level: 2,
        name: 'Session details',
      });
      // The same button, now to start it again.
      expect(
        screen.getByRole('button', { name: 'Start session' }),
      ).toHaveFocus();
    });
  });

  describe('a session that does not run', () => {
    it('shows its card, and has no window to show', async () => {
      routes(session({ id: 5, name: 'Shop', status: 'stopped' }));
      show();
      expect(
        await screen.findByRole('heading', {
          level: 2,
          name: 'Session details',
        }),
      ).toBeVisible();
      // The name is the page's heading, once: the card does not repeat it.
      expect(
        screen.getByRole('heading', { level: 1, name: 'Shop' }),
      ).toBeVisible();
      // One Start for the page: the header's. The card has none of its own.
      expect(screen.getAllByRole('button', { name: /^Start/ })).toHaveLength(1);
      expect(
        screen.getByRole('button', { name: 'Start session' }),
      ).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Show window' })).toBeNull();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });

    it('shows the failure of a session that could not start', async () => {
      routes(
        session({
          id: 5,
          status: 'error',
          error: 'x',
          errorCode: 'no_working_proxy',
        }),
      );
      show();
      expect(
        await screen.findByText(/No working proxy is available/),
      ).toBeVisible();
      // The way on is to add proxies right there, in a dialog.
      expect(screen.getByRole('button', { name: 'Add proxies' })).toBeVisible();
    });

    it('hands the keyboard to the title of the page when the session starts under the button that has it', async () => {
      routes(
        session({
          id: 5,
          name: 'Shop',
          status: 'error',
          error: 'x',
          errorCode: 'no_working_proxy',
        }),
      );
      const { queryClient } = show();
      const addProxies = await screen.findByRole('button', {
        name: 'Add proxies',
      });
      act(() => addProxies.focus());

      act(() => {
        queryClient.setQueryData(
          queryKeys.session(5),
          runningSession({ id: 5, name: 'Shop' }),
        );
      });

      const title = await screen.findByRole('heading', {
        level: 1,
        name: 'Shop',
      });
      await waitFor(() => expect(title).toHaveFocus());
    });
  });

  describe('a session that is not there', () => {
    it('says so for one that does not exist, with the way back', async () => {
      routes(() => failure(404, 'session_not_found'));
      show();
      expect(
        await screen.findByRole('heading', {
          level: 2,
          name: 'Session not found',
        }),
      ).toBeVisible();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole('heading', { level: 1, name: 'Session' }),
      ).toBeVisible();
      expect(
        screen.getByRole('link', { name: 'Back to sessions' }),
      ).toHaveAttribute('href', '/sessions');
    });

    it('says so for an address that is no id, without asking the server', () => {
      const api = routes();
      show(null);
      expect(
        screen.getByRole('heading', { level: 2, name: 'Session not found' }),
      ).toBeVisible();
      expect(
        api.calls.filter((call) => call.path.startsWith('/sessions')),
      ).toEqual([]);
    });

    it('says so when the session is deleted while its page is open', async () => {
      const api = routes();
      const { queryClient } = show();
      await screen.findByRole('button', { name: 'Stop session' });
      api.on('GET /sessions/:id', failure(404, 'session_not_found'));
      await act(() =>
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
      );
      expect(
        await screen.findByRole('heading', {
          level: 2,
          name: 'Session not found',
        }),
      ).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Show window' })).toBeNull();
    });
  });

  describe('a session that cannot be read', () => {
    it('says so, leaves the lost connection to the banner of the page, and reads it again when asked', async () => {
      const api = routes(() => failure(503, 'network'));
      const { user } = show();
      expect(
        await screen.findByRole('heading', {
          level: 2,
          name: "Couldn't load the session",
        }),
      ).toBeVisible();
      // The button says to try again: no second sentence says it.
      expect(screen.queryByText(/Can't reach|Something went wrong/)).toBeNull();
      api.on(
        'GET /sessions/:id',
        session({ id: 5, name: 'Shop', status: 'stopped' }),
      );
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Shop' }),
      ).toBeVisible();
    });

    it('adds the cause when trying again would not mend it', async () => {
      routes(() => failure(403, 'forbidden_host'));
      show();
      await screen.findByRole('heading', {
        level: 2,
        name: "Couldn't load the session",
      });
      expect(
        screen.getByText('Open Session Manager at 127.0.0.1 or localhost.'),
      ).toBeVisible();
    });

    it('keeps showing the session it has when a later read fails', async () => {
      const api = routes(session({ id: 5, name: 'Shop', status: 'stopped' }));
      const { queryClient } = show();
      await screen.findByRole('heading', { level: 1, name: 'Shop' });
      api.on('GET /sessions/:id', failure(503, 'network'));
      await act(() =>
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
      );
      await waitFor(() =>
        expect(queryClient.getQueryState(queryKeys.session(5))?.status).toBe(
          'error',
        ),
      );
      expect(
        screen.getByRole('heading', { level: 1, name: 'Shop' }),
      ).toBeVisible();
      expect(screen.queryByText("Couldn't load the session")).toBeNull();
    });
  });

  describe('leaving a deleted session', () => {
    it('goes back to the list of sessions when the session was deleted from its menu', async () => {
      const navigate = useNavigate();
      const api = routes(session({ id: 5, name: 'Shop', status: 'stopped' }));
      api.on('DELETE /sessions/:id', undefined);
      const { user } = show();
      await user.click(
        await screen.findByRole('button', { name: 'Actions for Shop' }),
      );
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog', {
        name: 'Delete "Shop"?',
      });
      await waitFor(() =>
        expect(
          within(dialog).getByRole('button', { name: 'Delete session' }),
        ).toBeEnabled(),
      );
      await user.click(
        within(dialog).getByRole('button', { name: 'Delete session' }),
      );
      await waitFor(() =>
        expect(navigate).toHaveBeenCalledWith({ to: '/sessions' }),
      );
    });
  });

  describe('its header', () => {
    it('names the session once, and leads back to the list on a phone', async () => {
      routes();
      show();
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Shop' }),
      ).toBeVisible();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
        'href',
        '/sessions',
      );
      // The state and the exit IP are in the one line under the name, at any
      // width: the page does not measure itself to move them elsewhere.
      expect(screen.getAllByText('Running')).toHaveLength(1);
      expect(
        screen.getAllByRole('button', { name: '203.0.113.7 · DE' }),
      ).toHaveLength(1);
    });

    it('is masked while the session is read, and keeps its way back', () => {
      routes(() => new Promise(() => {}));
      show();
      expect(screen.getByRole('link', { name: 'Back' })).toBeVisible();
      expect(screen.queryByRole('button', { name: /session$/ })).toBeNull();
    });

    // The header was a mask for as long as the session was unknown, which a
    // failed read also is: it kept saying that it was loading.
    it('no longer says that it is loading once the read failed, and is named for the page', async () => {
      routes(() => failure(503, 'network'));
      show();
      await screen.findByRole('heading', {
        level: 2,
        name: "Couldn't load the session",
      });
      expect(screen.queryByRole('status')).toBeNull();
      expect(
        screen.getByRole('heading', { level: 1, name: 'Session' }),
      ).toBeVisible();
      expect(screen.getByRole('link', { name: 'Back' })).toBeVisible();
    });
  });

  describe('the tab of the browser', () => {
    it('is named by the session', async () => {
      routes(runningSession({ id: 5, name: 'Shop – Berlin' }));
      show();
      await waitFor(() =>
        expect(document.title).toBe('Shop – Berlin - Session Manager'),
      );
    });

    it('says so when the session is not there', async () => {
      routes(() => failure(404, 'session_not_found'));
      show();
      await waitFor(() =>
        expect(document.title).toBe('Session not found - Session Manager'),
      );
    });

    it('gives the title back when the page is left', async () => {
      routes(runningSession({ id: 5, name: 'Shop' }));
      const view = show();
      await waitFor(() =>
        expect(document.title).toBe('Shop - Session Manager'),
      );
      view.unmount();
      expect(document.title).not.toContain('Shop');
    });
  });

  describe('the failure of one session', () => {
    it('is not carried over to the next one the page opens', async () => {
      routes(({ params }) =>
        params.id === '5'
          ? failure(503, 'network')
          : runningSession({
              id: Number(params.id),
              name: `Session ${params.id}`,
            }),
      );
      const view = show(5);
      await screen.findByRole('heading', {
        level: 2,
        name: "Couldn't load the session",
      });
      view.rerender(
        <ProxyFlowProvider>
          <main>
            <SessionPage sessionId={6} />
          </main>
        </ProxyFlowProvider>,
      );
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Session 6' }),
      ).toBeVisible();
      expect(screen.queryByText("Couldn't load the session")).toBeNull();
    });

    it('is not carried over to a session that is not there either', async () => {
      routes(({ params }) =>
        params.id === '5'
          ? failure(404, 'session_not_found')
          : runningSession({ id: Number(params.id), name: 'Shop' }),
      );
      const view = show(5);
      await screen.findByRole('heading', {
        level: 2,
        name: 'Session not found',
      });
      view.rerender(
        <ProxyFlowProvider>
          <main>
            <SessionPage sessionId={6} />
          </main>
        </ProxyFlowProvider>,
      );
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Shop' }),
      ).toBeVisible();
      expect(screen.queryByText('Session not found')).toBeNull();
    });
  });

  describe('reading the session again', () => {
    it('keeps the keyboard on the button while it reads, and hands it to the title of the page that comes', async () => {
      let answer: (value: Session) => void = () => {};
      const api = routes(() => failure(503, 'network'));
      const { user } = show();
      const retry = await screen.findByRole('button', { name: 'Try again' });
      api.on(
        'GET /sessions/:id',
        () =>
          new Promise<Session>((resolve) => {
            answer = resolve;
          }),
      );
      retry.focus();
      await user.keyboard('{Enter}');
      await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'));
      expect(retry).toHaveFocus();
      // Pressed again while it reads: nothing more is asked.
      await user.keyboard('{Enter}');
      expect(api.callsTo('GET /sessions/:id')).toHaveLength(2);

      answer(session({ id: 5, name: 'Shop', status: 'stopped' }));
      const title = await screen.findByRole('heading', {
        level: 1,
        name: 'Shop',
      });
      await waitFor(() => expect(title).toHaveFocus());
    });
  });

  describe('accessibility', () => {
    it('has no violations while the session is read', async () => {
      routes(() => new Promise(() => {}));
      const view = show();
      await checkAccessibility(view);
    });

    it('has no violations for a running session', async () => {
      routes();
      const view = show();
      await screen.findByRole('button', { name: 'Show window' });
      await checkAccessibility(view);
    });

    it('has no violations for a stopped session', async () => {
      routes(session({ id: 5, status: 'stopped' }));
      const view = show();
      await screen.findByRole('heading', { level: 2 });
      await checkAccessibility(view);
    });

    it('has no violations for a session that failed to start', async () => {
      routes(
        session({
          id: 5,
          status: 'error',
          error: 'x',
          errorCode: 'proxy_unreachable',
        }),
      );
      const view = show();
      await screen.findByRole('heading', { level: 2 });
      await checkAccessibility(view);
    });

    it('has no violations for a session that is not there', async () => {
      routes(() => failure(404, 'session_not_found'));
      const view = show();
      await screen.findByRole('heading', { level: 2 });
      await checkAccessibility(view);
    });

    it('has no violations when the session cannot be read', async () => {
      routes(() => failure(503, 'network'));
      const view = show();
      await screen.findByRole('heading', { level: 2 });
      await checkAccessibility(view);
    });
  });
});
