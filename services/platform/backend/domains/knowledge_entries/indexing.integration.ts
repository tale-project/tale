/** Real-Postgres proof for the status shown by the knowledge-entry table.
 * Every fixture rolls back, including when an assertion fails. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { listKnowledgeEntries } from './service.ts';

export async function checkKnowledgeEntryIndexing(sql: Sql): Promise<void> {
  const rollback = new Error('roll back indexing fixtures');
  try {
    await sql.begin(async (tx) => {
      const orgId = `indexing-${randomUUID()}`;
      const otherOrgId = `indexing-${randomUUID()}`;
      const now = Date.now();
      const states = [
        'queued',
        'running',
        'completed',
        'failed',
        'unsupported',
      ] as const;
      for (const [index, state] of states.entries()) {
        const docId = randomUUID();
        const ref = `s3:${orgId}/${index}`;
        await tx`
          INSERT INTO app.documents (id, org_id, file_ref, created_at_ms, updated_at_ms)
          VALUES (${docId}, ${orgId}, ${ref}, ${now}, ${now})
        `;
        await tx`
          INSERT INTO app.file_metadata (
            org_id, storage_ref, document_id, file_name, content_type, size,
            rag_status, rag_indexed_at_ms, rag_error, rag_error_code, created_at_ms
          ) VALUES (
            ${orgId}, ${ref}, ${docId}, 'entry.md', 'text/markdown', 1,
            ${state}, ${state === 'completed' ? now : null},
            ${state === 'failed' ? 'Embedding service unavailable' : null},
            ${state === 'failed' ? 'EMBEDDING_MODEL_NOT_CONFIGURED' : null}, ${now}
          )
        `;
        // A newer foreign row sharing a reference must not leak status or errors.
        await tx`
          INSERT INTO app.file_metadata (
            org_id, storage_ref, file_name, content_type, size, rag_status, rag_error, created_at_ms
          ) VALUES (
            ${otherOrgId}, ${ref}, 'foreign.md', 'text/markdown', 1,
            'failed', 'Another organization secret', ${now + 1}
          )
        `;
        await tx`
          INSERT INTO app.knowledge_entries (
            org_id, topic, topic_key, content, status, document_id, source, created_by, created_at_ms
          ) VALUES (
            ${orgId}, ${state}, ${state}, 'A verified fact.', 'active',
            ${docId}, 'manual', 'indexing-test', ${now}
          )
        `;
      }
      await tx`
        INSERT INTO app.knowledge_entries (
          org_id, topic, topic_key, content, status, source, created_by, created_at_ms
        ) VALUES (
          ${orgId}, 'Legacy entry', 'legacy', 'No backing file.', 'active',
          'manual', 'indexing-test', ${now}
        )
      `;
      // Sql and TransactionSql share the tagged-query surface used here.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- this fixture uses only the shared tagged-query surface
      const scopedSql = tx as unknown as Sql;
      const first = await listKnowledgeEntries(scopedSql, orgId, { limit: 2 });
      assert.equal(first.rows.length, 2);
      assert.ok(first.nextCursor);
      const second = await listKnowledgeEntries(scopedSql, orgId, {
        limit: 10,
        cursor: first.nextCursor,
      });
      assert.equal(second.nextCursor, null);
      const rows = [...first.rows, ...second.rows];
      assert.equal(
        rows.length,
        6,
        'metadata must not duplicate paginated entries',
      );
      assert.equal(new Set(rows.map((row) => row.id)).size, 6);
      for (const state of states) {
        const row = rows.find((entry) => entry.topic === state);
        assert.ok(row);
        assert.equal(row.ragStatus, state, `preserve ${state} indexing status`);
        assert.equal(row.ragIndexedAt, state === 'completed' ? now : undefined);
        assert.equal(
          row.ragError,
          state === 'failed' ? 'Embedding service unavailable' : undefined,
        );
        assert.equal(
          row.ragErrorCode,
          state === 'failed' ? 'EMBEDDING_MODEL_NOT_CONFIGURED' : undefined,
        );
        assert.ok(!('seq' in row));
      }
      assert.equal(
        rows.find((row) => row.topic === 'Legacy entry')?.ragStatus,
        undefined,
      );
      const filtered = await listKnowledgeEntries(scopedSql, orgId, {
        topic: 'COMPLETED',
      });
      assert.equal(filtered.rows.length, 1);
      assert.equal(filtered.rows[0]?.ragStatus, 'completed');
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
