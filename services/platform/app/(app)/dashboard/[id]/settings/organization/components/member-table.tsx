'use client';

import { useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { ChevronDownIcon } from 'lucide-react';
import { formatDate } from '@/lib/utils/date/format';
import MemberOptions from './member-options';
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

const getRoleBadgeColor = (role?: string) => {
  switch ((role || '').toLowerCase()) {
    case 'admin':
      return 'bg-red-100 text-red-800';
    case 'member':
      return 'bg-muted text-muted-foreground';
    default:
      return 'bg-muted text-muted-foreground';
  }
};

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
            <div className="flex flex-col">
              <span className="text-sm text-foreground font-medium">
                {member.displayName || member.email || 'Unknown'}
              </span>
              {member.displayName && member.email && (
                <span className="text-xs text-muted-foreground">
                  {member.email}
                </span>
              )}
            </div>
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
              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getRoleBadgeColor(
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
          <div className="text-sm text-muted-foreground text-right">
            {formatDate(new Date(row.original._creationTime), { preset: 'relative' })}
          </div>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <MemberOptions
              member={row.original}
              memberContext={memberContext}
            />
          </div>
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
