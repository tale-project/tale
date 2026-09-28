/** The watchdog must decide who hears a status after settling it, even when
 * a document bind commits while the sweep is reading the corpus or while
 * its UPDATE is waiting for the bind's file-metadata lock. The latter also
 * catches an ownership probe in UPDATE RETURNING: that statement's snapshot
 * predates the bind's commit. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { getKnowledgePoolForOrg } from '../../core/knowledge/pool.ts';
import { createDocumentFromUpload } from '../documents/service.ts';
import { recoverStuckRagIndexing } from '../file_metadata/watchdogs.ts';

function gate() {
  let release = () => {};
  const reached = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { reached, release };
}

async function waitsForBind(sql: Sql, pid: number): Promise<boolean> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await sql<{ waiting: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database()
          AND ${pid}::int = ANY(pg_blocking_pids(pid))
      ) AS waiting
    `;
    if (rows[0]?.waiting) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

export async function checkRagStatusHintBindingRace(
  sql: Sql,
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const [user] = await sql<{ id: string }[]>`SELECT id FROM "user" LIMIT 1`;
  if (user === undefined) throw new Error('the integration user is missing');

  for (const order of [
    'before settlement',
    'while settlement waits',
  ] as const) {
    const orgId = randomUUID();
    const orgSlug = `itest-hint-bind-${orgId.slice(0, 8)}`;
    const ref = `s3:itest/${orgSlug}/report.pdf`;
    await sql`
      INSERT INTO "organization" (id, name, slug, "createdAt")
      VALUES (${orgId}, 'RAG hint binding race', ${orgSlug}, now())
    `;
    const [file] = await sql<{ id: string }[]>`
      INSERT INTO app.file_metadata (
        org_id, storage_ref, file_name, content_type, size, rag_status,
        rag_queued_at_ms, created_at_ms
      ) VALUES (
        ${orgId}, ${ref}, 'report.pdf', 'application/pdf', 1, 'running', -10, -10
      )
      RETURNING id
    `;
    if (file === undefined) throw new Error('the integration file is missing');
    const pool = await getKnowledgePoolForOrg(orgSlug);
    await pool`
      INSERT INTO private_knowledge.documents
        (org_slug, file_id, filename, status, updated_at)
      VALUES (${orgSlug}, ${ref}, 'report.pdf', 'completed', now())
    `;
    const prepared = gate();
    const commit = gate();
    let binding: Promise<unknown> | undefined;
    let bindPid = 0;
    let beforeStatus: string | null = null;
    let documentId = '';
    // Pause after candidate capture, before the organization/corpus lookup.
    const interleaved = new Proxy(sql, {
      apply(target, thisArg, args: unknown[]) {
        const strings = args[0];
        if (
          binding === undefined &&
          Array.isArray(strings) &&
          strings.join('').includes('SELECT "slug" FROM "organization"') &&
          args.includes(orgId)
        ) {
          binding = sql.begin(async (tx) => {
            const [session] = await tx<{ pid: number }[]>`
              SELECT pg_backend_pid() AS pid
            `;
            bindPid = session?.pid ?? 0;
            // Use the real bind and its metadata lock, audit and document
            // hint. Do not queue a second job for the existing index run.
            documentId = await createDocumentFromUpload(
              tx,
              {
                organizationId: orgId,
                userId: user.id,
                role: 'owner',
                teamIds: [],
              },
              {
                fileId: file.id,
                fileName: 'report.pdf',
                skipRagIndexing: true,
              },
            );
            const [visible] = await tx<{ status: string | null }[]>`
              SELECT rag_status AS status FROM app.file_metadata
              WHERE id = ${file.id}
            `;
            beforeStatus = visible?.status ?? null;
            prepared.release();
            if (order === 'while settlement waits') await commit.reached;
          });
          return (async () => {
            await Promise.race([prepared.reached, binding]);
            if (order === 'before settlement') await binding;
            return Reflect.apply(target, thisArg, args);
          })();
        }
        return Reflect.apply(target, thisArg, args);
      },
    });
    const sweep = recoverStuckRagIndexing(interleaved, { limit: 1 });
    try {
      await Promise.race([prepared.reached, sweep]);
      const waited =
        order === 'before settlement' || (await waitsForBind(sql, bindPid));
      commit.release();
      const [result] = await Promise.all([sweep, binding]);
      const [after] = await sql<{ status: string | null }[]>`
        SELECT rag_status AS status FROM app.file_metadata WHERE id = ${file.id}
      `;
      // The bind names its document; the watchdog's settlement owes one
      // org-wide hint. This organization has no other writer or queued job.
      const [hints] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM app_realtime.outbox
        WHERE org_id = ${orgId} AND entity = 'document' AND entity_id IS NULL
      `;
      record(
        `rag watchdog: a document bound ${order} hears the settled status`,
        waited &&
          documentId !== '' &&
          beforeStatus === 'running' &&
          after?.status === 'completed' &&
          result.adopted === 1 &&
          hints?.count === '1',
        `bind=${documentId !== ''}, lock ordering=${waited}, status=${beforeStatus}→${after?.status}, adopted=${result.adopted}, settlement hints=${hints?.count} (want 1)`,
      );
    } finally {
      commit.release();
      await Promise.allSettled([sweep, binding]);
      await sql`DELETE FROM app.documents WHERE org_id = ${orgId}`;
      await sql`DELETE FROM app.file_metadata WHERE id = ${file.id}`;
      await pool`DELETE FROM private_knowledge.documents WHERE org_slug = ${orgSlug}`;
      await sql`DELETE FROM "organization" WHERE id = ${orgId}`;
    }
  }
}
