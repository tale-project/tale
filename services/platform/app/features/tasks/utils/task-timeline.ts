export type TaskActivityRow = {
  _id: string;
  actorType: 'user' | 'agent';
  actorId: string;
  action: string;
  fromValue?: string;
  toValue?: string;
  context?: {
    workflowSlug?: string;
    wfExecutionId?: string;
  };
  createdAt: number;
};

export type TaskAgentRunRow = {
  runId: string;
  agentSlug: string;
  trigger: string;
  status: string;
  error?: string;
  startedAt: number;
  durationMs?: number;
  costCents: number;
  workflowSlug?: string;
  wfExecutionId?: string;
};

export type TaskTimelineEntry =
  | { kind: 'activity'; at: number; entry: TaskActivityRow }
  | { kind: 'agentRun'; at: number; run: TaskAgentRunRow };

/** How far apart an activity row and agent run may be to share workflow context. */
export const WORKFLOW_CONTEXT_INFERENCE_WINDOW_MS = 5 * 60 * 1000;

/** When a workflow-sentinel activity row lacks stored context, borrow from the nearest run. */
export function inferWorkflowContextFromRuns(
  activityAt: number,
  runs: TaskAgentRunRow[],
): TaskActivityRow['context'] | undefined {
  let best: TaskAgentRunRow | undefined;
  let bestDelta = Infinity;
  for (const run of runs) {
    if (!run.workflowSlug && !run.wfExecutionId) continue;
    const delta = Math.abs(run.startedAt - activityAt);
    if (delta > WORKFLOW_CONTEXT_INFERENCE_WINDOW_MS) continue;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = run;
    }
  }
  if (!best) return undefined;
  return {
    workflowSlug: best.workflowSlug,
    wfExecutionId: best.wfExecutionId,
  };
}

/** Merge audit activity and agent runs into one descending timeline. */
export function mergeTaskTimeline(
  activity: TaskActivityRow[],
  runs: TaskAgentRunRow[],
): TaskTimelineEntry[] {
  const entries: TaskTimelineEntry[] = [
    ...activity.map((entry) => ({
      kind: 'activity' as const,
      at: entry.createdAt,
      entry,
    })),
    ...runs.map((run) => ({
      kind: 'agentRun' as const,
      at: run.startedAt,
      run,
    })),
  ];
  entries.sort((a, b) => {
    if (b.at !== a.at) return b.at - a.at;
    // Stable tie-break: runs before audit at the same millisecond (run starts
    // the work; the status/comment activity often follows immediately after).
    if (a.kind === b.kind) return 0;
    return a.kind === 'agentRun' ? -1 : 1;
  });
  return entries;
}
