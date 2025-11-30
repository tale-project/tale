'use client';

import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ChevronDownIcon } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import MemberOptions from './member-options';

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
  const handleSort = () => {
    onSortChange(sortOrder === 'asc' ? 'desc' : 'asc');
  };

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

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-secondary/20">
          <TableHead className="w-[348px]">
            <Button
              variant="ghost"
              className="h-auto p-0 font-medium text-muted-foreground hover:text-foreground"
              onClick={handleSort}
            >
              Member
              <ChevronDownIcon
                className={`ml-1 size-4 transition-transform ${
                  sortOrder === 'desc' ? 'rotate-180' : ''
                }`}
              />
            </Button>
          </TableHead>
          <TableHead className="w-[200px]">
            <div className="font-medium text-muted-foreground">Role</div>
          </TableHead>
          <TableHead className="text-right">
            <div className="font-medium text-muted-foreground">Joined</div>
          </TableHead>
          <TableHead className="w-[140px]"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <TableRow key={member._id}>
            <TableCell className="font-medium">
              <div className="flex flex-col">
                <span className="text-sm text-foreground">
                  {member.displayName || member.email || 'Unknown'}
                </span>
                {member.displayName && member.email && (
                  <span className="text-xs text-muted-foreground">
                    {member.email}
                  </span>
                )}
              </div>
            </TableCell>
            <TableCell>
              <span
                className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getRoleBadgeColor(
                  member.role,
                )}`}
              >
                {member.role || 'Disabled'}
              </span>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground text-right">
              {formatDistanceToNow(new Date(member._creationTime), {
                addSuffix: true,
              })}
            </TableCell>
            <TableCell className="flex items-center justify-end gap-1">
              <MemberOptions member={member} memberContext={memberContext} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
