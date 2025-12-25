'use client';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Pencil, Trash2 } from 'lucide-react';

import { useState } from 'react';
import EditMemberDialog from './edit-member-dialog';
import DeleteMemberDialog from './delete-member-dialog';
import { useT } from '@/lib/i18n';

type MemberItem = {
  _id: string;
  _creationTime: number;
  organizationId: string;
  identityId?: string;
  email?: string;
  role?: string;
  displayName?: string;
};

interface MemberOptionsProps {
  member: MemberItem;
  memberContext?: {
    member: MemberItem | null;
    role: string | null;
    isAdmin: boolean;
    canManageMembers?: boolean;
  } | null;
}

export default function MemberOptions({
  member,
  memberContext,
}: MemberOptionsProps) {
  const { t } = useT('settings');
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const isViewingSelf = memberContext?.member?._id === member._id;

  const openEditDialog = () => {
    setIsEditDialogOpen(true);
  };

  const openDeleteDialog = () => {
    setIsDeleteDialogOpen(true);
  };

  return (
    <div>
      {memberContext?.canManageMembers && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={openEditDialog} aria-label={t('organization.editMember')}>
                <Pencil className="size-4 text-muted-foreground hover:text-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('organization.editMember')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {memberContext?.canManageMembers && !isViewingSelf && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={openDeleteDialog} aria-label={t('organization.removeMember')}>
                <Trash2 className="size-4 text-muted-foreground hover:text-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('organization.removeMember')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {/* Edit Member Dialog */}
      <EditMemberDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        member={member}
        currentUserMemberId={memberContext?.member?._id}
      />

      {/* Delete Member Dialog */}
      <DeleteMemberDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        member={member}
      />
    </div>
  );
}
