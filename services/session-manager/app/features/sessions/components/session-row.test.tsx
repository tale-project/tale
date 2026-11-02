import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Session } from '@/lib/api/schemas';
import { checkAccessibility } from '@/tests/utils/a11y';
import { errorText } from '@/tests/utils/errors';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { meta, runningSession, session } from '@/tests/utils/fixtures';
import { renderApp } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () =>
  (await import('@/tests/utils/sessions-router')).createSessionsRouterMock(),
);

import { navigate, setOpenPath } from '@/tests/utils/sessions-router';

import { ProxyFlowProvider } from './proxy-flow-provider';
import { SessionRow } from './session-row';

function renderRow(row: Session, { active = false } = {}) {
  return renderApp(
    <ProxyFlowProvider>
      <ul>
        <SessionRow session={row} active={active} />
      </ul>
    </ProxyFlowProvider>,
  );
}

function link(name: RegExp | string = /0001/) {
  return screen.getByRole('link', { name });
}

/**
 * What a screen reader says of a row, as the parts it is made of, in order and
 * each once. jsdom lays nothing out, so the spans of the row run together and
 * no space tells the parts apart: the match is on their order and their count.
 */
function saysInOrder(...parts: string[]): RegExp {
  const literally = (part: string) =>
    part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${parts.map(literally).join('\\s*')}$`);
}

beforeEach(() => {
  navigate.mockClear();
  setOpenPath('/sessions');
  installFakeApi({ 'GET /meta': meta() });
});

describe('SessionRow', () => {
  it('is a real link to the session page, named by the session', () => {
    renderRow(session({ id: 4, name: 'Shop login' }));
    expect(link(/Shop login/)).toHaveAttribute('href', '/sessions/4');
  });

  it('keeps the full name in its title for a name the narrow panel cuts', () => {
    renderRow(session({ name: 'A very long session name that will not fit' }));
    expect(
      screen.getByTitle('A very long session name that will not fit'),
    ).toBeInTheDocument();
  });

  it('marks the open session as the current page', () => {
    renderRow(session(), { active: true });
    expect(link()).toHaveAttribute('aria-current', 'page');
  });

  it('does not mark a session that is not open', () => {
    renderRow(session());
    expect(link()).not.toHaveAttribute('aria-current');
  });

  describe('the second line', () => {
    it('says where a running session exits: its IP and country', () => {
      renderRow(runningSession());
      expect(link()).toHaveTextContent('203.0.113.7 · DE');
    });

    it('says only that it runs when its proxy has not told where it exits', () => {
      renderRow(
        runningSession({
          proxy: {
            id: 1,
            display: 'http://198.51.100.4:8080',
            exitIp: null,
            country: null,
            checkStatus: 'unchecked',
          },
          location: null,
        }),
      );
      expect(link()).toHaveTextContent('Running');
    });

    it('warns that the IP changed while the session still reports the old place', () => {
      const place = runningSession().location;
      renderRow(
        runningSession({
          location: place === null ? null : { ...place, inSync: false },
        }),
      );
      expect(link()).toHaveTextContent('IP changed · restart recommended');
      expect(link()).not.toHaveTextContent('203.0.113.7');
    });

    it.each([
      [session(), 'Stopped'],
      [session({ activity: 'assigning_proxy' }), 'Assigning proxy'],
      [session({ activity: 'launching' }), 'Starting'],
      [session({ status: 'starting' }), 'Starting'],
      [runningSession({ status: 'stopping' }), 'Stopping'],
    ])('says the state of %# in words', (row, words) => {
      renderRow(row);
      expect(link()).toHaveTextContent(words);
    });

    it('words a failure the app knows from its code, in the language of the person', () => {
      renderRow(
        session({
          status: 'error',
          errorCode: 'no_working_proxy',
          error: 'No working proxy available.',
        }),
      );
      expect(link()).toHaveTextContent(errorText('no_working_proxy'));
    });

    it('shows the first line of what a failure with an unknown code says', () => {
      renderRow(
        session({
          status: 'error',
          errorCode: 'something_new',
          error: 'The browser crashed.\n  at launch (browser.ts:12)',
        }),
      );
      expect(link()).toHaveTextContent('The browser crashed.');
      expect(link()).not.toHaveTextContent('browser.ts');
    });

    it('shows the first line of a failure that has no code', () => {
      renderRow(session({ status: 'error', error: 'Disk full' }));
      expect(link()).toHaveTextContent('Disk full');
    });

    it('says "Error" for a failure that has no words at all', () => {
      renderRow(session({ status: 'error' }));
      expect(link()).toHaveTextContent('Error');
    });

    it('keeps the whole of a failure in the title of the line, which the row shows on one line', () => {
      const text = errorText('no_working_proxy');
      renderRow(
        session({
          status: 'error',
          errorCode: 'no_working_proxy',
          error: 'No working proxy available.',
        }),
      );
      expect(screen.getByTitle(text)).toHaveTextContent(text);
    });

    it('says what failed on a stopped session whose last proxy change failed, and that it is stopped', () => {
      renderRow(
        session({
          name: 'Shop',
          status: 'stopped',
          errorCode: 'no_working_proxy',
          errorExtra: { failed: 3 },
          error: 'No working proxy available (3 failed their check).',
        }),
      );
      expect(link(/Shop/)).toHaveAccessibleName(
        saysInOrder(
          'Shop',
          'Stopped',
          errorText('no_working_proxy', { failed: 3 }),
        ),
      );
    });
  });

  // The dot is only a colour. The name is the session's, then its state in
  // words, told once: by the line under the name when that line is only the
  // state, else by a word between the two that only a screen reader hears.
  describe('its accessible name', () => {
    const cause = errorText('no_working_proxy', { failed: 3 });
    const place = runningSession().location;
    const failed = {
      errorCode: 'no_working_proxy',
      errorExtra: { failed: 3 },
      error: 'No working proxy available (3 failed their check).',
    };

    it.each<[string, Session, string[]]>([
      ['stopped', session({ name: 'Trip' }), ['Trip', 'Stopped']],
      [
        'assigning a proxy',
        session({ name: 'Trip', activity: 'assigning_proxy' }),
        ['Trip', 'Assigning proxy'],
      ],
      [
        'starting',
        session({ name: 'Trip', status: 'starting' }),
        ['Trip', 'Starting'],
      ],
      [
        'stopping',
        runningSession({ name: 'Trip', status: 'stopping' }),
        ['Trip', 'Stopping'],
      ],
      [
        'running, where it exits',
        runningSession({ name: 'Trip' }),
        ['Trip', 'Running', '203.0.113.7 · DE'],
      ],
      [
        'running, no place known',
        runningSession({
          name: 'Trip',
          proxy: {
            id: 1,
            display: 'http://198.51.100.4:8080',
            exitIp: null,
            country: null,
            checkStatus: 'unchecked',
          },
          location: null,
        }),
        ['Trip', 'Running'],
      ],
      [
        'running, its IP changed',
        runningSession({
          name: 'Trip',
          location: place === null ? null : { ...place, inSync: false },
        }),
        ['Trip', 'Running', 'IP changed · restart recommended'],
      ],
      [
        'failed, with its cause',
        session({ name: 'Trip', status: 'error', ...failed }),
        ['Trip', 'Error', cause],
      ],
      [
        'failed, without a cause',
        session({ name: 'Trip', status: 'error' }),
        ['Trip', 'Error'],
      ],
      [
        'stopped after a failed proxy change',
        session({ name: 'Trip', status: 'stopped', ...failed }),
        ['Trip', 'Stopped', cause],
      ],
    ])('says %s once, after the name', (_state, row, parts) => {
      renderRow(row);
      expect(screen.getByRole('link')).toHaveAccessibleName(
        saysInOrder(...parts),
      );
    });
  });

  describe('its buttons', () => {
    it('start a stopped session, named by it', async () => {
      const api = installFakeApi({
        'GET /meta': meta(),
        'POST /sessions/:id/start': session({ id: 1, status: 'starting' }),
      });
      const { user } = renderRow(session());

      await user.click(screen.getByRole('button', { name: 'Start 0001' }));

      await waitFor(() => expect(navigate).toHaveBeenCalled());
      expect(api.callsTo('POST /sessions/:id/start')[0]?.body).toEqual({
        force: false,
      });
    });

    it('stop a running session, named by it', async () => {
      const api = installFakeApi({
        'GET /meta': meta(),
        'POST /sessions/:id/stop': session({ id: 1, status: 'stopping' }),
      });
      const { user } = renderRow(runningSession());

      await user.click(screen.getByRole('button', { name: 'Stop 0001' }));

      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/stop')).toHaveLength(1),
      );
      expect(navigate).not.toHaveBeenCalled();
    });

    it('offer Stop to a session that is starting, which cancels its start', () => {
      renderRow(session({ status: 'starting' }));
      expect(screen.getByRole('button', { name: 'Stop 0001' })).toBeEnabled();
    });

    it('offer Start again to a session that failed', () => {
      renderRow(session({ status: 'error', error: 'x' }));
      expect(screen.getByRole('button', { name: 'Start 0001' })).toBeEnabled();
    });

    it('cannot stop a session that is already stopping, and say why', async () => {
      const { user } = renderRow(runningSession({ status: 'stopping' }));
      const button = screen.getByRole('button', { name: 'Stop 0001' });
      expect(button).toHaveAttribute('aria-disabled', 'true');

      await user.tab();
      await user.tab();
      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        'The session is already stopping.',
      );
    });

    it('cannot start a session that is busy, and say why', async () => {
      const { user } = renderRow(session({ activity: 'assigning_proxy' }));
      const button = screen.getByRole('button', { name: 'Start 0001' });
      expect(button).toHaveAttribute('aria-disabled', 'true');
      await user.click(button);
      expect(navigate).not.toHaveBeenCalled();

      button.focus();
      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        'The session is busy.',
      );
    });

    it('cannot start while the browser is being installed, and say why', async () => {
      installFakeApi({
        'GET /meta': meta({ browserInstalled: false, browserInstalling: true }),
      });
      renderRow(session());
      const button = screen.getByRole('button', { name: 'Start 0001' });
      await waitFor(() =>
        expect(button).toHaveAttribute('aria-disabled', 'true'),
      );
      button.focus();
      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        'The browser is being installed.',
      );
    });

    it('cannot start while the browser is not installed, and say why', async () => {
      installFakeApi({ 'GET /meta': meta({ browserInstalled: false }) });
      renderRow(session());
      const button = screen.getByRole('button', { name: 'Start 0001' });
      await waitFor(() =>
        expect(button).toHaveAttribute('aria-disabled', 'true'),
      );
      button.focus();
      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        "The browser isn't installed yet.",
      );
    });

    it('can still stop a running session while the browser is missing', async () => {
      installFakeApi({ 'GET /meta': meta({ browserInstalled: false }) });
      renderRow(runningSession());
      expect(screen.getByRole('button', { name: 'Stop 0001' })).toBeEnabled();
    });

    it('show the work under way and stay put until it settles', async () => {
      let finish: (() => void) | undefined;
      installFakeApi({
        'GET /meta': meta(),
        'POST /sessions/:id/stop': () =>
          new Promise((resolve) => {
            finish = () => resolve(session({ status: 'stopping' }));
          }),
      });
      const { user } = renderRow(runningSession());
      const button = screen.getByRole('button', { name: 'Stop 0001' });

      await user.click(button);

      await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'));
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveFocus();
      finish?.();
      await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'));
    });

    it('open the actions menu of the session', () => {
      renderRow(session());
      expect(
        screen.getByRole('button', { name: 'Actions for 0001' }),
      ).toBeInTheDocument();
    });
  });

  it('tells a failed start once and does not open the session', async () => {
    installFakeApi({
      'GET /meta': meta(),
      'POST /sessions/:id/start': failure(409, 'session_busy'),
    });
    const { user } = renderRow(session());

    await user.click(screen.getByRole('button', { name: 'Start 0001' }));

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Start 0001' }),
      ).not.toHaveAttribute('aria-busy'),
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each([
    ['stopped', session()],
    ['running', runningSession()],
    [
      'out of step',
      (() => {
        const place = runningSession().location;
        return runningSession({
          location: place === null ? null : { ...place, inSync: false },
        });
      })(),
    ],
    ['failed', session({ status: 'error', errorCode: 'no_proxy' })],
    ['open', session()],
  ])('has no accessibility violations when %s', async (_state, row) => {
    const view = renderRow(row, { active: _state === 'open' });
    await checkAccessibility(view);
  });
});
