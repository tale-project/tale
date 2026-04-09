import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { MemberRowActions } from './member-row-actions';

vi.mock('@/app/hooks/use-toast', () => ({
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

function makeMember() {
  return {
    _id: 'member-1',
    organizationId: 'org-1',
    email: 'alice@example.com',
    role: 'member',
    displayName: 'Alice',
  };
}

describe('MemberRowActions', () => {
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
