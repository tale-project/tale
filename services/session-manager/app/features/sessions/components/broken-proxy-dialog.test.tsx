import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/app/lib/api/client';
import { failureText } from '@/app/lib/api/failure';
import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { renderApp } from '@/tests/utils/render';

import { BrokenProxyDialog } from './broken-proxy-dialog';

/** What the server answers when the proxy of a session fails the check before its start. */
const refusal = () =>
  new ApiError(
    502,
    'proxy_unreachable',
    'The proxy of session Shop (http://198.51.100.4:8080) is not working: Proxy refused the credentials (407). Use “Rotate IP” to give the session another proxy.',
    { proxyId: 3, reason: 'Proxy refused the credentials (407)' },
  );

function renderDialog(sessionName = 'Shop') {
  const onAnswer = vi.fn();
  const view = renderApp(
    <BrokenProxyDialog
      sessionName={sessionName}
      error={refusal()}
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

describe('BrokenProxyDialog', () => {
  it('says that the proxy of this session is not working, by its name, and what the last check said', async () => {
    renderDialog();

    const dialog = await screen.findByRole('dialog', {
      name: 'The proxy of "Shop" isn\'t working',
    });
    expect(dialog).toHaveTextContent(
      'The last check failed: Proxy refused the credentials (407).',
    );
  });

  it('does not say the same thing again, nor tell to press the button it offers', async () => {
    renderDialog();

    const dialog = await screen.findByRole('dialog');
    // The title says that the proxy does not work; the hint says what Rotate
    // IP does. Neither the sentence of the error nor its advice is repeated.
    expect(dialog).not.toHaveTextContent('is not working');
    expect(dialog).not.toHaveTextContent(/Use Rotate IP|Choose Rotate IP/);
    expect(dialog).not.toHaveTextContent(
      failureText(refusal(), i18n.getFixedT('en', 'errors')),
    );
  });

  it('leaves the last check out when it named no cause', async () => {
    const onAnswer = vi.fn();
    renderApp(
      <BrokenProxyDialog
        sessionName="Shop"
        error={new ApiError(502, 'proxy_unreachable', 'x', { proxyId: 3 })}
        onAnswer={onAnswer}
      />,
    );

    const dialog = await screen.findByRole('dialog');
    expect(dialog).not.toHaveTextContent('The last check said');
    expect(dialog).toHaveTextContent('Rotate IP switches the session "Shop"');
  });

  it('says the cause on one line, with the one stop that ends the sentence', async () => {
    renderApp(
      <BrokenProxyDialog
        sessionName="Shop"
        error={
          new ApiError(502, 'proxy_unreachable', 'x', {
            reason:
              'Proxy refused the credentials (407).\nSecond line of the check.',
          })
        }
        onAnswer={vi.fn()}
      />,
    );

    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'The last check failed: Proxy refused the credentials (407). Second line of the check.',
    );
  });

  it('says what Rotate IP does for this session', async () => {
    renderDialog('Shop');

    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Rotate IP switches the session "Shop" to another working proxy and starts it.',
    );
  });

  it('puts Cancel first and Rotate IP, the way on, last', async () => {
    renderDialog();
    await screen.findByRole('dialog');

    const buttons = screen
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter((text) => text === 'Cancel' || text === 'Rotate IP');
    expect(buttons).toEqual(['Cancel', 'Rotate IP']);
  });

  it('has the focus on Rotate IP, so that Enter takes the way on', async () => {
    const { user, onAnswer } = renderDialog();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Rotate IP' })).toHaveFocus(),
    );
    await user.keyboard('{Enter}');

    expect(onAnswer).toHaveBeenCalledExactlyOnceWith('rotate');
  });

  it('answers rotate when asked to give the session another proxy', async () => {
    const { user, onAnswer } = renderDialog();

    await user.click(await screen.findByRole('button', { name: 'Rotate IP' }));

    expect(onAnswer).toHaveBeenCalledExactlyOnceWith('rotate');
  });

  it('answers cancel for Cancel, for Escape and for the close button', async () => {
    const first = renderDialog();
    await first.user.click(
      await screen.findByRole('button', { name: 'Cancel' }),
    );
    expect(first.onAnswer).toHaveBeenLastCalledWith('cancel');
    cleanup();

    const second = renderDialog();
    await screen.findByRole('dialog');
    await second.user.keyboard('{Escape}');
    expect(second.onAnswer).toHaveBeenLastCalledWith('cancel');
    cleanup();

    const third = renderDialog();
    await third.user.click(
      await screen.findByRole('button', { name: 'Close' }),
    );
    expect(third.onAnswer).toHaveBeenLastCalledWith('cancel');
  });

  it('speaks German', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    renderDialog('Shop');

    const dialog = await screen.findByRole('dialog', {
      name: 'Der Proxy von „Shop“ funktioniert nicht',
    });
    expect(dialog).toHaveTextContent(
      'Die letzte Prüfung ist fehlgeschlagen: Proxy refused the credentials (407).',
    );
    expect(dialog).toHaveTextContent(
      'Mit IP wechseln bekommt die Sitzung „Shop“ einen anderen funktionierenden Proxy und startet danach.',
    );
    expect(screen.getByRole('button', { name: 'IP wechseln' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeVisible();
  });

  it('speaks French', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    renderDialog('Shop');

    const dialog = await screen.findByRole('dialog', {
      name: /^Le proxy de «\s*Shop\s*» ne fonctionne pas$/,
    });
    expect(dialog).toHaveTextContent(
      'La dernière vérification a échoué : Proxy refused the credentials (407).',
    );
    expect(dialog).toHaveTextContent(
      "Si tu choisis Changer d'IP, la session « Shop » reçoit un autre proxy fonctionnel, puis démarre.",
    );
  });

  it('has no accessibility violations', async () => {
    renderDialog();
    await checkAccessibility(await screen.findByRole('dialog'));
  });
});
