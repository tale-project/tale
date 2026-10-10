import { Alert } from '@tale/ui/alert';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { Textarea } from '@tale/ui/textarea';
import { useEffect, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import type { RefusedSend } from '../hooks/use-bulk-actions';

/** How many refused conversations the dialog names before it counts the
 * rest. */
const LISTED_REFUSALS = 10;

interface BulkSendDialogProps {
  selectedCount: number;
  isSending: boolean;
  /** The conversations the last attempt did not reach; empty before one. */
  refused: readonly RefusedSend[];
  onConfirm: (message: string) => void;
  onCancel: () => void;
}

export function BulkSendDialog({
  selectedCount,
  isSending,
  refused,
  onConfirm,
  onCancel,
}: BulkSendDialogProps) {
  const { t: tConversations } = useT('conversations');

  const [message, setMessage] = useState('');
  const trimmedMessage = message.trim();
  const canSend = trimmedMessage.length > 0 && selectedCount > 0 && !isSending;

  const sendLabel = tConversations('bulkSend.send');

  // Send is disabled while it runs, which takes focus off it. After a refusal
  // the dialog stays open, so give focus back to the message the person may
  // now edit or send again.
  const messageRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (refused.length > 0) messageRef.current?.focus();
  }, [refused]);

  const listed = refused.slice(0, LISTED_REFUSALS);
  const unlisted = refused.length - listed.length;

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
      {refused.length > 0 && (
        // No heading: the dialog's title is the only one in it, so the
        // summary line stays text and the outline keeps its order.
        <Alert
          variant="destructive"
          className="mb-3"
          description={
            <>
              <p className="font-medium">
                {tConversations('bulkSend.refused', { count: refused.length })}
              </p>
              <p>{tConversations('bulkSend.refusedRetry')}</p>
            </>
          }
        >
          <ul className="mt-1 list-outside list-disc space-y-1 pl-4 text-sm">
            {listed.map((entry) => (
              <li key={entry.id}>
                {entry.reason === undefined
                  ? entry.name
                  : tConversations('bulkSend.refusedEntry', {
                      name: entry.name,
                      reason: entry.reason,
                    })}
              </li>
            ))}
            {unlisted > 0 && (
              <li className="list-none">
                {tConversations('bulkSend.refusedMore', { count: unlisted })}
              </li>
            )}
          </ul>
        </Alert>
      )}
      <Textarea
        ref={messageRef}
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
