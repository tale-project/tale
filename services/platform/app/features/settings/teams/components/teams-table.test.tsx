import { createSelectColumn } from '@tale/ui/data-table/column-builders';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { backendKey } from '@/app/lib/backend/query-keys';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import type { Team } from '../hooks/queries';
import { TeamsTable } from './teams-table';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

vi.mock('../hooks/queries', () => ({
  useTeamMembers: () => ({ data: [], isLoading: false }),
}));

// The select column is opt-in per test: bulk delete is unreachable without it
// (it is what puts a checkbox in every row), while the a11y audits below keep
// running on the name-only shape they have always used. Adding it there would
// fail them on an UNRELATED, pre-existing finding — the production config does
// carry `createSelectColumn`, and its `<th>` renders empty in the loading
// state (axe `empty-table-header`), which belongs to the shared DataTable
// skeleton, not to this change.
const { columnConfig } = vi.hoisted(() => ({
  columnConfig: { selectable: false },
}));

vi.mock('../hooks/use-teams-table-config', () => ({
  useTeamsTableConfig: () => ({
    columns: [
      ...(columnConfig.selectable ? [createSelectColumn<Team>()] : []),
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

// Bulk delete runs the same atomic door as the single-row dialog
// (`DELETE /api/app/teams/:teamId`), one call per selected row.
const { deleteTeam } = vi.hoisted(() => ({ deleteTeam: vi.fn() }));
vi.mock('../hooks/mutations', () => ({
  useDeleteTeam: () => ({ mutateAsync: deleteTeam, isPending: false }),
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

/** The table reads the cache it invalidates, so it needs a real client. */
function renderTable(ui: ReactElement, client = new QueryClient()) {
  return {
    client,
    ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>),
  };
}

describe('TeamsTable', () => {
  // Regression for #2381: rendered under `SettingsPage` (no bounded-height
  // ancestor) the table must let the settings page own the vertical scroll. It
  // must NOT emit the sticky-layout inner scroll container (`overscroll-contain`
  // + `overflow-auto`), which collapses to content height and swallows the
  // wheel over the table. The non-sticky frame uses `overflow-x-auto` instead.
  it('does not render the sticky wheel-trap scroll container', () => {
    const { container } = renderTable(
      <TeamsTable teams={[makeTeam()]} organizationId="org-1" />,
    );

    expect(container.querySelector('.overscroll-contain')).toBeNull();
    expect(container.querySelector('.overflow-x-auto')).not.toBeNull();
  });

  describe('accessibility', () => {
    it('passes axe audit with teams', async () => {
      const { container } = renderTable(
        <TeamsTable
          teams={[makeTeam(), makeTeam({ id: 'team-2', name: 'Design' })]}
          organizationId="org-1"
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when empty', async () => {
      const { container } = renderTable(
        <TeamsTable teams={[]} organizationId="org-1" />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when loading', async () => {
      const { container } = renderTable(
        <TeamsTable teams={undefined} organizationId="org-1" />,
      );
      await checkAccessibility(container);
    });
  });

  // The bulk bar deletes one team per selected row and asks for the refetch
  // itself once the batch has run — it used to leave every deleted row on
  // screen until the page reloaded.
  describe('bulk delete', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      columnConfig.selectable = true;
      deleteTeam.mockResolvedValue({
        deleted: true,
        retirement: {
          projectsRetagged: 0,
          foldersRetagged: 0,
          documentsRetagged: 0,
          conversationsUnassigned: 0,
          syncConfigsUnscoped: 0,
          nowOrgWide: { projects: 0, folders: 0, documents: 0 },
        },
      });
    });

    afterEach(() => {
      columnConfig.selectable = false;
    });

    it('invalidates the org team reads once the batch has run', async () => {
      const client = new QueryClient();
      const teamsOfThisOrg = backendKey('org-1', 'team', 'org-list');
      const teamsOfOtherOrg = backendKey('org-b', 'team', 'org-list');
      client.setQueryData(teamsOfThisOrg, [makeTeam()]);
      client.setQueryData(teamsOfOtherOrg, [makeTeam({ id: 'team-b' })]);

      const { user } = renderTable(
        <TeamsTable
          teams={[makeTeam(), makeTeam({ id: 'team-2', name: 'Design' })]}
          organizationId="org-1"
        />,
        client,
      );

      const [firstRow] = screen.getAllByRole('checkbox', {
        name: 'Select row',
      });
      await user.click(firstRow as HTMLElement);
      await user.click(screen.getByRole('button', { name: /Delete/ }));
      const confirm = await screen.findByRole('dialog');
      await user.click(within(confirm).getByRole('button', { name: /Delete/ }));

      await waitFor(() =>
        expect(client.getQueryState(teamsOfThisOrg)?.isInvalidated).toBe(true),
      );
      expect(deleteTeam).toHaveBeenCalledWith({
        organizationId: 'org-1',
        teamId: 'team-1',
      });
      // Another organization's list is nobody else's business.
      expect(client.getQueryState(teamsOfOtherOrg)?.isInvalidated).toBe(false);
      client.clear();
    });
  });
});
