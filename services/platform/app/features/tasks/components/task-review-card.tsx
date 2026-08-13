'use client';

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Bot, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';

import { Textarea } from '@/app/components/ui/forms/textarea';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useRespondToTaskReview } from '../hooks/mutations';
import { usePendingTaskReview } from '../hooks/queries';
import { useActorDirectory } from '../hooks/use-actor-directory';

/**
 * The human side of the review gate, rendered prominently in the task detail
 * sheet while a `task_review` approval is pending: Approve completes the task
 * (the only automated path to done); Request changes needs feedback, hands the
 * card back to the assignee (In progress) and re-engages an agent driver with
 * the feedback. Names the reviewer the gate waits on — but designation is SOFT,
 * so any project editor may respond; the actions are hidden only from read-only
 * viewers (`canEdit`, matching the server's `respondToTaskReview` gate — the
 * card itself stays visible to them). Modeled on the chat human-input card.
 *
 * The gate opens on the STATE, so the submission may be a person's, not an
 * agent's: the copy names an agent ONLY when the request carries a driver name.
 */
export function TaskReviewCard({
  taskId,
  organizationId,
  canEdit = false,
}: {
  taskId: Id<'tasks'>;
  organizationId: string;
  canEdit?: boolean;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const { review } = usePendingTaskReview(taskId);
  const respond = useRespondToTaskReview();
  const { resolveActor } = useActorDirectory(organizationId);
  const { data: me } = useCurrentMemberContext(organizationId);
  const [requestingChanges, setRequestingChanges] = useState(false);
  const [feedback, setFeedback] = useState('');

  if (!review) return null;

  const waitingOn =
    review.requestedFor === undefined
      ? null
      : review.requestedFor === me?.userId
        ? t('review.waitingOnYou')
        : t('review.waitingOn', {
            name: resolveActor('user', review.requestedFor).name,
          });

  const submit = async (decision: 'approve' | 'request_changes') => {
    try {
      const result = await respond.mutateAsync({
        approvalId: review.approvalId,
        decision,
        feedback: decision === 'request_changes' ? feedback.trim() : undefined,
      });
      toast({
        title:
          decision === 'approve'
            ? result.taskCompleted
              ? t('review.approvedToast')
              : t('review.approvedRecordedToast')
            : result.agentKicked
              ? t('review.changesRequestedToast')
              : result.taskReopened
                ? t('review.sentBackToast')
                : t('review.changesRecordedToast'),
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
              (review.agentSlug
                ? t('review.defaultQuestion', { agent: review.agentSlug })
                : t('review.submittedQuestion'))}
          </Text>
          {waitingOn !== null && (
            <Text as="p" variant="muted" className="text-xs">
              {waitingOn}
            </Text>
          )}
        </div>
      </Row>

      {canEdit &&
        (requestingChanges ? (
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
                variant="ghost"
                onClick={() => setRequestingChanges(false)}
                disabled={respond.isPending}
              >
                {tCommon('actions.cancel')}
              </Button>
              <Button
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
              icon={CheckCircle2}
              onClick={() => void submit('approve')}
              disabled={respond.isPending}
            >
              {t('review.approve')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setRequestingChanges(true)}
              disabled={respond.isPending}
            >
              {t('review.requestChanges')}
            </Button>
          </Row>
        ))}
    </Stack>
  );
}
