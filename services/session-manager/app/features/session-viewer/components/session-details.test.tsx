import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Session } from '@/lib/api/schemas';
import { checkAccessibility } from '@/tests/utils/a11y';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { runningSession, session } from '@/tests/utils/fixtures';
import { resetLanguage, showLanguage } from '@/tests/utils/language';
import { renderApp } from '@/tests/utils/render';
import { ToastList, shownToasts } from '@/tests/utils/toast-list';

import { SessionDetails } from './session-details';

afterEach(resetLanguage);

const moved = runningSession({
  id: 3,
  name: 'Shop',
  proxy: {
    id: 1,
    display: 'http://198.51.100.4:8080',
    exitIp: '203.0.113.99',
    country: 'FR',
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
});

function show(
  shown: Session,
  actions?: Parameters<typeof SessionDetails>[0]['actions'],
) {
  return renderApp(
    <>
      <SessionDetails session={shown} actions={actions} />
      <ToastList />
    </>,
  );
}

/** The value beside a label, read as a person reads the list. */
function valueOf(label: string): string {
  const row = screen.getByText(label).closest('div');
  return row?.textContent?.replace(label, '').trim() ?? '';
}

describe('SessionDetails', () => {
  describe('a session that has not started yet', () => {
    it('lists what the session is, and says that a proxy comes when it starts', () => {
      show(session());
      expect(valueOf('Operating system')).toBe('Windows');
      expect(valueOf('Screen')).toBe('1920×1080');
      expect(valueOf('Exit IP')).toBe('Assigned when the session starts');
    });

    it('has no language, time zone or location to list before it has them', () => {
      show(session());
      expect(screen.queryByText('Language')).toBeNull();
      expect(screen.queryByText('Time zone')).toBeNull();
      expect(screen.queryByText('Location')).toBeNull();
      expect(screen.queryByText(/are taken from/)).toBeNull();
    });
  });

  describe('a session that has run', () => {
    it('lists its language, time zone and location, and the IP its proxy exits through', () => {
      show(runningSession({ os: 'macos' }));
      expect(valueOf('Operating system')).toBe('macOS');
      expect(valueOf('Language')).toBe('de-DE');
      expect(valueOf('Time zone')).toBe('Europe/Berlin');
      expect(valueOf('Location')).toBe('52.520 / 13.405');
      expect(valueOf('Exit IP')).toContain('203.0.113.7 · DE');
    });

    it('says whose place it is: the exit IP of the proxy when the session started', () => {
      show(runningSession());
      expect(
        screen.getByText(
          "The language, time zone and location are taken from 203.0.113.7, the proxy's exit IP when the session started.",
        ),
      ).toBeVisible();
    });

    it('says that the exit IP of a proxy has not been checked yet', () => {
      show(
        session({
          proxy: {
            id: 1,
            display: 'http://198.51.100.4:8080',
            exitIp: null,
            country: null,
            checkStatus: 'unchecked',
          },
        }),
      );
      expect(valueOf('Exit IP')).toBe('Not checked yet');
    });

    it('writes the coordinates in the number format of the language', async () => {
      await showLanguage('de');
      show(runningSession());
      expect(valueOf('Standort')).toBe('52,520 / 13,405');
      expect(valueOf('Ausgangs-IP')).toContain('203.0.113.7 · DE');
      expect(valueOf('System')).toBe('Windows');
    });

    it('speaks French', async () => {
      await showLanguage('fr');
      show(runningSession());
      expect(valueOf('Position')).toBe('52,520 / 13,405');
      expect(valueOf('IP de sortie')).toContain('203.0.113.7 · DE');
    });
  });

  describe('whether the place still matches the exit IP', () => {
    it('says that they match', () => {
      show(runningSession());
      expect(
        screen.getByText("The session's time zone and location match this IP."),
      ).toBeVisible();
    });

    it('says that the proxy exits through another IP now, with that IP in the list', () => {
      show(moved);
      expect(
        screen.getByText('The proxy now exits through another IP.'),
      ).toBeVisible();
      expect(valueOf('Exit IP')).toContain('203.0.113.99 · FR');
    });

    it('says nothing about it when it is not known, or the session does not run', () => {
      show(
        runningSession({
          location: { ...runningSession().location!, inSync: null },
        }),
      );
      expect(screen.queryByText(/match this IP/)).toBeNull();
      expect(screen.queryByText(/another IP now/)).toBeNull();
    });

    it('says nothing about it for a session that does not run', () => {
      show({ ...moved, status: 'stopped' });
      expect(screen.queryByText(/another IP now/)).toBeNull();
    });
  });

  describe('copying the exit IP', () => {
    it('puts the IP on the clipboard, and says so', async () => {
      const { user } = show(runningSession());
      await user.click(screen.getByRole('button', { name: 'Copy exit IP' }));
      expect(await navigator.clipboard.readText()).toBe('203.0.113.7');
      expect(await screen.findByText('Copied')).toBeInTheDocument();
    });

    it('is not there while there is no IP to copy', () => {
      show(session());
      expect(screen.queryByRole('button', { name: 'Copy exit IP' })).toBeNull();
    });
  });

  describe('what can be done about it', () => {
    it('offers nothing unless it is asked to', () => {
      show(moved);
      expect(screen.queryByRole('button', { name: 'Check IP' })).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Restart session' }),
      ).toBeNull();
    });

    it('looks at the proxy again, and says what it found', async () => {
      const api = installFakeApi({
        'POST /sessions/:id/check-ip': runningSession({ id: 4 }),
      });
      const { user } = show(runningSession({ id: 4 }), {
        onRestart: vi.fn(),
      });
      await user.click(screen.getByRole('button', { name: 'Check IP' }));
      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/check-ip')).toHaveLength(1),
      );
      await waitFor(() => expect(shownToasts()).toHaveLength(1));
      expect(shownToasts()[0]).toEqual({
        title: 'Exit IP unchanged',
        description:
          'The proxy still exits through 203.0.113.7. The time zone and location still match.',
      });
    });

    it('keeps the keyboard on the button while the proxy is looked at', async () => {
      let answer: (value: Session) => void = () => {};
      installFakeApi({
        'POST /sessions/:id/check-ip': () =>
          new Promise<Session>((resolve) => {
            answer = resolve;
          }),
      });
      const { user } = show(runningSession({ id: 4 }), { onRestart: vi.fn() });
      const check = screen.getByRole('button', { name: 'Check IP' });
      check.focus();
      await user.keyboard('{Enter}');
      await waitFor(() => expect(check).toHaveAttribute('aria-busy', 'true'));
      expect(check).toHaveFocus();
      expect(check).toHaveAttribute('aria-disabled', 'true');
      answer(runningSession({ id: 4 }));
      await waitFor(() => expect(check).not.toHaveAttribute('aria-busy'));
      expect(check).toHaveFocus();
    });

    it('tells a failed check once', async () => {
      installFakeApi({
        'POST /sessions/:id/check-ip': failure(502, 'proxy_unreachable'),
      });
      const { user } = show(runningSession({ id: 4 }), { onRestart: vi.fn() });
      await user.click(screen.getByRole('button', { name: 'Check IP' }));
      await waitFor(() => expect(shownToasts()).toHaveLength(1));
      expect(shownToasts()[0]?.title).toBe("Couldn't check the IP");
    });

    it('cannot look at a proxy the session does not have, or one that does not run', () => {
      show(session(), { onRestart: vi.fn() });
      expect(screen.queryByRole('button', { name: 'Check IP' })).toBeNull();
    });

    it('offers the restart that matches the session to the new IP, only when the IP changed', async () => {
      const onRestart = vi.fn();
      const { user } = show(moved, { onRestart });
      await user.click(screen.getByRole('button', { name: 'Restart session' }));
      expect(onRestart).toHaveBeenCalledTimes(1);
    });

    it('does not offer a restart while the place matches', () => {
      show(runningSession(), { onRestart: vi.fn() });
      expect(
        screen.queryByRole('button', { name: 'Restart session' }),
      ).toBeNull();
      expect(screen.getByRole('button', { name: 'Check IP' })).toBeVisible();
    });
  });

  it.each([
    ['a session that has not started', session()],
    ['a running session', runningSession()],
    ['a session out of step with its IP', moved],
  ])('has no accessibility violations: %s', async (_name, shown) => {
    const view = show(shown, { onRestart: vi.fn() });
    await checkAccessibility(view);
  });
});
