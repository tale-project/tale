import type { Sql, TransactionSql } from 'postgres';

import { emitHintInTx } from '../../realtime/outbox.ts';

/**
 * The realtime hints one document write owes — emitted INSIDE the writing
 * transaction, like every outbox hint.
 *
 * `document` names the changed row (or, for a folder cascade, the folder) so
 * the document reads refetch. A PROJECT document owes a `task` hint as well:
 * the task DTO carries folder facts derived from the project's documents —
 * `hasFiles` and `folderExists` (`collectFolderFacts`, tasks/service.ts) —
 * and an automation-owned task's Start gate IS that stamp. Before this, an
 * upload into a task's bound folder refreshed the Files zone (a `document`
 * read) while the panel beside it kept saying "waiting for input files"
 * until a reload: nothing told the task reads to refetch. Comments set the
 * precedent — a comment write emits `task` because `commentCount` rides the
 * task DTO — and this is the same rule for the folder facts.
 *
 * The task hint carries no task id: one folder change can move the facts of
 * several tasks, and the client invalidates the whole `task` family by prefix
 * anyway. Hub documents (no project) can never be a task's input, so they owe
 * only the `document` hint.
 */
export async function emitDocumentChangeHints(
  tx: TransactionSql | Sql,
  args: {
    orgId: string;
    /** The document id, or the folder id for a whole-folder change. */
    entityId: string | null;
    /** The document's project — `null` for a Knowledge Hub row. */
    projectId: string | null;
  },
): Promise<void> {
  await emitHintInTx(tx, {
    orgId: args.orgId,
    entity: 'document',
    entityId: args.entityId,
  });
  if (args.projectId !== null) {
    await emitHintInTx(tx, {
      orgId: args.orgId,
      entity: 'task',
      entityId: null,
    });
  }
}
