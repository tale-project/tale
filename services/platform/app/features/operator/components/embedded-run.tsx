'use client';

/**
 * Route-free, reusable execution view — the operator render-kind panels
 * (stage timeline + per-step transcript / gate / artifact / summary.md, live
 * agent transcript included) for one execution, embeddable inside ANY domain
 * component (a task card/detail now; other components later). This is the only
 * justification for the step `ui` config / render-kinds: how a step renders when
 * fused into a domain surface. Given just `{organizationId, executionId}`.
 *
 * A terminal **failed** run also offers a **Re-run** (`showRerun`, default on):
 * a failed run cannot be resumed, so this starts a fresh, subject-linked run
 * (copying the original's input). Successful completed runs never show it. A
 * surface that owns its own re-run verb passes `showRerun={false}` — the
 * subject-linked desk expand view does, because its Start / Request changes own
 * intentional re-runs, so a user-cancelled (terminal-failed) run isn't offered a
 * second anonymous retry right next to Start.
 *
 * A still-running run can offer a **Stop** when `showStop` is true: a confirmed
 * cancel of the underlying workflow. Subject-linked desk expand views leave
 * Stop off — the desk **Cancel** action (`cancelTaskWorkflow`) owns halting
 * the run so Start / Cancel stay one clean pair.
 */
import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useExecutionProjection } from '../hooks/use-execution-projection';
import { mapExecutionError } from '../lib/map-execution-error';
import { OperatorView } from './operator-view';
import { RerunButton } from './rerun-button';

/** In-flight states — a Stop is offered only here, mirroring the backend
 * `cancelExecution` guard (it rejects any non-running/pending status). */
const RUNNING_STATUSES = new Set(['running', 'pending']);

function StopButton({ executionId }: { executionId: Id<'wfExecutions'> }) {
  const { t } = useT('operator');
  const { t: tCommon } = useT('common');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { mutateAsync, isPending } = useConvexMutation(
    api.workflow_executions.mutations.cancelExecution,
  );

  const stop = async () => {
    try {
      await mutateAsync({ executionId });
      toast({ title: t('stop.stopped'), variant: 'success' });
    } catch (err) {
      // cancelExecution throws a structured code if the run already settled (a
      // race) or is gone — map it rather than leak the raw ConvexError JSON.
      toast({
        title: mapExecutionError(err, tCommon, t('stop.failed')),
        variant: 'destructive',
      });
    } finally {
      setConfirmOpen(false);
    }
  };

  return (
    <>
      <Button
        variant="destructive"
        disabled={isPending}
        onClick={() => setConfirmOpen(true)}
      >
        {t('stop.button')}
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        variant="destructive"
        title={t('stop.confirm.title')}
        description={t('stop.confirm.description')}
        confirmText={t('stop.confirm.confirm')}
        isLoading={isPending}
        onConfirm={() => void stop()}
      />
    </>
  );
}

export function EmbeddedRun({
  organizationId,
  executionId,
  showStop = false,
  showRerun = true,
}: {
  organizationId: string;
  executionId: Id<'wfExecutions'>;
  /**
   * Opt-in Stop control. Subject-linked desk expand views leave this off —
   * desk Cancel (`cancelTaskWorkflow`) owns halting the run. Surfaces that
   * have no Cancel verb can pass `true`.
   */
  showStop?: boolean;
  /**
   * Show the Re-run button on a failed run. Subject-linked desk expand views
   * pass `false`: their Start / Request changes own intentional re-runs, so a
   * user-cancelled or failed run must not also offer a second anonymous retry.
   */
  showRerun?: boolean;
}) {
  const { projection, isLoading, error } = useExecutionProjection({
    organizationId,
    executionId,
  });

  if (error) return <Text variant="error">{error.message}</Text>;
  if (!projection) return isLoading ? <SkeletonText lines={4} /> : null;
  /** Failed executions only, and only where the surface doesn't own its own
   *  re-run verb (subject-linked desk views pass showRerun=false — their Start
   *  owns it, so a user-cancelled run isn't offered a redundant retry). */
  const rerunVisible = showRerun && projection.status === 'failed';
  const stopVisible = showStop && RUNNING_STATUSES.has(projection.status);
  return (
    <Stack gap={3}>
      {(rerunVisible || stopVisible) && (
        <Row gap={0} align="stretch" justify="end">
          {rerunVisible ? (
            <RerunButton executionId={executionId} />
          ) : (
            <StopButton executionId={executionId} />
          )}
        </Row>
      )}
      <OperatorView projection={projection} />
    </Stack>
  );
}
