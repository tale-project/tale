import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { MemberRowActions } from './member-row-actions';

vi.mock('@tale/ui/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../hooks/mutations', () => ({
  useRemoveMember: () => ({ mutateAsync: vi.fn() }),
  useSetMemberPassword: () => ({ mutateAsync: vi.fn() }),
  useCreateMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('./member-edit-dialog', () => ({
  EditMemberDialog: () => null,
}));

vi.mock('./transfer-ownership-dialog', () => ({
  TransferOwnershipDialog: () => null,
}));

vi.mock('./member-rights-dialog', () => ({
  MemberRightsDialog: ({
    open,
    member,
  }: {
    open: boolean;
    member: { userId: string };
  }) =>
    open ? (
      <div role="dialog" aria-label={`Rights of ${member.userId}`} />
    ) : null,
}));

vi.mock(
  '@/app/features/settings/api-keys/components/member-api-keys-dialog',
  () => ({
    MemberApiKeysDialog: ({
      open,
      member,
    }: {
      open: boolean;
      member: { userId: string };
    }) =>
      open ? (
        <div role="dialog" aria-label={`API keys of ${member.userId}`} />
      ) : null,
  }),
);

function makeMember() {
  return {
    _id: 'member-1',
    organizationId: 'org-1',
    userId: 'user-1',
    email: 'alice@example.com',
    role: 'member',
    displayName: 'Alice',
  };
}

describe('MemberRowActions', () => {
  it('offers owners and admins the Rights of each member [GOV-R21]', async () => {
    const { user } = render(
      <MemberRowActions
        member={makeMember()}
        memberContext={{
          member: { ...makeMember(), _id: 'member-2' },
          role: 'admin',
          isAdmin: true,
          canManageMembers: true,
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Rights' }));
    expect(
      await screen.findByRole('dialog', { name: 'Rights of user-1' }),
    ).toBeInTheDocument();
  });

  it('offers no Rights to anyone else [GOV-R21]', async () => {
    const { user } = render(
      <MemberRowActions
        member={makeMember()}
        memberContext={{
          member: makeMember(),
          role: 'member',
          isAdmin: false,
          canManageMembers: false,
        }}
      />,
    );
    const trigger = screen.queryByRole('button', { name: 'Open menu' });
    if (trigger !== null) await user.click(trigger);
    expect(
      screen.queryByRole('menuitem', { name: 'Rights' }),
    ).not.toBeInTheDocument();
  });

  it('offers owners and admins a member’s personal API keys [APIKEY-R11]', async () => {
    const { user } = render(
      <MemberRowActions
        member={makeMember()}
        memberContext={{
          member: { ...makeMember(), _id: 'member-2' },
          role: 'admin',
          isAdmin: true,
          canManageMembers: true,
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Personal API keys' }),
    );
    expect(
      await screen.findByRole('dialog', { name: 'API keys of user-1' }),
    ).toBeInTheDocument();
  });

  it('offers no personal API keys on one’s own row, nor to a member [APIKEY-R11]', async () => {
    const own = render(
      <MemberRowActions
        member={makeMember()}
        memberContext={{
          member: makeMember(),
          role: 'admin',
          isAdmin: true,
          canManageMembers: true,
        }}
      />,
    );
    const ownTrigger = screen.queryByRole('button', { name: 'Open menu' });
    if (ownTrigger !== null) await own.user.click(ownTrigger);
    expect(
      screen.queryByRole('menuitem', { name: 'Personal API keys' }),
    ).not.toBeInTheDocument();
    own.unmount();

    const { user } = render(
      <MemberRowActions
        member={makeMember()}
        memberContext={{
          member: { ...makeMember(), _id: 'member-2' },
          role: 'member',
          isAdmin: false,
          canManageMembers: false,
        }}
      />,
    );
    const trigger = screen.queryByRole('button', { name: 'Open menu' });
    if (trigger !== null) await user.click(trigger);
    expect(
      screen.queryByRole('menuitem', { name: 'Personal API keys' }),
    ).not.toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit with manage permissions', async () => {
      const { container } = render(
        <MemberRowActions
          member={makeMember()}
          memberContext={{
            member: { ...makeMember(), _id: 'member-2' },
            role: 'admin',
            isAdmin: true,
            canManageMembers: true,
          }}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit without manage permissions', async () => {
      const { container } = render(
        <MemberRowActions
          member={makeMember()}
          memberContext={{
            member: makeMember(),
            role: 'member',
            isAdmin: false,
            canManageMembers: false,
          }}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
