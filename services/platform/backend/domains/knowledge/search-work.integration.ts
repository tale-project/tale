/**
 * Real-Postgres proof that a knowledge search no longer does work in
 * proportion to the organization's whole corpus on every query (#4711), with
 * the indexer and both legs run over the migrated tables.
 *
 * A document hit reports where it starts in its document's text. Each hit
 * used to sum the length of every earlier chunk of its document for that;
 * the indexer now stores it with the chunk (`core_offset`, knowledge-db
 * migration 17), from the chunk before it. The lane indexes a document of
 * many chunks, slice by slice, in text with characters outside the Basic
 * Multilingual Plane, and holds that both legs report the offsets the sum
 * gives; that a copy of the same content carries them; and that a chunk
 * stored before the column existed (its offset NULL) still gets the sum.
 *
 * The dense leg counts its scope only as far as its plan needs. The lane
 * watches what the leg sends and holds that a scope under the bound is
 * counted in full and scanned exactly, and that one past it is counted to
 * one row past the bound and left to the index.
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import type { Sql, TransactionSql } from 'postgres';

import { DocumentCorpusReader } from '../../core/knowledge/corpus.ts';
import { Embedder } from '../../core/knowledge/embedding.ts';
import { indexWholeDocument } from '../../core/knowledge/indexing.ts';
import {
  getKnowledgePoolForOrg,
  PRIVATE_KNOWLEDGE_SCHEMA,
  resolveOrgUrl,
} from '../../core/knowledge/pool.ts';

const WIDTH = 256;
/** Chunks in the large scope: past the dense leg's exact-scan bound (5,000)
 * by more than the one row its count reads past it. */
const BULK_CHUNKS = 5_010;

interface Sent {
  readonly text: string;
  readonly rows: readonly unknown[];
}

/** `handle`, writing down every statement sent through `unsafe` — in the
 * transactions it begins too — with the rows each answered. */
