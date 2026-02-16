import { Loader2Icon } from 'lucide-react';

import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';

interface BulkSendDialogProps {
  selectedCount: number;
  isSending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function BulkSendDialog({
  selectedCount,
  isSending,
  onConfirm,
  onCancel,
}: BulkSendDialogProps) {
  const { t: tConversations } = useT('conversations');
  const { t: tCommon } = useT('common');

  return (
    <div className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
      <div className="bg-background mx-4 w-full max-w-md rounded-lg border p-6">
        <h3 className="mb-4 text-lg font-semibold">
          {tConversations('bulkSend.title', { count: selectedCount })}
        </h3>
        <p className="text-muted-foreground mb-6">
          {tConversations('bulkSend.description', { count: selectedCount })}
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={isSending}>
            {tCommon('actions.cancel')}
          </Button>
          <Button onClick={onConfirm} disabled={isSending}>
            {isSending && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {tConversations('bulkSend.send')}
          </Button>
        </div>
      </div>
    </div>
  );
}
