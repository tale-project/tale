'use client';

import { useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Stack, HStack } from '@/components/ui/layout';
import { ChevronDownIcon } from 'lucide-react';
import { getRoleBadgeClasses } from '@/lib/utils/badge-colors';
import { TableTimestampCell } from '@/components/ui/table-date-cell';
import MemberRowActions from './member-row-actions';
import type { ColumnDef } from '@tanstack/react-table';
import { useT } from '@/lib/i18n';

type Member = {
  _id: string;
  _creationTime: number;
  organizationId: string;
  identityId?: string;
  email?: string;
  role?: string;
  displayName?: string;
  metadata?: Record<string, unknown>;
};

interface MemberTableProps {
  members: Member[];
  sortOrder: 'asc' | 'desc';
  memberContext?: {
    member: Member | null;
    role: string | null;
    isAdmin: boolean;
  } | null;
  onSortChange: (sortOrder: 'asc' | 'desc') => void;
}

export default function MemberTable({
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
            className="h-auto p-0 font-medium text-muted-foreground hover:text-foreground"
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
            <Stack>
              <span className="text-sm text-foreground font-medium">
                {member.displayName || member.email || tTables('cells.unknown')}
              </span>
              {member.displayName && member.email && (
                <span className="text-xs text-muted-foreground">
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
              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getRoleBadgeClasses(
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
        header: () => <div className="text-right">{tTables('headers.joined')}</div>,
        cell: ({ row }) => (
          <TableTimestampCell timestamp={row.original._creationTime} preset="relative" />
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
