import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProxyFlowProvider } from '@/app/features/sessions/components/proxy-flow-provider';
import type { Session } from '@/lib/api/schemas';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  failure,
  installFakeApi,
  type FakeRoute,
} from '@/tests/utils/fake-api';
import { meta, proxy, runningSession, session } from '@/tests/utils/fixtures';
import { renderApp } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub('/sessions/1');
});

// The menu is the sessions unit's, with its own tests: here only what the
// header gives it matters.
vi.mock('@/app/features/sessions/components/session-actions-menu', () => ({
  SessionActionsMenu: ({
    session: shown,
    onDeleted,
  }: {
    session: Session;
    onDeleted?: () => void;
  }) => (
    <button type="button" onClick={onDeleted}>
      Menu of {shown.name}
    </button>
  ),
}));

import { Notices } from '@/tests/utils/notices';

import { SessionHeader } from './session-header';

function setup(
  shown: Session | undefined,
  {
    failed = false,
    routes = {},
  }: { failed?: boolean; routes?: Record<string, FakeRoute> } = {},
) {
  const onDeleted = vi.fn();
  const api = installFakeApi({ 'GET /meta': meta(), ...routes });
  const view = renderApp(
    <ProxyFlowProvider>
      <header>
        <SessionHeader session={shown} failed={failed} onDeleted={onDeleted} />
      </header>
      <Notices />
    </ProxyFlowProvider>,
  );
  return { ...view, api, onDeleted };
}

