import type { Sql, TransactionSql } from 'postgres';

/** Harvest first records temporary agent blobs; completion claims them in the
 * same transaction as their task references so a cancelled harvest stays GC-able. */
export async function saveAgentFileMetadata(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    storageId: string;
    fileName: string;
    contentType: string;
    size: number;
    source?: string;
  },
): Promise<void> {
  // storage_ref is not unique: several logical rows can reference one blob.
  const updated = await sql<{ id: string }[]>`
    UPDATE app.file_metadata SET
      file_name = ${args.fileName}, content_type = ${args.contentType},
      size = ${args.size}, source = ${args.source ?? 'agent'}
    WHERE storage_ref = ${args.storageId} AND org_id = ${args.organizationId}
    RETURNING id
  `;
  if (updated.length === 0) {
    await sql`
      INSERT INTO app.file_metadata (
        org_id, storage_ref, file_name, content_type, size, source, created_at_ms
      ) VALUES (
        ${args.organizationId}, ${args.storageId}, ${args.fileName},
        ${args.contentType}, ${args.size}, ${args.source ?? 'agent'}, ${Date.now()}
      )
    `;
  }
}
