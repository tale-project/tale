'use client';

import { DeleteModal } from '@/components/ui/modals';
import { toast } from '@/hooks/use-toast';
import { useRemoveMember } from '../hooks';
import { useT } from '@/lib/i18n';

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

export default function DeleteMemberDialog({
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
    <DeleteModal
      open={open}
      onOpenChange={onOpenChange}
      title={t('organization.removeTeamMember')}
      description={tDialogs('cannotBeUndone')}
      deleteText={t('organization.removeMember')}
      onDelete={handleConfirm}
    >
      <p className="text-sm text-foreground">
        {tDialogs('confirmRemoveMember', { name: member.displayName || member.email || tDialogs('thisMember') })}
      </p>
      {member.role === 'admin' && (
        <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-md">
          <p className="text-sm text-amber-800">
            {t('organization.adminSecurityWarning')}
          </p>
        </div>
      )}
    </DeleteModal>
  );
}
