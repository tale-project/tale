import { useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useT } from '@/lib/i18n/client';

interface BulkSendDialogProps {
  selectedCount: number;
  isSending: boolean;
  onConfirm: (message: string) => void;
  onCancel: () => void;
}

export function BulkSendDialog({
  selectedCount,
  isSending,
  onConfirm,
  onCancel,
}: BulkSendDialogProps) {
  const { t: tConversations } = useT('conversations');

  const [message, setMessage] = useState('');
  const trimmedMessage = message.trim();
  const canSend = trimmedMessage.length > 0 && !isSending;

  const sendLabel = tConversations('bulkSend.send');

  // Composed on the shared Radix `ConfirmDialog` so it inherits role="dialog",
  // aria-modal, focus trap + return, and Escape/outside-click dismiss — the
  // caller (`conversations.tsx`) already gates the mount on `isOpen`, matching
  // the `Dialog` primitive's documented "render nothing when closed" pattern,
  // so `open` is fixed true and a close request maps to `onCancel`.
  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={tConversations('bulkSend.title', { count: selectedCount })}
      description={tConversations('bulkSend.description', {
        count: selectedCount,
      })}
      confirmText={sendLabel}
      loadingText={sendLabel}
      isLoading={isSending}
      disableConfirm={!canSend}
      onConfirm={() => onConfirm(trimmedMessage)}
    >
      <Textarea
        id="bulk-send-message"
        label={tConversations('bulkSend.messageLabel')}
        placeholder={tConversations('bulkSend.messagePlaceholder')}
        rows={6}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        disabled={isSending}
      />
    </ConfirmDialog>
  );
}
