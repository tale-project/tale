import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { USER_NAME_MAX_LENGTH } from '@/lib/shared/constants/user-name';
import { checkAccessibility } from '@/tests/utils/a11y';
import { fireEvent, render, screen, waitFor } from '@/tests/utils/render';

import { EditMemberDialog } from './member-edit-dialog';

const { updateNameMock, updateRoleMock, setPasswordMock, toastMock } =
  vi.hoisted(() => ({
    updateNameMock: vi.fn(),
    updateRoleMock: vi.fn(),
    setPasswordMock: vi.fn(),
    toastMock: vi.fn(),
  }));

vi.mock('@tale/ui/use-toast', () => ({ toast: toastMock }));

vi.mock('../hooks/mutations', () => ({
  useUpdateMemberDisplayName: () => ({ mutateAsync: updateNameMock }),
  useUpdateMemberRole: () => ({ mutateAsync: updateRoleMock }),
  useSetMemberPassword: () => ({ mutateAsync: setPasswordMock }),
  useResetMemberTwoFactor: () => ({ mutateAsync: vi.fn() }),
  useRevokeMemberPasskey: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../hooks/queries', () => ({
  useMemberPasskeys: () => ({ data: [] }),
}));

vi.mock('@/app/features/settings/governance/hooks/queries', async () => {
  const { DEFAULT_PASSWORD_POLICY } =
    await import('@tale/shared/schemas/governance');
  return { usePasswordPolicy: () => DEFAULT_PASSWORD_POLICY };
});

function renderDialog(
  memberOverrides: Partial<
    NonNullable<Parameters<typeof EditMemberDialog>[0]['member']>
  > = {},
) {
  const onOpenChange = vi.fn();
  return {
    onOpenChange,
    ...render(
      <EditMemberDialog
        open
        onOpenChange={onOpenChange}
        member={{
          _id: 'member-1',
          organizationId: 'org-1',
          displayName: 'Alice',
          email: 'alice@example.com',
          role: 'member',
          ...memberOverrides,
        }}
      />,
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  updateNameMock.mockResolvedValue(null);
});

afterEach(() => {
  localStorage.removeItem('user-locale');
});

describe('EditMemberDialog name validation', () => {
  it.each([
    ['   ', 'Name is required'],
    [
      'a'.repeat(USER_NAME_MAX_LENGTH + 1),
      'Name must be 100 characters or fewer',
    ],
  ])(
    'refuses the invalid draft %j without sending it',
    async (draft, error) => {
      const { user, onOpenChange } = renderDialog();
      const input = screen.getByRole('textbox', { name: /^Name/ });
      await user.clear(input);
      await user.type(input, draft);
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(error);
      expect(input).toHaveValue(draft);
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAccessibleDescription(error);
      expect(updateNameMock).not.toHaveBeenCalled();
      expect(updateRoleMock).not.toHaveBeenCalled();
      expect(setPasswordMock).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();

      const form = input.closest('form');
      if (!form) throw new Error('Name must be inside the member form');
      fireEvent.submit(form);
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(error),
      );
      expect(updateNameMock).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();

      await checkAccessibility(screen.getByRole('dialog'));

      await user.clear(input);
      await user.type(input, 'Bob');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(updateNameMock).toHaveBeenCalledExactlyOnceWith({
        memberId: 'member-1',
        displayName: 'Bob',
      });
    },
  );

  it.each([
    'Bob',
    '  Bob  ',
    'B',
    'a'.repeat(USER_NAME_MAX_LENGTH),
    `  ${'a'.repeat(USER_NAME_MAX_LENGTH)}  `,
  ])('saves the valid trimmed name %j and closes', async (draft) => {
    const { user, onOpenChange } = renderDialog();
    const input = screen.getByRole('textbox', { name: /^Name/ });
    await user.clear(input);
    await user.type(input, draft);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(updateNameMock).toHaveBeenCalledExactlyOnceWith({
      memberId: 'member-1',
      displayName: draft.trim(),
    });
    expect(updateRoleMock).not.toHaveBeenCalled();
    expect(setPasswordMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'success' }),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['en', 'de', 'fr', 'de-CH'])(
    'renders both inline name errors in %s',
    async (locale) => {
      localStorage.setItem('user-locale', locale);
      const { user, onOpenChange } = renderDialog();
      const tSettings = i18n.getFixedT(locale, 'settings');
      const tCommon = i18n.getFixedT(locale, 'common');
      const name = tSettings('form.name');
      const input = await screen.findByRole('textbox', {
        name: new RegExp(`^${name}`),
      });

      for (const [draft, error] of [
        ['   ', tCommon('validation.required', { field: name })],
        [
          'a'.repeat(USER_NAME_MAX_LENGTH + 1),
          tCommon('validation.maxLength', { field: name, max: 100 }),
        ],
      ]) {
        await user.clear(input);
        await user.type(input, draft);
        await user.tab();
        expect(await screen.findByRole('alert')).toHaveTextContent(error);
        expect(input).toHaveValue(draft);
        expect(input).toHaveAccessibleDescription(error);
        expect(updateNameMock).not.toHaveBeenCalled();
        expect(onOpenChange).not.toHaveBeenCalled();
      }
    },
  );
});

describe('EditMemberDialog unrelated edits with legacy names', () => {
  it.each([
    ['   ', 'role', 'Editor'],
    ['x'.repeat(USER_NAME_MAX_LENGTH + 20), 'role', 'Editor'],
    ['   ', 'disable', 'Disabled'],
    ['x'.repeat(USER_NAME_MAX_LENGTH + 20), 'disable', 'Disabled'],
  ])(
    'saves a %s legacy name when changing %s',
    async (displayName, operation, role) => {
      const { user, onOpenChange } = renderDialog({ displayName });
      const roleSelect = screen.getByRole('combobox', { name: 'Role' });
      await user.click(roleSelect);
      await user.click(screen.getByRole('option', { name: role }));
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(updateRoleMock).toHaveBeenCalledExactlyOnceWith({
        memberId: 'member-1',
        role: role.toLowerCase(),
      });
      expect(updateNameMock).not.toHaveBeenCalled();
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'success' }),
      );
    },
  );

  it.each(['   ', 'x'.repeat(USER_NAME_MAX_LENGTH + 20)])(
    'saves a %s legacy name when changing the password',
    async (displayName) => {
      const { user, onOpenChange } = renderDialog({ displayName });
      await user.click(
        screen.getByRole('checkbox', { name: /Update password/i }),
      );
      await user.type(screen.getByLabelText('Password'), 'ValidPassword1!');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(setPasswordMock).toHaveBeenCalledExactlyOnceWith({
        memberId: 'member-1',
        newPassword: 'ValidPassword1!',
      });
      expect(updateNameMock).not.toHaveBeenCalled();
      expect(updateRoleMock).not.toHaveBeenCalled();
    },
  );

  it('does not rewrite surrounding whitespace during an unrelated edit', async () => {
    const { user, onOpenChange } = renderDialog({ displayName: ' Alice ' });
    const roleSelect = screen.getByRole('combobox', { name: 'Role' });
    await user.click(roleSelect);
    await user.click(screen.getByRole('option', { name: 'Editor' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(updateRoleMock).toHaveBeenCalledExactlyOnceWith({
      memberId: 'member-1',
      role: 'editor',
    });
    expect(updateNameMock).not.toHaveBeenCalled();
  });
});
