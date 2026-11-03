import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { answer, failure, type FakeRoute } from '@/tests/utils/fake-api';
import { renderApp } from '@/tests/utils/render';
import {
  installSecretsApi,
  SAMPLE,
  summaryOf,
} from '@/tests/utils/secrets-api';
import { openToastLines, ToastProbe } from '@/tests/utils/toast-probe';

import { SecretDeleteDialog } from './secret-delete-dialog';

afterEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});

function renderDelete(secret = SAMPLE.credentials) {
  const backend = installSecretsApi();
  const onOpenChange = vi.fn();
  const view = renderApp(
    <>
      <SecretDeleteDialog
        secret={summaryOf(secret)}
        onOpenChange={onOpenChange}
      />
      <ToastProbe />
    </>,
  );
  return { ...view, ...backend, onOpenChange };
}

const confirm = () => screen.getByRole('button', { name: 'Delete secret' });

describe('the question before a secret is deleted', () => {
  it('names the secret, and what it is and who it is for', () => {
    renderDelete();
    const dialog = screen.getByRole('dialog', {
      name: 'Delete "Example shop"?',
    });
    expect(dialog).toHaveAccessibleDescription(
      "Sessions and connected AI assistants lose access to it immediately. This can't be undone.",
    );
    expect(screen.getByText('Credentials · Every session')).toBeInTheDocument();
  });

  it('names the session of a secret that belongs to one', () => {
    renderDelete(SAMPLE.mail);
    expect(
      screen.getByText('Credentials · Session "0003"'),
    ).toBeInTheDocument();
  });

  it('asks and sends nothing before it is answered', () => {
    const { api } = renderDelete();
    expect(api.callsTo('DELETE /secrets/:id')).toHaveLength(0);
  });

  it('closes without a request when the person cancels', async () => {
    const { user, api, onOpenChange } = renderDelete();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(api.callsTo('DELETE /secrets/:id')).toHaveLength(0);
  });

  it('closes with Escape without a request', async () => {
    const { user, api, onOpenChange } = renderDelete();
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(api.callsTo('DELETE /secrets/:id')).toHaveLength(0);
  });

  it('deletes the secret, says so and closes', async () => {
    const { user, api, state, onOpenChange } = renderDelete();
    await user.click(confirm());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.callsTo('DELETE /secrets/:id')[0]?.params.id).toBe('6');
    expect(state.secrets.map((secret) => secret.id)).not.toContain(6);
    expect(openToastLines()).toEqual(['success: Secret deleted']);
  });

  it('is the destructive action: Delete secret is last, after Cancel, and is not the one in focus', () => {
    renderDelete();
    const buttons = screen
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(buttons.indexOf('Cancel')).toBeLessThan(
      buttons.indexOf('Delete secret'),
    );
    expect(confirm()).not.toHaveFocus();
  });

  it('shows the request under way, and cannot be sent twice or dismissed meanwhile', async () => {
    const { user, api, onOpenChange } = renderDelete();
    let finish: (value: FakeRoute) => void = () => {};
    api.on(
      'DELETE /secrets/:id',
      () =>
        new Promise<FakeRoute>((resolve) => {
          finish = resolve;
        }),
    );

    await user.click(confirm());

    await waitFor(() => expect(confirm()).toHaveAttribute('aria-busy', 'true'));
    expect(confirm()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(api.callsTo('DELETE /secrets/:id')).toHaveLength(1);

    finish(answer({ status: 204 }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('raises one toast for a failure and stays open, so the person can try again', async () => {
    const { user, api, onOpenChange } = renderDelete();
    api.on('DELETE /secrets/:id', failure(500, 'internal', 'boom'));

    await user.click(confirm());

    await waitFor(() =>
      expect(openToastLines()).toEqual([
        "destructive: Couldn't delete the secret",
      ]),
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(confirm()).toBeEnabled();
  });

  it('closes when the secret was already deleted elsewhere, and says so', async () => {
    const { user, api, onOpenChange } = renderDelete();
    api.on('DELETE /secrets/:id', failure(404, 'secret_not_found'));

    await user.click(confirm());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(openToastLines()).toEqual([
      "destructive: Couldn't delete the secret",
    ]);
  });

  it('has no accessibility violations', async () => {
    renderDelete(SAMPLE.bank);
    await checkAccessibility(document.body);
  });

  it('asks in German', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    renderDelete();
    const dialog = await screen.findByRole('dialog', {
      name: '„Example shop“ löschen?',
    });
    expect(dialog).toHaveAccessibleDescription(
      'Sitzungen und verbundene KI-Assistenten verlieren sofort den Zugriff darauf. Das lässt sich nicht rückgängig machen.',
    );
    expect(
      screen.getByRole('button', { name: 'Secret löschen' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Abbrechen' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Zugangsdaten · Jede Sitzung')).toBeInTheDocument();
  });

  it('asks in French', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    renderDelete();
    const dialog = await screen.findByRole('dialog', {
      name: 'Supprimer le secret « Example shop » ?',
    });
    expect(dialog).toHaveAccessibleDescription(
      "Les sessions et les assistants IA connectés perdent immédiatement l'accès à ce secret. Cette action est irréversible.",
    );
    expect(
      screen.getByRole('button', { name: 'Supprimer le secret' }),
    ).toBeInTheDocument();
  });
});
