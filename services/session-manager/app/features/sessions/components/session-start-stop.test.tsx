import { Toaster } from '@tale/ui/toaster';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POLL_FAST_MS } from '@/app/lib/polling';
import type { Session } from '@/lib/api/schemas';
import { checkAccessibility } from '@/tests/utils/a11y';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { meta, proxy, runningSession, session } from '@/tests/utils/fixtures';
import { renderApp } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () =>
  (await import('@/tests/utils/sessions-router')).createSessionsRouterMock(),
);

import { errorText } from '@/tests/utils/errors';
import { navigate } from '@/tests/utils/sessions-router';
import { ToastList, shownToasts } from '@/tests/utils/toast-list';

import { ProxyFlowProvider } from './proxy-flow-provider';
import { SessionStartStop } from './session-start-stop';

function renderButton(row = session()) {
  return renderApp(
    <ProxyFlowProvider>
      <SessionStartStop session={row} />
      <ToastList />
      <Toaster />
    </ProxyFlowProvider>,
  );
}

/** The answers of the server, one after the other; the last one stays. */
function sequence<Answers extends unknown[]>(...answers: Answers) {
  let next = 0;
  return (): Answers[number] => answers[Math.min(next++, answers.length - 1)];
}

const SHARED = {
  exitIp: '203.0.113.7',
  sessions: [
    { id: 2, name: 'Shop', status: 'running' },
    { id: 3, name: 'Bank', status: 'running' },
  ],
};

