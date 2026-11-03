import { useToast } from '@tale/ui/use-toast';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { runningSession } from '@/tests/utils/fixtures';
import { resetLanguage, showLanguage } from '@/tests/utils/language';
import { renderApp } from '@/tests/utils/render';
import { openToasts } from '@/tests/utils/toasts';

import { OutOfSyncBar } from './out-of-sync-bar';

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

describe('OutOfSyncBar', () => {
  it('says nothing while the place matches the IP', () => {
    const view = renderApp(<OutOfSyncBar session={runningSession()} />);
    expect(view.container).toBeEmptyDOMElement();
  });

  it('says nothing when it is not known whether the place matches', () => {
    const view = renderApp(
      <OutOfSyncBar
        session={runningSession({
          location: { ...runningSession().location!, inSync: null },
        })}
      />,
    );
    expect(view.container).toBeEmptyDOMElement();
  });

  it('says nothing about a session that does not run', () => {
    const view = renderApp(
      <OutOfSyncBar session={{ ...moved, status: 'stopped' }} />,
    );
    expect(view.container).toBeEmptyDOMElement();
  });

  it('warns that the exit IP changed, and which time zone and location the session still reports', () => {
    renderApp(<OutOfSyncBar session={moved} />);
    const bar = screen.getByRole('alert');
    expect(bar).toHaveAttribute('data-variant', 'warning');
    expect(within(bar).getByText('The exit IP has changed')).toBeVisible();
    expect(
      within(bar).getByText(
        'The proxy now exits through 203.0.113.99, but this session still reports the time zone and location of 203.0.113.7.',
      ),
    ).toBeVisible();
    expect(
      within(bar).getByText(
        'If this keeps happening, the proxy probably rotates its IP. Use a proxy with a fixed IP.',
      ),
    ).toBeVisible();
  });

  // The library's alert titles are level-5 headings, which would come right
  // after the page's heading: the sentence that leads is not one.
  it('has no heading of its own: the page keeps its order of headings', () => {
    renderApp(<OutOfSyncBar session={moved} />);
    expect(within(screen.getByRole('alert')).queryByRole('heading')).toBeNull();
  });

  it('words the warning without the new IP when the proxy has none on record', () => {
    renderApp(
      <OutOfSyncBar
        session={{
          ...moved,
          proxy: moved.proxy ? { ...moved.proxy, exitIp: null } : null,
        }}
      />,
    );
    expect(
      screen.getByText(
        'The proxy now exits through another IP, but this session still reports the time zone and location of 203.0.113.7.',
      ),
    ).toBeVisible();
  });

  it('speaks German', async () => {
    await showLanguage('de');
    renderApp(<OutOfSyncBar session={moved} />);
    expect(
      await screen.findByText('Die Ausgangs-IP hat sich geändert'),
    ).toBeVisible();
    expect(
      screen.getByText(
        'Die Ausgangs-IP des Proxys ist jetzt 203.0.113.99, diese Sitzung meldet aber weiterhin Zeitzone und Standort von 203.0.113.7.',
      ),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Sitzung neu starten' }),
    ).toBeVisible();
  });

  it('speaks French', async () => {
    await showLanguage('fr');
    renderApp(<OutOfSyncBar session={moved} />);
    expect(await screen.findByText("L'IP de sortie a changé")).toBeVisible();
    expect(
      screen.getByText(
        "L'IP de sortie du proxy est maintenant 203.0.113.99, mais cette session indique toujours le fuseau horaire et la position de 203.0.113.7.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Redémarrer la session' }),
    ).toBeVisible();
  });

  it('asks before restarting, and restarts the session when confirmed', async () => {
    const api = installFakeApi({
      'POST /sessions/:id/restart': { ...moved, status: 'starting' },
    });
    const { user } = renderApp(<OutOfSyncBar session={moved} />);
    await user.click(screen.getByRole('button', { name: 'Restart session' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Restart "Shop"?',
    });
    expect(api.callsTo('POST /sessions/:id/restart')).toHaveLength(0);
    await user.click(
      within(dialog).getByRole('button', { name: 'Restart session' }),
    );
    await waitFor(() =>
      expect(api.callsTo('POST /sessions/:id/restart')).toHaveLength(1),
    );
    expect(api.callsTo('POST /sessions/:id/restart')[0]?.params.id).toBe('3');
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Restart "Shop"?' }),
      ).toBeNull(),
    );
  });

  it('does not restart when the question is dismissed, and gives the keyboard back to its button', async () => {
    const api = installFakeApi({});
    const { user } = renderApp(<OutOfSyncBar session={moved} />);
    await user.click(screen.getByRole('button', { name: 'Restart session' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.calls).toHaveLength(0);
    expect(
      screen.getByRole('button', { name: 'Restart session' }),
    ).toHaveFocus();
  });

  it('tells a failed restart once, and keeps the question open to try again', async () => {
    installFakeApi({
      'POST /sessions/:id/restart': failure(409, 'session_busy'),
    });
    function Probe() {
      const { toasts } = useToast();
      return <p>toasts: {openToasts(toasts).length}</p>;
    }
    const { user } = renderApp(
      <>
        <OutOfSyncBar session={moved} />
        <Probe />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Restart session' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: 'Restart session' }),
    );
    await waitFor(() => expect(screen.getByText('toasts: 1')).toBeVisible());
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('has no accessibility violations', async () => {
    const view = renderApp(<OutOfSyncBar session={moved} />);
    await checkAccessibility(view);
  });
});
