import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { TeamCreateDialog } from './team-create-dialog';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    organization: {
      createTeam: vi.fn(),
    },
    getSession: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
  },
}));

vi.mock('../hooks/mutations', () => ({
  useCreateTeamMember: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('./team-member-checklist', () => ({
  TeamMemberChecklist: () => <div data-testid="member-checklist">Members</div>,
}));

describe('TeamCreateDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <TeamCreateDialog
          organizationId="org-1"
          open={true}
          onOpenChange={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when closed', async () => {
      const { container } = render(
        <TeamCreateDialog
          organizationId="org-1"
          open={false}
          onOpenChange={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
