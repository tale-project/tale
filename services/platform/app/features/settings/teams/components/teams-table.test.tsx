import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import type { Team } from '../hooks/queries';
import { TeamsTable } from './teams-table';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

vi.mock('../hooks/queries', () => ({
  useTeamMembers: () => ({ data: [], isLoading: false }),
}));

vi.mock('../hooks/use-teams-table-config', () => ({
  useTeamsTableConfig: () => ({
    columns: [
      {
        accessorKey: 'name',
        header: 'Name',
      },
    ],
    searchPlaceholder: 'Search teams',
    stickyLayout: false,
    pageSize: 20,
  }),
}));

vi.mock('./teams-action-menu', () => ({
  TeamsActionMenu: () => <button type="button">Create team</button>,
}));

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    name: 'Engineering',
    memberCount: 5,
    createdAt: Date.now(),
    ...overrides,
  } as Team;
}

describe('TeamsTable', () => {
  // Regression for #2381: rendered under `SettingsPage` (no bounded-height
  // ancestor) the table must let the settings page own the vertical scroll. It
  // must NOT emit the sticky-layout inner scroll container (`overscroll-contain`
  // + `overflow-auto`), which collapses to content height and swallows the
  // wheel over the table. The non-sticky frame uses `overflow-x-auto` instead.
  it('does not render the sticky wheel-trap scroll container', () => {
    const { container } = render(
      <TeamsTable teams={[makeTeam()]} organizationId="org-1" />,
    );

    expect(container.querySelector('.overscroll-contain')).toBeNull();
    expect(container.querySelector('.overflow-x-auto')).not.toBeNull();
  });

  describe('accessibility', () => {
    it('passes axe audit with teams', async () => {
      const { container } = render(
        <TeamsTable
          teams={[makeTeam(), makeTeam({ id: 'team-2', name: 'Design' })]}
          organizationId="org-1"
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when empty', async () => {
      const { container } = render(
        <TeamsTable teams={[]} organizationId="org-1" />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when loading', async () => {
      const { container } = render(
        <TeamsTable teams={undefined} organizationId="org-1" />,
      );
      await checkAccessibility(container);
    });
  });
});
