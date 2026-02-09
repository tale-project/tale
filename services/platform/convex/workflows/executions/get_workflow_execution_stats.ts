import type { Id, Doc } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';

export type GetWorkflowExecutionStatsArgs = {
  wfDefinitionId: Id<'wfDefinitions'>;
};

export type WorkflowExecutionStats = {
  total: number;
  completed: number;
  failed: number;
  suspended: number;
  running: number;
  successRate: number;
  avgExecutionTimeSeconds: number;
  lastExecution: number | null;
};

interface ExecutionCounts {
  completed: number;
  failed: number;
  suspended: number;
  running: number;
  completedExecutionTimeSum: number;
  completedWithTimeCount: number;
}

export async function getWorkflowExecutionStats(
  ctx: QueryCtx,
  args: GetWorkflowExecutionStatsArgs,
): Promise<WorkflowExecutionStats> {
  const executions = (await ctx.db
    .query('wfExecutions')
    .withIndex('by_definition', (q) =>
      q.eq('wfDefinitionId', args.wfDefinitionId),
    )
    .order('desc')
    .take(1000)) as Doc<'wfExecutions'>[];

  const total = executions.length;

  // Single pass to count all statuses and compute execution time sum
  const counts = executions.reduce<ExecutionCounts>(
    (acc, e) => {
      switch (e.status) {
        case 'completed':
          acc.completed++;
          if (e.completedAt) {
            acc.completedExecutionTimeSum += e.completedAt - e.startedAt;
            acc.completedWithTimeCount++;
          }
          break;
        case 'failed':
          acc.failed++;
          break;
        case 'suspended':
          acc.suspended++;
          break;
        case 'running':
          acc.running++;
          break;
      }
      return acc;
    },
    {
      completed: 0,
      failed: 0,
      suspended: 0,
      running: 0,
      completedExecutionTimeSum: 0,
      completedWithTimeCount: 0,
    },
  );

  const avgExecutionTimeMs =
    counts.completedWithTimeCount > 0
      ? counts.completedExecutionTimeSum / counts.completedWithTimeCount
      : 0;

  return {
    total,
    completed: counts.completed,
    failed: counts.failed,
    suspended: counts.suspended,
    running: counts.running,
    successRate: total > 0 ? (counts.completed / total) * 100 : 0,
    avgExecutionTimeSeconds: Math.round(avgExecutionTimeMs / 1000),
    lastExecution: executions[0]?.startedAt ?? null,
  };
}
