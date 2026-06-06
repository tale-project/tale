'use client';

import { Button } from '@tale/ui/button';
import { Stack, HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ColumnDef, RowSelectionState } from '@tanstack/react-table';
import { ChevronDownIcon, Users } from 'lucide-react';
import { useMemo, useCallback, useState } from 'react';

import { TableTimestampCell } from '@/app/components/ui/data-display/table-date-cell';
import {
  ACTIONS_COLUMN_SIZE,
  createSelectColumn,
} from '@/app/components/ui/data-table/column-builders';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { BulkDeleteBar } from '@/app/components/ui/data-table/data-table-bulk-actions';
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
};

interface MemberContext {
  member: Member | null;
  role: string | null;
  isAdmin: boolean;
  canManageMembers?: boolean;
}

interface MemberTableProps {
  members: Member[];
  sortOrder: 'asc' | 'desc';
  memberContext?: MemberContext | null;
  onSortChange: (sortOrder: 'asc' | 'desc') => void;
  isLoading?: boolean;
  approxRowCount?: number;
}

export function MemberTable({
  members,
  sortOrder,
  memberContext,
  onSortChange,
  isLoading,
  approxRowCount,
}: MemberTableProps) {
  const { t: tTables } = useT('tables');
  const { t: tSettings } = useT('settings');
  const { t: tEmpty } = useT('emptyStates');
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const removeMember = useRemoveMember();
  const handleSort = useCallback(() => {
    onSortChange(sortOrder === 'asc' ? 'desc' : 'asc');
  }, [sortOrder, onSortChange]);

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

  const columns = useMemo<ColumnDef<Member>[]>(
    () => [
      // Multi-row select — canonical 40px column. Enables bulk-remove via
      // the `BulkDeleteBar` footer. Note: `removeMember` doesn't cascade
      // to better-auth; bulk-remove of org owners would partial-fail and
      // the bar surfaces a destructive toast for the failed ids.
      createSelectColumn<Member>(),
      {
        id: 'member',
        header: () => (
          <Button
            variant="ghost"
            className="text-muted-foreground hover:text-foreground h-auto p-0 font-medium"
            onClick={handleSort}
          >
            {tTables('headers.member')}
            <ChevronDownIcon
              className={`ml-1 size-4 transition-transform ${
                sortOrder === 'desc' ? 'rotate-180' : ''
              }`}
            />
          </Button>
        ),
        cell: ({ row }) => {
          const member = row.original;
          return (
            <Stack gap={0}>
              <Text as="span" variant="label" className="block">
                {member.displayName || member.email || tTables('cells.unknown')}
              </Text>
              {member.displayName &&
                member.email &&
                member.displayName !== member.email && (
                  <Text as="span" variant="caption" className="block">
                    {member.email}
                  </Text>
                )}
            </Stack>
          );
        },
        size: 348,
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
        size: 200,
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
    [handleSort, sortOrder, memberContext, tTables, tSettings],
  );

  return (
    <DataTable
      columns={columns}
      data={members}
      getRowId={(row) => row._id}
      isLoading={isLoading}
      approxRowCount={approxRowCount}
      enableRowSelection
      rowSelection={rowSelection}
      onRowSelectionChange={setRowSelection}
      pagination={{
        clientSide: true,
        pageSize: 10,
        total: members.length,
        showPageSizeSelector: true,
        entityLabel: tSettings('organization.membersEntityLabel'),
      }}
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
    />
  );
}
