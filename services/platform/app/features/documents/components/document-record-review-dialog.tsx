'use client';

import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import type { DocumentRecordInfo } from '@/types/documents';

import { useRespondToDocumentRecordReview } from '../hooks/mutations';
import { usePendingDocumentRecordReview } from '../hooks/queries';

interface DocumentRecordReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  documentName?: string | null;
  record: DocumentRecordInfo | undefined;
}

function DocumentRecordReviewDialogContent({
  open,
  onOpenChange,
  documentId,
  documentName,
  record,
}: DocumentRecordReviewDialogProps) {
  const { t: tDocuments } = useT('documents');
  const { t: tCommon } = useT('common');
  // The approval id is the respond mutation's key; the content only mounts
  // while the dialog is open, so this subscribes per open dialog, not per row.
  const { data: pending } = usePendingDocumentRecordReview(documentId);
  const respond = useRespondToDocumentRecordReview();
  const [requestingChanges, setRequestingChanges] = useState(false);
  const [feedback, setFeedback] = useState('');

  const waitingOn =
    record?.state === 'in_review' && record.reviewerName
      ? tDocuments('record.waitingOn', { name: record.reviewerName })
      : undefined;

  const submit = async (decision: 'approve' | 'request_changes') => {
    if (!pending) return;
    try {
      const result = await respond.mutateAsync({
        approvalId: pending.approvalId,
        decision,
        feedback: decision === 'request_changes' ? feedback.trim() : undefined,
      });
      toast({
        title:
          result.state === 'approved'
            ? tDocuments('record.toast.approved', { version: result.version })
            : tDocuments('record.toast.changesRequested'),
        variant: 'success',
      });
      setRequestingChanges(false);
      setFeedback('');
      onOpenChange(false);
    } catch (error) {
      console.error('[documents] record review response failed', error);
      toast({
        title: tDocuments('record.toast.respondFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={tDocuments('record.review.title', {
        version: record?.version ?? 1,
      })}
      description={
        documentName ? (
          <span className="break-all">{documentName}</span>
        ) : undefined
      }
      footerClassName="px-6 pt-4 pb-5"
      footer={
        requestingChanges ? (
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRequestingChanges(false)}
              disabled={respond.isPending}
            >
              {tCommon('actions.cancel')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void submit('request_changes')}
              disabled={
                respond.isPending || !pending || feedback.trim().length === 0
              }
            >
              {tDocuments('record.review.sendFeedback')}
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRequestingChanges(true)}
              disabled={respond.isPending || !pending}
            >
              {tDocuments('record.review.requestChanges')}
            </Button>
            <Button
              type="button"
              icon={CheckCircle2}
              onClick={() => void submit('approve')}
              disabled={respond.isPending || !pending}
            >
              {tDocuments('record.review.approve')}
            </Button>
          </>
        )
      }
    >
      <Stack gap={2} className="px-6 pt-2 pb-4">
        <Text as="p" variant="muted" className="text-sm">
          {tDocuments('record.review.frozenHint')}
        </Text>
        {waitingOn !== undefined && (
          <Text as="p" variant="muted" className="text-xs">
            {waitingOn}
          </Text>
        )}
        {requestingChanges && (
          <Textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={tDocuments('record.review.feedbackPlaceholder')}
            rows={3}
            autoFocus
          />
        )}
      </Stack>
    </Dialog>
  );
}

/**
 * The review decision for a controlled record in `in_review`: Approve locks
 * the version as an immutable snapshot; Request changes needs feedback and
 * reopens the draft. Names the reviewer the record waits on — designation
 * is soft (matching task reviews), so any member with document-write access
 * may respond; the server enforces the real permission.
 *
 * Mounted only while open (the DocumentTeamTagsDialog pattern): the content
 * holds a live pending-review query, which must not subscribe once per
 * table row, and Radix keeps closed dialogs mounted through animations.
 */
export function DocumentRecordReviewDialog(
  props: DocumentRecordReviewDialogProps,
) {
  if (!props.open) {
    return null;
  }
  return <DocumentRecordReviewDialogContent {...props} />;
}
