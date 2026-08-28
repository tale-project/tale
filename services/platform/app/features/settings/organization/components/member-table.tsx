'use client';

import { Stack, HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ColumnDef, RowSelectionState } from '@tanstack/react-table';
import { Users } from 'lucide-react';
import { useMemo, useCallback, useState } from 'react';

import { TableTimestampCell } from '@/app/components/ui/data-display/table-date-cell';
import {
  ACTIONS_COLUMN_SIZE,
  createSelectColumn,
} from '@/app/components/ui/data-table/column-builders';
import {
  DataTable,
  type DataTableAddAction,
} from '@/app/components/ui/data-table/data-table';
import { BulkDeleteBar } from '@/app/components/ui/data-table/data-table-bulk-actions';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';
import { getRoleBadgeClasses } from '@/lib/utils/badge-colors';

import { useRemoveMember } from '../hooks/mutations';
import { MemberRowActions } from './member-row-actions';

type Member = {
  _id: string;
  createdAt: number;
  organizationId: string;
  userId: string;
  email?: string;
  role?: string;
  displayName?: string;
  twoFactorEnabled?: boolean;
  passkeyCount?: number;
};

interface MemberContext {
  member: Member | null;
  role: string | null;
  isAdmin: boolean;
  canManageMembers?: boolean;
}

interface MemberTableProps {
  members: Member[];
  memberContext?: MemberContext | null;
  isLoading?: boolean;
  approxRowCount?: number;
  /** The primary action (Add member) — DataTable renders it at the standard
   *  size and placement, so the page reads exactly like the Teams table. */
  addAction?: DataTableAddAction;
}

export function MemberTable({
  members,
  memberContext,
  isLoading,
  approxRowCount,
  addAction,
}: MemberTableProps) {
  const { t: tTables } = useT('tables');
  const { t: tSettings } = useT('settings');
  const { t: tEmpty } = useT('emptyStates');
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const removeMember = useRemoveMember();

  const handleClearSelection = useCallback(() => {
    setRowSelection({});
  }, []);

  const handleDeleteItem = useCallback(
    async (id: string) => {
      // `removeMember` takes the member doc's id as `v.string()` (the
      // members table lives in the better-auth component, not Convex's
      // user table — so no `Id<'members'>` schema type). The row id we
      // pull from RowSelectionState matches `Member._id` directly.
      // Let failures propagate so `BulkDeleteBar` surfaces a single batch
      // toast instead of one per failed row.
      await removeMember.mutateAsync({ memberId: id });
    },
    [removeMember],
  );

  // Column sizes double as the table's min-width floor (DataTable sums them).
  // Keep the total within the full-width settings page budget (≤ 940px) so the
  // table never forces horizontal scroll on the Organization page.
  const columns = useMemo<ColumnDef<Member>[]>(
    () => [
      // Multi-row select — canonical 40px column. Enables bulk-remove via
      // the `BulkDeleteBar` footer. Selection of the current-user row and
      // the owner row is gated by `enableRowSelection` below, so neither a
      // self-removal nor an always-failing owner row can enter a batch.
      createSelectColumn<Member>(),
      {
        id: 'member',
        header: tTables('headers.member'),
        cell: ({ row }) => {
          const member = row.original;
          return (
            <Stack gap={0}>
              <Text as="span" variant="label" className="block truncate">
                {member.displayName || member.email || tTables('cells.unknown')}
              </Text>
              {member.displayName &&
                member.email &&
                member.displayName !== member.email && (
                  <Text as="span" variant="caption" className="block truncate">
                    {member.email}
                  </Text>
                )}
            </Stack>
          );
        },
        size: 212,
      },
      {
        id: 'role',
        header: tTables('headers.role'),
        cell: ({ row }) => {
          const role = row.original.role;
          const roleKey = role
            ? (`roles.${role.toLowerCase()}` as const)
            : 'roles.disabled';
          return (
            <span
              className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${getRoleBadgeClasses(
                role,
              )}`}
            >
              {tSettings(roleKey as Parameters<typeof tSettings>[0])}
            </span>
          );
        },
        size: 112,
      },
      {
        id: 'joined',
        header: () => (
          <div className="text-right">{tTables('headers.joined')}</div>
        ),
        cell: ({ row }) => (
          <TableTimestampCell
            timestamp={row.original.createdAt}
            preset="relative"
          />
        ),
        size: 120,
      },
      {
        id: 'actions',
        header: '',
        // Locked to `ACTIONS_COLUMN_SIZE` so the 3-dot column aligns with
        // every other table's actions column.
        size: ACTIONS_COLUMN_SIZE,
        cell: ({ row }) => (
          <HStack gap={1} justify="end">
            <MemberRowActions
              member={row.original}
              memberContext={memberContext}
            />
          </HStack>
        ),
      },
    ],
    [memberContext, tTables, tSettings],
  );

  // Same list shape as the Teams table: search and pagination come from the
  // shared list-page hook, so the two people pages read identically.
  const list = useListPage<Member>({
    dataSource: { type: 'query', data: members },
    pageSize: 10,
    search: {
      fields: ['displayName', 'email'],
      placeholder: tSettings('organization.searchMember'),
    },
    getRowId: (row) => row._id,
    entityLabel: {
      one: tSettings('organization.memberEntityLabel'),
      other: tSettings('organization.membersEntityLabel'),
    },
  });

  return (
    <DataTable
      columns={columns}
      isLoading={isLoading}
      approxRowCount={approxRowCount}
      addAction={addAction}
      // Mirror the single-row Delete gating (`member-row-actions.tsx`): the
      // current user's own row and the owner row are not selectable for
      // bulk-remove. Self-removal is a self-lockout + irreversible
      // personalization wipe, and the owner is backend-protected (a bulk
      // batch including it would partial-fail). The backend `removeMember`
      // enforces both as defense in depth.
      enableRowSelection={(row) =>
        row.original._id !== memberContext?.member?._id &&
        row.original.role?.toLowerCase() !== 'owner'
      }
      rowSelection={rowSelection}
      onRowSelectionChange={setRowSelection}
      emptyState={{
        icon: Users,
        title: tEmpty('members.title'),
        description: tEmpty('members.description'),
      }}
      footer={
        <BulkDeleteBar
          rowSelection={rowSelection}
          onClearSelection={handleClearSelection}
          onDeleteItem={handleDeleteItem}
          onDeleteComplete={handleClearSelection}
        />
      }
      {...list.tableProps}
    />
  );
}
