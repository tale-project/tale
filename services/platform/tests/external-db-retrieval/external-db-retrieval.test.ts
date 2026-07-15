/**
 * TRULY end-to-end proof that Tale's chat RAG RETRIEVES from a per-org, bring-your-own
 * EXTERNAL knowledge database — not just the deployment default.
 *
 * The companion `tests/large-file/large-file-indexing.test.ts` proves the WRITE side
 * (per-org routing lands chunks in the external Postgres). This suite proves the READ
 * side end to end, against a REAL external ParadeDB (pgvector + pg_search) and a REAL
 * embedding server (OpenAI-compatible, e.g. HuggingFace Text-Embeddings-Inference).
 * Nothing in the retrieval path is mocked: the per-org pool router
 * (`getKnowledgePoolForOrg`), the embedding HTTP call, the postgres.js driver, the
 * hybrid BM25 + vector SQL (`RagSearchService` / `search_service.ts`), and the
 * `RagService` singleton the Convex `internal.rag.search.{search,generate}` actions
 * (and thus the chat `rag_search` tool) call are all the production code paths.
 *
 * It indexes ONE tiny, distinctive document — a made-up fact
 * ("The Zephyr-9 reactor's primary coolant is gallium-72") — into a test org whose
 * `<org>/knowledge/connection.json` points at the EXTERNAL DB, then proves retrieval:
 *
 *   1. ROUTING/ISOLATION — the chunks physically land in the EXTERNAL ParadeDB and the
 *      default DB stays EMPTY for that org (SQL row counts on both pools).
 *   2. HIGH-LEVEL SEARCH — `ragService.search(ORG_BYO, ...)` (the exact path the
 *      Convex `internal.rag.search.search` action + the `rag_search` chat tool use)
 *      returns a chunk containing the fact, resolved through the per-org router.
 *   3. NEGATIVE CONTROL — `ragService.search(ORG_DEFAULT, ...)` (an org WITHOUT a
 *      connection.json → the deployment-default pool) returns NOTHING for the same
 *      query, proving the hit in (2) came from the external pool, not a shared surface.
 *   4. LOW-LEVEL SEARCH — `new RagSearchService(externalPool, embedding)` retrieves the
 *      fact; the same service bound to the DEFAULT pool retrieves nothing — proving it
 *      at the `search_service.ts` layer, independent of the singleton's config cache.
 *   5. FULL CHAT (optional, EXTERNAL_DB_E2E_CHAT=1) — `ragService.generate(ORG_BYO, ...)`
 *      runs a real LLM turn (via the org's OpenRouter provider) grounded ONLY on the
 *      externally-retrieved context, and the answer contains the fact.
 *
 * ── Gate ────────────────────────────────────────────────────────────────────
 * SKIPPED unless `EXTERNAL_DB_E2E=1` so `bun run test` stays fast. Proof (5) is
 * additionally gated behind `EXTERNAL_DB_E2E_CHAT=1` + `OPENROUTER_API_KEY`.
 *
 * ── Env knobs (read at run time) ─────────────────────────────────────────────
 *   EXTERNAL_DB_E2E=1                          enable the suite (else skipped)
 *   KNOWLEDGE_DATABASE_URL                     deployment-default Postgres (the code
 *     (or EXTERNAL_DB_E2E_DEFAULT_DATABASE_URL)  reads KNOWLEDGE_DATABASE_URL)
 *   EXTERNAL_DB_E2E_EXTERNAL_DATABASE_URL      the org's own (BYO) external Postgres
 *   EXTERNAL_DB_E2E_EMBEDDINGS_URL             OpenAI-compat base, e.g.
 *                                              http://127.0.0.1:8090/v1
 *   EXTERNAL_DB_E2E_EMBEDDINGS_MODEL           default BAAI/bge-small-en-v1.5
 *   EXTERNAL_DB_E2E_EMBEDDINGS_DIM             default 384
 *   RAG_SIMILARITY_THRESHOLD=0                 recommended: keeps the vector pre-filter
 *                                              from early-returning on a marginal cosine
 *   EXTERNAL_DB_E2E_CHAT=1                      also run proof (5) (needs a chat key)
 *   OPENROUTER_API_KEY                         chat provider key (never logged)
 *   EXTERNAL_DB_E2E_CHAT_BASE_URL              default https://openrouter.ai/api/v1
 *   EXTERNAL_DB_E2E_CHAT_MODEL                 default openai/gpt-4o-mini
 *
 * ── Run it locally (three throwaway containers) ──────────────────────────────
 *   docker run -d --name edr-db-default  -e DB_PASSWORD=edr -e TALE_DB_ROLE=knowledge \
 *     -p 5560:5432 ghcr.io/tale-project/tale/tale-db:latest
 *   docker run -d --name edr-db-external -e DB_PASSWORD=edr -e TALE_DB_ROLE=knowledge \
 *     -p 5561:5432 ghcr.io/tale-project/tale/tale-db:latest
 *   docker run -d --name edr-tei -p 8090:80 \
 *     -e MODEL_ID=BAAI/bge-small-en-v1.5 -e MAX_CLIENT_BATCH_SIZE=512 -e AUTO_TRUNCATE=true \
 *     ghcr.io/huggingface/text-embeddings-inference:cpu-latest
 *
 *   EXTERNAL_DB_E2E=1 RAG_SIMILARITY_THRESHOLD=0 \
 *   KNOWLEDGE_DATABASE_URL='postgresql://tale:edr@127.0.0.1:5560/tale_knowledge' \
 *   EXTERNAL_DB_E2E_EXTERNAL_DATABASE_URL='postgresql://tale:edr@127.0.0.1:5561/tale_knowledge' \
 *   EXTERNAL_DB_E2E_EMBEDDINGS_URL='http://127.0.0.1:8090/v1' \
 *   bun run --filter @tale/platform test -- tests/external-db-retrieval/external-db-retrieval.test.ts
 *
 *   docker rm -f edr-db-default edr-db-external edr-tei   # cleanup
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  closeKnowledgePool,
  getKnowledgePool,
  getKnowledgePoolForOrg,
  invalidateOrgKnowledgeUrl,
  PRIVATE_KNOWLEDGE_SCHEMA as SCHEMA,
} from '../../convex/lib/knowledge/db/knowledge_db';
import { pinEmbeddingDimensions } from '../../convex/lib/knowledge/db/pin_embedding_dimensions';
import { EmbeddingService } from '../../convex/lib/knowledge/embedding/service';
import { ragService } from '../../convex/rag/lib/rag_service';
import { RagSearchService } from '../../convex/rag/lib/search_service';

const ENABLED = process.env.EXTERNAL_DB_E2E === '1';
const CHAT_ENABLED =
  process.env.EXTERNAL_DB_E2E_CHAT === '1' &&
  Boolean(process.env.OPENROUTER_API_KEY);

/** Org WITHOUT a connection.json → routes to the deployment-default pool. */
const ORG_DEFAULT = 'ext-retrieval-default';
/** Org WITH connection.json → routes to its own external Postgres. */
const ORG_BYO = 'ext-retrieval-byo';

