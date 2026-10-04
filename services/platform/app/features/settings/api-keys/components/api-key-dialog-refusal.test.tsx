import { Toaster } from '@tale/ui/toaster';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { act, cleanup, render, screen, waitFor } from '@/tests/utils/render';

import { ApiKeyCreateDialog } from './api-key-create-dialog';
import { ApiKeyRevokeDialog } from './api-key-revoke-dialog';

const { apiKey } = vi.hoisted(() => ({
  apiKey: { create: vi.fn(), delete: vi.fn(), list: vi.fn() },
}));

vi.mock('@/lib/auth-client', () => ({ authClient: { apiKey } }));

const refusal = {
  error: {
    status: 401,
    statusText: 'Unauthorized',
    code: 'UNAUTHORIZED',
    message: 'Unauthorized',
  },
};

let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('user-locale', 'en');
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  apiKey.create.mockResolvedValue(refusal);
  apiKey.delete.mockResolvedValue(refusal);
});

afterEach(async () => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  localStorage.removeItem('user-locale');
  await i18n.changeLanguage('en');
});

function renderCreate() {
  const onOpenChange = vi.fn();
  const onSuccess = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <QueryClientProvider client={client}>
        <button onClick={() => setOpen(true)}>Open create dialog</button>
        <ApiKeyCreateDialog
          open={open}
          onOpenChange={(value) => {
            setOpen(value);
            onOpenChange(value);
          }}
          onSuccess={onSuccess}
          organizationId="org-1"
        />
        <Toaster />
      </QueryClientProvider>
    );
  }
  const result = render(<Harness />);
  return { ...result, onOpenChange, onSuccess };
}

describe('API-key refusal feedback', () => {
  it.each([
    ['en', "Couldn't create API key", 'Your session has ended. Sign in again.'],
    [
      'de',
      'API-Schlüssel konnte nicht erstellt werden',
      'Deine Sitzung ist beendet. Melde dich erneut an.',
    ],
    [
      'fr',
      'Échec de la création de la clé API',
      'Ta session a pris fin. Reconnecte-toi.',
    ],
    [
      'de-CH',
      'API-Schlüssel konnte nicht erstellt werden',
      'Deine Sitzung ist beendet. Melde dich erneut an.',
    ],
  ])(
    'shows a localized session refusal in %s and keeps the draft',
    async (locale, title, detail) => {
      localStorage.setItem('user-locale', locale);
      await act(async () => {
        await i18n.changeLanguage(locale);
      });
      const { user, onOpenChange, onSuccess } = renderCreate();
      const name = screen.getByRole('textbox', {
        name: i18n.t('apiKeys.form.name', { ns: 'settings' }),
      });
      const submit = screen.getByRole('button', {
        name: i18n.t('apiKeys.createKeySubmit', { ns: 'settings' }),
      });
      await user.type(name, 'Audit key');
      await user.click(screen.getByRole('combobox'));
      await user.click(
        screen.getByRole('option', {
          name: i18n.t('apiKeys.form.expiresOptions.never', { ns: 'settings' }),
        }),
      );
      await waitFor(() => expect(submit).toBeEnabled());
      await user.click(submit);

      expect(await screen.findByText(title)).toBeInTheDocument();
      expect(await screen.findByText(detail)).toBeInTheDocument();
      expect(screen.getAllByText(title)).toHaveLength(1);
      expect(apiKey.create).toHaveBeenCalledTimes(1);
      expect(name).toHaveValue('Audit key');
      expect(screen.getByRole('combobox')).toHaveTextContent(
        i18n.t('apiKeys.form.expiresOptions.never', { ns: 'settings' }),
      );
      expect(submit).toBeEnabled();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();
      expect(
        screen.queryByText(i18n.t('apiKeys.yourApiKey', { ns: 'settings' })),
      ).not.toBeInTheDocument();
      await checkAccessibility(document.body);

      apiKey.create.mockResolvedValueOnce({
        data: { key: 'synthetic-key', id: 'key-1' },
      });
      await user.click(submit);
      expect(await screen.findByText('synthetic-key')).toBeInTheDocument();
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(apiKey.create).toHaveBeenLastCalledWith({
        name: 'Audit key',
        expiresIn: undefined,
      });
    },
  );

  it.each(['   ', 'a'.repeat(33)])(
    'rejects invalid name %j locally',
    async (draft) => {
      const { user } = renderCreate();
      await user.type(screen.getByRole('textbox', { name: /Key name/ }), draft);
      await user.tab();
      const submit = screen.getByRole('button', { name: 'Create key' });
      expect(submit).toBeDisabled();
      await user.click(submit);
      expect(apiKey.create).not.toHaveBeenCalled();
    },
  );

  it('trims valid creation, honors Never, and clears the revealed key on Done and reopen', async () => {
    apiKey.create.mockResolvedValueOnce({
      data: { key: 'synthetic-key', id: 'key-1' },
    });
    const { user } = renderCreate();
    await user.type(
      screen.getByRole('textbox', { name: /Key name/ }),
      '  Audit key  ',
    );
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Never' }));
    const submit = screen.getByRole('button', { name: 'Create key' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);
    expect(await screen.findByText('synthetic-key')).toBeInTheDocument();
    expect(apiKey.create).toHaveBeenCalledWith({
      name: 'Audit key',
      expiresIn: undefined,
    });
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(
      screen.getByRole('button', { name: 'Open create dialog' }),
    );
    expect(screen.getByRole('textbox', { name: /Key name/ })).toHaveValue('');
    expect(screen.queryByText('synthetic-key')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveTextContent('30 days');
  });

  it('shows a non-authentication refusal without discarding the draft', async () => {
    apiKey.create.mockResolvedValueOnce({
      error: {
        status: 403,
        code: 'FORBIDDEN',
        message: 'Key creation is not allowed.',
      },
    });
    const { user, onSuccess } = renderCreate();
    const name = screen.getByRole('textbox', { name: /Key name/ });
    await user.type(name, 'Audit key');
    const submit = screen.getByRole('button', { name: 'Create key' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    expect(
      await screen.findByText("Couldn't create API key"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Key creation is not allowed.'),
    ).toBeInTheDocument();
    expect(name).toHaveValue('Audit key');
    expect(submit).toBeEnabled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('keeps the existing revoke-refusal feedback and key', async () => {
    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();
    const key = {
      id: 'key-1',
      name: 'Audit key',
      start: 'tale_test',
      prefix: 'tale_',
      enabled: true,
      expiresAt: null,
      createdAt: new Date(),
      lastRequest: null,
    };
    client.setQueryData(['api-keys', 'org-1'], [key]);
    const { user } = render(
      <QueryClientProvider client={client}>
        <ApiKeyRevokeDialog
          open
          onOpenChange={onOpenChange}
          onSuccess={onSuccess}
          apiKey={key}
          organizationId="org-1"
        />
        <Toaster />
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Revoke key' }));
    expect(
      await screen.findByText("Couldn't revoke API key"),
    ).toBeInTheDocument();
    expect(apiKey.delete).toHaveBeenCalledWith({ keyId: 'key-1' });
    expect(client.getQueryData(['api-keys', 'org-1'])).toEqual([key]);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
