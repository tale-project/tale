import type { QueryCtx } from '../../_generated/server';
import type { Id, Doc } from '../../_generated/dataModel';
import { components } from '../../_generated/api';

const workflow = components.workflow;

export type GetExecutionStepJournalArgs = {
  executionId: Id<'wfExecutions'>;
};

export async function getExecutionStepJournal(
  ctx: QueryCtx,
  args: GetExecutionStepJournalArgs,
): Promise<Array<unknown>> {
  const execution = (await ctx.db.get(
    args.executionId,
  )) as Doc<'wfExecutions'> | null;
  if (!execution) return [];

  const metadata = execution.metadata
    ? (JSON.parse(execution.metadata) as Record<string, unknown>)
    : {};
  const history: string[] = Array.isArray(metadata.componentWorkflowIds)
    ? (metadata.componentWorkflowIds as string[])
    : [];
  const idsOrdered: string[] = Array.from(
    new Set([
      ...history,
      ...(execution.componentWorkflowId ? [execution.componentWorkflowId] : []),
    ]),
  );

  if (idsOrdered.length === 0) return [];

  // Load all journals in parallel
  const journals = await Promise.all(
    idsOrdered.map((wid) =>
      ctx.runQuery(workflow.journal.load, { workflowId: wid }),
    ),
  );

  // Combine and sort entries, preserving workflow order
  const combined: Array<{ stepNumber?: number } & Record<string, unknown>> = [];
  for (let i = 0; i < idsOrdered.length; i++) {
    const wid = idsOrdered[i];
    const entries = journals[i].journalEntries || [];
    const sorted = (
      entries as Array<{ stepNumber?: number } & Record<string, unknown>>
    )
      .slice()
      .sort((a, b) => (a.stepNumber ?? 0) - (b.stepNumber ?? 0));

    for (const e of sorted) {
      combined.push({ ...e, _componentWorkflowId: wid });
    }
  }

  return combined as unknown as Array<unknown>;
}
