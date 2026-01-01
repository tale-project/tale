'use client';

import { ConfirmDialog } from '@/components/ui/dialog';
import { Dispatch, SetStateAction } from 'react';
import { useT } from '@/lib/i18n';

interface LeaveOrganizationDialogProps {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
  isUpdating: boolean;
  onLeave: () => void;
}

export function LeaveOrganizationDialog({
  open,
  isUpdating,
  onLeave,
  onOpenChange,
}: LeaveOrganizationDialogProps) {
  const { t } = useT('settings');

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('organization.leaveOrganization')}
      description={t('organization.leaveConfirmation')}
      confirmText={t('organization.leaveOrganization')}
      loadingText={t('organization.leaving')}
      isLoading={isUpdating}
      onConfirm={onLeave}
      variant="destructive"
    />
  );
}