const EMBED_MODEL =
  process.env.EXTERNAL_DB_E2E_EMBEDDINGS_MODEL ?? 'BAAI/bge-small-en-v1.5';
const EMBED_DIM = Number(process.env.EXTERNAL_DB_E2E_EMBEDDINGS_DIM ?? '384');
const CHAT_BASE_URL =
  process.env.EXTERNAL_DB_E2E_CHAT_BASE_URL ?? 'https://openrouter.ai/api/v1';
const CHAT_MODEL =
  process.env.EXTERNAL_DB_E2E_CHAT_MODEL ?? 'openai/gpt-4o-mini';

/**
 * The made-up, highly-distinctive fact. Deliberately free of secret-shaped tokens
 * so the pre-ingestion secret scanner does not reject the document. "gallium-72"
 * and "Zephyr-9" appear nowhere else, so any retrieval of them is unambiguous.
 */
const FACT = 'gallium-72';
const DOCUMENT =
  'Zephyr-9 Reactor Coolant Briefing\n\n' +
  'The Zephyr-9 reactor is an experimental fusion reactor.\n' +
  "The Zephyr-9 reactor's primary coolant is gallium-72.\n" +
  'Gallium-72 was chosen as the Zephyr-9 coolant for its thermal stability.\n' +
  'Engineers monitor the gallium-72 coolant loop pressure continuously.\n';
const QUERY = 'What is the primary coolant used in the Zephyr-9 reactor?';

const MINUTE = 60_000;
const READY_TIMEOUT = 3 * MINUTE;
const STEP_TIMEOUT = 3 * MINUTE;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait until the OpenAI-compatible embedding server can actually produce an
 * embedding. Probing `/embeddings` keeps this agnostic across TEI, llama.cpp, or
 * any other backend, and doubles as a live check that the `{model,input,dimensions}`
 * payload is accepted.
 */
