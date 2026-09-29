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
 *
 * A write that MOVES the holder without editing any scope — a copy whose id
 * sorts first, the holder trashed, restored or hard-deleted — is followed by
 * `syncRagRefHolderScopes`, which writes the new holder's scope, and leaves
 * a ref no active document holds alone: on a second organization, through
 * the helper after each row change, the real `purgeDocument`, and the real
 * WebDAV COPY and DELETE handlers.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  getKnowledgePoolForOrg,
  PRIVATE_KNOWLEDGE_SCHEMA,
} from '../../core/knowledge/pool.ts';
import { purgeDocument } from '../retention/service.ts';
import { webdavHandlers } from '../webdav/handlers.ts';
import {
  reconcileDocumentScopeStamps,
  syncRagDocumentScope,
  syncRagDocumentScopes,
  syncRagFolderSubtree,
  syncRagRefHolderScopes,
} from './service.ts';

const corpusStamp = z.object({
  teamIds: z.array(z.string()).nullable(),
  folderPath: z.string().nullable(),
});

type Record = (name: string, ok: boolean, detail: string) => void;

export async function checkScopeRefHolder(
  sql: Sql,
  record: Record,
): Promise<void> {
  await checkHolderRule(sql, record);
  await checkHolderChanges(sql, record);
}

