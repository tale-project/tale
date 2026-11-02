import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { Toaster } from '@tale/ui/toaster';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { installFakeApi } from '@/tests/utils/fake-api';
import { meta, proxy, session } from '@/tests/utils/fixtures';
import { renderApp } from '@/tests/utils/render';

import { NoWorkingProxyDialog } from './no-working-proxy-dialog';

function renderDialog(names: string[], failedProxies: number) {
  const api = installFakeApi({
    'GET /meta': meta({ counts: { proxies: failedProxies, failedProxies } }),
    'POST /proxies/import': {
      added: [proxy({ id: 10 })],
      duplicates: [],
      errors: [],
      summary: 'Added 1',
    },
  });
  const onAnswer = vi.fn();
  const view = renderApp(
    <>
      <NoWorkingProxyDialog
        sessions={names.map((name, index) => session({ id: index + 1, name }))}
        onAnswer={onAnswer}
      />
      <Toaster />
    </>,
  );
  return { ...view, api, onAnswer };
}

afterEach(async () => {
  cleanup();
  localStorage.removeItem(LOCALE_STORAGE_KEY);
  await i18n.changeLanguage('en');
});

describe('NoWorkingProxyDialog', () => {
  it('names the session that gets one of the proxies once they are added, and how many failed their check', async () => {
    renderDialog(['Shop'], 3);

    const dialog = await screen.findByRole('dialog', {
      name: 'No working proxy available',
    });
    await waitFor(() =>
      expect(dialog).toHaveTextContent('3 proxies failed their check.'),
    );
    expect(dialog).toHaveTextContent(
      'Once you add proxies, the session "Shop" gets one of them automatically.',
    );
  });

  it('counts one proxy in the singular', async () => {
    renderDialog(['Shop'], 1);

    await waitFor(() =>
      expect(screen.getByRole('dialog')).toHaveTextContent(
        '1 proxy failed its check.',
      ),
    );
  });

  it('says nothing of failed checks when none of the proxies failed', async () => {
    renderDialog(['Shop'], 0);

    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(dialog).toHaveTextContent(
        'Once you add proxies, the session "Shop" gets one of them automatically.',
      ),
    );
    expect(dialog).not.toHaveTextContent('failed their check');
  });

  it('lists every session that waits, in one dialog', async () => {
    renderDialog(['Shop', 'Bank', 'Mail'], 2);

    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Once you add proxies, the sessions "Shop", "Bank", and "Mail" get one of them automatically.',
    );
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('is the form that imports proxies, and answers that some were added', async () => {
    const { user, onAnswer, api } = renderDialog(['Shop'], 1);
    await screen.findByRole('dialog');

    await user.click(
      screen.getByRole('textbox', { name: 'Proxies, one per line' }),
    );
    await user.paste('198.51.100.9:8080');
    await user.click(screen.getByRole('button', { name: 'Add proxies' }));

    await waitFor(() => expect(onAnswer).toHaveBeenCalledExactlyOnceWith(true));
    expect(api.callsTo('POST /proxies/import')).toHaveLength(1);
    expect(await screen.findByText('1 proxy added')).toBeVisible();
  });

  it('answers that none were added for Cancel and for Escape', async () => {
    const first = renderDialog(['Shop'], 1);
    await first.user.click(
      await screen.findByRole('button', { name: 'Cancel' }),
    );
    expect(first.onAnswer).toHaveBeenCalledExactlyOnceWith(false);
    cleanup();

    const second = renderDialog(['Shop'], 1);
    await screen.findByRole('dialog');
    await second.user.keyboard('{Escape}');
    expect(second.onAnswer).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('speaks German, down to the plurals', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    renderDialog(['Shop', 'Bank'], 2);

    const dialog = await screen.findByRole('dialog', {
      name: 'Kein funktionierender Proxy verfügbar',
    });
    await waitFor(() =>
      expect(dialog).toHaveTextContent(
        '2 Proxies haben die Prüfung nicht bestanden.',
      ),
    );
    expect(dialog).toHaveTextContent(
      'Sobald du Proxies hinzufügst, bekommen die Sitzungen „Shop“ und „Bank“ automatisch je einen davon.',
    );
  });

  it('speaks German in the singular', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    renderDialog(['Shop'], 1);

    await waitFor(() =>
      expect(screen.getByRole('dialog')).toHaveTextContent(
        '1 Proxy hat die Prüfung nicht bestanden. Sobald du Proxies hinzufügst, bekommt die Sitzung „Shop“ automatisch einen davon.',
      ),
    );
  });

  it('speaks French', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    renderDialog(['Shop', 'Bank'], 2);

    const dialog = await screen.findByRole('dialog', {
      name: 'Aucun proxy fonctionnel disponible',
    });
    await waitFor(() =>
      expect(dialog).toHaveTextContent(
        '2 proxys ont échoué à la vérification.',
      ),
    );
    expect(dialog).toHaveTextContent(
      'Dès que tu ajoutes des proxys, les sessions « Shop » et « Bank » en reçoivent chacune un automatiquement.',
    );
  });

  it('has no accessibility violations', async () => {
    renderDialog(['Shop', 'Bank'], 2);
    await screen.findByRole('dialog');
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toHaveTextContent(
        'failed their check',
      ),
    );
    await checkAccessibility(screen.getByRole('dialog'));
  });
});
