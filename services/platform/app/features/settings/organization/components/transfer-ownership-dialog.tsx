'use client';

import { useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useTransferOwnership } from '../hooks/mutations';

type MemberLite = {
  _id: string;
  organizationId: string;
  email?: string;
  displayName?: string;
  role?: string;
};

interface TransferOwnershipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: MemberLite | null;
}

export function TransferOwnershipDialog({
  open,
  onOpenChange,
  member,
}: TransferOwnershipDialogProps) {
  const { t } = useT('settings');
  const [isTransferring, setIsTransferring] = useState(false);

  const transferOwnership = useTransferOwnership();

  if (!member) return null;

  const handleConfirm = async () => {
    setIsTransferring(true);
    try {
      await transferOwnership.mutateAsync({
        targetMemberId: member._id,
      });

      toast({
        title: t('organization.ownershipTransferred'),
      });
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast({
        title: t('organization.ownershipTransferFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsTransferring(false);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('organization.transferOwnership')}
      description={t('organization.transferOwnershipConfirmation', {
        name: member.displayName || member.email || member._id,
      })}
      confirmText={t('organization.transferOwnership')}
      isLoading={isTransferring}
      variant="destructive"
      onConfirm={handleConfirm}
    />
  );
}
