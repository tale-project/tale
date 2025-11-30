import type { QueryCtx } from '../../_generated/server';
import type { Id, Doc } from '../../_generated/dataModel';

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
  const completed = executions.filter((e) => e.status === 'completed').length;
  const failed = executions.filter((e) => e.status === 'failed').length;
  const suspended = executions.filter((e) => e.status === 'suspended').length;
  const running = executions.filter((e) => e.status === 'running').length;

  const completedExecutions = executions.filter(
    (e) => e.status === 'completed' && e.completedAt,
  );
  const avgExecutionTimeMs =
    completedExecutions.length > 0
      ? completedExecutions.reduce(
          (sum: number, e) => sum + (e.completedAt! - e.startedAt),
          0,
        ) / completedExecutions.length
      : 0;

  return {
    total,
    completed,
    failed,
    suspended,
    running,
    successRate: total > 0 ? (completed / total) * 100 : 0,
    avgExecutionTimeSeconds: Math.round(avgExecutionTimeMs / 1000),
    lastExecution: executions[0]?.startedAt ?? null,
  };
}
