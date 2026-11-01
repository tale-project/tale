'use client';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@tale/ui/entity/entity-row-actions';
import {
  ArrowRightLeft,
  KeyRound,
  Pencil,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useMemo } from 'react';

import { MemberApiKeysDialog } from '@/app/features/settings/api-keys/components/member-api-keys-dialog';
import { useT } from '@/lib/i18n/client';

import { DeleteMemberDialog } from './member-delete-dialog';
import { EditMemberDialog } from './member-edit-dialog';
import { MemberRightsDialog } from './member-rights-dialog';
import { TransferOwnershipDialog } from './transfer-ownership-dialog';

type MemberItem = {
  _id: string;
  _creationTime?: number;
  organizationId: string;
  userId: string;
  identityId?: string;
  email?: string;
  role?: string;
  displayName?: string;
  twoFactorEnabled?: boolean;
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
  const dialogs = useEntityRowDialogs([
    'edit',
    'rights',
    'apiKeys',
    'delete',
    'transferOwnership',
  ]);

  const isViewingSelf = memberContext?.member?._id === member._id;
  const canManageMembers = memberContext?.canManageMembers ?? false;
  // A member's rights, and the register behind their switches, are for
  // owners and admins (GOV-R21) — anyone's, their own and the owner's too.
  const callerIsAdmin = memberContext?.isAdmin ?? false;
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
        key: 'rights',
        label: tSettings('organization.memberRights.action'),
        icon: ShieldCheck,
        onClick: dialogs.open.rights,
        visible: callerIsAdmin,
      },
      {
        // A member's own keys, each of which an Owner or Admin can block
        // here (APIKEY-R11); one's own keys are ended in one's own settings.
        key: 'apiKeys',
        label: tSettings('apiKeys.memberKeys.action'),
        icon: KeyRound,
        onClick: dialogs.open.apiKeys,
        visible: callerIsAdmin && !isViewingSelf,
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
      callerIsAdmin,
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

      {/* Each dialog mounts from its first open: every row of the list
          carries all five. */}
      {dialogs.mounted.edit && (
        <EditMemberDialog
          open={dialogs.isOpen.edit}
          onOpenChange={dialogs.setOpen.edit}
          member={member}
          currentUserMemberId={memberContext?.member?._id}
        />
      )}

      {dialogs.mounted.rights && (
        <MemberRightsDialog
          open={dialogs.isOpen.rights}
          onOpenChange={dialogs.setOpen.rights}
          organizationId={member.organizationId}
          member={member}
        />
      )}

      {dialogs.mounted.apiKeys && (
        <MemberApiKeysDialog
          open={dialogs.isOpen.apiKeys}
          onOpenChange={dialogs.setOpen.apiKeys}
          organizationId={member.organizationId}
          member={member}
        />
      )}

      {dialogs.mounted.delete && (
        <DeleteMemberDialog
          open={dialogs.isOpen.delete}
          onOpenChange={dialogs.setOpen.delete}
          member={member}
        />
      )}

      {dialogs.mounted.transferOwnership && (
        <TransferOwnershipDialog
          open={dialogs.isOpen.transferOwnership}
          onOpenChange={dialogs.setOpen.transferOwnership}
          member={member}
        />
      )}
    </>
  );
}
