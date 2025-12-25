'use client';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

interface BulkSendMessagesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onSend: () => Promise<void>;
  isLoading: boolean;
}

export function BulkSendMessagesDialog({
  open,
  onOpenChange,
  selectedCount,
  onSend,
  isLoading,
}: BulkSendMessagesDialogProps) {
  const { t } = useT('conversations');
  const { t: tCommon } = useT('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader className="pt-2">
          <DialogTitle>{t('bulkSend.title', { count: selectedCount })}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          {t('bulkSend.description', { count: selectedCount })}
          <br />
          <br />
          {t('bulkSend.confirm')}
        </p>
        <DialogFooter className="flex">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            {tCommon('actions.cancel')}
          </Button>
          <Button className="flex-1" onClick={onSend} disabled={isLoading}>
            {isLoading ? t('bulkSend.sending') : t('bulkSend.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
