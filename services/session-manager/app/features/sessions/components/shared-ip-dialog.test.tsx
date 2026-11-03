import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { renderApp } from '@/tests/utils/render';

import type { SharedIpConflict } from '../lib/shared-ip';
import { SharedIpDialog } from './shared-ip-dialog';

function renderDialog(
  conflict: SharedIpConflict,
  { sessionName = '0003' } = {},
) {
  const onAnswer = vi.fn();
  const view = renderApp(
    <SharedIpDialog
      sessionName={sessionName}
      conflict={conflict}
      onAnswer={onAnswer}
    />,
  );
  return { ...view, onAnswer };
}

afterEach(async () => {
  cleanup();
  localStorage.removeItem(LOCALE_STORAGE_KEY);
  await i18n.changeLanguage('en');
});

describe('SharedIpDialog', () => {
  it('names the exit IP and the one running session that uses it', async () => {
    renderDialog({ exitIp: '203.0.113.7', names: ['Shop'] });

    const dialog = await screen.findByRole('dialog', {
      name: 'Same exit IP as another session',
    });
    expect(dialog).toHaveTextContent(
      'The running session "Shop" already uses the exit IP 203.0.113.7.',
    );
  });

  it('names several sessions in one sentence', async () => {
    renderDialog({ exitIp: '203.0.113.7', names: ['Shop', 'Bank', 'Mail'] });

    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'The running sessions "Shop", "Bank", and "Mail" already use the exit IP 203.0.113.7.',
    );
  });

  it('says what it means for the session that wants to start, and what rotating the IP does', async () => {
    renderDialog(
      { exitIp: '203.0.113.7', names: ['Shop'] },
      { sessionName: 'New' },
    );

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(
      'If the session "New" starts with the same exit IP too, websites can tell that these sessions belong together.',
    );
    expect(dialog).toHaveTextContent(
      'Rotate IP switches the session "New" to another working proxy and starts it.',
    );
  });

  it('puts the dismissing action first, the risky one in the middle and the one that is advised last', async () => {
    renderDialog({ exitIp: '203.0.113.7', names: ['Shop'] });
    await screen.findByRole('dialog');

    const buttons = screen
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter(
        (text) =>
          text === 'Cancel' || text === 'Start anyway' || text === 'Rotate IP',
      );
    expect(buttons).toEqual(['Cancel', 'Start anyway', 'Rotate IP']);
  });

  it('has the focus on Rotate IP, so that Enter takes the advised way', async () => {
    const { user, onAnswer } = renderDialog({
      exitIp: '203.0.113.7',
      names: ['Shop'],
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Rotate IP' })).toHaveFocus(),
    );
    await user.keyboard('{Enter}');

    expect(onAnswer).toHaveBeenCalledExactlyOnceWith('rotate');
  });

  it('answers rotate when asked to give the session another proxy first', async () => {
    const { user, onAnswer } = renderDialog({
      exitIp: '203.0.113.7',
      names: ['Shop'],
    });

    await user.click(await screen.findByRole('button', { name: 'Rotate IP' }));

    expect(onAnswer).toHaveBeenCalledExactlyOnceWith('rotate');
  });

  it('answers force when asked to start anyway', async () => {
    const { user, onAnswer } = renderDialog({
      exitIp: '203.0.113.7',
      names: ['Shop'],
    });

    await user.click(
      await screen.findByRole('button', { name: 'Start anyway' }),
    );

    expect(onAnswer).toHaveBeenCalledExactlyOnceWith('force');
  });

  it('answers cancel for Cancel, for Escape and for the close button', async () => {
    const first = renderDialog({ exitIp: '203.0.113.7', names: ['Shop'] });
    await first.user.click(
      await screen.findByRole('button', { name: 'Cancel' }),
    );
    expect(first.onAnswer).toHaveBeenLastCalledWith('cancel');
    cleanup();

    const second = renderDialog({ exitIp: '203.0.113.7', names: ['Shop'] });
    await screen.findByRole('dialog');
    await second.user.keyboard('{Escape}');
    expect(second.onAnswer).toHaveBeenLastCalledWith('cancel');
    cleanup();

    const third = renderDialog({ exitIp: '203.0.113.7', names: ['Shop'] });
    await third.user.click(
      await screen.findByRole('button', { name: 'Close' }),
    );
    expect(third.onAnswer).toHaveBeenLastCalledWith('cancel');
  });

  it('words the refusal in general terms when it does not know who shares the IP', async () => {
    renderDialog({ exitIp: null, names: [] });

    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Another running session already uses this exit IP.',
    );
  });

  it('speaks German, with the right plural, the quotes and the three choices', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    renderDialog({ exitIp: '203.0.113.7', names: ['Shop'] });

    const dialog = await screen.findByRole('dialog', {
      name: 'Dieselbe Ausgangs-IP wie eine andere Sitzung',
    });
    expect(dialog).toHaveTextContent(
      'Die laufende Sitzung „Shop“ nutzt die Ausgangs-IP 203.0.113.7 bereits.',
    );
    expect(
      screen.getByRole('button', { name: 'Trotzdem starten' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'IP wechseln' })).toBeVisible();
  });

  it('speaks German in the plural too', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    renderDialog({ exitIp: '203.0.113.7', names: ['Shop', 'Bank'] });

    await waitFor(() =>
      expect(screen.getByRole('dialog')).toHaveTextContent(
        'Die laufenden Sitzungen „Shop“ und „Bank“ nutzen die Ausgangs-IP 203.0.113.7 bereits.',
      ),
    );
  });

  it('speaks French, with its guillemets', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    renderDialog({ exitIp: '203.0.113.7', names: ['Shop'] });

    await waitFor(() =>
      expect(screen.getByRole('dialog')).toHaveTextContent(
        "La session en cours « Shop » utilise déjà l'IP de sortie 203.0.113.7.",
      ),
    );
    expect(screen.getByRole('button', { name: "Changer d'IP" })).toBeVisible();
  });

  it('keeps a French quotation together with its guillemets', () => {
    // A no-break space (U+00A0) inside « », so a name is never cut from them.
    expect(i18n.getFixedT('fr', 'sessions')('quoted', { text: 'Shop' })).toBe(
      '«\u00A0Shop\u00A0»',
    );
  });

  it('has no accessibility violations', async () => {
    renderDialog({ exitIp: '203.0.113.7', names: ['Shop'] });
    await checkAccessibility(await screen.findByRole('dialog'));
  });
});
