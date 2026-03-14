'use client';

import { ArrowRightLeft, Pencil, Trash2 } from 'lucide-react';
import { useMemo } from 'react';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { useT } from '@/lib/i18n/client';

import { DeleteMemberDialog } from './member-delete-dialog';
import { EditMemberDialog } from './member-edit-dialog';
import { TransferOwnershipDialog } from './transfer-ownership-dialog';

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
}

export function MemberRowActions({
  member,
  memberContext,
}: MemberRowActionsProps) {
  const { t: tCommon } = useT('common');
  const { t: tSettings } = useT('settings');
  const dialogs = useEntityRowDialogs(['edit', 'delete', 'transferOwnership']);

  const isViewingSelf = memberContext?.member?._id === member._id;
  const canManageMembers = memberContext?.canManageMembers ?? false;
  const isOwner = member.role?.toLowerCase() === 'owner';
  const callerIsOwner = memberContext?.role?.toLowerCase() === 'owner';

  const actions = useMemo(
    () => [
      {
        key: 'edit',
        label: tCommon('actions.edit'),
        icon: Pencil,
        onClick: dialogs.open.edit,
        visible: canManageMembers && !isOwner && !isViewingSelf,
      },
      {
        key: 'transferOwnership',
        label: tSettings('organization.transferOwnership'),
        icon: ArrowRightLeft,
        onClick: dialogs.open.transferOwnership,
        visible: callerIsOwner && !isViewingSelf && !isOwner,
      },
      {
        key: 'delete',
        label: tCommon('actions.delete'),
        icon: Trash2,
        onClick: dialogs.open.delete,
        destructive: true,
        visible: canManageMembers && !isViewingSelf && !isOwner,
      },
    ],
    [
      tCommon,
      tSettings,
      dialogs.open,
      canManageMembers,
      isViewingSelf,
      isOwner,
      callerIsOwner,
    ],
  );

  if (!canManageMembers) {
    return null;
  }

  return (
    <>
      <EntityRowActions actions={actions} contentWidth="w-[11.5rem]" />

      <EditMemberDialog
        open={dialogs.isOpen.edit}
        onOpenChange={dialogs.setOpen.edit}
        member={member}
        currentUserMemberId={memberContext?.member?._id}
      />

      <DeleteMemberDialog
        open={dialogs.isOpen.delete}
        onOpenChange={dialogs.setOpen.delete}
        member={member}
      />

      <TransferOwnershipDialog
        open={dialogs.isOpen.transferOwnership}
        onOpenChange={dialogs.setOpen.transferOwnership}
        member={member}
      />
    </>
  );
}
