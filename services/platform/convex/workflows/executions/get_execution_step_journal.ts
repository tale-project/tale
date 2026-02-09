import type { Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';

import { components } from '../../_generated/api';

const workflow = components.workflow;

export type GetExecutionStepJournalArgs = {
  executionId: Id<'wfExecutions'>;
};

export async function getExecutionStepJournal(
  ctx: QueryCtx,
  args: GetExecutionStepJournalArgs,
): Promise<Array<unknown>> {
  const execution = await ctx.db.get(args.executionId);
  if (!execution) return [];

  const metadata: Record<string, unknown> = execution.metadata
    ? JSON.parse(execution.metadata)
    : {};
  const rawIds = Array.isArray(metadata.componentWorkflowIds)
    ? metadata.componentWorkflowIds.filter(
        (x: unknown): x is string => typeof x === 'string',
      )
    : [];
  const idsOrdered: string[] = Array.from(
    new Set([
      ...rawIds,
      ...(execution.componentWorkflowId ? [execution.componentWorkflowId] : []),
    ]),
  );

  if (idsOrdered.length === 0) return [];

  const journals = await Promise.all(
    idsOrdered.map((wid) =>
      ctx.runQuery(workflow.journal.load, { workflowId: wid }),
    ),
  );

  const combined: Array<Record<string, unknown>> = [];
  for (let i = 0; i < idsOrdered.length; i++) {
    const wid = idsOrdered[i];
    const entries = journals[i].journalEntries || [];
    const sorted = entries
      .slice()
      .sort(
        (a: Record<string, unknown>, b: Record<string, unknown>) =>
          (typeof a.stepNumber === 'number' ? a.stepNumber : 0) -
          (typeof b.stepNumber === 'number' ? b.stepNumber : 0),
      );

    for (const e of sorted) {
      combined.push({ ...e, _componentWorkflowId: wid });
    }
  }

  return combined;
}