describe('SessionHeader', () => {
  describe('the session it names', () => {
    it('names the session as the one heading of the page, with the whole name for a long one', () => {
      setup(runningSession({ name: 'Shop – Berlin' }));
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      const title = screen.getByRole('heading', { level: 1 });
      expect(title).toHaveTextContent('Shop – Berlin');
      expect(title).toHaveAttribute('title', 'Shop – Berlin');
    });

    // The panel beside the page already says "Sessions": a phone has no panel.
    it('leads back to the sessions with one control, and has no trail of its own', () => {
      setup(runningSession({ name: 'Shop' }));
      expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
        'href',
        '/sessions',
      );
      expect(screen.queryByRole('navigation')).toBeNull();
    });

    it('says what the session is doing and where it exits, in one line under its name', () => {
      setup(runningSession({ name: 'Shop' }));
      expect(screen.getByText('Running')).toBeVisible();
      expect(
        screen.getByRole('button', { name: '203.0.113.7 · DE' }),
      ).toBeVisible();
    });

    it.each([
      ['stopped', session({ status: 'stopped' }), 'Stopped'],
      ['failed', session({ status: 'error', error: 'x' }), 'Error'],
      [
        'starting',
        session({ status: 'starting', activity: 'launching' }),
        'Starting',
      ],
      ['stopping', session({ status: 'stopping' }), 'Stopping'],
      [
        'given a proxy',
        session({ status: 'stopped', activity: 'assigning_proxy' }),
        'Assigning proxy',
      ],
    ])('says it while the session is %s', (_when, shown, words) => {
      setup(shown);
      expect(screen.getByText(words)).toBeVisible();
    });

    it('has no exit IP to show for a session that has none yet', () => {
      setup(session({ status: 'stopped' }));
      expect(screen.getByText('Stopped')).toBeVisible();
      expect(
        screen.queryByRole('button', { name: /\d+\.\d+\.\d+\.\d+/ }),
      ).toBeNull();
    });

    it('shows the exit IP of a stopped session that has one: its details open from here too', () => {
      setup(runningSession({ status: 'stopped' }));
      expect(screen.getByText('Stopped')).toBeVisible();
      expect(
        screen.getByRole('button', { name: '203.0.113.7 · DE' }),
      ).toBeVisible();
    });

    it('falls back to the IP of the place when the proxy is not known', () => {
      setup(runningSession({ proxy: null }));
      expect(
        screen.getByRole('button', { name: '203.0.113.7 · DE' }),
      ).toBeVisible();
    });

    it('opens the details of the session from its exit IP', async () => {
      const { user } = setup(runningSession({ name: 'Shop' }));
      await user.click(
        screen.getByRole('button', { name: '203.0.113.7 · DE' }),
      );
      const details = await screen.findByRole('dialog', {
        name: 'Session details',
      });
      expect(within(details).getByText('Europe/Berlin')).toBeVisible();
    });
  });

  describe('while the session is read', () => {
    it('keeps the places of its name, state and buttons, masked, and the way back', () => {
      setup(undefined);
      expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
      expect(screen.getByRole('status')).toBeVisible();
      expect(screen.getByRole('link', { name: 'Back' })).toBeVisible();
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('does not name a session it does not know', () => {
      setup(undefined);
      expect(screen.getByRole('heading', { level: 1 })).not.toHaveTextContent(
        /\d/,
      );
    });
  });

  // A read that failed is no wait: the page below says so, and the header must
  // not go on saying that it is loading.
  describe('when the session could not be read', () => {
    it('is no longer busy: it names the page, and keeps the way back', () => {
      setup(undefined, { failed: true });
      expect(
        screen.getByRole('heading', { level: 1, name: 'Session' }),
      ).toBeVisible();
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.getByRole('link', { name: 'Back' })).toBeVisible();
      expect(screen.queryByRole('button')).toBeNull();
    });
  });

  describe('Start and Stop', () => {
    it('holds Stop and the menu while it runs', () => {
      setup(runningSession({ name: 'Shop' }));
      expect(
        screen.getByRole('button', { name: 'Stop session' }),
      ).toBeEnabled();
      expect(
        screen.getByRole('button', { name: 'Menu of Shop' }),
      ).toBeVisible();
      expect(
        screen.queryByRole('button', { name: 'Start session' }),
      ).toBeNull();
    });

    it('holds Start while the session is stopped, and after a failure', () => {
      setup(session({ status: 'stopped' }));
      expect(
        screen.getByRole('button', { name: 'Start session' }),
      ).toBeEnabled();
      expect(screen.queryByRole('button', { name: 'Stop session' })).toBeNull();
    });

    it('holds Start after a failure too', () => {
      setup(
        session({ status: 'error', error: 'x', errorCode: 'launch_failed' }),
      );
      expect(
        screen.getByRole('button', { name: 'Start session' }),
      ).toBeEnabled();
    });

    it('holds Start, busy, while a proxy is assigned', () => {
      setup(session({ status: 'stopped', activity: 'assigning_proxy' }));
      const start = screen.getByRole('button', { name: 'Start session' });
      expect(start).toHaveAttribute('aria-busy', 'true');
      expect(start).toHaveAttribute('aria-disabled', 'true');
    });

    it('cannot start while the browser is not there', async () => {
      setup(session({ status: 'stopped' }), {
        routes: {
          'GET /meta': meta({
            browserInstalled: false,
            browserInstalling: false,
          }),
        },
      });
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Start session' }),
        ).toHaveAttribute('aria-disabled', 'true'),
      );
    });

    it('starts the session', async () => {
      const { user, api } = setup(session({ id: 4, status: 'stopped' }), {
        routes: {
          'POST /sessions/:id/start': session({ id: 4, status: 'starting' }),
        },
      });
      await user.click(screen.getByRole('button', { name: 'Start session' }));
      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(1),
      );
      expect(api.callsTo('POST /sessions/:id/start')[0]?.params.id).toBe('4');
    });

    it('says it is starting while the request is under way', async () => {
      let answer: (value: Session) => void = () => {};
      const { user } = setup(session({ id: 4, status: 'stopped' }), {
        routes: {
          'POST /sessions/:id/start': () =>
            new Promise<Session>((resolve) => {
              answer = resolve;
            }),
        },
      });
      await user.click(screen.getByRole('button', { name: 'Start session' }));

      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Start session' }),
        ).toHaveAttribute('aria-busy', 'true'),
      );
      answer(session({ id: 4, status: 'starting' }));
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Start session' }),
        ).not.toHaveAttribute('aria-busy'),
      );
    });

    it('asks for proxies when none is free, and starts the session by itself once they are added', async () => {
      let starts = 0;
      const { user, api } = setup(session({ id: 4, status: 'stopped' }), {
        routes: {
          'POST /sessions/:id/start': () =>
            ++starts === 1
              ? failure(409, 'no_free_proxy')
              : session({ id: 4, status: 'starting' }),
          'POST /proxies/import': {
            added: [proxy({ id: 5 })],
            duplicates: [],
            errors: [],
            summary: 'Added 1',
          },
          'GET /sessions/:id': session({ id: 4, status: 'running' }),
        },
      });
      await user.click(screen.getByRole('button', { name: 'Start session' }));

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
    });

    it('asks whether to rotate, start anyway or leave it, when the exit IP is shared', async () => {
      const { user, api } = setup(session({ id: 4, status: 'stopped' }), {
        routes: {
          'POST /sessions/:id/start': failure(409, 'ip_in_use', 'x', {
            exitIp: '203.0.113.7',
            sessions: [{ id: 2, name: 'Shop', status: 'running' }],
          }),
          'POST /sessions/:id/rotate': session({
            id: 4,
            activity: 'assigning_proxy',
          }),
          'GET /sessions/:id': session({ id: 4, activity: 'assigning_proxy' }),
        },
      });
      await user.click(screen.getByRole('button', { name: 'Start session' }));

      const dialog = await screen.findByRole('dialog', {
        name: 'Same exit IP as another session',
      });
      expect(
        within(dialog)
          .getAllByRole('button')
          .map((button) => button.textContent)
          .filter((text) =>
            ['Cancel', 'Start anyway', 'Rotate IP'].includes(text ?? ''),
          ),
      ).toEqual(['Cancel', 'Start anyway', 'Rotate IP']);
      await user.click(
        within(dialog).getByRole('button', { name: 'Rotate IP' }),
      );

      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/rotate')).toHaveLength(1),
      );
    });

    it('asks whether to give the session another proxy when its own does not work, and tells no toast', async () => {
      const { user, api } = setup(
        session({ id: 4, name: 'Shop', status: 'stopped' }),
        {
          routes: {
            'POST /sessions/:id/start': failure(502, 'proxy_unreachable', 'x', {
              proxyId: 3,
              reason: 'connection refused',
            }),
            'POST /sessions/:id/rotate': session({
              id: 4,
              activity: 'assigning_proxy',
            }),
            'GET /sessions/:id': session({
              id: 4,
              activity: 'assigning_proxy',
            }),
          },
        },
      );
      await user.click(screen.getByRole('button', { name: 'Start session' }));

      const dialog = await screen.findByRole('dialog', {
        name: 'The proxy of "Shop" isn\'t working',
      });
      expect(
        screen.getByRole('list', { name: 'Notices', hidden: true }),
      ).toBeEmptyDOMElement();
      await user.click(
        within(dialog).getByRole('button', { name: 'Rotate IP' }),
      );

      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/rotate')).toHaveLength(1),
      );
    });

    it('tells any other refusal of a start once, as a toast, without a dialog', async () => {
      const { user } = setup(session({ id: 4, status: 'stopped' }), {
        routes: { 'POST /sessions/:id/start': failure(409, 'session_busy') },
      });
      await user.click(screen.getByRole('button', { name: 'Start session' }));

      const notices = screen.getByRole('list', { name: 'Notices' });
      await waitFor(() =>
        expect(within(notices).getAllByRole('listitem')).toHaveLength(1),
      );
      expect(notices).toHaveTextContent("Couldn't start the session");
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('stops the session', async () => {
      const { user, api } = setup(runningSession({ id: 4 }), {
        routes: {
          'POST /sessions/:id/stop': session({ id: 4, status: 'stopping' }),
        },
      });
      await user.click(screen.getByRole('button', { name: 'Stop session' }));
      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/stop')).toHaveLength(1),
      );
    });

    it('tells a failed stop once', async () => {
      const { user } = setup(runningSession({ id: 4 }), {
        routes: { 'POST /sessions/:id/stop': failure(409, 'session_busy') },
      });
      await user.click(screen.getByRole('button', { name: 'Stop session' }));
      const notices = screen.getByRole('list', { name: 'Notices' });
      await waitFor(() =>
        expect(within(notices).getAllByRole('listitem')).toHaveLength(1),
      );
      expect(notices).toHaveTextContent("Couldn't stop the session");
    });
  });

  it('leaves the page when the menu says the session was deleted', async () => {
    const { user, onDeleted } = setup(runningSession({ name: 'Shop' }));
    await user.click(screen.getByRole('button', { name: 'Menu of Shop' }));
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  describe('accessibility', () => {
    it.each([
      ['while it runs', runningSession(), false],
      [
        'while it is out of step with its IP',
        runningSession({
          location: { ...runningSession().location!, inSync: false },
        }),
        false,
      ],
      ['while it is stopped', session({ status: 'stopped' }), false],
      ['while it is read', undefined, false],
      ['when it could not be read', undefined, true],
    ])('has no violations %s', async (_when, shown, failed) => {
      const view = setup(shown, { failed });
      await checkAccessibility(view);
    });
  });
});