async function waitForEmbeddingServer(
  baseUrl: string,
  model: string,
  dims: number,
  timeoutMs: number,
): Promise<void> {
  const url = baseUrl.replace(/\/$/, '') + '/embeddings';
  const body = JSON.stringify({ model, input: ['ready?'], dimensions: dims });
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer sk-local',
        },
        body,
      });
      if (res.ok) {
        const json = (await res.json()) as {
          data?: { embedding?: number[] }[];
        };
        if (json.data?.[0]?.embedding?.length) {
          return;
        }
        lastErr = new Error('no embedding in response');
      } else {
        lastErr = new Error(`status ${res.status}`);
      }
    } catch (err) {
      lastErr = err;
    }
    await sleep(2000);
  }
  throw new Error(
    `Embedding server not ready at ${url} within ${timeoutMs}ms: ${String(lastErr)}`,
  );
}

/** Poll until `private_knowledge.chunks` exists on `sql` (schema applied). */
async function waitForKnowledgeSchema(
  sql: Sql,
  label: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const rows = await sql.unsafe<{ t: string | null }[]>(
        `SELECT to_regclass('${SCHEMA}.chunks')::text AS t`,
      );
      if (rows[0]?.t) {
        return;
      }
      lastErr = new Error('private_knowledge.chunks not present yet');
    } catch (err) {
      lastErr = err;
    }
    await sleep(2000);
  }
  throw new Error(
    `${label}: private_knowledge schema not ready within ${timeoutMs}ms: ${String(lastErr)}`,
  );
}

/** Count `chunks` rows for `orgSlug`, and how many contain the fact. */
async function readOrgChunkStats(
  sql: Sql,
  orgSlug: string,
): Promise<{ total: number; withFact: number; sample: string | null }> {
  const rows = await sql.unsafe<
    { total: number; with_fact: number; sample: string | null }[]
  >(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE core_content ILIKE '%' || $2 || '%'
                              OR chunk_content ILIKE '%' || $2 || '%')::int AS with_fact,
            (SELECT COALESCE(core_content, chunk_content) FROM ${SCHEMA}.chunks
               WHERE org_slug = $1
                 AND (core_content ILIKE '%' || $2 || '%'
                      OR chunk_content ILIKE '%' || $2 || '%')
               LIMIT 1) AS sample
     FROM ${SCHEMA}.chunks
     WHERE org_slug = $1`,
    [orgSlug, FACT],
  );
  return {
    total: rows[0]?.total ?? 0,
    withFact: rows[0]?.with_fact ?? 0,
    sample: rows[0]?.sample ?? null,
  };
}

/** Delete any prior rows for `orgSlug` so reruns start clean (chunks cascade). */
async function clearOrg(sql: Sql, orgSlug: string): Promise<void> {
  await sql.unsafe(`DELETE FROM ${SCHEMA}.documents WHERE org_slug = $1`, [
    orgSlug,
  ]);
}

/** Write a minimal provider catalog file (+ plaintext secrets sidecar). */
async function writeProvider(
  configDir: string,
  orgSlug: string,
  fileName: string,
  provider: Record<string, unknown>,
  apiKey: string,
): Promise<void> {
  const dir = path.join(configDir, orgSlug, 'providers');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${fileName}.json`), JSON.stringify(provider));
  await writeFile(
    path.join(dir, `${fileName}.secrets.json`),
    JSON.stringify({ apiKey }),
  );
}

