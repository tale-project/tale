'use client';

/**
 * Inline answer panel for a subject whose latest run parked awaiting operator
 * input. Renders the question(s) the run carried — from the pending
 * `operator_input` / `human_input_request` approval's `metadata.questions` — plus
 * a reply box and a single "Submit & continue" action that posts the answer to
 * the task thread and re-runs the automation. Lets the operator answer in place
 * instead of hunting through the task discussion for the ask.
 *
 * Generic: any automation that parks by minting such a marker with
 * `metadata.questions` gets this panel; nothing here is desk-specific. Renders
 * nothing unless there is a pending request (the small `getSubjectInputRequest`
 * query), so it only appears on rows that actually need an answer. Platform code
 * over org-RLS-gated execution data, like `SubjectRun` and the status chip.
 */
import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { MessageCircleQuestion } from 'lucide-react';
import { useState } from 'react';

import { Textarea } from '@/app/components/ui/forms/textarea';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useAutomationRuntime } from '../../runtime/automation-runtime';

export function SubjectInputPanel({
  subjectType,
  subjectId,
}: {
  subjectType: string;
  subjectId: string;
}) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { organizationId } = useAutomationRuntime();
  const { data } = useConvexQuery(
    api.workflow_executions.queries.getSubjectInputRequest,
    { organizationId, subjectType, subjectId },
  );
  // We own the error toast (submit posts then re-runs) — opt out of the hook's.
  const postComment = useConvexMutation(api.tasks.mutations.addTaskComment, {
    errorToast: false,
  });
  const rerun = useConvexAction(api.workflow_executions.actions.rerunExecution);
  const [answer, setAnswer] = useState('');

  // Only task subjects carry the reply thread this panel posts into.
  if (!data || subjectType !== 'task') return null;

  const busy = postComment.isPending || rerun.isPending;

  const submit = async () => {
    const body = answer.trim();
    if (body.length === 0) return;
    try {
      await postComment.mutateAsync({
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- subjectId for subjectType=task is a tasks id
        taskId: subjectId as Id<'tasks'>,
        body,
      });
      // Post-then-run: the reply is committed before the fresh run reads the
      // thread (a run reads comments only at start, never mid-flight).
      const result = await rerun.mutateAsync({ executionId: data.executionId });
      if (result.started || result.reason === 'already_running') {
        toast({ title: t('runs.input.submittedToast'), variant: 'success' });
        setAnswer('');
      } else {
        toast({
          title: t('runs.input.rerunFailedToast'),
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('[automations] submit operator input failed', error);
      toast({ title: tCommon('errors.generic'), variant: 'destructive' });
    }
  };

  return (
    // The house banner (same primitive as the desk's "Getting started" box),
    // info-tinted to match the blue "Needs your input" chip. `live="off"`:
    // it appears on a user-initiated expand, not as an announcement.
    <Alert
      variant="info"
      icon={MessageCircleQuestion}
      title={t('runs.input.heading')}
      live="off"
      description={data.questions.map((question) => (
        <Text key={question} as="p" variant="muted" className="text-sm">
          {question}
        </Text>
      ))}
    >
      <Stack gap={2} className="mt-3">
        <Textarea
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder={t('runs.input.placeholder')}
          rows={2}
          aria-label={t('runs.input.heading')}
          className="bg-background"
        />
        <Row gap={2} justify="end">
          <Button
            size="sm"
            onClick={() => void submit()}
            disabled={busy || answer.trim().length === 0}
          >
            {t('runs.input.submit')}
          </Button>
        </Row>
      </Stack>
    </Alert>
  );
}
