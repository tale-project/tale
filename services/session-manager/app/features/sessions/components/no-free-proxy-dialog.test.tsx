import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { Toaster } from '@tale/ui/toaster';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { installFakeApi } from '@/tests/utils/fake-api';
import { proxy } from '@/tests/utils/fixtures';
import { renderApp } from '@/tests/utils/render';

import type { ProxyAction } from '../lib/proxy-flows';
import { NoFreeProxyDialog } from './no-free-proxy-dialog';

function renderDialog(action: ProxyAction = 'start') {
  const onAnswer = vi.fn();
  const view = renderApp(
    <>
      <NoFreeProxyDialog action={action} onAnswer={onAnswer} />
      <Toaster />
    </>,
  );
  return { ...view, onAnswer };
}

const list = () =>
  screen.getByRole('textbox', { name: 'Proxies, one per line' });

const imported = (count: number) => ({
  added: Array.from({ length: count }, (_, index) => proxy({ id: 10 + index })),
  duplicates: [],
  errors: [],
  summary: `Added ${count}`,
});

afterEach(async () => {
  cleanup();
  localStorage.removeItem(LOCALE_STORAGE_KEY);
  await i18n.changeLanguage('en');
});

describe('NoFreeProxyDialog', () => {
  it.each([
    ['start', 'Add proxies and the session will start automatically.'],
    [
      'rotate',
      'Add proxies and the session will switch to one of them automatically.',
    ],
    ['create', 'Add proxies and the session will be added automatically.'],
  ] as const)(
    'says every session needs its own proxy, and what happens once there are some, when you %s',
    async (action, next) => {
      renderDialog(action);

      const dialog = await screen.findByRole('dialog', {
        name: 'No free proxy available',
      });
      expect(dialog).toHaveTextContent(
        `Every session needs a proxy of its own, and none is free right now. ${next}`,
      );
    },
  );

  it('is the form that imports proxies, to paste a list or choose a file', async () => {
    renderDialog();

    await screen.findByRole('dialog');
    expect(list()).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Choose file' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'HTTP' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Add proxies' })).toBeVisible();
  });

  it('puts Cancel first and the one that adds the proxies second', async () => {
    renderDialog();
    await screen.findByRole('dialog');

    const buttons = screen
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter((text) => text === 'Cancel' || text === 'Add proxies');
    expect(buttons).toEqual(['Cancel', 'Add proxies']);
  });

  it('answers that proxies were added, with a notice, as soon as the import added one', async () => {
    const api = installFakeApi({ 'POST /proxies/import': imported(2) });
    const { user, onAnswer } = renderDialog();
    await screen.findByRole('dialog');

    await user.click(list());
    await user.paste('198.51.100.4:8080\n198.51.100.5:8080');
    await user.click(screen.getByRole('button', { name: 'Add proxies' }));

    await waitFor(() => expect(onAnswer).toHaveBeenCalledExactlyOnceWith(true));
    expect(api.callsTo('POST /proxies/import')[0]?.body).toEqual({
      text: '198.51.100.4:8080\n198.51.100.5:8080',
      defaultScheme: 'http',
    });
    expect(await screen.findByText('2 proxies added')).toBeVisible();
  });

  it('answers nothing while the report of an import that added none is read', async () => {
    installFakeApi({
      'POST /proxies/import': {
        added: [],
        duplicates: [],
        errors: [
          {
            line: 1,
            input: 'nonsense',
            message: 'missing port',
            code: 'missing_port',
            params: {},
          },
        ],
        summary: 'Added 0',
      },
    });
    const { user, onAnswer } = renderDialog();
    await screen.findByRole('dialog');

    await user.click(list());
    await user.paste('nonsense');
    await user.click(screen.getByRole('button', { name: 'Add proxies' }));

    expect(
      await screen.findByText(
        'The port is missing. Write the proxy as host:port.',
      ),
    ).toBeVisible();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('answers that none were added for Cancel, for Escape and for the close button', async () => {
    const first = renderDialog();
    await first.user.click(
      await screen.findByRole('button', { name: 'Cancel' }),
    );
    expect(first.onAnswer).toHaveBeenCalledExactlyOnceWith(false);
    cleanup();

    const second = renderDialog();
    await screen.findByRole('dialog');
    await second.user.keyboard('{Escape}');
    expect(second.onAnswer).toHaveBeenCalledExactlyOnceWith(false);
    cleanup();

    const third = renderDialog();
    await third.user.click(
      await screen.findByRole('button', { name: 'Close' }),
    );
    expect(third.onAnswer).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('speaks German', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    renderDialog('rotate');

    const dialog = await screen.findByRole('dialog', {
      name: 'Kein freier Proxy verfügbar',
    });
    expect(dialog).toHaveTextContent(
      'Jede Sitzung braucht einen eigenen Proxy, und gerade ist keiner frei. Füge Proxies hinzu, dann wechselt die Sitzung automatisch zu einem davon.',
    );
    expect(
      screen.getByRole('button', { name: 'Proxies hinzufügen' }),
    ).toBeVisible();
  });

  it('speaks French', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    renderDialog('create');

    const dialog = await screen.findByRole('dialog', {
      name: 'Aucun proxy libre disponible',
    });
    expect(dialog).toHaveTextContent(
      'Ajoute des proxys, et la session sera ajoutée automatiquement.',
    );
  });

  it('has no accessibility violations', async () => {
    renderDialog('rotate');
    await checkAccessibility(await screen.findByRole('dialog'));
  });
});
