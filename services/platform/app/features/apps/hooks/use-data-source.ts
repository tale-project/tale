/**
 * The data-source resolver registry. Maps a view part's closed `source.kind`
 * (data_sources.ts) to a reactive platform query and normalizes the result into
 * `{ data, partState }` the render-kind components consume. This is the layer
 * that decouples the UI from any single workflow — a part can bind to a runs
 * list, a review queue, a task board, or one run, none of which is "a step".
 *
 * Hooks must run unconditionally, so every underlying query is called every
 * render with `'skip'` for the inactive sources (skip = no subscription).
 */
import { useMemo } from 'react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { toId } from '@/convex/lib/type_cast_helpers';
import type { PartState } from '@/lib/shared/platform/part_state';
import type { ViewSource } from '@/lib/shared/schemas/views';
import { isRecord } from '@/lib/utils/type-utils';

export interface ResolvedSource {
  data: unknown;
  partState: PartState;
}

interface QueryShape {
  data: unknown;
  isLoading: boolean;
  error: unknown;
}

/** Fold a query result + a derived item list into the part envelope's state. */
function toState(q: QueryShape, itemCount: number | undefined): PartState {
  if (q.error) return 'output_error';
  if (q.isLoading && q.data === undefined) return 'loading';
  if (q.data === undefined || q.data === null) return 'empty';
  if (itemCount !== undefined)
    return itemCount > 0 ? 'output_available' : 'empty';
  return 'output_available';
}

function rec(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function str(record: Record<string, unknown>, key: string): string | undefined {
  const v = record[key];
  return typeof v === 'string' ? v : undefined;
}

export function useDataSource(
  source: ViewSource,
  organizationId: string,
): ResolvedSource {
  const kind = source.kind;
  const params = source.params ?? {};
  const workflow = typeof params.workflow === 'string' ? params.workflow : '';
  const projectId =
    typeof params.projectId === 'string' ? params.projectId : '';
  const executionId =
    typeof params.executionId === 'string' ? params.executionId : '';

  const runs = useConvexQuery(
    api.workflow_executions.queries.listExecutions,
    kind === 'workflow_runs' && workflow
      ? {
          paginationOpts: { numItems: 25, cursor: null },
          wfDefinitionId: workflow,
        }
      : 'skip',
  );
  const approvals = useConvexQuery(
    api.approvals.queries.listActiveApprovalsByOrganization,
    kind === 'approval_queue' ? { organizationId } : 'skip',
  );
  const tasks = useConvexQuery(
    api.tasks.queries.listTasksByProject,
    kind === 'task_collection' && projectId
      ? { projectId: toId<'projects'>(projectId) }
      : 'skip',
  );
  const run = useConvexQuery(
    api.workflow_executions.queries.getExecutionStepStatuses,
    kind === 'workflow_run' && executionId ? { executionId } : 'skip',
  );

  return useMemo<ResolvedSource>(() => {
    switch (kind) {
      case 'workflow_runs': {
        const pageVal = rec(runs.data).page;
        const page = Array.isArray(pageVal) ? pageVal : [];
        const items = page.map((raw) => {
          const r = rec(raw);
          return {
            run: str(r, 'workflowVersion') ?? str(r, '_id') ?? '',
            status: str(r, 'status') ?? 'unknown',
            started:
              typeof r.startedAt === 'number'
                ? new Date(r.startedAt).toISOString()
                : '',
            executionId: str(r, '_id') ?? '',
          };
        });
        return { data: { items }, partState: toState(runs, items.length) };
      }
      case 'approval_queue': {
        const list = Array.isArray(approvals.data) ? approvals.data : [];
        const items = list.map((raw) => {
          const a = rec(raw);
          const meta = rec(a.metadata);
          const item: Record<string, unknown> = { id: str(a, '_id') ?? '' };
          if (
            a.resourceType === 'task_review' &&
            typeof a.resourceId === 'string'
          ) {
            item.taskId = a.resourceId;
          }
          const question = str(meta, 'question') ?? str(meta, 'summary');
          if (question !== undefined) item.question = question;
          return item;
        });
        return { data: { items }, partState: toState(approvals, items.length) };
      }
      case 'task_collection': {
        const raw = tasks.data as { tasks?: unknown } | undefined;
        const list = Array.isArray(raw?.tasks) ? raw.tasks : [];
        const items = list.map((t) => {
          const task = rec(t);
          return {
            title: str(task, 'title') ?? '',
            status: str(task, 'status') ?? '',
            ref: str(task, 'externalId') ?? '',
            taskId: str(task, '_id') ?? '',
          };
        });
        return { data: { items }, partState: toState(tasks, items.length) };
      }
      case 'workflow_run': {
        return {
          data: run.data ?? undefined,
          partState: toState(run, undefined),
        };
      }
      default:
        return { data: undefined, partState: 'empty' };
    }
  }, [kind, runs, approvals, tasks, run]);
}
