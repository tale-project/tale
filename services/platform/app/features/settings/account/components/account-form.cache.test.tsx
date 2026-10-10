import {
  ActiveEditorProvider,
  EditorActions,
  useActiveEditor,
} from '@tale/ui/editor';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '@/app/hooks/use-session-user';
import { sessionQueryOptions } from '@/app/lib/auth/session-query';
import { currentUserQuery } from '@/app/lib/backend/account';
import { render, screen, waitFor } from '@/tests/utils/render';

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock('@tale/ui/use-toast', () => ({
  toast: toastMock,
  useToast: () => ({ toast: toastMock }),
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession: vi.fn() },
}));
vi.mock('@/app/features/auth/hooks/queries', () => ({
  useHasCredentialAccount: () => ({ data: false, isLoading: false }),
}));
vi.mock('../hooks/queries', () => ({ useMyPasswordPolicy: () => null }));
vi.mock('./role-section', () => ({ RoleSection: () => null }));
vi.mock('./teams-section', () => ({ TeamsSection: () => null }));
vi.mock('./two-factor-section', () => ({ TwoFactorSection: () => null }));
vi.mock('./passkey-section', () => ({ PasskeySection: () => null }));
vi.mock('./chats-section', () => ({ ChatsSection: () => null }));

import { AccountForm } from './account-form';

function HeaderSlot() {
  const controller = useActiveEditor();
  return controller ? (
    <EditorActions controller={controller} entityKind="settings" />
  ) : null;
}

function SharedUserReader() {
  const { user } = useAuth();
  return <output aria-label="Shared user name">{user?.name}</output>;
}

function renderAccount() {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(currentUserQuery().queryKey, {
    userId: 'member-1',
    email: 'member@example.test',
    name: 'Mia',
  });
  client.setQueryData(sessionQueryOptions.queryKey, {
    data: null,
    error: null,
  });
  const result = render(
    <QueryClientProvider client={client}>
      <ActiveEditorProvider>
        <HeaderSlot />
        <AccountForm />
        <SharedUserReader />
      </ActiveEditorProvider>
    </QueryClientProvider>,
  );
  return { ...result, client };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('account name cache', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/dashboard/org-1/settings/account');
    window.__ENV__ = { BASE_PATH: '' };
    toastMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
    delete window.__ENV__;
  });

  it('refreshes mounted readers and Discard restores the last saved name', async () => {
    let savedName = 'Mia';
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockImplementation(async (input) => {
        if (String(input) === '/api/app/users/update-name?orgId=org-1') {
          savedName = 'Mia Rossi';
          return jsonResponse(200, { ok: true });
        }
        if (String(input) === '/api/app/users/me') {
          return jsonResponse(200, {
            user: {
              userId: 'member-1',
              email: 'member@example.test',
              name: savedName,
            },
          });
        }
        throw new Error(`Unexpected fetch: ${String(input)}`);
      });
    const { user, client } = renderAccount();
    const name = screen.getByRole('textbox', { name: 'Name' });

    await user.clear(name);
    await user.type(name, 'Mia Rossi');
    await user.click(await screen.findByRole('button', { name: /^save$/i }));
    await screen.findByText('Saved');

    await waitFor(() =>
      expect(screen.getByLabelText('Shared user name')).toHaveTextContent(
        'Mia Rossi',
      ),
    );
    expect(client.getQueryData(currentUserQuery().queryKey)).toMatchObject({
      name: 'Mia Rossi',
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/app/users/update-name?orgId=org-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Mia Rossi' }),
      }),
    );

    await user.clear(name);
    await user.type(name, 'Unsaved draft');
    await user.click(await screen.findByRole('button', { name: /^discard$/i }));
    expect(name).toHaveValue('Mia Rossi');
    expect(toastMock).not.toHaveBeenCalled();
    client.clear();
  });

  it('keeps the draft and cached name and reports one toast when Enter-save fails', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(async () =>
      jsonResponse(400, {
        error: 'invalid_name',
        message: 'Name was refused',
      }),
    );
    const { user, client } = renderAccount();
    const name = screen.getByRole('textbox', { name: 'Name' });

    await user.clear(name);
    await user.type(name, 'Mia Rossi');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
    expect(name).toHaveValue('Mia Rossi');
    expect(screen.getByLabelText('Shared user name')).toHaveTextContent('Mia');
    expect(client.getQueryData(currentUserQuery().queryKey)).toMatchObject({
      name: 'Mia',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(
      client.getQueryState(currentUserQuery().queryKey)?.isInvalidated,
    ).toBe(false);
    client.clear();
  });
});
