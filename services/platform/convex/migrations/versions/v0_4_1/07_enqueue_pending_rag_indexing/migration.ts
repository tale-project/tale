/**
 * Pick up indexing rows that predate the workpools.
 *
 * Indexing used to be scheduled directly and gated by a hand-rolled cap, with
 * over-cap rows marked `ragParked` and promoted later. It now goes through a
 * workpool. A row already marked `'queued'` when that cutover deploys has no
 * pool job behind it, and nothing else would ever create one — the writers
 * enqueue at the moment they queue a row, and the promotion pass that used to
 * sweep the backlog is gone. Such a row would wait forever.
 *
 * `up` enqueues each one through `enqueueRagIndexing`, which selects the pool
 * from the row's provenance and writes NOTHING to the row.
 *
 * `down` is therefore a no-op by construction, not by omission: `up` changes no
 * data, so there is nothing to restore, and the world comes back byte-for-byte.
 * Rolling back the code is what reverses this; the pool discards its own
 * completed work. A row's stale `ragParked` flag is left alone — nothing reads
 * it any more, and clearing it here would be a write this migration would then
 * owe a reversal for.
 *
 * `snapshot: 'none'` is sufficient because nothing is overwritten: a row that
 * indexes twice is the pool's own cheap no-op, since the corpus writer skips
 * content whose hash and status are unchanged.
 */

import type { Id } from '../../../../_generated/dataModel';
import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Enqueue indexing rows that predate the workpools',
  description:
    'up enqueues every fileMetadata row still marked queued onto the indexing workpool its provenance selects, so rows written before the pools existed are picked up instead of waiting forever; down is a no-op because enqueueing is not a data change and the pool discards its own completed work.',
  destructive: false,
  snapshot: 'none',
  subjects: { tables: ['fileMetadata'] },
  table: 'fileMetadata',

  async up(ctx, doc) {
    if (doc.ragStatus !== 'queued') return;
    // Replayed after a crash mid-batch, this enqueues the row a second time.
    // That is safe and cheap: the corpus writer skips content whose hash and
    // status are unchanged, so the duplicate job finds nothing to do.
    //
    // `enqueueRagIndexing`, not `maybeDispatchRagIndexing`: the latter also
    // clears `ragParked`, and a migration that writes a field is a migration
    // that has to restore it. This one writes nothing.
    // The runner hands rows as `Record<string, unknown>`, so the fields the
    // enqueue needs are read and checked rather than asserted. A row missing
    // any of them could not have been indexed before this migration either.
    const { organizationId, storageId, fileName, contentType } = doc;
    if (
      typeof organizationId !== 'string' ||
      typeof storageId !== 'string' ||
      typeof fileName !== 'string' ||
      typeof contentType !== 'string'
    ) {
      return;
    }
    const { enqueueRagIndexing } =
      await import('../../../../file_metadata/rag_dispatch');
    await enqueueRagIndexing(ctx, {
      organizationId,
      storageId,
      fileName,
      contentType,
      ...(typeof doc.source === 'string' ? { source: doc.source } : {}),
      ...(typeof doc.documentId === 'string'
        ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a documentId on a fileMetadata row is a documents id by schema; a wrong id reads as a superseded row and is refused
          { documentId: doc.documentId as Id<'documents'> }
        : {}),
      ...(typeof doc.threadId === 'string' ? { threadId: doc.threadId } : {}),
    });
  },

  async down(_ctx, _doc) {
    // Nothing to reverse — see the header. Enqueueing is not a data change.
  },
});
