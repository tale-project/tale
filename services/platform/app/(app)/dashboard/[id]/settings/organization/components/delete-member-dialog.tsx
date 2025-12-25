'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { useMutation } from 'convex/react';
import { toast } from '@/hooks/use-toast';
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
  const { t: tCommon } = useT('common');
  const { t: tDialogs } = useT('dialogs');

  const removeMember = useMutation(api.member.removeMember);

  const handleCancel = () => {
    onOpenChange(false);
  };

  if (!member) return null;

  const handleConfirm = async (memberId: string) => {
    try {
      await removeMember({
        memberId,
      });

      toast({
        title: t('organization.memberRemoved'),
      });
    } catch (error) {
      console.error(error);
      toast({
        title: t('organization.memberRemoveFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="size-6 text-red-600" />
            </div>
            <div>
              <DialogTitle className="font-semibold text-foreground">
                {t('organization.removeTeamMember')}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground mt-1">
                {tDialogs('cannotBeUndone')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-4">
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
        </div>

        <DialogFooter className="flex gap-3">
          <Button variant="outline" onClick={handleCancel} className="flex-1">
            {tCommon('actions.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => handleConfirm(member._id)}
            className="flex-1"
          >
            {t('organization.removeMember')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
