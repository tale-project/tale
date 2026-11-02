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
 *
 * That index is the organization's own (knowledge-db migration 18): the
 * vectors carry their organization, and the indexer builds an organization
 * an index over its own vectors once it is past the bound. The lane puts an
 * organization just past the bound beside one whose vectors all lie nearer
 * the query, more of them than an iterative scan visits before it gives up,
 * and holds that its search gets its full result set, all of it its own,
 * and that its own index can rank that search; that a vector carries its
 * chunk's organization whatever the writer sent; and that the teardown
 * drops the index with the corpus.
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
import { purgeCorpusForOrg } from '../../core/knowledge/teardown.ts';

const WIDTH = 256;
/** Chunks in the large scope: past the dense leg's exact-scan bound (5,000)
 * by more than the one row its count reads past it. */
const BULK_CHUNKS = 5_010;
/** Chunks of the organization whose vectors all lie nearer the query than
 * the large scope's: more than `hnsw.max_scan_tuples` (20,000 by default),
 * the tuples an iterative scan of one index over both visits before it
 * gives up. */
const CROWD_CHUNKS = 25_000;
/** Hits the search past the bound asks for. */
const RANKED = 30;

interface Sent {
  readonly text: string;
  readonly params: Parameters<Sql['unsafe']>[1];
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
            params: args[1],
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
  const crowd = { id: randomUUID(), slug: `itest-search-crowd-${tag}` };
  for (const org of [acme, bulk, crowd]) {
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

  const index = (ref: string, text: string, orgSlug = acme.slug) =>
    indexWholeDocument({
      sql: pool,
      dbUrl,
      orgSlug,
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
  /** A completed document of `count` chunks, written straight to the
   * tables: more than the fake provider embeds in a lane's time. Chunk `g`'s
   * vector is `base + amplitude * sin(0.37 g + i)` in dimension `i`. */
  const plant = async (
    orgSlug: string,
    name: string,
    count: number,
    vector: { base: number; amplitude: number },
  ) => {
    const [document] = await pool.unsafe<{ id: string }[]>(
      `INSERT INTO ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
           (org_slug, file_id, filename, status, chunks_count)
       VALUES ($1, $2, $3, 'completed', $4)
       RETURNING id::text AS id`,
      [orgSlug, `s3:itest/${orgSlug}/${name}`, `${name}.txt`, count],
    );
    await pool.unsafe(
      `INSERT INTO ${PRIVATE_KNOWLEDGE_SCHEMA}.chunks
           (document_id, org_slug, chunk_index, chunk_content, content_hash,
            core_content, core_offset)
       SELECT $1::uuid, $2, g, $3 || ' passage ' || g, md5(g::text),
              $3 || ' passage ' || g, 0
         FROM generate_series(0, $4::int - 1) g`,
      [document?.id ?? '', orgSlug, name, count],
    );
    await pool.unsafe(
      `INSERT INTO ${PRIVATE_KNOWLEDGE_SCHEMA}.chunk_vectors_${WIDTH}
           (chunk_id, embedding)
       SELECT c.id,
              (SELECT array_agg(($4::real
                                 + $5::real * sin(c.chunk_index * 0.37 + i))::real
                                ORDER BY i)
                 FROM generate_series(1, $3::int) i)::vector
         FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.chunks c
        WHERE c.document_id = $1::uuid AND c.org_slug = $2`,
      [document?.id ?? '', orgSlug, WIDTH, vector.base, vector.amplitude],
    );
  };

  /** The organization's own index on the vectors of the lane's width: its
   * name, and its definition while it exists. */
  const ownIndex = async (orgSlug: string) => {
    const [row] = await pool.unsafe<
      { name: string; definition: string | null }[]
    >(
      `SELECT n.name,
              pg_get_indexdef(to_regclass(
                format('${PRIVATE_KNOWLEDGE_SCHEMA}.%I', n.name))) AS definition
         FROM (SELECT ${PRIVATE_KNOWLEDGE_SCHEMA}.chunk_vectors_org_index_name(
                        $1, $2) AS name) n`,
      [WIDTH, orgSlug],
    );
    return { name: row?.name ?? '', definition: row?.definition ?? null };
  };

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
    const reader = new DocumentCorpusReader(
      watched(pool, sent),
      acme.slug,
      'itest-embed',
    );
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
    await plant(bulk.slug, 'bulk', BULK_CHUNKS, { base: 0, amplitude: 1 });
    const bulkSent: Sent[] = [];
    const bulkHits = await new DocumentCorpusReader(
      watched(pool, bulkSent),
      bulk.slug,
      'itest-embed',
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

    // 6. The index past the bound is the organization's own. Its vectors
    //    were written straight to the table; the indexer builds the index
    //    when the organization's next document completes. One under the
    //    bound never gets one.
    const unbuilt = await ownIndex(bulk.slug);
    const small = await ownIndex(acme.slug);
    const next = await index(
      `s3:itest/${bulk.slug}/grüsse`,
      text.slice(0, 2_000),
      bulk.slug,
    );
    const built = await ownIndex(bulk.slug);
    record(
      'knowledge search: an organization gets an approximate index of its own once its next document completes past the bound, and one under it none',
      unbuilt.definition === null &&
        small.definition === null &&
        next.chunksTotal > 0 &&
        (built.definition?.includes('USING hnsw') ?? false) &&
        built.definition?.includes(`'${bulk.slug}'`) === true,
      `before=${unbuilt.definition ?? 'none'}, under the bound=${small.definition ?? 'none'}, document chunks=${next.chunksTotal}, after=${built.definition ?? 'none'}`,
    );

    // 7. Beside an organization whose vectors all lie nearer the query —
    //    every tuple a scan of an index over both would visit before it
    //    gave up — the search gets its full result set, all its own.
    await plant(crowd.slug, 'crowd', CROWD_CHUNKS, {
      base: 1,
      amplitude: 0.05,
    });
    const lone: Sent[] = [];
    const loneHits =
      (await new DocumentCorpusReader(
        watched(pool, lone),
        bulk.slug,
        'itest-embed',
      ).dense({
        query: 'bulk passage',
        limit: RANKED,
        embedding: Array.from({ length: WIDTH }, () => 1),
      })) ?? [];
    const lonePlan = densePlan(lone);
    const foreign = loneHits
      .map((hit) => hit.source.ref)
      .filter((hitRef) => !hitRef.startsWith(`s3:itest/${bulk.slug}/`));
    // The ranking statement, explained with its parameters under the
    // settings it ran with: the plan Postgres picks, and — sorting
    // forbidden, so that only an index can order the rows — the index that
    // can serve it. At the lane's few thousand rows Postgres may rank by an
    // exact sort of the organization's own rows instead; at either size no
    // index over another organization's vectors is left to pick.
    const ranked = lone.find((entry) =>
      entry.text.includes('ORDER BY v.embedding'),
    );
    const plans =
      ranked === undefined
        ? { chosen: '', served: '' }
        : await pool.begin(async (tx) => {
            for (const entry of lone) {
              if (entry.text.startsWith('SET LOCAL hnsw.')) {
                await tx.unsafe(entry.text);
              }
            }
            const explain = async () =>
              (
                await tx.unsafe<{ 'QUERY PLAN': string }[]>(
                  `EXPLAIN ${ranked.text}`,
                  ranked.params,
                )
              )
                .map((line) => line['QUERY PLAN'])
                .join('\n');
            const chosen = await explain();
            await tx.unsafe('SET LOCAL enable_sort = off');
            return { chosen, served: await explain() };
          });
    const scans = (plan: string) =>
      JSON.stringify(
        plan
          .split('\n')
          .filter((line) => /Scan|Sort|Loop|Join/.test(line))
          .map((line) => line.trim().replace(/'\[[^\]]*\]'/g, "'[…]'"))
          .slice(0, 6),
      );
    record(
      'knowledge search: past the bound, an organization beside one whose vectors all lie nearer the query gets its full result set, all its own',
      lonePlan.bounded &&
        lonePlan.counted === '5001' &&
        !lonePlan.exact &&
        loneHits.length === RANKED &&
        foreign.length === 0,
      `hits=${loneHits.length}/${RANKED}, foreign=${JSON.stringify(foreign.slice(0, 3))}, plan=${JSON.stringify(lonePlan)}, chosen=${scans(plans.chosen)}`,
    );
    record(
      'knowledge search: past the bound, the organization’s own index can rank its search',
      built.name !== '' && plans.served.includes(`using ${built.name} `),
      `index=${built.name}, served=${scans(plans.served)}`,
    );

    // 8. A vector's organization is its chunk's, whatever the writer sent.
    const [stamped] = await pool.unsafe<{ vectors: string; astray: string }[]>(
      `SELECT count(*)::text AS vectors,
              count(*) FILTER (WHERE v.org_slug IS DISTINCT FROM c.org_slug)::text
                AS astray
         FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.chunk_vectors_${WIDTH} v
         JOIN ${PRIVATE_KNOWLEDGE_SCHEMA}.chunks c ON c.id = v.chunk_id
        WHERE c.org_slug = ANY($1)`,
      [[acme.slug, bulk.slug, crowd.slug]],
    );
    const [rewritten] = await pool.unsafe<{ org_slug: string }[]>(
      `UPDATE ${PRIVATE_KNOWLEDGE_SCHEMA}.chunk_vectors_${WIDTH}
          SET org_slug = $2
        WHERE chunk_id = (
          SELECT min(v.chunk_id)
            FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.chunk_vectors_${WIDTH} v
            JOIN ${PRIVATE_KNOWLEDGE_SCHEMA}.chunks c ON c.id = v.chunk_id
           WHERE c.org_slug = $1)
        RETURNING org_slug`,
      [bulk.slug, crowd.slug],
    );
    record(
      'knowledge search: a vector carries its chunk’s organization, whatever the writer sent',
      Number(stamped?.vectors ?? 0) > BULK_CHUNKS + CROWD_CHUNKS &&
        stamped?.astray === '0' &&
        rewritten?.org_slug === bulk.slug,
      `vectors=${stamped?.vectors ?? '?'}, astray=${stamped?.astray ?? '?'}, written as ${crowd.slug}, stored as ${rewritten?.org_slug ?? 'no row'}`,
    );

    // 9. Purging the corpus drops the organization's index with it.
    await purgeCorpusForOrg(bulk.slug);
    const purged = await ownIndex(bulk.slug);
    record(
      'knowledge search: purging an organization’s corpus drops its approximate index',
      built.definition !== null && purged.definition === null,
      `before=${built.definition === null ? 'none' : 'built'}, after=${purged.definition ?? 'none'}`,
    );
  } finally {
    await new Promise<void>((resolve) => {
      embedServer.close(() => resolve());
    });
    for (const org of [acme, bulk, crowd]) {
      await pool
        .unsafe(
          `DELETE FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents WHERE org_slug = $1`,
          [org.slug],
        )
        .catch((error: unknown) => {
          console.warn('[itest] search-work corpus cleanup failed:', error);
        });
      await pool
        .unsafe(
          `SELECT ${PRIVATE_KNOWLEDGE_SCHEMA}.drop_chunk_vectors_org_indexes($1)`,
          [org.slug],
        )
        .catch((error: unknown) => {
          console.warn('[itest] search-work index cleanup failed:', error);
        });
      await sql`DELETE FROM "organization" WHERE "id" = ${org.id}`;
    }
  }
}
