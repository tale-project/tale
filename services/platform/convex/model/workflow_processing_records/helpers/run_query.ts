import { QueryCtx } from '../../../_generated/server';
import { FindUnprocessedWithCustomQueryArgs } from '../types';
import { isDocumentProcessed } from './is_document_processed';

/**
 * Shared helper to run a workflow-processing query starting from a given
 * resume point and return matching documents.
 *
 * This encapsulates the common logic of:
 * - Calling the caller-provided `buildQuery(startFrom)`
 * - Iterating candidates in index order
 * - Skipping already-processed documents (respecting `cutoffTimestamp`)
 * - Applying the optional `additionalFilter`
 */
export async function runQuery<T = unknown>(
  ctx: QueryCtx,
  args: FindUnprocessedWithCustomQueryArgs<T>,
  startFrom: number | null,
  limit: number,
): Promise<T[]> {
  const {
    tableName,
    workflowId,
    cutoffTimestamp,
    buildQuery,
    additionalFilter,
  } = args;

  const candidateIter = buildQuery(startFrom);
  const documents: T[] = [];

  for await (const doc of candidateIter) {
    const docId = String((doc as any)._id);

    const processed = await isDocumentProcessed(ctx, {
      tableName,
      documentId: docId,
      workflowId,
      cutoffTimestamp,
    });

    if (processed) {
      continue;
    }

    if (additionalFilter) {
      const passesFilter = await additionalFilter(doc as any);
      if (!passesFilter) {
        continue;
      }
    }

    documents.push(doc as T);

    if (documents.length >= limit) {
      break;
    }
  }

  return documents;
}
