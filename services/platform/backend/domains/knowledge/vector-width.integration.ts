/**
 * Real-Postgres proof that a knowledge database keeps vectors per width
 * (`chunk_vectors_<width>`, knowledge-db migrations 14 and 15), with the
 * indexer and the dense leg run over the migrated tables.
 *
 * Two organizations of their own, on the deployment's one knowledge
 * database, with embedding models of different widths: each is indexed and
 * searched among the vectors of its own width, where one column of one
 * width used to refuse the second of them. One then moves to the other's
 * width and is embedded again at it, and the embedding save's follow-up
 * puts what it has indexed back in the queue.
 *
 * The file row the follow-up moves is held by no document, so the job it
 * queues ends at its liveness check and writes nothing more.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

import { KNOWLEDGE_VECTOR_WIDTHS } from '@tale/shared/schemas/knowledge';
import type { Sql } from 'postgres';

import { DocumentCorpusReader } from '../../core/knowledge/corpus.ts';
import { Embedder } from '../../core/knowledge/embedding.ts';
import { indexWholeDocument } from '../../core/knowledge/indexing.ts';
import {
  getKnowledgePoolForOrg,
  PRIVATE_KNOWLEDGE_SCHEMA,
  resolveOrgUrl,
} from '../../core/knowledge/pool.ts';
import { requeueDocumentsWithoutVectors } from './service.ts';

const NARROW = 256;
const WIDE = 384;
const OTHER = 1024;

export async function checkVectorWidths(
  sql: Sql,
  harness: {
    record: (name: string, ok: boolean, detail: string) => void;
    /** The harness's deterministic fake `/v1/embeddings` body, as wide as
     * the request asks. */
    embeddingsPayload: (rawBody: string) => string;
  },
): Promise<void> {
  const { record } = harness;
  const tag = randomUUID().slice(0, 8);
  const acme = { id: randomUUID(), slug: `itest-width-acme-${tag}` };
  const globex = { id: randomUUID(), slug: `itest-width-globex-${tag}` };
  for (const org of [acme, globex]) {
    await sql`
      INSERT INTO "organization" ("id", "name", "slug", "createdAt")
      VALUES (${org.id}, 'Vector widths', ${org.slug}, now())
    `;
  }

  const embedServer = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: unknown) => {
      body += String(chunk);
    });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(harness.embeddingsPayload(body));
    });
  });
  await new Promise<void>((resolve) => {
    embedServer.listen(0, '127.0.0.1', resolve);
  });
  const address = embedServer.address();
  const embedPort =
    address !== null && typeof address === 'object' ? address.port : 0;
  const embedderOf = (org: { id: string }, dimensions: number) =>
    new Embedder(
      {
        providerSlug: 'openai',
        model: 'itest-embed',
        dimensions,
        baseUrl: `http://127.0.0.1:${embedPort}/v1`,
      },
      'sk-itest-vector-widths',
      { organizationId: org.id },
    );

  const configRoot = process.env.TALE_CONFIG_DIR ?? '';
  const stateWidth = async (org: { slug: string }, dimensions: number) => {
    const dir = path.join(configRoot, org.slug, 'knowledge');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'embedding.json'),
      JSON.stringify({
        providerSlug: 'openai',
        model: 'itest-embed',
        dimensions,
        baseUrl: `http://127.0.0.1:${embedPort}/v1`,
      }),
    );
  };

  // One database for both: neither organization brings its own.
  const pool = await getKnowledgePoolForOrg(acme.slug);
  const dbUrl = await resolveOrgUrl(acme.slug);
  const sameDatabase = (await resolveOrgUrl(globex.slug)) === dbUrl;

  const index = (
    org: { id: string; slug: string },
    ref: string,
    text: string,
    dimensions: number,
  ) =>
    indexWholeDocument({
      sql: pool,
      dbUrl,
      orgSlug: org.slug,
      fileId: ref,
      filename: `${ref.split('/').at(-1) ?? 'note'}.txt`,
      text,
      embedder: embedderOf(org, dimensions),
    });

  /** How many vectors a document holds at each width that holds any. */
  const vectorsOf = async (org: { slug: string }, ref: string) => {
    const held: Record<number, number> = {};
    for (const width of KNOWLEDGE_VECTOR_WIDTHS) {
      const [row] = await pool.unsafe<{ n: string }[]>(
        `SELECT count(*)::text AS n
           FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.chunk_vectors_${width} v
           JOIN ${PRIVATE_KNOWLEDGE_SCHEMA}.chunks c ON c.id = v.chunk_id
           JOIN ${PRIVATE_KNOWLEDGE_SCHEMA}.documents d
             ON d.id = c.document_id AND d.org_slug = c.org_slug
          WHERE d.org_slug = $1 AND d.file_id = $2`,
        [org.slug, ref],
      );
      const count = Number(row?.n ?? '0');
      if (count > 0) held[width] = count;
    }
    return held;
  };

  /** The documents the dense leg finds for an organization at a width. */
  const foundByMeaning = async (
    org: { id: string; slug: string },
    dimensions: number,
    query: string,
  ) => {
    const embedding = await embedderOf(org, dimensions).embed(query);
    const hits = await new DocumentCorpusReader(pool, org.slug).dense({
      query,
      limit: 5,
      embedding,
    });
    return (hits ?? []).map((hit) => hit.source.ref);
  };

  const acmeRef = `s3:itest/${acme.slug}/handbook`;
  const globexRef = `s3:itest/${globex.slug}/handbook`;
  const acmeText =
    'The Spiez office keeps the parental leave policy in the staff handbook.';
  const globexText =
    'The Thun warehouse records every forklift inspection in the safety log.';
  const fileIds: string[] = [];

  try {
    // 1. Two widths in one database: each organization's vectors go to the
    //    table of its own width, and each search reads that table alone.
    await index(acme, acmeRef, acmeText, NARROW);
    await index(globex, globexRef, globexText, WIDE);
    const acmeHeld = await vectorsOf(acme, acmeRef);
    const globexHeld = await vectorsOf(globex, globexRef);
    const acmeFinds = await foundByMeaning(acme, NARROW, acmeText);
    const globexFinds = await foundByMeaning(globex, WIDE, globexText);
    // The other organization's width holds nothing of this one's.
    const acmeAtWide = await foundByMeaning(acme, WIDE, acmeText);
    record(
      'vector widths: two organizations with models of different widths index and search in one knowledge database',
      sameDatabase &&
        Object.keys(acmeHeld).join() === String(NARROW) &&
        Object.keys(globexHeld).join() === String(WIDE) &&
        acmeFinds.join() === acmeRef &&
        globexFinds.join() === globexRef &&
        acmeAtWide.length === 0,
      `sameDatabase=${sameDatabase}, acme=${JSON.stringify(acmeHeld)} (want only ${NARROW}), globex=${JSON.stringify(globexHeld)} (want only ${WIDE}), acme finds=${JSON.stringify(acmeFinds)}, globex finds=${JSON.stringify(globexFinds)}, acme at ${WIDE}=${JSON.stringify(acmeAtWide)} (want none)`,
    );

    // 2. A move to another width: the same content is embedded again, from
    //    its first chunk, and is found at the new width; a second pass has
    //    nothing left to do.
    const moved = await index(acme, acmeRef, acmeText, WIDE);
    const movedHeld = await vectorsOf(acme, acmeRef);
    const movedFinds = await foundByMeaning(acme, WIDE, acmeText);
    const globexStill = await foundByMeaning(globex, WIDE, globexText);
    const again = await index(acme, acmeRef, acmeText, WIDE);
    record(
      'vector widths: an organization that moves to a model of another width is embedded again at it, beside the organization already there',
      moved.skipped === undefined &&
        moved.chunksStored === moved.chunksTotal &&
        Object.keys(movedHeld).join() === String(WIDE) &&
        movedFinds.join() === acmeRef &&
        globexStill.join() === globexRef &&
        again.skipped === 'unchanged',
      `moved: skipped=${moved.skipped ?? 'no'} stored=${moved.chunksStored}/${moved.chunksTotal}, holds=${JSON.stringify(movedHeld)} (want only ${WIDE}), finds=${JSON.stringify(movedFinds)}, globex still finds=${JSON.stringify(globexStill)}, second pass=${again.skipped ?? 'indexed'} (want unchanged)`,
    );

    // 3. The save's follow-up: what is indexed and has no vector of the
    //    width the settings now state goes back in the queue, once; with
    //    the width its vectors have, nothing does.
    const [file] = await sql<{ id: string }[]>`
      INSERT INTO app.file_metadata (
        org_id, storage_ref, file_name, content_type, size, rag_status,
        created_at_ms
      ) VALUES (
        ${acme.id}, ${acmeRef}, 'handbook.txt', 'text/plain', 1, 'completed',
        ${Date.now()}
      )
      RETURNING id
    `;
    const fileId = file?.id ?? '';
    fileIds.push(fileId);
    const statusOf = async () =>
      (
        await sql<{ status: string | null }[]>`
          SELECT rag_status AS status FROM app.file_metadata
          WHERE id = ${fileId}
        `
      )[0]?.status ?? null;

    await stateWidth(acme, WIDE);
    const atHeldWidth = await requeueDocumentsWithoutVectors(sql, {
      organizationId: acme.id,
      orgSlug: acme.slug,
    });
    const statusAtHeldWidth = await statusOf();

    await stateWidth(acme, OTHER);
    const atOtherWidth = await requeueDocumentsWithoutVectors(sql, {
      organizationId: acme.id,
      orgSlug: acme.slug,
    });
    const statusAtOtherWidth = await statusOf();
    const jobs = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM pgboss.job
      WHERE name = 'rag.index_file' AND data->>'fileId' = ${fileId}
    `;
    // Queued already: a second save moves it no further.
    const repeated = await requeueDocumentsWithoutVectors(sql, {
      organizationId: acme.id,
      orgSlug: acme.slug,
    });
    record(
      'vector widths: saving a model of another width puts the indexed documents back in the queue, and a save that keeps the width puts none',
      atHeldWidth.requeued === 0 &&
        statusAtHeldWidth === 'completed' &&
        atOtherWidth.requeued === 1 &&
        statusAtOtherWidth === 'queued' &&
        jobs[0]?.count === '1' &&
        repeated.requeued === 0,
      `same width: requeued=${atHeldWidth.requeued} (want 0) status=${statusAtHeldWidth}, other width: requeued=${atOtherWidth.requeued} (want 1) status=${statusAtOtherWidth} (want queued) jobs=${jobs[0]?.count ?? '?'} (want 1), repeated=${repeated.requeued} (want 0)`,
    );
  } finally {
    await new Promise<void>((resolve) => {
      embedServer.close(() => resolve());
    });
    await sql`DELETE FROM app.file_metadata WHERE id = ANY(${fileIds})`;
    for (const org of [acme, globex]) {
      await pool
        .unsafe(
          `DELETE FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents WHERE org_slug = $1`,
          [org.slug],
        )
        .catch((error: unknown) => {
          console.warn('[itest] vector-width corpus cleanup failed:', error);
        });
      await rm(path.join(configRoot, org.slug), {
        recursive: true,
        force: true,
      });
      await sql`DELETE FROM "organization" WHERE "id" = ${org.id}`;
    }
  }
}
