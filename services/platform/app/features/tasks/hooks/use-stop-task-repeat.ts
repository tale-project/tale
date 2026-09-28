'use client';

import { formatTaskIdentifier } from '@tale/shared/utils/project-key';
import { toast } from '@tale/ui/use-toast';
import { type QueryClient, QueryClientContext } from '@tanstack/react-query';
import { useContext } from 'react';

import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
import { activeOrganizationId } from '@/app/lib/backend/adapters';
import type { ReturnsOf } from '@/app/lib/backend/contract';
import { ensureAdaptedQueryData } from '@/app/lib/backend/prefetch';
import { useT } from '@/lib/i18n/client';

/** The next task a stop may take back: its id, and its number when known. */
interface StopRepeatNextTask {
  id: string;
  number?: number;
}

/**
 * The next task's name for the toast saying it stays: its identifier, else
 * its title. Read only when that answer comes — from the cache when the
 * board or sheet already holds it — and never through a component: the
 * toast outlives the card or sheet that asked for the stop. `undefined`
 * when the task cannot be read.
 */
async function nextTaskName(
  queryClient: QueryClient | undefined,
  next: StopRepeatNextTask,
): Promise<string | undefined> {
  const organizationId = activeOrganizationId();
  if (queryClient === undefined || organizationId === undefined) {
    return undefined;
  }
  let detail: ReturnsOf<'tasks/queries:getTask'>;
  try {
    detail = await ensureAdaptedQueryData(
      queryClient,
      'tasks/queries:getTask',
      { organizationId, taskId: next.id },
    );
  } catch (error) {
    console.warn('[tasks] could not read the next task to name it', error);
    return undefined;
  }
  if (detail === null) return undefined;
  const { task } = detail;
  try {
    const project = await ensureAdaptedQueryData(
      queryClient,
      'projects/queries:getProject',
      { organizationId, projectId: task.projectId },
    );
    return (
      formatTaskIdentifier(project?.key, task.number ?? next.number) ??
      task.title
    );
  } catch (error) {
    console.warn('[tasks] could not read the next task’s project', error);
    return task.title;
  }
}

/**
 * "Stop repeating", from the task whose series continues on `next`: the
 * series ends, and the next task is taken back while nobody has touched it
 * yet. A toast says which happened. The one way to do it, shared by the
 * "Next task created" toast and the button beside the task's "Next task"
 * link.
 *
 * `stop` resolves `true` as soon as the series has stopped — before the
 * toast naming a next task that stays has read that name, so the caller
 * can move focus while its own button is still there — and `false` when
 * the write failed: its own error toast says so.
 */
export function useStopTaskRepeat(): {
  stop: (taskId: string, next: StopRepeatNextTask) => Promise<boolean>;
  isPending: boolean;
} {
  const { t } = useT('tasks');
  // Read without `useQueryClient`, which throws outside a provider: the
  // name is a nicety, and the write hooks run in surfaces tested without one.
  const queryClient = useContext(QueryClientContext);
  const stopRepeat = useBackendMutation('tasks/mutations:stopTaskRepeat');

  const stop = async (
    taskId: string,
    next: StopRepeatNextTask,
  ): Promise<boolean> => {
    let removedNextTask: boolean;
    try {
      ({ removedNextTask } = await stopRepeat.mutateAsync({
        taskId,
        nextTaskId: next.id,
      }));
    } catch (error) {
      console.warn('[tasks] stopping the repeat failed', error);
      return false;
    }
    if (removedNextTask) {
      toast({
        title: t('repeat.stop.done'),
        description: t('repeat.stop.removed'),
        variant: 'success',
      });
      return true;
    }
    // It stayed, without its rule: its own reads were held back while it
    // might have been taken back, and refresh now.
    void queryClient?.invalidateQueries({
      predicate: (query) => query.queryKey.includes(next.id),
    });
    void nextTaskName(queryClient, next)
      .then((name) => {
        toast({
          title: t('repeat.stop.done'),
          description:
            name === undefined
              ? t('repeat.stop.keptUnnamed')
              : t('repeat.stop.kept', { task: name }),
          variant: 'success',
        });
      })
      .catch((error: unknown) => {
        console.warn('[tasks] could not say the repeat stopped', error);
      });
    return true;
  };

  return { stop, isPending: stopRepeat.isPending };
}
