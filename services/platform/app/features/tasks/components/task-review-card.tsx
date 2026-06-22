'use client';

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Bot, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';

import { Textarea } from '@/app/components/ui/forms/textarea';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useRespondToTaskReview } from '../hooks/mutations';
import { usePendingTaskReview } from '../hooks/queries';

/**
 * The human side of the review gate, rendered prominently in the task detail
 * sheet while a `task_review` approval is pending: Approve completes the
 * task (the only automated path to done); Request changes needs feedback and
 * re-engages the agent with it. Modeled on the chat human-input request card.
 */
export function TaskReviewCard({ taskId }: { taskId: Id<'tasks'> }) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const { review } = usePendingTaskReview(taskId);
  const respond = useRespondToTaskReview();
  const [requestingChanges, setRequestingChanges] = useState(false);
  const [feedback, setFeedback] = useState('');

  if (!review) return null;

  const submit = async (decision: 'approve' | 'request_changes') => {
    try {
      await respond.mutateAsync({
        approvalId: review.approvalId,
        decision,
        feedback: decision === 'request_changes' ? feedback.trim() : undefined,
      });
      toast({
        title:
          decision === 'approve'
            ? t('review.approvedToast')
            : t('review.changesRequestedToast'),
        variant: 'success',
      });
      setRequestingChanges(false);
      setFeedback('');
    } catch (error) {
      console.error('[tasks] review response failed', error);
      toast({ title: tCommon('errors.generic'), variant: 'destructive' });
    }
  };

  return (
    <Stack
      as="section"
      gap={3}
      className="border-primary/40 bg-primary/5 rounded-lg border p-3"
      aria-label={t('review.needsReview')}
    >
      <Row gap={2} align="start">
        <Bot className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="flex flex-col gap-0.5">
          <Text as="h3" variant="label">
            {t('review.needsReview')}
          </Text>
          <Text as="p" variant="muted" className="text-sm">
            {review.question ??
              t('review.defaultQuestion', {
                agent: review.agentSlug ?? t('review.anAgent'),
              })}
          </Text>
        </div>
      </Row>

      {requestingChanges ? (
        <Stack gap={2}>
          <Textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={t('review.feedbackPlaceholder')}
            rows={3}
            autoFocus
          />
          <Row gap={2} justify="end">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRequestingChanges(false)}
              disabled={respond.isPending}
            >
              {tCommon('actions.cancel')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void submit('request_changes')}
              disabled={respond.isPending || feedback.trim().length === 0}
            >
              {t('review.sendFeedback')}
            </Button>
          </Row>
        </Stack>
      ) : (
        <Row gap={2}>
          <Button
            size="sm"
            icon={CheckCircle2}
            onClick={() => void submit('approve')}
            disabled={respond.isPending}
          >
            {t('review.approve')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setRequestingChanges(true)}
            disabled={respond.isPending}
          >
            {t('review.requestChanges')}
          </Button>
        </Row>
      )}
    </Stack>
  );
}
