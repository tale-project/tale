'use client';

import { useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useRemoveMember } from '../hooks/mutations';

type MemberLite = {
  _id: string;
  organizationId: string;
  email?: string;
  displayName?: string;
  role?: string;
};

interface DeleteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: MemberLite | null;
}

export function DeleteMemberDialog({
  open,
  onOpenChange,
  member,
}: DeleteMemberDialogProps) {
  const { t } = useT('settings');
  const { t: tDialogs } = useT('dialogs');
  const [isDeleting, setIsDeleting] = useState(false);

  const removeMember = useRemoveMember();

  if (!member) return null;

  const handleConfirm = async () => {
    setIsDeleting(true);
    try {
      await removeMember({
        memberId: member._id,
      });

      toast({
        title: t('organization.memberRemoved'),
      });
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast({
        title: t('organization.memberRemoveFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <DeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('organization.removeMember')}
      description={tDialogs('confirmRemoveMember', {
        name: member.displayName || member.email || tDialogs('thisMember'),
      })}
      deleteText={t('organization.removeMember')}
      isDeleting={isDeleting}
      onDelete={handleConfirm}
      warning={
        member.role === 'admin'
          ? t('organization.adminSecurityWarning')
          : undefined
      }
    />
  );
}
