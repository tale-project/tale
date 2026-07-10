'use client';

/**
 * Route-free, reusable execution view — the operator render-kind panels
 * (stage timeline + per-step transcript / gate / artifact / summary.md, live
 * agent transcript included) for one execution, embeddable inside ANY domain
 * component (a task card/detail now; other components later). This is the only
 * justification for the step `ui` config / render-kinds: how a step renders when
 * fused into a domain surface. Given just `{organizationId, executionId}`.
 *
 * A terminal **failed** run also offers a **Re-run**: a failed run cannot be
 * resumed, so this starts a fresh, subject-linked run (copying the original's
 * input). Successful completed runs do not show Re-run here — desk actions
 * (Request changes / Start) own intentional re-runs so operators are not
 * offered a second anonymous retry next to feedback-first flows.
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
  /** Failed executions only — completed runs use desk Start / Request changes. */
  const showRerun = projection.status === 'failed';
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
