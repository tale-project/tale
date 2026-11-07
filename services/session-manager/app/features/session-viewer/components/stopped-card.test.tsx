import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProxyFlowProvider } from '@/app/features/sessions/components/proxy-flow-provider';
import { POLL_FAST_MS } from '@/app/lib/polling';
import type { Session } from '@/lib/api/schemas';
import { checkAccessibility } from '@/tests/utils/a11y';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { meta, proxy, session } from '@/tests/utils/fixtures';
import { renderApp } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub('/sessions/1');
});

import { Notices } from '@/tests/utils/notices';

import { StoppedCard } from './stopped-card';

function setup(
  overrides: Partial<Session> = {},
  routes: Parameters<typeof installFakeApi>[0] = {},
) {
  const api = installFakeApi({ 'GET /meta': meta(), ...routes });
  const view = renderApp(
    <ProxyFlowProvider>
      <StoppedCard session={session(overrides)} />
      <Notices />
    </ProxyFlowProvider>,
  );
  return { ...view, api };
}

/** The answers of a route, one after the other; the last one stays. */
function sequence<Answers extends unknown[]>(...answers: Answers) {
  let next = 0;
  return (): Answers[number] => answers[Math.min(next++, answers.length - 1)];
}

const imported = {
  added: [proxy({ id: 5 })],
  duplicates: [],
  errors: [],
  summary: 'Added 1',
};

afterEach(() => {
  vi.useRealTimers();
});

