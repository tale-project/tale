'use client';

import { ActionRow } from '@tale/ui/action-row';
import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

import { SearchInput } from '@/app/components/ui/forms/search-input';
import { AddMemberDialog } from '@/app/features/settings/organization/components/member-add-dialog';
import { MemberTable } from '@/app/features/settings/organization/components/member-table';
import {
  useMembers,
  type Member,
} from '@/app/features/settings/organization/hooks/queries';
import { useDebounce } from '@/app/hooks/use-debounce';
import { useT } from '@/lib/i18n/client';

type MemberContext = {
  memberId?: string;
  organizationId?: string;
  userId?: string;
  role?: string | null;
  createdAt?: number;
  displayName?: string;
  isAdmin?: boolean;
  canManageMembers?: boolean;
};

interface MembersSettingsProps {
  organizationId: string;
  memberContext: MemberContext | null;
}

export function MembersSettings({
  organizationId,
  memberContext,
}: MembersSettingsProps) {
  const { t: tSettings } = useT('settings');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isAddMemberDialogOpen, setIsAddMemberDialogOpen] = useState(false);

  const debouncedSearch = useDebounce(searchQuery, 300);

  const { members: allMembers, isLoading: isMembersLoading } =
    useMembers(organizationId);

  const members = useMemo(() => {
    if (!allMembers) return null;
    const search = debouncedSearch?.toLowerCase();
    let filtered = allMembers;
    if (search) {
      filtered = filtered.filter(
        (member: Member) =>
          (member.displayName?.toLowerCase().includes(search) ?? false) ||
          (member.email?.toLowerCase().includes(search) ?? false),
      );
    }
    return [...filtered].sort((a, b) => {
      const nameA = a.displayName || a.email || '';
      const nameB = b.displayName || b.email || '';
      return sortOrder === 'asc'
        ? nameA.localeCompare(nameB)
        : nameB.localeCompare(nameA);
    });
  }, [allMembers, debouncedSearch, sortOrder]);

  return (
    <Stack gap={5}>
      <ActionRow justify="between">
        <SearchInput
          placeholder={tSettings('organization.searchMember')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          wrapperClassName="flex-1 max-w-sm"
        />
        {memberContext?.isAdmin && (
          <Button onClick={() => setIsAddMemberDialogOpen(true)}>
            <Plus className="mr-2 size-4" />
            {tSettings('organization.addMember')}
          </Button>
        )}
      </ActionRow>

      <MemberTable
        members={members || []}
        sortOrder={sortOrder}
        isLoading={isMembersLoading}
        approxRowCount={5}
        memberContext={
          memberContext
            ? {
                member: memberContext.memberId
                  ? {
                      _id: memberContext.memberId,
                      createdAt: memberContext.createdAt ?? 0,
                      organizationId: memberContext.organizationId ?? '',
                      userId: memberContext.userId ?? '',
                      role: memberContext.role ?? undefined,
                      displayName: memberContext.displayName,
                    }
                  : null,
                role: memberContext.role || null,
                isAdmin: memberContext.isAdmin || false,
                canManageMembers:
                  memberContext.canManageMembers ??
                  memberContext.isAdmin ??
                  false,
              }
            : undefined
        }
        onSortChange={(newSortOrder) => {
          setSortOrder(newSortOrder);
        }}
      />

      <AddMemberDialog
        organizationId={organizationId}
        open={isAddMemberDialogOpen}
        onOpenChange={setIsAddMemberDialogOpen}
      />
    </Stack>
  );
}
