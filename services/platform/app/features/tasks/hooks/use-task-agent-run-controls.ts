import { toast } from '@tale/ui/use-toast';
import { useState } from 'react';

import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';

import { taskRunErrorMessage } from '../lib/task-run-error';
import { useCancelTaskAgentRun, useStartTaskAgentRun } from './mutations';

/** The start refusal's reason, as a sentence the user can act on. */
function notStartedMessage(
  t: (key: string) => string,
  reason: string | undefined,
): string {
  switch (reason) {
    case 'agent_missing':
    case 'agent_unavailable':
      return t('agentRun.agentMissing');
    case 'no_agent_assignee':
      return t('agentRun.noAgentAssignee');
    default:
      return t('agentRun.notStarted');
  }
}

/**
 * Start (or retry) and cancel a task's agent run, each reported once: what
 * the run strip beside the assignee and the failed-run notice in the task's
 * body both do, so the two never word a refusal differently.
 */
export function useTaskAgentRunControls(taskId: string) {
  const { t } = useT('tasks');
  const { mutateAsync: startRun } = useStartTaskAgentRun();
  const { mutateAsync: cancelRun } = useCancelTaskAgentRun({
    errorToast: false,
  });
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const result = await startRun({ taskId });
      if (result.started) {
        toast({ title: t('agentRun.started'), variant: 'success' });
      } else if (result.reason === 'already_running') {
        toast({ title: t('agentRun.alreadyRunning') });
      } else {
        toast({
          title: notStartedMessage(t, result.reason),
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('startTaskAgentRun failed', error);
      const known = taskRunErrorMessage(error, t);
      toast({
        title: known ?? t('agentRun.notStarted'),
        // A refusal named above is the whole story; any other says why.
        description: known === undefined ? failureDetail(error) : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await cancelRun({ taskId });
      toast({ title: t('agentRun.cancelled') });
    } catch (error) {
      console.error('cancelTaskAgentRun failed', error);
      toast({
        title: t('agentRun.cancelFailed'),
        description: failureDetail(error),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return { start, cancel, busy };
}