async function checkHolderRule(sql: Sql, record: Record): Promise<void> {
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

async function checkHolderChanges(sql: Sql, record: Record): Promise<void> {
  const orgId = randomUUID();
  const tag = orgId.slice(0, 8);
  const orgSlug = `itest-holder-moves-${tag}`;
  await sql`
    INSERT INTO "organization" ("id", "name", "slug", "createdAt")
    VALUES (${orgId}, 'Scope ref holder moves', ${orgSlug}, now())
  `;
  const pool = await getKnowledgePoolForOrg(orgSlug);
  const now = Date.now();
  const ref = `s3:${orgId}/itest/moved-${tag}.txt`;
  // One prefix: the copy (`-0`) sorts before the first holder (`-1`), which
  // sorts before the twin (`-2`).
  const copyId = `itest-moves-${tag}-0`;
  const firstId = `itest-moves-${tag}-1`;
  const twinId = `itest-moves-${tag}-2`;
  const plant = async (id: string, fileRef: string, team: string) => {
    await sql`
      INSERT INTO app.documents (
        id, org_id, title, file_ref, team_id, team_tags, created_at_ms,
        updated_at_ms
      ) VALUES (
        ${id}, ${orgId}, ${`${id}.txt`}, ${fileRef}, ${team}, ${[team]},
        ${now}, ${now}
      )
    `;
  };
  const plantCorpusRow = async (fileRef: string, team: string | null) => {
    await pool.unsafe(
      `INSERT INTO ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
         (org_slug, file_id, filename, status, team_ids, team_id)
       VALUES ($1, $2, 'moved.txt', 'completed', $3::text[], $4)`,
      [orgSlug, fileRef, team === null ? null : [team], team],
    );
  };
  const rowOf = async (fileRef: string) => {
    const parsed = corpusStamp.safeParse(
      (
        await pool.unsafe(
          `SELECT team_ids AS "teamIds", folder_path AS "folderPath"
             FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
            WHERE org_slug = $1 AND file_id = $2`,
          [orgSlug, fileRef],
        )
      )[0],
    );
    return parsed.success ? parsed.data : null;
  };
  const teamsOf = async (fileRef: string) =>
    JSON.stringify((await rowOf(fileRef))?.teamIds ?? 'no row');
  const setLifecycle = async (id: string, lifecycle: string | null) => {
    await sql`
      UPDATE app.documents SET lifecycle_status = ${lifecycle}
      WHERE id = ${id}
    `;
  };
  const moved = async () => {
    await syncRagRefHolderScopes(sql, orgId, [ref]);
    return teamsOf(ref);
  };

  try {
    await plant(firstId, ref, 'team-first');
    await plant(twinId, ref, 'team-twin');
    await plantCorpusRow(ref, 'team-first');

    await setLifecycle(firstId, 'trashed');
    const trashed = await moved();
    await setLifecycle(firstId, null);
    const restored = await moved();
    await plant(copyId, ref, 'team-copy');
    const copied = await moved();
    // The real hard-delete funnel: the twins keep the ref, and the purge
    // re-stamps it from the holder left once the copy's row is gone.
    await purgeDocument(sql, orgSlug, {
      id: copyId,
      fileRef: ref,
      organizationId: orgId,
    });
    const purged = await teamsOf(ref);
    await setLifecycle(firstId, 'trashed');
    await setLifecycle(twinId, 'trashed');
    const unheld = await moved();
    record(
      "knowledge: a write that moves a shared ref's holder re-stamps it from the new holder, and a ref no active document holds keeps its row",
      trashed === '["team-twin"]' &&
        restored === '["team-first"]' &&
        copied === '["team-copy"]' &&
        purged === '["team-first"]' &&
        unheld === '["team-first"]',
      `holder trashed → ${trashed} (want team-twin), restored → ${restored} (want team-first), a copy sorting first → ${copied} (want team-copy), the copy purged → ${purged} (want team-first), no active holder left → ${unheld} (want team-first, untouched)`,
    );

    // The real WebDAV handlers. The source sits in an organization-wide
    // folder under an id that sorts after every uuid, so the COPY's fresh
    // id makes the copy, at the root, the holder: its path (none) goes onto
    // the row. Deleting the copy hands the ref back to the source.
    const webdavRef = `s3:${orgId}/itest/webdav-${tag}.txt`;
    const folderId = `itest-moves-folder-${tag}`;
    const sourceId = `zz-itest-moves-${tag}`;
    await sql`
      INSERT INTO app.folders (id, org_id, name, created_at_ms)
      VALUES (${folderId}, ${orgId}, 'Reports', ${now})
    `;
    await sql`
      INSERT INTO app.documents (
        id, org_id, title, file_ref, folder_id, created_at_ms, updated_at_ms
      ) VALUES (
        ${sourceId}, ${orgId}, 'report.txt', ${webdavRef}, ${folderId},
        ${now}, ${now}
      )
    `;
    await plantCorpusRow(webdavRef, null);
    await pool.unsafe(
      `UPDATE ${PRIVATE_KNOWLEDGE_SCHEMA}.documents SET folder_path = 'Reports'
        WHERE org_slug = $1 AND file_id = $2`,
      [orgSlug, webdavRef],
    );
    const handlers = webdavHandlers(sql);
    await handlers['webdav/tree_mutations:copyResource']({
      organizationId: orgId,
      src: { kind: 'document', id: sourceId },
      destParentSegments: [],
      destName: 'report copy.txt',
      overwrite: false,
      userId: `itest-moves-user-${tag}`,
    });
    const [copy] = await sql<{ id: string }[]>`
      SELECT id FROM app.documents
      WHERE org_id = ${orgId} AND file_ref = ${webdavRef} AND id <> ${sourceId}
    `;
    const afterCopy = (await rowOf(webdavRef))?.folderPath;
    await handlers['webdav/tree_mutations:softDeleteDocument']({
      organizationId: orgId,
      userId: `itest-moves-user-${tag}`,
      documentId: copy?.id ?? '',
    });
    const afterDelete = (await rowOf(webdavRef))?.folderPath;
    record(
      'knowledge: a WebDAV COPY re-stamps the shared ref from the copy it made the holder, and deleting that copy hands it back',
      copy !== undefined && afterCopy === null && afterDelete === 'Reports',
      `copy=${copy?.id ?? 'none'}, after COPY → ${String(afterCopy)} (want null: the copy at the root), after DELETE of the copy → ${String(afterDelete)} (want Reports)`,
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
        console.warn('[itest] holder-moves corpus cleanup failed:', error);
      });
    await sql`DELETE FROM "organization" WHERE "id" = ${orgId}`;
  }
}