function watched<T extends Sql | TransactionSql>(handle: T, sent: Sent[]): T {
  return new Proxy(handle, {
    get(target, property, receiver) {
      if (property === 'unsafe') {
        return async (...args: Parameters<Sql['unsafe']>) => {
          const rows: unknown = await target.unsafe(...args);
          sent.push({
            text: args[0].trim(),
            rows: Array.isArray(rows) ? [...rows] : [],
          });
          return rows;
        };
      }
      if (property === 'begin' && 'begin' in target) {
        return (fn: (tx: TransactionSql) => Promise<unknown>) =>
          target.begin((tx) => fn(watched(tx, sent)));
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

/** What the dense leg's scope count answered, and the statements after it. */
function densePlan(sent: readonly Sent[]) {
  const at = sent.findIndex((entry) => entry.text.includes('count(*)'));
  const answered = sent[at]?.rows[0];
  const counted =
    answered !== null &&
    typeof answered === 'object' &&
    'n' in answered &&
    typeof answered.n === 'string'
      ? answered.n
      : null;
  const after = at < 0 ? [] : sent.slice(at + 1).map((entry) => entry.text);
  return {
    counted,
    bounded: sent[at]?.text.includes(') scoped') ?? false,
    exact: after.includes('SET LOCAL enable_indexscan = off'),
    iterative: after.some((text) => text.startsWith('SET LOCAL hnsw.')),
  };
}

export async function checkSearchWork(
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
  const acme = { id: randomUUID(), slug: `itest-search-acme-${tag}` };
  const bulk = { id: randomUUID(), slug: `itest-search-bulk-${tag}` };
  for (const org of [acme, bulk]) {
    await sql`
      INSERT INTO "organization" ("id", "name", "slug", "createdAt")
      VALUES (${org.id}, 'Search work', ${org.slug}, now())
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
  const embedder = new Embedder(
    {
      providerSlug: 'openai',
      model: 'itest-embed',
      dimensions: WIDTH,
      baseUrl: `http://127.0.0.1:${embedPort}/v1`,
    },
    'sk-itest-search-work',
    { organizationId: acme.id },
  );

  const pool = await getKnowledgePoolForOrg(acme.slug);
  const dbUrl = await resolveOrgUrl(acme.slug);

  const index = (ref: string, text: string) =>
    indexWholeDocument({
      sql: pool,
      dbUrl,
      orgSlug: acme.slug,
      fileId: ref,
      filename: 'grüsse.txt',
      text,
      embedder,
      // Slices of three: the chunk a slice starts on stores its offset from
      // the one an earlier transaction committed.
      maxChunks: 3,
    });

  /** Each chunk's stored offset, beside the sum the search computed for
   * every hit before it was stored. */
  const offsetsOf = (ref: string) =>
    pool.unsafe<{ index: number; stored: string | null; summed: string }[]>(
      `SELECT c.chunk_index AS index, c.core_offset::text AS stored,
              (SELECT COALESCE(SUM(length(c2.core_content)), 0)
                 FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.chunks c2
                WHERE c2.org_slug = c.org_slug
                  AND c2.document_id = c.document_id
                  AND c2.chunk_index < c.chunk_index)::text AS summed
         FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.chunks c
         JOIN ${PRIVATE_KNOWLEDGE_SCHEMA}.documents d
           ON d.id = c.document_id AND d.org_slug = c.org_slug
        WHERE d.org_slug = $1 AND d.file_id = $2
        ORDER BY c.chunk_index`,
      [acme.slug, ref],
    );
  const storedAsSummed = (
    rows: readonly { stored: string | null; summed: string }[],
  ) => rows.every((row) => row.stored !== null && row.stored === row.summed);

  /** Hits of `ref` on both legs whose offset is not the sum for their
   * chunk, and how many hits each leg had. */
  const searchedOffsets = async (
    ref: string,
    summed: ReadonlyMap<number, string>,
  ) => {
    const sent: Sent[] = [];
    const reader = new DocumentCorpusReader(watched(pool, sent), acme.slug);
    const query = 'Grüsse aus Zürich';
    const keyword = (await reader.keyword({ query, limit: 200 })) ?? [];
    const dense =
      (await reader.dense({
        query,
        limit: 200,
        embedding: await embedder.embed(query),
      })) ?? [];
    const hits = [...keyword, ...dense].filter((hit) => hit.source.ref === ref);
    const wrong = hits.filter(
      (hit) => String(hit.offset) !== summed.get(hit.chunkIndex),
    );
    return {
      keyword: keyword.filter((hit) => hit.source.ref === ref).length,
      dense: dense.filter((hit) => hit.source.ref === ref).length,
      wrong: wrong.map((hit) => `${hit.chunkIndex}@${hit.offset}`),
      plan: densePlan(sent),
    };
  };

  const ref = `s3:itest/${acme.slug}/grüsse`;
  const copyRef = `s3:itest/${acme.slug}/grüsse-kopie`;
  // Characters of two UTF-16 units: the database counts each as one, the
  // offset the search always reported.
  const text = Array.from(
    { length: 400 },
    (_v, i) =>
      `## Abschnitt ${i}\n\nGrüsse aus Zürich 🏔️ und Genève 🇨🇭 — Absatz ${i}, lang genug für einen eigenen Teil des Textes.\n`,
  ).join('\n');

  try {
    // 1. Offsets stored at index time, slice after slice, are the sum the
    //    search used to compute, and both legs report them.
    const indexed = await index(ref, text);
    const offsets = await offsetsOf(ref);
    const summed = new Map(offsets.map((row) => [row.index, row.summed]));
    const searched = await searchedOffsets(ref, summed);
    record(
      'knowledge search: a document hit reports the offset stored with its chunk, the sum of the chunks before it',
      indexed.chunksTotal > 6 &&
        offsets.length === indexed.chunksTotal &&
        storedAsSummed(offsets) &&
        searched.keyword > 0 &&
        searched.dense > 0 &&
        searched.wrong.length === 0,
      `chunks=${offsets.length}/${indexed.chunksTotal} (want >6, all stored), stored≠sum=${JSON.stringify(offsets.filter((row) => row.stored !== row.summed).slice(0, 3))}, keyword hits=${searched.keyword}, dense hits=${searched.dense}, wrong=${JSON.stringify(searched.wrong.slice(0, 5))}`,
    );

    // 2. A small scope: counted in full — the bound cuts nothing — and
    //    scanned exactly.
    const chunksWithVectors = await pool.unsafe<{ n: string }[]>(
      `SELECT count(*)::text AS n
         FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.chunk_vectors_${WIDTH} v
         JOIN ${PRIVATE_KNOWLEDGE_SCHEMA}.chunks c ON c.id = v.chunk_id
        WHERE c.org_slug = $1 AND NOT c.passage_repeat`,
      [acme.slug],
    );
    record(
      'knowledge search: the dense leg counts a scope under the bound in full and scans it exactly',
      searched.plan.bounded &&
        searched.plan.counted === chunksWithVectors[0]?.n &&
        searched.plan.exact,
      `plan=${JSON.stringify(searched.plan)}, in scope=${chunksWithVectors[0]?.n ?? '?'}`,
    );

    // 3. A copy of the same content carries the offsets with its chunks.
    const copied = await index(copyRef, text);
    const copyOffsets = await offsetsOf(copyRef);
    record(
      'knowledge search: a copied document carries the stored offsets of the one it copies',
      copied.chunksTotal === indexed.chunksTotal &&
        copyOffsets.length === offsets.length &&
        storedAsSummed(copyOffsets) &&
        copyOffsets.every((row) => row.stored === summed.get(row.index)),
      `copied=${copied.chunksTotal}, chunks=${copyOffsets.length}/${offsets.length}, stored≠sum=${JSON.stringify(copyOffsets.filter((row) => row.stored !== row.summed).slice(0, 3))}`,
    );

    // 4. Chunks stored before the column existed: no offset, and the
    //    search still reports the sum.
    await pool.unsafe(
      `UPDATE ${PRIVATE_KNOWLEDGE_SCHEMA}.chunks c SET core_offset = NULL
         FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents d
        WHERE d.id = c.document_id AND d.org_slug = c.org_slug
          AND d.org_slug = $1 AND d.file_id = $2`,
      [acme.slug, ref],
    );
    const legacy = await searchedOffsets(ref, summed);
    const cleared = await offsetsOf(ref);
    record(
      'knowledge search: a chunk stored without an offset still reports the sum of the chunks before it',
      cleared.length === offsets.length &&
        cleared.every((row) => row.stored === null) &&
        legacy.keyword > 0 &&
        legacy.dense > 0 &&
        legacy.wrong.length === 0,
      `cleared=${cleared.filter((row) => row.stored === null).length}/${cleared.length}, keyword hits=${legacy.keyword}, dense hits=${legacy.dense}, wrong=${JSON.stringify(legacy.wrong.slice(0, 5))}`,
    );

    // 5. A scope past the bound: counted to one row past it, never in
    //    full, and left to the index.
    const [bulkDocument] = await pool.unsafe<{ id: string }[]>(
      `INSERT INTO ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
           (org_slug, file_id, filename, status, chunks_count)
       VALUES ($1, $2, 'bulk.txt', 'completed', $3)
       RETURNING id::text AS id`,
      [bulk.slug, `s3:itest/${bulk.slug}/bulk`, BULK_CHUNKS],
    );
    await pool.unsafe(
      `INSERT INTO ${PRIVATE_KNOWLEDGE_SCHEMA}.chunks
           (document_id, org_slug, chunk_index, chunk_content, content_hash,
            core_content, core_offset)
       SELECT $1::uuid, $2, g, 'bulk passage ' || g, md5(g::text),
              'bulk passage ' || g, 0
         FROM generate_series(0, $3::int - 1) g`,
      [bulkDocument?.id ?? '', bulk.slug, BULK_CHUNKS],
    );
    await pool.unsafe(
      `INSERT INTO ${PRIVATE_KNOWLEDGE_SCHEMA}.chunk_vectors_${WIDTH}
           (chunk_id, embedding)
       SELECT c.id,
              (SELECT array_agg(sin(c.chunk_index * 0.37 + i)::real
                                ORDER BY i)
                 FROM generate_series(1, $3::int) i)::vector
         FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.chunks c
        WHERE c.document_id = $1::uuid AND c.org_slug = $2`,
      [bulkDocument?.id ?? '', bulk.slug, WIDTH],
    );
    const bulkSent: Sent[] = [];
    const bulkHits = await new DocumentCorpusReader(
      watched(pool, bulkSent),
      bulk.slug,
    ).dense({
      query: 'bulk passage',
      limit: 5,
      embedding: Array.from({ length: WIDTH }, (_v, i) => Math.sin(i + 1)),
    });
    const bulkPlan = densePlan(bulkSent);
    record(
      'knowledge search: the dense leg counts a scope past the bound only one row past it and does not scan it exactly',
      bulkPlan.bounded &&
        bulkPlan.counted === '5001' &&
        !bulkPlan.exact &&
        (bulkHits?.length ?? 0) > 0,
      `plan=${JSON.stringify(bulkPlan)} (want counted 5001 of ${BULK_CHUNKS}, not exact), hits=${bulkHits?.length ?? 'null'}`,
    );
  } finally {
    await new Promise<void>((resolve) => {
      embedServer.close(() => resolve());
    });
    for (const org of [acme, bulk]) {
      await pool
        .unsafe(
          `DELETE FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents WHERE org_slug = $1`,
          [org.slug],
        )
        .catch((error: unknown) => {
          console.warn('[itest] search-work corpus cleanup failed:', error);
        });
      await sql`DELETE FROM "organization" WHERE "id" = ${org.id}`;
    }
  }
}
