'use client';

/**
 * Re-run a terminal (failed/completed) execution as a fresh, subject-linked run.
 * A failed run is terminal and can't be resumed, so `rerunExecution` starts a
 * clean run copying the original's input; because the new run carries the same
 * subject, any view watching that subject (the embedded run view, a list's
 * per-row run indicator) swaps to it reactively. Reused wherever a re-run is
 * offered — the embedded run view and the list-row "Failed" affordance — so the
 * toast/error-mapping/i18n stay in one place.
 */
import { Button } from '@tale/ui/button';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { mapExecutionError } from '../lib/map-execution-error';

export function RerunButton({
  executionId,
}: {
  executionId: Id<'wfExecutions'>;
}) {
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
    <Button
      variant="secondary"
      isLoading={isPending}
      onClick={() => void run()}
    >
      {t('rerun.button')}
    </Button>
  );
}
