import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { Session } from '@/lib/api/schemas';
import { checkAccessibility } from '@/tests/utils/a11y';
import { installFakeApi } from '@/tests/utils/fake-api';
import { runningSession, session } from '@/tests/utils/fixtures';
import { resetLanguage, showLanguage } from '@/tests/utils/language';
import { renderApp } from '@/tests/utils/render';
import { ToastList, shownToasts } from '@/tests/utils/toast-list';

import { IdentityChip } from './identity-chip';

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

function show(shown: Session) {
  return renderApp(
    <main>
      <IdentityChip session={shown} />
      <ToastList />
    </main>,
  );
}

describe('IdentityChip', () => {
  it('says where the session exits, as the chip that opens its details', () => {
    show(runningSession());
    const chip = screen.getByRole('button', { name: '203.0.113.7 · DE' });
    expect(chip).toBeVisible();
    expect(chip).toHaveAttribute('aria-haspopup', 'dialog');
    expect(chip).toHaveAttribute('aria-expanded', 'false');
  });

  it('is there for a session that is stopped but has been seen behind an IP', () => {
    show(runningSession({ status: 'stopped' }));
    expect(
      screen.getByRole('button', { name: '203.0.113.7 · DE' }),
    ).toBeVisible();
  });

  it('falls back to the IP of the place when the proxy is not known', () => {
    show(runningSession({ proxy: null }));
    expect(
      screen.getByRole('button', { name: '203.0.113.7 · DE' }),
    ).toBeVisible();
  });

  it('is not there for a session that has no IP yet: its page lists what it has', () => {
    show(session());
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('opens the details of the session, named by their heading', async () => {
    const { user } = show(runningSession());
    await user.click(screen.getByRole('button', { name: '203.0.113.7 · DE' }));

    const details = await screen.findByRole('dialog', {
      name: 'Session details',
    });
    expect(
      within(details).getByRole('heading', {
        level: 2,
        name: 'Session details',
      }),
    ).toBeVisible();
    expect(within(details).getByText('Europe/Berlin')).toBeVisible();
    expect(within(details).getByText('de-DE')).toBeVisible();
    expect(within(details).getByText('52.520 / 13.405')).toBeVisible();
    expect(
      screen.getByRole('button', { name: '203.0.113.7 · DE' }),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens from the keyboard, and gives the keyboard back to the chip when it closes', async () => {
    const { user } = show(runningSession());
    screen.getByRole('button', { name: '203.0.113.7 · DE' }).focus();
    await user.keyboard('{Enter}');
    const details = await screen.findByRole('dialog');
    // The dialog has the keyboard, ready for a Tab into what it holds.
    expect(details).toHaveFocus();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      screen.getByRole('button', { name: '203.0.113.7 · DE' }),
    ).toHaveFocus();
  });

  it('reads as matching while the place still fits the IP', async () => {
    const { user } = show(runningSession());
    const chip = screen.getByRole('button', { name: '203.0.113.7 · DE' });
    expect(chip).not.toHaveAccessibleDescription(/another IP/);
    await user.click(chip);
    expect(
      await screen.findByText(
        "The session's time zone and location match this IP.",
      ),
    ).toBeVisible();
  });

  describe('once the proxy exits through another IP', () => {
    it('warns in words, not in colour alone: the chip is described by what changed', () => {
      show(moved);
      const chip = screen.getByRole('button', { name: '203.0.113.99 · FR' });
      expect(chip).toHaveAccessibleDescription(
        'The proxy now exits through another IP.',
      );
    });

    it('lists the new IP and offers to check it again, and to restart', async () => {
      const { user } = show(moved);
      await user.click(
        screen.getByRole('button', { name: '203.0.113.99 · FR' }),
      );
      const details = await screen.findByRole('dialog');
      expect(within(details).getByText('203.0.113.99 · FR')).toBeVisible();
      expect(
        within(details).getByRole('button', { name: 'Check IP' }),
      ).toBeVisible();
      expect(
        within(details).getByRole('button', { name: 'Restart session' }),
      ).toBeVisible();
    });

    it('asks before restarting, restarts when confirmed, and the details give way to the question', async () => {
      const api = installFakeApi({
        'POST /sessions/:id/restart': { ...moved, status: 'starting' },
      });
      const { user } = show(moved);
      await user.click(
        screen.getByRole('button', { name: '203.0.113.99 · FR' }),
      );
      const details = await screen.findByRole('dialog', {
        name: 'Session details',
      });
      await user.click(
        within(details).getByRole('button', { name: 'Restart session' }),
      );

      const question = await screen.findByRole('dialog', {
        name: 'Restart "Shop"?',
      });
      expect(
        screen.queryByRole('dialog', { name: 'Session details' }),
      ).toBeNull();
      expect(api.callsTo('POST /sessions/:id/restart')).toHaveLength(0);
      await user.click(
        within(question).getByRole('button', { name: 'Restart session' }),
      );
      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/restart')).toHaveLength(1),
      );
      expect(api.callsTo('POST /sessions/:id/restart')[0]?.params.id).toBe('3');
    });

    it('gives the keyboard back to the chip when the question is dismissed', async () => {
      installFakeApi({});
      const { user } = show(moved);
      await user.click(
        screen.getByRole('button', { name: '203.0.113.99 · FR' }),
      );
      const details = await screen.findByRole('dialog');
      await user.click(
        within(details).getByRole('button', { name: 'Restart session' }),
      );
      const question = await screen.findByRole('dialog', {
        name: 'Restart "Shop"?',
      });
      await user.click(
        within(question).getByRole('button', { name: 'Cancel' }),
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(
        screen.getByRole('button', { name: '203.0.113.99 · FR' }),
      ).toHaveFocus();
    });
  });

  it('looks at the proxy again from its details, and says what it found', async () => {
    const api = installFakeApi({
      'POST /sessions/:id/check-ip': runningSession({ id: 4 }),
    });
    const { user } = show(runningSession({ id: 4 }));
    await user.click(screen.getByRole('button', { name: '203.0.113.7 · DE' }));
    const details = await screen.findByRole('dialog');
    await user.click(within(details).getByRole('button', { name: 'Check IP' }));
    await waitFor(() =>
      expect(api.callsTo('POST /sessions/:id/check-ip')).toHaveLength(1),
    );
    await waitFor(() => expect(shownToasts()).toHaveLength(1));
    expect(shownToasts()[0]?.title).toBe('Exit IP unchanged');
    // The details stay open: the answer is in them too.
    expect(
      screen.getByRole('dialog', { name: 'Session details' }),
    ).toBeVisible();
  });

  it('keeps its details of a stopped session free of what only a running one can do', async () => {
    const { user } = show(runningSession({ status: 'stopped' }));
    await user.click(screen.getByRole('button', { name: '203.0.113.7 · DE' }));
    const details = await screen.findByRole('dialog');
    expect(
      within(details).queryByRole('button', { name: 'Check IP' }),
    ).toBeNull();
    expect(
      within(details).queryByRole('button', { name: 'Restart session' }),
    ).toBeNull();
  });

  it('speaks German', async () => {
    await showLanguage('de');
    const { user } = show(moved);
    await user.click(
      await screen.findByRole('button', { name: '203.0.113.99 · FR' }),
    );
    const details = await screen.findByRole('dialog', {
      name: 'Sitzungsdetails',
    });
    expect(within(details).getByText('52,520 / 13,405')).toBeVisible();
    expect(
      within(details).getByRole('button', { name: 'Sitzung neu starten' }),
    ).toBeVisible();
  });

  it('has no accessibility violations, closed or open', async () => {
    const { user, ...view } = show(moved);
    await checkAccessibility(view);
    await user.click(screen.getByRole('button', { name: '203.0.113.99 · FR' }));
    await screen.findByRole('dialog');
    await checkAccessibility(document.body);
  });
});
