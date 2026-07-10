'use client';

/**
 * Feedback-first "Request changes" for the task detail overlay.
 *
 * Desk workflows (e.g. VAT return) branch on user comments after the last
 * prepared marker — clicking start without a new comment just re-runs the
 * unchanged pipeline. This control requires written feedback, posts it as a
 * task comment, then starts the automation workflow.
 */
import { Button } from '@tale/ui/button';
import { useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useAddTaskComment } from '../../tasks/hooks/mutations';
import { useBoundAction } from '../hooks/use-bound-action';

export function RequestChangesButton({
  taskId,
  organizationId,
  workflowSlug,
}: {
  taskId: Id<'tasks'>;
  organizationId: string;
  workflowSlug: string;
}) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const addComment = useAddTaskComment();
  const { dispatch, isPending: starting } = useBoundAction(
    'tasks/public_actions:startTaskWorkflow',
    'action',
  );
  const pending = addComment.isPending || starting;
  const trimmed = feedback.trim();

  const submit = async () => {
    if (trimmed.length === 0) {
      toast({
        title: t('detail.requestChangesEmpty'),
        variant: 'destructive',
      });
      return;
    }
    try {
      await addComment.mutateAsync({ taskId, body: trimmed });
      await dispatch({
        organizationId,
        taskId,
        workflowSlug,
      });
      toast({
        title: t('detail.requestChangesStarted'),
        variant: 'success',
      });
      setOpen(false);
      setFeedback('');
    } catch (err) {
      console.error('[automations] request changes failed', err);
      toast({ title: tCommon('errors.generic'), variant: 'destructive' });
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        disabled={pending}
      >
        {t('list.requestChanges')}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setFeedback('');
        }}
        title={t('detail.requestChangesTitle')}
        description={t('detail.requestChangesDescription')}
        submitText={t('detail.requestChangesSubmit')}
        isSubmitting={pending}
        isValid={trimmed.length > 0}
        isDirty={trimmed.length > 0}
        confirmDiscardOnDirty
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Textarea
          label={t('detail.requestChangesFeedbackLabel')}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder={t('detail.requestChangesPlaceholder')}
          rows={4}
          required
          autoFocus
        />
      </FormDialog>
    </>
  );
}
