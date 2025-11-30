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

  const combined: Array<{ stepNumber?: number } & Record<string, unknown>> = [];

  for (const wid of idsOrdered) {
    const journal = await ctx.runQuery(workflow.journal.load, {
      workflowId: wid,
    });
    const entries = journal.journalEntries || [];
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
