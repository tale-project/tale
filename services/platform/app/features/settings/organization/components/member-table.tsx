'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { ChevronDownIcon } from 'lucide-react';
import { useMemo, useCallback } from 'react';

import { TableTimestampCell } from '@/app/components/ui/data-display/table-date-cell';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';
import { getRoleBadgeClasses } from '@/lib/utils/badge-colors';

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
}

export function MemberTable({
  members,
  sortOrder,
  memberContext,
  onSortChange,
}: MemberTableProps) {
  const { t: tTables } = useT('tables');
  const { t: tSettings } = useT('settings');
  const handleSort = useCallback(() => {
    onSortChange(sortOrder === 'asc' ? 'desc' : 'asc');
  }, [sortOrder, onSortChange]);

  const columns = useMemo<ColumnDef<Member>[]>(
    () => [
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
              <span className="text-foreground block text-sm font-medium">
                {member.displayName || member.email || tTables('cells.unknown')}
              </span>
              {member.displayName &&
                member.email &&
                member.displayName !== member.email && (
                  <span className="text-muted-foreground block text-xs">
                    {member.email}
                  </span>
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
        cell: ({ row }) => (
          <HStack gap={1} justify="end">
            <MemberRowActions
              member={row.original}
              memberContext={memberContext}
            />
          </HStack>
        ),
        size: 140,
      },
    ],
    [handleSort, sortOrder, memberContext, tTables, tSettings],
  );

  return (
    <DataTable columns={columns} data={members} getRowId={(row) => row._id} />
  );
}
