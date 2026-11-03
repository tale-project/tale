import { useNavigate } from '@tanstack/react-router';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { FakeWebSocket } from '@/tests/utils/fake-websocket';
import { meta, runningSession, session } from '@/tests/utils/fixtures';
import { renderApp } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub('/sessions/5');
});

import {
  jpegBytes,
  stubDrawing,
  stubRoom,
  type Drawing,
} from '@/tests/utils/live-view';

import { SessionPage } from './session-page';

let drawing: Drawing;

beforeEach(() => {
  FakeWebSocket.install();
  drawing = stubDrawing();
  stubRoom(1000, 700);
});

afterEach(() => {
  drawing.restore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function routes(
  shown: Session | FakeRoute = runningSession({ id: 5, name: 'Shop' }),
) {
  return installFakeApi({
    'GET /meta': meta(),
    'GET /sessions/:id': shown,
    'GET /secrets': list([]),
  });
}

function show(id: number | null = 5) {
  return renderApp(
    <ProxyFlowProvider>
      <main>
        <SessionPage sessionId={id} />
      </main>
    </ProxyFlowProvider>,
  );
}

const serve = (socket = FakeWebSocket.last) =>
  act(() => {
    socket.emitOpen();
    socket.emitMessage({
      t: 'tabs',
      tabs: [
        {
          id: 1,
          url: 'https://shop.example.com/',
          title: 'Shop',
          loading: false,
          active: true,
        },
      ],
    });
    socket.emitMessage({ t: 'view', tab: 1, w: 1280, h: 800 });
    socket.emitMessage(jpegBytes(1));
  });

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
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  describe('a running session', () => {
    it('shows its browser: the header, the tabs, the address bar', async () => {
      routes();
      show();
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Shop' }),
      ).toBeVisible();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole('button', { name: 'Stop session' }),
      ).toBeVisible();
      expect(
        screen.getByRole('button', { name: 'Actions for Shop' }),
      ).toBeVisible();
      await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
      expect(FakeWebSocket.last.url).toMatch(/\/api\/sessions\/5\/stream$/);
      serve();
      expect(
        await screen.findByRole('tablist', { name: 'Open tabs' }),
      ).toBeVisible();
      expect(screen.getByRole('textbox', { name: 'Address' })).toHaveValue(
        'https://shop.example.com/',
      );
      expect(screen.getByRole('application')).toBeVisible();
    });

    it('leaves the live view to a session that is stopped, and opens it for one that runs', async () => {
      const api = routes();
      const { queryClient } = show();
      await screen.findByRole('button', { name: 'Stop session' });
      await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
      const socket = FakeWebSocket.last;
      serve(socket);

      act(() => {
        queryClient.setQueryData(
          queryKeys.session(5),
          session({ id: 5, name: 'Shop', status: 'stopping' }),
        );
      });
      await screen.findByRole('heading', { level: 2, name: 'Session details' });
      expect(socket.closeCalls).toHaveLength(1);
      expect(screen.queryByRole('tablist')).toBeNull();

      act(() => {
        queryClient.setQueryData(
          queryKeys.session(5),
          runningSession({ id: 5, name: 'Shop' }),
        );
      });
      await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
      expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
      expect(api.callsTo('GET /sessions/:id').length).toBeGreaterThan(0);
    });

    it('hands the keyboard to the title of the page when the session stops while the page has it', async () => {
      routes();
      const { queryClient } = show();
      await screen.findByRole('button', { name: 'Stop session' });
      await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
      serve(FakeWebSocket.last);
      const field = await screen.findByRole('textbox', {
        name: 'Keyboard input for the page',
      });
      act(() => field.focus());
      expect(field).toHaveFocus();

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

    it('hands the keyboard to the title of the page when the browser closes while the page has it', async () => {
      routes();
      show();
      await screen.findByRole('button', { name: 'Stop session' });
      await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
      const socket = FakeWebSocket.last;
      serve(socket);
      const field = await screen.findByRole('textbox', {
        name: 'Keyboard input for the page',
      });
      act(() => field.focus());

      act(() => {
        socket.emitMessage({ t: 'closed' });
        socket.emitClose(1000);
      });

      expect(await screen.findByRole('status')).toHaveTextContent(
        'The browser has closed',
      );
      const title = screen.getByRole('heading', { level: 1, name: 'Shop' });
      await waitFor(() => expect(title).toHaveFocus());
    });

    it('leaves the keyboard on the button that has it when the session stops', async () => {
      routes();
      const { queryClient } = show();
      const stop = await screen.findByRole('button', { name: 'Stop session' });
      await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
      serve(FakeWebSocket.last);
      act(() => stop.focus());

      act(() => {
        queryClient.setQueryData(
          queryKeys.session(5),
          session({ id: 5, name: 'Shop', status: 'stopped' }),
        );
      });

      await screen.findByRole('heading', { level: 2, name: 'Session details' });
      // The same button, now to start it again.
      expect(
        screen.getByRole('button', { name: 'Start session' }),
      ).toHaveFocus();
    });

    it('connects to the new browser when the session was restarted, with no gap between', async () => {
      routes();
      const { queryClient } = show();
      await screen.findByRole('button', { name: 'Stop session' });
      await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
      const first = FakeWebSocket.last;
      serve(first);
      act(() => {
        queryClient.setQueryData(
          queryKeys.session(5),
          runningSession({
            id: 5,
            name: 'Shop',
            lastStartedAt: '2026-11-01T11:00:00+00:00',
          }),
        );
      });
      await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
      expect(first.closeCalls).toHaveLength(1);
    });

    it('opens the browser of the other session when the session of the page changes', async () => {
      routes(({ params }) =>
        runningSession({ id: Number(params.id), name: `Session ${params.id}` }),
      );
      const view = show(5);
      await screen.findByRole('heading', { level: 1, name: 'Session 5' });
      await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
      const first = FakeWebSocket.last;
      view.rerender(
        <ProxyFlowProvider>
          <main>
            <SessionPage sessionId={6} />
          </main>
        </ProxyFlowProvider>,
      );
      await screen.findByRole('heading', { level: 1, name: 'Session 6' });
      await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
      expect(first.closeCalls).toHaveLength(1);
      expect(FakeWebSocket.last.url).toMatch(/\/sessions\/6\/stream$/);
    });
  });

  describe('a session that does not run', () => {
    it('shows its card, and opens no browser', async () => {
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
      expect(FakeWebSocket.instances).toHaveLength(0);
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
      expect(FakeWebSocket.instances).toHaveLength(0);
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
      await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
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
      expect(FakeWebSocket.last.closeCalls).toHaveLength(1);
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
      await screen.findByRole('button', { name: 'Stop session' });
      await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
      serve();
      await screen.findByRole('application');
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
