import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import type { Team } from '../hooks/queries';
import { TeamsTable } from './teams-table';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

vi.mock('../hooks/use-teams-table-config', () => ({
  useTeamsTableConfig: () => ({
    columns: [
      {
        accessorKey: 'name',
        header: 'Name',
      },
    ],
    searchPlaceholder: 'Search teams...',
    stickyLayout: true,
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
    createdAt: new Date(),
    ...overrides,
  } as Team;
}

describe('TeamsTable', () => {
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
