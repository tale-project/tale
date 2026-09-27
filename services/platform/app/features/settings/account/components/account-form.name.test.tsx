// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { USER_NAME_MAX_LENGTH } from '@/lib/shared/constants/user-name';
import { render, screen, waitFor } from '@/tests/utils/render';

// The server refuses a display name past 100 characters, and the form used
// to let one through: the save then failed on a generic toast with nothing
// on the field. The field now names the limit before anything is sent.

const { updateUserName } = vi.hoisted(() => ({ updateUserName: vi.fn() }));

vi.mock('@/app/features/auth/hooks/queries', () => ({
  useHasCredentialAccount: () => ({ data: false, isLoading: false }),
}));

vi.mock('@/app/hooks/use-session-user', () => ({
  useAuth: () => ({
    user: { userId: 'member-1', email: 'member@example.test', name: 'Mia' },
    isLoading: false,
    signOut: vi.fn().mockResolvedValue(undefined),
  }),
  useSessionUser: () => ({ isLoading: false, isAuthenticated: true }),
}));

vi.mock('@tale/ui/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../hooks/mutations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/mutations')>()),
  useUpdateUserName: () => ({ mutateAsync: updateUserName }),
}));

// The other sections read their own backends; none of them is under test.
vi.mock('./role-section', () => ({ RoleSection: () => null }));
vi.mock('./teams-section', () => ({ TeamsSection: () => null }));
vi.mock('./two-factor-section', () => ({ TwoFactorSection: () => null }));
vi.mock('./passkey-section', () => ({ PasskeySection: () => null }));
vi.mock('./chats-section', () => ({ ChatsSection: () => null }));

import { AccountForm } from './account-form';

const TOO_LONG = `Name must be ${USER_NAME_MAX_LENGTH} characters or fewer`;

function renderAccountForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AccountForm />
    </QueryClientProvider>,
  );
}

describe('AccountForm name', () => {
  beforeEach(() => {
    updateUserName.mockReset();
    updateUserName.mockResolvedValue(null);
  });

  it("refuses a name past the server's limit in the field, before any save", async () => {
    const { user } = renderAccountForm();
    const name = screen.getByRole('textbox', { name: 'Name' });

    await user.clear(name);
    await user.click(name);
    await user.paste('x'.repeat(USER_NAME_MAX_LENGTH + 1));
    await user.keyboard('{Enter}');

    expect(await screen.findByText(TOO_LONG)).toBeInTheDocument();
    expect(updateUserName).not.toHaveBeenCalled();
  });

  it('saves a name exactly at the limit', async () => {
    const { user } = renderAccountForm();
    const name = screen.getByRole('textbox', { name: 'Name' });
    const longest = 'x'.repeat(USER_NAME_MAX_LENGTH);

    await user.clear(name);
    await user.click(name);
    await user.paste(longest);
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(updateUserName).toHaveBeenCalledWith({ name: longest }),
    );
    expect(screen.queryByText(TOO_LONG)).toBeNull();
  });
});
