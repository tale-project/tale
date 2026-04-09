import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { DeleteMemberDialog } from './member-delete-dialog';

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useRemoveMember: () => ({ mutateAsync: vi.fn() }),
}));

function makeMember() {
  return {
    _id: 'member-1',
    organizationId: 'org-1',
    email: 'alice@example.com',
    displayName: 'Alice',
    role: 'member',
  };
}

describe('DeleteMemberDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <DeleteMemberDialog
          open={true}
          onOpenChange={vi.fn()}
          member={makeMember()}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when open with admin member', async () => {
      const { container } = render(
        <DeleteMemberDialog
          open={true}
          onOpenChange={vi.fn()}
          member={{ ...makeMember(), role: 'admin' }}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when member is null', async () => {
      const { container } = render(
        <DeleteMemberDialog open={true} onOpenChange={vi.fn()} member={null} />,
      );
      await checkAccessibility(container);
    });
  });
});
