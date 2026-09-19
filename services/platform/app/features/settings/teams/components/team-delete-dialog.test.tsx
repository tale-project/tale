import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import type { Team } from '../hooks/queries';
import { TeamDeleteDialog } from './team-delete-dialog';

/**
 * Deleting a team runs the app's atomic door after showing what it touches —
 * and, above all, how many items lose their ONLY team and become visible
 * to the whole organization.
 */
const { deleteTeam, impactState, toast } = vi.hoisted(() => ({
  deleteTeam: vi.fn(),
  impactState: {
    impact: undefined as
      | {
          teamId: string;
          name: string;
          memberCount: number;
          projects: { scoped: number; becomeOrgWide: number };
          folders: { scoped: number; becomeOrgWide: number };
          documents: { scoped: number; becomeOrgWide: number };
          conversations: { queued: number };
          syncConfigs: { scoped: number };
        }
      | undefined,
    isLoading: false,
  },
  toast: vi.fn(),
}));

vi.mock('@tale/ui/use-toast', () => ({ toast }));
vi.mock('../hooks/mutations', () => ({
  useDeleteTeam: () => ({ mutateAsync: deleteTeam, isPending: false }),
}));
vi.mock('../hooks/queries', () => ({
  useTeamDeletionImpact: () => impactState,
}));

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    name: 'Engineering',
    memberCount: 5,
    createdAt: Date.now(),
    ...overrides,
  };
}

const IMPACT = {
  teamId: 'team-1',
  name: 'Engineering',
  memberCount: 5,
  projects: { scoped: 3, becomeOrgWide: 1 },
  folders: { scoped: 2, becomeOrgWide: 0 },
  documents: { scoped: 12, becomeOrgWide: 4 },
  conversations: { queued: 1 },
  syncConfigs: { scoped: 0 },
};

describe('TeamDeleteDialog', () => {
  it('previews what the delete touches and how much becomes organization-wide', () => {
    impactState.impact = IMPACT;
    render(
      <TeamDeleteDialog
        open={true}
        onOpenChange={vi.fn()}
        team={makeTeam()}
        organizationId="org-1"
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete team' });
    expect(dialog).toHaveTextContent('This team has 5 members.');
    expect(dialog).toHaveTextContent(
      'It is on the audience of 3 projects, 2 folders and 12 documents, and 1 conversation is in its queue.',
    );
    // 1 project + 4 documents lose their only team.
    expect(dialog).toHaveTextContent(
      '5 items have no other team and will become visible to everyone in the organization.',
    );
  });

  it('says nothing about widening when every scoped item keeps another team', () => {
    impactState.impact = {
      ...IMPACT,
      projects: { scoped: 3, becomeOrgWide: 0 },
      documents: { scoped: 12, becomeOrgWide: 0 },
    };
    render(
      <TeamDeleteDialog
        open={true}
        onOpenChange={vi.fn()}
        team={makeTeam()}
        organizationId="org-1"
      />,
    );
    expect(
      screen.getByRole('dialog', { name: 'Delete team' }),
    ).not.toHaveTextContent(/will become visible to everyone/);
  });

  it('deletes through the atomic door and closes on success', async () => {
    impactState.impact = IMPACT;
    deleteTeam.mockResolvedValueOnce({ deleted: true });
    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();
    const { user } = render(
      <TeamDeleteDialog
        open={true}
        onOpenChange={onOpenChange}
        team={makeTeam()}
        organizationId="org-1"
        onSuccess={onSuccess}
      />,
    );
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete team' })).getByRole(
        'button',
        {
          name: 'Delete',
        },
      ),
    );
    await waitFor(() =>
      expect(deleteTeam).toHaveBeenCalledWith({
        organizationId: 'org-1',
        teamId: 'team-1',
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSuccess).toHaveBeenCalled();
  });

  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      impactState.impact = IMPACT;
      const { container } = render(
        <TeamDeleteDialog
          open={true}
          onOpenChange={vi.fn()}
          team={makeTeam()}
          organizationId="org-1"
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when closed', async () => {
      const { container } = render(
        <TeamDeleteDialog
          open={false}
          onOpenChange={vi.fn()}
          team={makeTeam()}
          organizationId="org-1"
        />,
      );
      await checkAccessibility(container);
    });
  });
});
