'use client';

import { DeleteDialog } from '@/components/ui/dialog/delete-dialog';
import { toast } from '@/hooks/use-toast';
import { useRemoveMember } from '../hooks/use-remove-member';
import { useT } from '@/lib/i18n/client';

type MemberLite = {
  _id: string;
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

  const removeMember = useRemoveMember();

  if (!member) return null;

  const handleConfirm = async () => {
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
    }
  };

  return (
    <DeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('organization.removeMember')}
      description={tDialogs('confirmRemoveMember', { name: member.displayName || member.email || tDialogs('thisMember') })}
      deleteText={t('organization.removeMember')}
      onDelete={handleConfirm}
      warning={member.role === 'admin' ? t('organization.adminSecurityWarning') : undefined}
    />
  );
}
