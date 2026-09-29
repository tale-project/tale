/**
 * Real-Postgres proof that the scope passes write a ref several documents
 * share from its HOLDER alone: the active document with the lowest id, the
 * one the indexer indexes the ref as (`activeDocumentHoldingRef`). A WebDAV
 * COPY leaves such twins. Written from every one of them, the corpus row took
 * either twin within a page and a later page's twin over an earlier one's,
 * and read as drift again every night.
 *
 * On an organization of its own, so the passes walk only these rows: three
 * documents on one ref — the lowest id trashed, then the holder, then its
 * twin under another scope — and a corpus row stamped with none of theirs.
 * The reconcile reads one document to a page, so each twin is on a page of
 * its own. The per-edit syncs follow the same holder: the batch sync, the
 * sync of one document, and the folder re-stamp of a renamed folder.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  getKnowledgePoolForOrg,
  PRIVATE_KNOWLEDGE_SCHEMA,
} from '../../core/knowledge/pool.ts';
import {
  reconcileDocumentScopeStamps,
  syncRagDocumentScope,
  syncRagDocumentScopes,
  syncRagFolderSubtree,
} from './service.ts';

const corpusStamp = z.object({
  teamIds: z.array(z.string()).nullable(),
  folderPath: z.string().nullable(),
});

export async function checkScopeRefHolder(
  sql: Sql,
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const orgId = randomUUID();
  const tag = orgId.slice(0, 8);
  const orgSlug = `itest-scope-holder-${tag}`;
  await sql`
    INSERT INTO "organization" ("id", "name", "slug", "createdAt")
    VALUES (${orgId}, 'Scope ref holder', ${orgSlug}, now())
  `;
  const ref = `s3:${orgId}/itest/shared-${tag}.txt`;
  // One prefix, so the digit orders them: the trashed one first, then the
  // holder, then its twin.
  const trashedId = `itest-holder-${tag}-0`;
  const holderId = `itest-holder-${tag}-1`;
  const twinId = `itest-holder-${tag}-2`;
  const now = Date.now();
  const plant = async (
    id: string,
    team: string,
    lifecycle: 'trashed' | 'active' | null,
  ) => {
    await sql`
      INSERT INTO app.documents (
        id, org_id, title, file_ref, team_id, team_tags, lifecycle_status,
        created_at_ms, updated_at_ms
      ) VALUES (
        ${id}, ${orgId}, 'shared.txt', ${ref}, ${team}, ${[team]},
        ${lifecycle}, ${now}, ${now}
      )
    `;
  };
  const pool = await getKnowledgePoolForOrg(orgSlug);
  const corpusRow = async () => {
    const parsed = corpusStamp.safeParse(
      (
        await pool.unsafe(
          `SELECT team_ids AS "teamIds", folder_path AS "folderPath"
             FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
            WHERE org_slug = $1 AND file_id = $2`,
          [orgSlug, ref],
        )
      )[0],
    );
    return parsed.success ? parsed.data : null;
  };
  const stampOf = async (): Promise<string> => {
    const row = await corpusRow();
    return row === null ? 'no row' : JSON.stringify(row.teamIds);
  };
  /** The state a failed sync leaves: a stamp no document of the ref has. */
  const drift = async () => {
    await pool.unsafe(
      `UPDATE ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
          SET team_ids = ARRAY['itest-drifted'], team_id = 'itest-drifted'
        WHERE org_slug = $1 AND file_id = $2`,
      [orgSlug, ref],
    );
  };
  const holderStamp = JSON.stringify(['team-holder']);
  const driftedStamp = JSON.stringify(['itest-drifted']);

  try {
    await plant(trashedId, 'team-trashed', 'trashed');
    await plant(holderId, 'team-holder', 'active');
    await plant(twinId, 'team-twin', null);
    await pool.unsafe(
      `INSERT INTO ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
         (org_slug, file_id, filename, status, team_ids, team_id)
       VALUES ($1, $2, 'shared.txt', 'completed',
               ARRAY['itest-drifted'], 'itest-drifted')`,
      [orgSlug, ref],
    );
    const order = (
      await sql<{ id: string }[]>`
        SELECT id FROM app.documents WHERE org_id = ${orgId} ORDER BY id
      `
    ).map((row) => row.id);
    const ordered =
      JSON.stringify(order) === JSON.stringify([trashedId, holderId, twinId]);

    const first = await reconcileDocumentScopeStamps(sql, {
      organizationId: orgId,
      orgSlug,
      limit: 1,
    });
    const afterFirst = await stampOf();
    const second = await reconcileDocumentScopeStamps(sql, {
      organizationId: orgId,
      orgSlug,
      limit: 1,
    });
    const afterSecond = await stampOf();
    record(
      'knowledge: the scope reconcile writes a ref two active documents share from the lower id, and the next night finds no drift',
      ordered &&
        first.scanned === 1 &&
        first.corrected === 1 &&
        afterFirst === holderStamp &&
        second.corrected === 0 &&
        afterSecond === holderStamp,
      `order=${order.join(',')} (want trashed, holder, twin), first=corrected ${first.corrected}/scanned ${first.scanned} (want 1/1) → ${afterFirst}, second=corrected ${second.corrected} (want 0) → ${afterSecond} (want ${holderStamp})`,
    );

    await drift();
    await syncRagDocumentScopes(sql, orgId, [twinId]);
    const twinOnly = await stampOf();
    await syncRagDocumentScopes(sql, orgId, [twinId, holderId]);
    const both = await stampOf();
    record(
      "knowledge: a batch scope sync leaves a shared ref to its holder: the twin's edit alone writes nothing",
      twinOnly === driftedStamp && both === holderStamp,
      `twin alone → ${twinOnly} (want ${driftedStamp}), twin and holder → ${both} (want ${holderStamp})`,
    );

    await drift();
    await syncRagDocumentScope(sql, orgId, twinId);
    const twinEdited = await stampOf();
    await drift();
    await syncRagDocumentScope(sql, orgId, holderId);
    const holderEdited = await stampOf();
    record(
      'knowledge: a document scope sync writes a shared ref from its holder, whichever twin was edited',
      twinEdited === holderStamp && holderEdited === holderStamp,
      `twin edited → ${twinEdited}, holder edited → ${holderEdited} (want ${holderStamp} both)`,
    );

    // Each twin in a folder of its own, neither re-stamped yet: a rename of
    // the twin's folder leaves the row's path alone, one of the holder's
    // writes it.
    const twinFolder = `itest-twin-folder-${tag}`;
    const holderFolder = `itest-holder-folder-${tag}`;
    for (const [folderId, docId] of [
      [twinFolder, twinId],
      [holderFolder, holderId],
    ] as const) {
      await sql`
        INSERT INTO app.folders (id, org_id, name, created_at_ms)
        VALUES (${folderId}, ${orgId}, ${folderId}, ${now})
      `;
      await sql`
        UPDATE app.documents SET folder_id = ${folderId} WHERE id = ${docId}
      `;
    }
    await syncRagFolderSubtree(sql, orgId, twinFolder);
    const afterTwinFolder = (await corpusRow())?.folderPath;
    await syncRagFolderSubtree(sql, orgId, holderFolder);
    const afterHolderFolder = (await corpusRow())?.folderPath;
    record(
      "knowledge: a folder re-stamp writes a shared ref's path from its holder alone",
      afterTwinFolder === null && afterHolderFolder === holderFolder,
      `twin's folder → ${String(afterTwinFolder)} (want null), holder's folder → ${String(afterHolderFolder)} (want ${holderFolder})`,
    );
  } finally {
    await sql`DELETE FROM app.documents WHERE org_id = ${orgId}`;
    await sql`DELETE FROM app.folders WHERE org_id = ${orgId}`;
    await pool
      .unsafe(
        `DELETE FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents WHERE org_slug = $1`,
        [orgSlug],
      )
      .catch((error: unknown) => {
        console.warn('[itest] scope-holder corpus cleanup failed:', error);
      });
    await sql`DELETE FROM "organization" WHERE "id" = ${orgId}`;
  }
}
