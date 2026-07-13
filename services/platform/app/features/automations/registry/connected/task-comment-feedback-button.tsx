'use client';

/**
 * Feedback-first bound action: required textarea → task comment → dispatch.
 * Used when a BoundActionSpec declares `feedback: { as: "taskComment" }`
 * (Request changes). Kept as its own component so BoundButton can early-return
 * without conditional hooks.
 */
import { Button } from '@tale/ui/button';
import { useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { evaluateWhen } from '@/lib/shared/platform/when_predicate';
import type { BoundActionSpec } from '@/lib/shared/schemas/automation_views';

import { useAddTaskComment } from '../../../tasks/hooks/mutations';
import { useBoundAction } from '../../hooks/use-bound-action';
import { useActionEffect } from '../../runtime/action-effects';

export function hasTaskCommentFeedback(
  action: BoundActionSpec,
): action is BoundActionSpec & { feedback: { as: 'taskComment' } } {
  return action.feedback?.as === 'taskComment';
}

function taskIdFromItem(
  item: Record<string, unknown> | undefined,
): Id<'tasks'> | undefined {
  const id = item?._id ?? item?.id;
  return typeof id === 'string' && id.length > 0
    ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- row id for subjectType=task collections
      (id as Id<'tasks'>)
    : undefined;
}

/** Shared form + submit for list buttons and board card runners. */
export function TaskCommentFeedbackDialog({
  action,
  item,
  open,
  onOpenChange,
}: {
  action: BoundActionSpec;
  item?: Record<string, unknown>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { dispatch, isPending: starting } = useBoundAction(
    action.path,
    action.mode,
  );
  const applyEffect = useActionEffect();
  const addComment = useAddTaskComment();
  const [feedback, setFeedback] = useState('');
  const pending = addComment.isPending || starting;
  const trimmed = feedback.trim();
  const taskId = taskIdFromItem(item);

  const submit = async () => {
    if (trimmed.length === 0) {
      toast({
        title: t('detail.requestChangesEmpty'),
        variant: 'destructive',
      });
      return;
    }
    if (!taskId) {
      toast({ title: tCommon('errors.generic'), variant: 'destructive' });
      return;
    }
    try {
      await addComment.mutateAsync({ taskId, body: trimmed });
      const result = await dispatch(action.args, item);
      applyEffect(action.onSuccess, result, item);
      toast({
        title: t('detail.requestChangesStarted'),
        variant: 'success',
      });
      onOpenChange(false);
      setFeedback('');
    } catch (err) {
      console.error(
        '[automation-binding] feedback action failed',
        action.path,
        err,
      );
      toast({ title: tCommon('errors.generic'), variant: 'destructive' });
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
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
  );
}

export function TaskCommentFeedbackButton({
  action,
  item,
  size = 'sm',
}: {
  action: BoundActionSpec;
  item?: Record<string, unknown>;
  size?: 'sm' | 'default';
}) {
  const { t } = useT('automations');
  const [open, setOpen] = useState(false);

  if (item && action.when && !evaluateWhen(action.when, item)) return null;

  const label = action.labelKey
    ? t(action.labelKey, { defaultValue: action.label ?? action.path })
    : (action.label ?? action.path);

  return (
    <>
      <Button
        size={size}
        variant={action.variant ?? 'secondary'}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <TaskCommentFeedbackDialog
        action={action}
        item={item}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