describe('StoppedCard', () => {
  // The page's header names the session and its state: the card does not say
  // them a second time.
  it('lists the details of the session, and does not repeat its name or its state', () => {
    setup({ name: 'Shop' });
    expect(
      screen.getByRole('heading', { level: 2, name: 'Session details' }),
    ).toBeVisible();
    expect(screen.getByText('Operating system')).toBeVisible();
    expect(screen.getByText('Windows')).toBeVisible();
    expect(screen.getByText('Assigned when the session starts')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Shop' })).toBeNull();
    expect(screen.queryByText('Shop')).toBeNull();
    expect(screen.queryByText('Stopped')).toBeNull();
  });

  // A person who pressed Start hears what became of it only if the region that
  // says so was in the page before it did.
  describe('the status region', () => {
    it('is in the page while nothing is under way, with nothing in it', () => {
      setup();
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });

    it('holds the failure of a session that could not start, to be read out', () => {
      setup({ status: 'error', error: 'It went wrong', errorCode: null });
      expect(screen.getByRole('status')).toHaveTextContent('It went wrong');
    });

    it('holds the words of the work that is under way', () => {
      setup({ status: 'starting', activity: 'launching' });
      expect(screen.getByRole('status')).toHaveTextContent('Starting');
    });
  });

  describe('what starting it does', () => {
    const started = '2026-11-01T11:00:00+00:00';
    const hint =
      'Starting the session reopens the tabs it had when it was stopped.';

    it('is said under the details of a session that has run and is stopped', () => {
      setup({ lastStartedAt: started });
      expect(screen.getByText(hint)).toBeVisible();
    });

    it.each([
      ['never started', {}],
      ['failed', { status: 'error', error: 'x', lastStartedAt: started }],
      [
        'starting',
        { status: 'starting', activity: 'launching', lastStartedAt: started },
      ],
      ['stopping', { status: 'stopping', lastStartedAt: started }],
    ] as const)('is not said for a session that is %s', (_name, overrides) => {
      setup(overrides);
      expect(screen.queryByText(hint)).toBeNull();
    });
  });

  it.each([
    ['stopped', {}],
    ['failed', { status: 'error', error: 'x', errorCode: 'launch_failed' }],
    [
      'failed for want of a working proxy',
      { status: 'error', error: 'x', errorCode: 'no_working_proxy' },
    ],
  ] as const)(
    'has no Start of its own when %s: the Start of the page header is the only one',
    (_name, overrides) => {
      setup(overrides);
      expect(screen.queryByRole('button', { name: /^Start/ })).toBeNull();
    },
  );

  it.each([
    ['starting', { status: 'starting', activity: 'launching' }, 'Starting'],
    [
      'assigning a proxy',
      { status: 'stopped', activity: 'assigning_proxy' },
      'Assigning proxy',
    ],
    ['stopping', { status: 'stopping' }, 'Stopping'],
  ] as const)(
    'shows work that is under way while %s, with nothing to press',
    (_name, overrides, words) => {
      setup(overrides);
      expect(screen.getByRole('status')).toHaveTextContent(words);
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByText(/reopens the tabs/)).toBeNull();
    },
  );

  describe('a session that could not start', () => {
    it('says why, in the words of the app when it has them', () => {
      setup({
        status: 'error',
        error: 'The proxy did not answer',
        errorCode: 'proxy_unreachable',
      });
      expect(
        screen.getByText(
          "This session's proxy isn't working. Choose Rotate IP to give the session another proxy.",
        ),
      ).toBeVisible();
      expect(screen.queryByText('The proxy did not answer')).toBeNull();
    });

    it('says the reason as the server said it when the app has no words for its code', () => {
      setup({
        status: 'error',
        error: 'Camoufox exited with code 1',
        errorCode: 'launch_failed',
      });
      expect(screen.getByText('Camoufox exited with code 1')).toBeVisible();
    });

    it('says the reason as the server said it when there is no code', () => {
      setup({ status: 'error', error: 'It went wrong', errorCode: null });
      expect(screen.getByText('It went wrong')).toBeVisible();
    });

    it('still says that it failed when the session has no reason to give', () => {
      setup({ status: 'error', error: null, errorCode: null });
      expect(screen.getByText('Start failed')).toBeVisible();
    });

    it('offers another proxy when the trouble is the proxy', async () => {
      const { user, api } = setup(
        { status: 'error', error: 'x', errorCode: 'proxy_unreachable' },
        {
          'POST /sessions/:id/rotate': session({ activity: 'assigning_proxy' }),
        },
      );
      const rotate = screen.getByRole('button', { name: 'Rotate IP' });
      await user.click(rotate);
      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/rotate')).toHaveLength(1),
      );
    });

    it('gives the session another proxy, and then starts it: that is why it was pressed', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { user, api } = setup(
        { status: 'error', error: 'x', errorCode: 'proxy_unreachable' },
        {
          'POST /sessions/:id/rotate': session({ activity: 'assigning_proxy' }),
          'POST /sessions/:id/start': session({
            status: 'starting',
            activity: 'launching',
          }),
          'GET /sessions/:id': sequence(
            session({ activity: 'assigning_proxy' }),
            session(),
          ),
        },
      );

      await user.click(screen.getByRole('button', { name: 'Rotate IP' }));
      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/rotate')).toHaveLength(1),
      );
      // The proxy is being assigned: the start waits for it.
      expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(0);
      await act(() => vi.advanceTimersByTimeAsync(POLL_FAST_MS));

      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(1),
      );
    });

    it('says it is rotating while the request is under way', async () => {
      let answer: (value: Session) => void = () => {};
      const { user } = setup(
        { status: 'error', error: 'x', errorCode: 'proxy_unreachable' },
        {
          'POST /sessions/:id/rotate': () =>
            new Promise<Session>((resolve) => {
              answer = resolve;
            }),
          'GET /sessions/:id': session({ activity: 'assigning_proxy' }),
        },
      );

      await user.click(screen.getByRole('button', { name: 'Rotate IP' }));

      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Rotate IP' }),
        ).toHaveAttribute('aria-busy', 'true'),
      );
      answer(session({ activity: 'assigning_proxy' }));
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Rotate IP' }),
        ).not.toHaveAttribute('aria-busy'),
      );
    });

    it('asks for proxies when there is no free proxy to rotate to', async () => {
      const { user } = setup(
        { status: 'error', error: 'x', errorCode: 'unknown_ip_location' },
        { 'POST /sessions/:id/rotate': failure(409, 'no_free_proxy') },
      );
      await user.click(screen.getByRole('button', { name: 'Rotate IP' }));
      const dialog = await screen.findByRole('dialog', {
        name: 'No free proxy available',
      });
      expect(dialog).toHaveTextContent(
        'Add proxies and the session will switch to one of them automatically.',
      );
    });

    it.each(['no_working_proxy', 'no_free_proxy'])(
      'offers to add proxies right there when the code is %s',
      (code) => {
        setup({ status: 'error', error: 'x', errorCode: code, proxy: null });
        expect(
          screen.getByRole('button', { name: 'Add proxies' }),
        ).toBeEnabled();
        expect(screen.queryByRole('link', { name: 'Add proxies' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Rotate IP' })).toBeNull();
      },
    );

    it('asks for proxies in a dialog, and starts the session once they are added', async () => {
      const { user, api } = setup(
        {
          name: 'Shop',
          status: 'error',
          error: 'x',
          errorCode: 'no_working_proxy',
          proxy: null,
        },
        {
          'GET /meta': meta({ counts: { proxies: 2, failedProxies: 2 } }),
          'POST /proxies/import': imported,
          'POST /sessions/:id/start': session({
            status: 'starting',
            activity: 'assigning_proxy',
          }),
          'GET /sessions/:id': session({ status: 'running' }),
        },
      );

      await user.click(screen.getByRole('button', { name: 'Add proxies' }));

      const dialog = await screen.findByRole('dialog', {
        name: 'No working proxy available',
      });
      await waitFor(() =>
        expect(dialog).toHaveTextContent('2 proxies failed their check.'),
      );
      expect(dialog).toHaveTextContent(
        'Once you add proxies, the session "Shop" gets one of them automatically.',
      );
      await user.click(
        within(dialog).getByRole('textbox', { name: 'Proxies, one per line' }),
      );
      await user.paste('198.51.100.9:8080');
      await user.click(
        within(dialog).getByRole('button', { name: 'Add proxies' }),
      );

      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(1),
      );
    });

    it('leaves the session as it was when the dialog is given up', async () => {
      const { user, api } = setup(
        {
          status: 'error',
          error: 'x',
          errorCode: 'no_working_proxy',
          proxy: null,
        },
        { 'GET /meta': meta() },
      );
      await user.click(screen.getByRole('button', { name: 'Add proxies' }));
      const dialog = await screen.findByRole('dialog');

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(0);
      expect(screen.getByRole('button', { name: 'Add proxies' })).toHaveFocus();
    });

    it('offers nothing to press for another trouble: the page header starts the session', () => {
      setup({ status: 'error', error: 'x', errorCode: 'launch_failed' });
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByRole('link')).toBeNull();
    });
  });

  it('speaks German', async () => {
    const { LOCALE_STORAGE_KEY } = await import('@tale/ui/i18n/detect-locale');
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    try {
      setup({
        status: 'error',
        error: 'x',
        errorCode: 'proxy_unreachable',
        lastStartedAt: '2026-11-01T11:00:00+00:00',
      });
      expect(
        await screen.findByRole('heading', { name: 'Sitzungsdetails' }),
      ).toBeVisible();
      expect(screen.getByRole('button', { name: 'IP wechseln' })).toBeVisible();
      expect(screen.getByText('Bildschirm')).toBeVisible();
    } finally {
      localStorage.removeItem(LOCALE_STORAGE_KEY);
    }
  });

  it.each([
    ['stopped', {}],
    ['starting', { status: 'starting', activity: 'launching' }],
    [
      'failed with a proxy error',
      { status: 'error', error: 'x', errorCode: 'proxy_unreachable' },
    ],
    [
      'failed for want of proxies',
      { status: 'error', error: 'x', errorCode: 'no_working_proxy' },
    ],
  ] as const)(
    'has no accessibility violations: %s',
    async (_name, overrides) => {
      const view = setup(overrides);
      await checkAccessibility(view);
    },
  );
});