describe.skipIf(!ENABLED)(
  'per-org external-DB RAG retrieval (real Postgres + embeddings)',
  () => {
    let configDir: string;
    let defaultPool: Sql;
    let externalPool: Sql;
    let embeddingService: EmbeddingService;

    beforeAll(async () => {
      const defaultUrl =
        process.env.KNOWLEDGE_DATABASE_URL ??
        process.env.EXTERNAL_DB_E2E_DEFAULT_DATABASE_URL;
      const externalUrl = process.env.EXTERNAL_DB_E2E_EXTERNAL_DATABASE_URL;
      const embeddingsUrl = process.env.EXTERNAL_DB_E2E_EMBEDDINGS_URL;
      if (!defaultUrl || !externalUrl || !embeddingsUrl) {
        throw new Error(
          'EXTERNAL_DB_E2E=1 requires KNOWLEDGE_DATABASE_URL (or ' +
            'EXTERNAL_DB_E2E_DEFAULT_DATABASE_URL), ' +
            'EXTERNAL_DB_E2E_EXTERNAL_DATABASE_URL, and ' +
            'EXTERNAL_DB_E2E_EMBEDDINGS_URL to be set.',
        );
      }
      // The pipeline reads KNOWLEDGE_DATABASE_URL for the deployment default.
      process.env.KNOWLEDGE_DATABASE_URL = defaultUrl;

      // ── Per-org config dir: BYO connection.json + provider catalogs.
      configDir = await mkdtemp(path.join(tmpdir(), 'ext-retrieval-config-'));
      process.env.TALE_CONFIG_DIR = configDir;

      const ext = new URL(externalUrl);
      const byoKnowledgeDir = path.join(configDir, ORG_BYO, 'knowledge');
      await mkdir(byoKnowledgeDir, { recursive: true });
      await writeFile(
        path.join(byoKnowledgeDir, 'connection.json'),
        JSON.stringify({
          host: ext.hostname,
          port: Number(ext.port || '5432'),
          database: decodeURIComponent(ext.pathname.replace(/^\//, '')),
          user: decodeURIComponent(ext.username),
          sslmode: 'disable',
        }),
      );
      if (ext.password) {
        // Plaintext secrets sidecar (no SOPS key configured in the test env).
        await writeFile(
          path.join(byoKnowledgeDir, 'connection.secrets.json'),
          JSON.stringify({ password: decodeURIComponent(ext.password) }),
        );
      }
      invalidateOrgKnowledgeUrl(ORG_BYO);

      // Provider catalogs. Embedding → the local OpenAI-compatible server for both
      // orgs. Chat → OpenRouter for the BYO org (used only by proof 5; the search
      // paths never call it, but `ensureOrgClients` requires a resolvable chat
      // model with a non-empty key). The DEFAULT org gets a local dummy chat model.
      const embeddingProvider = {
        displayName: 'Local Embeddings',
        baseUrl: embeddingsUrl,
        models: [
          {
            id: EMBED_MODEL,
            tags: ['embedding'],
            dimensions: EMBED_DIM,
          },
        ],
      };
      await writeProvider(
        configDir,
        ORG_BYO,
        'local-embeddings',
        embeddingProvider,
        'sk-local',
      );
      await writeProvider(
        configDir,
        ORG_BYO,
        'chat',
        {
          displayName: 'Chat',
          baseUrl: CHAT_BASE_URL,
          models: [{ id: CHAT_MODEL, tags: ['chat'] }],
        },
        process.env.OPENROUTER_API_KEY ?? 'sk-local',
      );
      await writeProvider(
        configDir,
        ORG_DEFAULT,
        'local',
        {
          displayName: 'Local',
          baseUrl: embeddingsUrl,
          models: [
            { id: 'local-chat', tags: ['chat'] },
            { id: EMBED_MODEL, tags: ['embedding'], dimensions: EMBED_DIM },
          ],
        },
        'sk-local',
      );

      // ── Wait for the embedding server, then build a direct EmbeddingService
      // (used by proof 4's low-level search, independent of the singleton).
      await waitForEmbeddingServer(
        embeddingsUrl,
        EMBED_MODEL,
        EMBED_DIM,
        READY_TIMEOUT,
      );
      embeddingService = new EmbeddingService(
        'sk-local',
        embeddingsUrl,
        EMBED_MODEL,
        EMBED_DIM,
      );

      // ── Resolve both pools via the real per-org router.
      defaultPool = await getKnowledgePoolForOrg(ORG_DEFAULT); // → deployment default
      externalPool = await getKnowledgePoolForOrg(ORG_BYO); // → external, bootstraps schema
      expect(defaultPool).toBe(getKnowledgePool());
      expect(externalPool).not.toBe(defaultPool);

      await waitForKnowledgeSchema(defaultPool, 'default DB', READY_TIMEOUT);
      await waitForKnowledgeSchema(externalPool, 'external DB', READY_TIMEOUT);

      // Pin the single vector column to the model's dimension on BOTH DBs.
      await pinEmbeddingDimensions(defaultPool, SCHEMA, EMBED_DIM);
      await pinEmbeddingDimensions(externalPool, SCHEMA, EMBED_DIM);

      // Clean any prior run's rows so counts are deterministic.
      await clearOrg(externalPool, ORG_BYO);
      await clearOrg(defaultPool, ORG_BYO); // must stay 0 in the default DB
      await clearOrg(defaultPool, ORG_DEFAULT);

      await ragService.initialize();
    }, READY_TIMEOUT + MINUTE);

    afterAll(async () => {
      try {
        await ragService.shutdown();
      } finally {
        await closeKnowledgePool().catch(() => {});
        await rm(configDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it(
      'routes indexing into the EXTERNAL DB, not the deployment default',
      async () => {
        const fileId = `zephyr9-${Date.now()}`;
        const result = await ragService.addDocument(
          ORG_BYO,
          Buffer.from(DOCUMENT, 'utf8'),
          fileId,
          'zephyr9-briefing.txt',
        );
        expect(result.success).toBe(true);
        expect(result.chunks_created).toBeGreaterThan(0);

        // The chunks — with the fact — physically live in the EXTERNAL ParadeDB.
        const external = await readOrgChunkStats(externalPool, ORG_BYO);
        console.log(
          `[ext-retrieval] EXTERNAL DB rows for ${ORG_BYO}: total=${external.total} ` +
            `withFact=${external.withFact} sample=${JSON.stringify(external.sample)}`,
        );
        expect(external.total).toBeGreaterThan(0);
        expect(external.withFact).toBeGreaterThan(0);
        expect(external.sample).toContain(FACT);

        // The deployment-default DB stays EMPTY for this org (tenant isolation).
        const inDefault = await readOrgChunkStats(defaultPool, ORG_BYO);
        console.log(
          `[ext-retrieval] DEFAULT DB rows for ${ORG_BYO}: total=${inDefault.total}`,
        );
        expect(inDefault.total).toBe(0);
      },
      STEP_TIMEOUT,
    );

    it(
      'retrieves the fact via the per-org RAG search (ragService.search → external pool)',
      async () => {
        const [results] = await ragService.search(ORG_BYO, QUERY, {
          topK: 10,
          similarityThreshold: 0,
        });
        console.log(
          `[ext-retrieval] ragService.search(${ORG_BYO}) returned ${results.length} rows; ` +
            `top content=${JSON.stringify(results[0]?.content?.slice(0, 160) ?? null)}`,
        );
        expect(results.length).toBeGreaterThan(0);
        expect(results.some((r) => r.content.includes(FACT))).toBe(true);

        // NEGATIVE CONTROL: the same query for an org routed to the DEFAULT pool
        // returns nothing — the fact lives ONLY in the external DB, so the hit
        // above unambiguously came from the external pool.
        const [defaultResults] = await ragService.search(ORG_DEFAULT, QUERY, {
          topK: 10,
          similarityThreshold: 0,
        });
        console.log(
          `[ext-retrieval] ragService.search(${ORG_DEFAULT}) returned ${defaultResults.length} rows (expected 0)`,
        );
        expect(defaultResults.length).toBe(0);
      },
      STEP_TIMEOUT,
    );

    it(
      'retrieves the fact via search_service bound directly to the external pool',
      async () => {
        const externalSearch = new RagSearchService(
          externalPool,
          embeddingService,
        );
        const [rows] = await externalSearch.search(ORG_BYO, QUERY, {
          topK: 10,
          similarityThreshold: 0,
        });
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.some((r) => r.content.includes(FACT))).toBe(true);

        // The SAME service bound to the DEFAULT pool finds nothing for this org.
        const defaultSearch = new RagSearchService(
          defaultPool,
          embeddingService,
        );
        const [defaultRows] = await defaultSearch.search(ORG_BYO, QUERY, {
          topK: 10,
          similarityThreshold: 0,
        });
        expect(defaultRows.length).toBe(0);
      },
      STEP_TIMEOUT,
    );

    it.skipIf(!CHAT_ENABLED)(
      'full RAG generate: the LLM answers with the fact retrieved from the external DB',
      async () => {
        const generation = await ragService.generate(ORG_BYO, QUERY);
        console.log(
          `[ext-retrieval] generate.success=${generation.success} ` +
            `sources=${generation.sources.length} ` +
            `answer=${JSON.stringify(generation.response.slice(0, 240))}`,
        );
        expect(generation.success).toBe(true);
        // The context fed to the model came exclusively from the external-DB search.
        expect(generation.sources.length).toBeGreaterThan(0);
        expect(generation.sources.some((s) => s.content.includes(FACT))).toBe(
          true,
        );
        // The model's answer cites the fact it could only have gotten from retrieval.
        expect(generation.response.toLowerCase()).toContain(FACT.toLowerCase());
      },
      STEP_TIMEOUT,
    );
  },
);
