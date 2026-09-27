import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { DeleteMemberDialog } from './member-delete-dialog';

vi.mock('@tale/ui/use-toast', () => ({
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

  // E-07: the dialog removes a membership, not a team seat — teams are a
  // separate concept with their own Delete flow — so the question names
  // the organization, in line with the sentence that follows it.
  it('asks about the organization, never a team', () => {
    render(
      <DeleteMemberDialog
        open={true}
        onOpenChange={vi.fn()}
        member={makeMember()}
      />,
    );

    expect(
      screen.getByText(/Remove Alice from this organization\?/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/from the team/)).not.toBeInTheDocument();
  });
});
