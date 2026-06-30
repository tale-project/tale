'use client';

/**
 * Route-free, reusable execution view — the operator render-kind panels
 * (stage timeline + per-step transcript / gate / artifact / summary.md, live
 * agent transcript included) for one execution, embeddable inside ANY domain
 * component (a task card/detail now; other components later). This is the only
 * justification for the step `ui` config / render-kinds: how a step renders when
 * fused into a domain surface. Given just `{organizationId, executionId}`.
 *
 * A terminal run also offers a **Re-run**: a failed run is terminal and cannot be
 * resumed, so this starts a fresh, subject-linked run (copying the original's
 * input). Because the new run carries the same subject, the surrounding
 * `SubjectRun` swaps to it reactively.
 *
 * A still-running run offers a **Stop**: a confirmed cancel of the underlying
 * workflow (abandons in-progress steps, marks the run failed). This is the only
 * user-facing way to halt a runaway run from where runs are actually viewed.
 */
import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useExecutionProjection } from '../hooks/use-execution-projection';
import { mapExecutionError } from '../lib/map-execution-error';
import { OperatorView } from './operator-view';

/** Terminal execution states — a re-run is offered only once a run has settled
 * (a still-running run is left alone; the concurrency guard refuses a second). */
const TERMINAL_STATUSES = new Set(['completed', 'failed']);

/** In-flight states — a Stop is offered only here, mirroring the backend
 * `cancelExecution` guard (it rejects any non-running/pending status). */
const RUNNING_STATUSES = new Set(['running', 'pending']);

function RerunButton({ executionId }: { executionId: Id<'wfExecutions'> }) {
  const { t } = useT('operator');
  const { t: tCommon } = useT('common');
  const { mutateAsync, isPending } = useConvexAction(
    api.workflow_executions.actions.rerunExecution,
  );

  const run = async () => {
    try {
      const result = await mutateAsync({ executionId });
      if (result.started) {
        toast({ title: t('rerun.started'), variant: 'success' });
      } else if (result.reason === 'already_running') {
        toast({ title: t('rerun.alreadyRunning') });
      } else {
        toast({ title: t('rerun.notStarted'), variant: 'destructive' });
      }
    } catch (err) {
      // The action throws structured codes on hard errors (unauthenticated /
      // not found / no workflow slug); map them to a specific message rather
      // than leaking the raw ConvexError JSON blob.
      toast({
        title: mapExecutionError(err, tCommon, t('rerun.notStarted')),
        variant: 'destructive',
      });
    }
  };

  return (
    <Button variant="secondary" disabled={isPending} onClick={() => void run()}>
      {t('rerun.button')}
    </Button>
  );
}

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
}: {
  organizationId: string;
  executionId: Id<'wfExecutions'>;
}) {
  const { projection, isLoading, error } = useExecutionProjection({
    organizationId,
    executionId,
  });

  if (error) return <Text variant="error">{error.message}</Text>;
  if (!projection) return isLoading ? <SkeletonText lines={4} /> : null;
  const showRerun = TERMINAL_STATUSES.has(projection.status);
  const showStop = RUNNING_STATUSES.has(projection.status);
  return (
    <Stack gap={3}>
      {(showRerun || showStop) && (
        <Row gap={0} align="stretch" justify="end">
          {showRerun ? (
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
