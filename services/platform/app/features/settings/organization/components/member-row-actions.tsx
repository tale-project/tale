'use client';

import type { Collection } from '@tanstack/db';

import { Pencil, Trash2 } from 'lucide-react';
import { useMemo } from 'react';

import type { Member } from '@/lib/collections/entities/members';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { useT } from '@/lib/i18n/client';

import { DeleteMemberDialog } from './member-delete-dialog';
import { EditMemberDialog } from './member-edit-dialog';

type MemberItem = {
  _id: string;
  _creationTime?: number;
  organizationId: string;
  identityId?: string;
  email?: string;
  role?: string;
  displayName?: string;
};

interface MemberRowActionsProps {
  member: MemberItem;
  memberContext?: {
    member: MemberItem | null;
    role: string | null;
    isAdmin: boolean;
    canManageMembers?: boolean;
  } | null;
  collection: Collection<Member, string>;
}

export function MemberRowActions({
  member,
  memberContext,
  collection,
}: MemberRowActionsProps) {
  const { t: tCommon } = useT('common');
  const dialogs = useEntityRowDialogs(['edit', 'delete']);

  const isViewingSelf = memberContext?.member?._id === member._id;
  const canManageMembers = memberContext?.canManageMembers ?? false;

  const actions = useMemo(
    () => [
      {
        key: 'edit',
        label: tCommon('actions.edit'),
        icon: Pencil,
        onClick: dialogs.open.edit,
        visible: canManageMembers,
      },
      {
        key: 'delete',
        label: tCommon('actions.delete'),
        icon: Trash2,
        onClick: dialogs.open.delete,
        destructive: true,
        visible: canManageMembers && !isViewingSelf,
      },
    ],
    [tCommon, dialogs.open, canManageMembers, isViewingSelf],
  );

  // Don't render anything if user can't manage members
  if (!canManageMembers) {
    return null;
  }

  return (
    <>
      <EntityRowActions actions={actions} />

      <EditMemberDialog
        open={dialogs.isOpen.edit}
        onOpenChange={dialogs.setOpen.edit}
        member={member}
        currentUserMemberId={memberContext?.member?._id}
        collection={collection}
      />

      <DeleteMemberDialog
        open={dialogs.isOpen.delete}
        onOpenChange={dialogs.setOpen.delete}
        member={member}
        collection={collection}
      />
    </>
  );
}
