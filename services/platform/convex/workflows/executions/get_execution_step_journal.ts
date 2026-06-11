import type { Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { getWorkflowComponentForExecution } from './get_workflow_component';

export type GetExecutionStepJournalArgs = {
  executionId: Id<'wfExecutions'>;
};

export async function getExecutionStepJournal(
  ctx: QueryCtx,
  args: GetExecutionStepJournalArgs,
): Promise<Array<unknown>> {
  const execution = await ctx.db.get(args.executionId);
  if (!execution) return [];

  // Journals live on the component shard the execution was started on —
  // loading from a fixed shard made ~75% of journals appear empty.
  const workflow = getWorkflowComponentForExecution(execution);

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
    idsOrdered.map(async (wid) => {
      try {
        return await ctx.runQuery(workflow.journal.load, { workflowId: wid });
      } catch (error) {
        // Cleaned-up component workflows legitimately 404 here; this swallow
        // also hid the shard-routing bug, so keep a trace of every miss.
        console.warn(
          `getExecutionStepJournal: failed to load journal for workflow ${wid}:`,
          error,
        );
        return null;
      }
    }),
  );

  const combined: Array<Record<string, unknown>> = [];
  for (let i = 0; i < idsOrdered.length; i++) {
    const wid = idsOrdered[i];
    const journal = journals[i];
    if (!journal) continue;

    const entries = journal.journalEntries || [];
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
