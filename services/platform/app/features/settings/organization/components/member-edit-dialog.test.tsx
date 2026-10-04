import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { EditMemberDialog } from './member-edit-dialog';

const {
  revokeMemberPasskeyMock,
  resetMemberTwoFactorMock,
  setMemberPasswordMock,
  updateMemberDisplayNameMock,
  updateMemberRoleMock,
  toastMock,
} = vi.hoisted(() => ({
  revokeMemberPasskeyMock: vi.fn(),
  resetMemberTwoFactorMock: vi.fn(),
  setMemberPasswordMock: vi.fn(),
  updateMemberDisplayNameMock: vi.fn(),
  updateMemberRoleMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock('@tale/ui/use-toast', () => ({
  toast: toastMock,
}));

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  usePasswordPolicy: () => ({
    minLength: 12,
    requireLowercase: true,
    requireUppercase: true,
    requireNumber: true,
    requireSpecialChar: true,
  }),
}));

vi.mock('../hooks/mutations', () => ({
  useResetMemberTwoFactor: () => ({ mutateAsync: resetMemberTwoFactorMock }),
  useRevokeMemberPasskey: () => ({ mutateAsync: revokeMemberPasskeyMock }),
  useSetMemberPassword: () => ({ mutateAsync: setMemberPasswordMock }),
  useUpdateMemberDisplayName: () => ({
    mutateAsync: updateMemberDisplayNameMock,
  }),
  useUpdateMemberRole: () => ({ mutateAsync: updateMemberRoleMock }),
}));

vi.mock('../hooks/queries', () => ({
  useMemberPasskeys: () => ({ data: undefined }),
}));

const member = {
  _id: 'member-1',
  organizationId: 'org-1',
  displayName: 'Alice',
  email: 'alice@example.com',
  role: 'member',
};

function renderDialog(onOpenChange = vi.fn()) {
  return render(
    <EditMemberDialog open onOpenChange={onOpenChange} member={member} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  updateMemberDisplayNameMock.mockResolvedValue(undefined);
  updateMemberRoleMock.mockResolvedValue(undefined);
  setMemberPasswordMock.mockResolvedValue(undefined);
  resetMemberTwoFactorMock.mockResolvedValue(undefined);
  revokeMemberPasskeyMock.mockResolvedValue(undefined);
});

describe('EditMemberDialog', () => {
  it('passes axe audit when open', async () => {
    const { container } = renderDialog();
    await checkAccessibility(container);
  });

  it('keeps the failed draft open and announces the save refusal', async () => {
    const onOpenChange = vi.fn();
    updateMemberDisplayNameMock.mockRejectedValueOnce(
      new Error('display name refused'),
    );
    const { user } = renderDialog(onOpenChange);
    const name = screen.getByRole('textbox', { name: /^Name/i });

    await user.clear(name);
    await user.type(name, 'A repaired name');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        "Couldn't save the member — try again.",
      );
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(name).toHaveValue('A repaired name');
    expect(toastMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'success' }),
    );
  });

  it('closes and reports success after the update succeeds', async () => {
    const onOpenChange = vi.fn();
    const { user } = renderDialog(onOpenChange);
    const name = screen.getByRole('textbox', { name: /^Name/i });

    await user.clear(name);
    await user.type(name, 'A new name');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastMock).toHaveBeenCalledWith({
      title: 'Member updated',
      variant: 'success',
    });
  });
});
