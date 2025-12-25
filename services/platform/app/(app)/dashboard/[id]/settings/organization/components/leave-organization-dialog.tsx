'use client';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Dispatch, SetStateAction } from 'react';
import { useT } from '@/lib/i18n';

interface LeaveOrganizationDialogProps {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
  isUpdating: boolean;
  onLeave: () => void;
}

export default function LeaveOrganizationDialog({
  open,
  isUpdating,
  onLeave,
  onOpenChange,
}: LeaveOrganizationDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader className="space-y-3">
          <DialogTitle className="text-lg">{t('organization.leaveOrganization')}</DialogTitle>
          <DialogDescription className="text-sm">
            {t('organization.leaveConfirmation')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col sm:flex-row gap-3 sm:gap-2">
          <DialogClose asChild>
            <Button variant="outline" disabled={isUpdating} className="flex-1">
              {tCommon('actions.cancel')}
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={onLeave}
            disabled={isUpdating}
            className="flex-1"
          >
            {isUpdating ? t('organization.leaving') : t('organization.leaveOrganization')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
