import { describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor, within } from '@/tests/utils/render';

import { ProjectSharingSection } from './project-sharing-section';

/**
 * The audience editor confirms a change that NARROWS access — from
 * organization-wide to some teams, or dropping a team while others remain —
 * and saves a widening (adding a team, or clearing every team so the whole
 * organization sees the project) straight away. Clearing the last team used
 * to be mistaken for a narrowing: the removed team was "no longer in the
 * upcoming set", although everyone, that team included, keeps access.
 */
const { updateSharing } = vi.hoisted(() => ({ updateSharing: vi.fn() }));

vi.mock('../hooks/mutations', () => ({
  useUpdateProjectSharing: () => ({
    mutateAsync: updateSharing,
    isPending: false,
  }),
}));
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => ({
    teams: [
      { id: 't-one', name: 'Team One', memberCount: 2, createdAt: 0 },
      { id: 't-two', name: 'Team Two', memberCount: 3, createdAt: 0 },
    ],
    isLoading: false,
  }),
  useTeamNames: () => ({
    nameOf: (id: string) => ({ 't-one': 'Team One', 't-two': 'Team Two' })[id],
    isLoading: false,
    teams: [],
  }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock('@tale/ui/use-toast', () => ({ toast: vi.fn() }));

const NARROWS = /This change narrows access/;

function renderSection(teamIds: string[], canAdminister = true) {
  return render(
    <ProjectSharingSection
      projectId="p-1"
      organizationId="org-1"
      teamIds={teamIds}
      canAdminister={canAdminister}
    />,
  );
}

describe('ProjectSharingSection', () => {
  it('saves straight away when the last team is cleared — the whole organization gains access', async () => {
    updateSharing.mockResolvedValueOnce(undefined);
    const { user } = renderSection(['t-one']);
    await user.click(screen.getByRole('button', { name: 'Remove Team One' }));
    await waitFor(() =>
      expect(updateSharing).toHaveBeenCalledWith({
        projectId: 'p-1',
        teamIds: [],
      }),
    );
    expect(screen.queryByText(NARROWS)).not.toBeInTheDocument();
  });

  it('asks before dropping one of several teams, and saves only on Confirm', async () => {
    updateSharing.mockClear();
    updateSharing.mockResolvedValueOnce(undefined);
    const { user } = renderSection(['t-one', 't-two']);
    await user.click(screen.getByRole('button', { name: 'Remove Team One' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(NARROWS);
    expect(updateSharing).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(updateSharing).toHaveBeenCalledWith({
        projectId: 'p-1',
        teamIds: ['t-two'],
      }),
    );
  });

  it('asks before taking an organization-wide project to some teams', async () => {
    updateSharing.mockClear();
    const { user } = renderSection([]);
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Team One' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent(NARROWS);
    expect(updateSharing).not.toHaveBeenCalled();
  });

  it('shows a non-admin the audience by name, read-only', () => {
    renderSection(['t-two'], false);
    expect(screen.getByText('Team Two')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