beforeEach(() => {
  navigate.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SessionStartStop', () => {
  it('starts the session and opens it, so its start can be watched', async () => {
    const api = installFakeApi({
      'GET /meta': meta(),
      'POST /sessions/:id/start': session({ status: 'starting' }),
    });
    const { user } = renderButton();

    await user.click(screen.getByRole('button', { name: 'Start 0001' }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/sessions/$sessionId',
        params: { sessionId: '1' },
      }),
    );
    expect(api.callsTo('POST /sessions/:id/start')[0]?.body).toEqual({
      force: false,
    });
  });

  it('tells a refusal once, as a toast, and stays where it is', async () => {
    installFakeApi({
      'GET /meta': meta(),
      'POST /sessions/:id/start': failure(409, 'session_busy'),
    });
    const { user } = renderButton();

    await user.click(screen.getByRole('button', { name: 'Start 0001' }));

    await waitFor(() => expect(shownToasts()).toHaveLength(1));
    expect(shownToasts()[0]).toEqual({
      title: "Couldn't start the session",
      description: errorText('session_busy'),
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says it is starting, and cannot be pressed again, while the request is under way', async () => {
    let answer: (value: Session) => void = () => {};
    installFakeApi({
      'GET /meta': meta(),
      'POST /sessions/:id/start': () =>
        new Promise<Session>((resolve) => {
          answer = resolve;
        }),
      'GET /sessions/:id': session({ status: 'running' }),
    });
    const { user } = renderButton();

    await user.click(screen.getByRole('button', { name: 'Start 0001' }));

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Start 0001' }),
      ).toHaveAttribute('aria-busy', 'true'),
    );
    expect(screen.getByRole('button', { name: 'Start 0001' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    answer(session({ status: 'starting' }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
  });

  it('stops a running session and tells a failure once', async () => {
    installFakeApi({
      'GET /meta': meta(),
      'POST /sessions/:id/stop': failure(409, 'session_busy'),
    });
    const { user } = renderButton(runningSession());

    await user.click(screen.getByRole('button', { name: 'Stop 0001' }));

    await waitFor(() => expect(shownToasts()).toHaveLength(1));
    expect(shownToasts()[0]?.title).toBe("Couldn't stop the session");
  });

  describe('when another running session has the same exit IP', () => {
    function refuseThenAllow() {
      return installFakeApi({
        'GET /meta': meta(),
        'POST /sessions/:id/start': (request) =>
          typeof request.body === 'object' &&
          request.body !== null &&
          'force' in request.body &&
          request.body.force === true
            ? session({ status: 'starting' })
            : failure(409, 'ip_in_use', 'x', SHARED),
      });
    }

    it('asks first, naming the exit IP and the sessions that use it', async () => {
      refuseThenAllow();
      const { user } = renderButton();

      await user.click(screen.getByRole('button', { name: 'Start 0001' }));

      const dialog = await screen.findByRole('dialog', {
        name: 'Same exit IP as another session',
      });
      expect(dialog).toHaveTextContent(
        'The running sessions "Shop" and "Bank" already use the exit IP 203.0.113.7.',
      );
      expect(dialog).toHaveTextContent(
        'If the session "0001" starts with the same exit IP too, websites can tell that these sessions belong together.',
      );
      expect(navigate).not.toHaveBeenCalled();
      expect(shownToasts()).toEqual([]);
    });

    it('starts anyway when asked to, and opens the session', async () => {
      const api = refuseThenAllow();
      const { user } = renderButton();
      await user.click(screen.getByRole('button', { name: 'Start 0001' }));
      const dialog = await screen.findByRole('dialog');

      await user.click(
        within(dialog).getByRole('button', { name: 'Start anyway' }),
      );

      await waitFor(() => expect(navigate).toHaveBeenCalled());
      expect(
        api.callsTo('POST /sessions/:id/start').map((call) => call.body),
      ).toEqual([{ force: false }, { force: true }]);
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
    });

    it('leaves the session stopped when the person cancels', async () => {
      const api = refuseThenAllow();
      const { user } = renderButton();
      await user.click(screen.getByRole('button', { name: 'Start 0001' }));
      const dialog = await screen.findByRole('dialog');

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(1);
      expect(navigate).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Start 0001' })).toHaveFocus();
    });

    it('gives the session another proxy first, and starts it once it has one, on Rotate IP', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const api = installFakeApi({
        'GET /meta': meta(),
        'POST /sessions/:id/start': sequence(
          failure(409, 'ip_in_use', 'x', SHARED),
          session({ status: 'starting', activity: 'launching' }),
        ),
        'POST /sessions/:id/rotate': session({ activity: 'assigning_proxy' }),
        'GET /sessions/:id': sequence(
          session({ activity: 'assigning_proxy' }),
          session(),
          session({ status: 'running' }),
        ),
      });
      const { user } = renderButton();
      await user.click(screen.getByRole('button', { name: 'Start 0001' }));
      const dialog = await screen.findByRole('dialog');

      await user.click(
        within(dialog).getByRole('button', { name: 'Rotate IP' }),
      );

      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/rotate')).toHaveLength(1),
      );
      expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(1);
      await act(() => vi.advanceTimersByTimeAsync(POLL_FAST_MS));
      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(2),
      );
      await waitFor(() => expect(navigate).toHaveBeenCalled());
      expect(shownToasts()).toEqual([]);
    });

    it('can be answered with the keyboard alone', async () => {
      const api = refuseThenAllow();
      const { user } = renderButton();
      screen.getByRole('button', { name: 'Start 0001' }).focus();
      await user.keyboard('{Enter}');
      await screen.findByRole('dialog');

      await user.keyboard('{Escape}');

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Start 0001' })).toHaveFocus();
    });

    it('words the refusal in general terms when the backend named no one', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'POST /sessions/:id/start': failure(409, 'ip_in_use'),
      });
      const { user } = renderButton();

      await user.click(screen.getByRole('button', { name: 'Start 0001' }));

      expect(await screen.findByRole('dialog')).toHaveTextContent(
        'Another running session already uses this exit IP.',
      );
    });

    it('has no accessibility violations', async () => {
      refuseThenAllow();
      const { user } = renderButton();
      await user.click(screen.getByRole('button', { name: 'Start 0001' }));
      await screen.findByRole('dialog');
      await checkAccessibility(document.body);
    });
  });

  describe('when no proxy is free', () => {
    it('asks for proxies right there, and starts the session by itself once there are some', async () => {
      const api = installFakeApi({
        'GET /meta': meta(),
        'POST /sessions/:id/start': sequence(
          failure(409, 'no_free_proxy'),
          session({ status: 'starting', activity: 'launching' }),
        ),
        'POST /proxies/import': {
          added: [proxy({ id: 5 })],
          duplicates: [],
          errors: [],
          summary: 'Added 1',
        },
        'GET /sessions/:id': session({ status: 'running' }),
      });
      const { user } = renderButton();

      await user.click(screen.getByRole('button', { name: 'Start 0001' }));

      const dialog = await screen.findByRole('dialog', {
        name: 'No free proxy available',
      });
      expect(dialog).toHaveTextContent(
        'Every session needs a proxy of its own, and none is free right now. Add proxies and the session will start automatically.',
      );
      expect(shownToasts()).toEqual([]);
      await checkAccessibility(document.body);

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
      await waitFor(() => expect(navigate).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
    });

    it('can be given up, and the focus returns to the button', async () => {
      const api = installFakeApi({
        'GET /meta': meta(),
        'POST /sessions/:id/start': failure(409, 'no_free_proxy'),
      });
      const { user } = renderButton();
      await user.click(screen.getByRole('button', { name: 'Start 0001' }));
      const dialog = await screen.findByRole('dialog');

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(1);
      expect(shownToasts()).toEqual([]);
      expect(navigate).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Start 0001' })).toHaveFocus();
    });
  });

  describe('when its own proxy does not work', () => {
    const MESSAGE =
      'The proxy of session 0001 (http://198.51.100.4:8080) is not working: connection refused.';
    const EXTRA = { proxyId: 3, reason: 'connection refused' };
    const refusal = failure(502, 'proxy_unreachable', MESSAGE, EXTRA);

    it('asks, in the words of the app, whether to give the session another proxy, and tells no toast', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'POST /sessions/:id/start': refusal,
      });
      const { user } = renderButton();

      await user.click(screen.getByRole('button', { name: 'Start 0001' }));

      const dialog = await screen.findByRole('dialog', {
        name: 'The proxy of "0001" isn\'t working',
      });
      expect(dialog).toHaveTextContent(
        'The last check failed: connection refused.',
      );
      expect(dialog).toHaveTextContent(
        'Rotate IP switches the session "0001" to another working proxy and starts it.',
      );
      expect(shownToasts()).toEqual([]);
      expect(navigate).not.toHaveBeenCalled();
      await checkAccessibility(document.body);
    });

    it('rotates the proxy, and starts the session afterwards, on Rotate IP', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const api = installFakeApi({
        'GET /meta': meta(),
        'POST /sessions/:id/start': sequence(
          refusal,
          session({ status: 'starting', activity: 'launching' }),
        ),
        'POST /sessions/:id/rotate': session({ activity: 'assigning_proxy' }),
        'GET /sessions/:id': sequence(
          session({ activity: 'assigning_proxy' }),
          session(),
        ),
      });
      const { user } = renderButton();
      await user.click(screen.getByRole('button', { name: 'Start 0001' }));
      const dialog = await screen.findByRole('dialog');

      await user.click(
        within(dialog).getByRole('button', { name: 'Rotate IP' }),
      );
      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/rotate')).toHaveLength(1),
      );
      await act(() => vi.advanceTimersByTimeAsync(POLL_FAST_MS));

      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(2),
      );
      await waitFor(() => expect(navigate).toHaveBeenCalled());
    });

    it('leaves the session as it is on Cancel, and the focus returns to the button', async () => {
      const api = installFakeApi({
        'GET /meta': meta(),
        'POST /sessions/:id/start': refusal,
      });
      const { user } = renderButton();
      await user.click(screen.getByRole('button', { name: 'Start 0001' }));
      const dialog = await screen.findByRole('dialog');

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(api.callsTo('POST /sessions/:id/rotate')).toHaveLength(0);
      expect(screen.getByRole('button', { name: 'Start 0001' })).toHaveFocus();
    });
  });
});
