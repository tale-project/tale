'use client';

import { Button } from '@tale/ui/button';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';

import { Textarea } from '@/app/components/ui/forms/textarea';
import { useMarkNotificationRead } from '@/app/features/inbox/hooks/mutations';
import { useRespondToTaskReview } from '@/app/features/tasks/hooks/mutations';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

function asApprovalId(value: string): Id<'approvals'> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- approvalId written by the review-request emitter
  return value as Id<'approvals'>;
}

/**
 * Inline Approve / Request-changes for actionable review requests — the
 * review gate is answerable straight from the notification panel, no board
 * round-trip.
 */
export function ReviewActions({
  notificationId,
  approvalId: approvalIdRaw,
}: {
  notificationId: Id<'userNotifications'>;
  approvalId: string;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const respond = useRespondToTaskReview();
  const markRead = useMarkNotificationRead();
  const [requestingChanges, setRequestingChanges] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [resolved, setResolved] = useState(false);

  if (resolved) return null;
  const approvalId = asApprovalId(approvalIdRaw);

  const submit = async (decision: 'approve' | 'request_changes') => {
    try {
      await respond.mutateAsync({
        approvalId,
        decision,
        feedback: decision === 'request_changes' ? feedback.trim() : undefined,
      });
      setResolved(true);
      markRead.mutate({ notificationId });
      toast({
        title:
          decision === 'approve'
            ? t('review.approvedToast')
            : t('review.changesRequestedToast'),
        variant: 'success',
      });
    } catch (error) {
      console.error('[notifications] review response failed', error);
      toast({ title: tCommon('errors.generic'), variant: 'destructive' });
    }
  };

  return requestingChanges ? (
    <div className="mt-2 flex flex-col gap-2">
      <Textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder={t('review.feedbackPlaceholder')}
        rows={2}
        autoFocus
        onClick={(e) => e.stopPropagation()}
      />
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          disabled={respond.isPending || feedback.trim().length === 0}
          onClick={(e) => {
            e.stopPropagation();
            void submit('request_changes');
          }}
        >
          {t('review.sendFeedback')}
        </Button>
        <Button
          variant="ghost"
          disabled={respond.isPending}
          onClick={(e) => {
            e.stopPropagation();
            setRequestingChanges(false);
          }}
        >
          {tCommon('actions.cancel')}
        </Button>
      </div>
    </div>
  ) : (
    <div className="mt-2 flex items-center gap-2">
      <Button
        icon={CheckCircle2}
        disabled={respond.isPending}
        onClick={(e) => {
          e.stopPropagation();
          void submit('approve');
        }}
      >
        {t('review.approve')}
      </Button>
      <Button
        variant="secondary"
        disabled={respond.isPending}
        onClick={(e) => {
          e.stopPropagation();
          setRequestingChanges(true);
        }}
      >
        {t('review.requestChanges')}
      </Button>
    </div>
  );
}
