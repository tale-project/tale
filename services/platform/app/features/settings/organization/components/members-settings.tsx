'use client';

import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

import { AddMemberDialog } from '@/app/features/settings/organization/components/member-add-dialog';
import { MemberTable } from '@/app/features/settings/organization/components/member-table';
import { useMembers } from '@/app/features/settings/organization/hooks/queries';
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
  const [isAddMemberDialogOpen, setIsAddMemberDialogOpen] = useState(false);

  const { members: allMembers, isLoading: isMembersLoading } =
    useMembers(organizationId);

  const members = useMemo(() => {
    if (!allMembers) return null;
    return [...allMembers].sort((a, b) => {
      const nameA = a.displayName || a.email || '';
      const nameB = b.displayName || b.email || '';
      return nameA.localeCompare(nameB);
    });
  }, [allMembers]);

  return (
    <>
      <MemberTable
        members={members || []}
        isLoading={isMembersLoading}
        approxRowCount={5}
        addAction={
          memberContext?.isAdmin
            ? {
                label: tSettings('organization.addMember'),
                icon: Plus,
                onClick: () => setIsAddMemberDialogOpen(true),
              }
            : undefined
        }
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
      />

      <AddMemberDialog
        organizationId={organizationId}
        open={isAddMemberDialogOpen}
        onOpenChange={setIsAddMemberDialogOpen}
      />
    </>
  );
}
