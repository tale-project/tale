/**
 * Real-Postgres proof that a document records the embedding model that
 * embedded it (`documents.embedding_model`, knowledge-db migration 17), and
 * that a move to another model of the SAME width embeds what is indexed
 * again — where vectors kept per width noticed only a change of width.
 *
 * One organization on the deployment's knowledge database, two models of
 * one width behind a fake `/v1/embeddings` whose vectors depend on the
 * model, as real models' do: a query one model embeds finds nothing near
 * the other's vectors. The settings are saved through the embedding save
 * itself (`saveKnowledgeEmbedding`), so the stamp before the change, the
 * write and the re-queue after it run as a save runs them.
 *
 * The file rows the re-queue moves are trashed, so the jobs it queues end
 * at their liveness check (`isCorpusRefLive`) and write nothing, and the
 * email body's at its missing message; this lane indexes in their place.
 */
import { createHash, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

import type { Sql } from 'postgres';
import { z } from 'zod';

import { messageRef } from '../../../lib/knowledge/message-ref.ts';
import { DocumentCorpusReader } from '../../core/knowledge/corpus.ts';
import { Embedder } from '../../core/knowledge/embedding.ts';
import { indexWholeDocument } from '../../core/knowledge/indexing.ts';
import {
  getKnowledgePoolForOrg,
  PRIVATE_KNOWLEDGE_SCHEMA,
  resolveOrgUrl,
} from '../../core/knowledge/pool.ts';
import { saveKnowledgeEmbedding } from './embedding-save.ts';
import { embeddingMovedSince } from './service.ts';

const WIDTH = 384;
const MODEL_A = 'itest-embed-a';
const MODEL_B = 'itest-embed-b';

/** A vector per text that depends on the model: each word lands on a
 * coordinate its hash with the model's name picks, so texts sharing words
 * are near under one model and unrelated across two. */
function modelVector(model: string, text: string, width: number): number[] {
  const vector = new Array<number>(width).fill(0);
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const word of words) {
    const digest = createHash('sha256').update(`${model}:${word}`).digest();
    const at = digest.readUInt32BE(0) % width;
    vector[at] = (vector[at] ?? 0) + ((digest[4] ?? 0) % 2 === 0 ? 1 : -1);
  }
  if (words.length === 0) vector[0] = 1;
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0)) || 1;
  return vector.map((x) => x / norm);
}

/** What the embedder sends `/v1/embeddings`. */
const embeddingsRequest = z.object({
  input: z.union([z.string(), z.array(z.string())]),
  model: z.string(),
  dimensions: z.number().int().positive().optional(),
  encoding_format: z.string().optional(),
});

/** The texts and the model of a request body. */
function readRequest(rawBody: string) {
  const body = embeddingsRequest.parse(JSON.parse(rawBody || '{}'));
  return {
    ...body,
    inputs: Array.isArray(body.input) ? body.input : [body.input],
  };
}

/** The OpenAI-shaped answer, base64 Float32 when asked (the SDK's default
 * decode path). */
function embeddingsPayload(rawBody: string): string {
  const body = readRequest(rawBody);
  const model = body.model;
  const data = body.inputs.map((text, index) => {
    const vector = modelVector(model, text, body.dimensions ?? WIDTH);
    return {
      object: 'embedding',
      index,
      embedding:
        body.encoding_format === 'base64'
          ? Buffer.from(new Float32Array(vector).buffer).toString('base64')
          : vector,
    };
  });
  return JSON.stringify({
    object: 'list',
    data,
    model,
    usage: { prompt_tokens: 1, total_tokens: 1 },
  });
}

export async function checkEmbeddingModelChange(
  sql: Sql,
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const tag = randomUUID().slice(0, 8);
  const org = { id: randomUUID(), slug: `itest-model-${tag}` };
  await sql`
    INSERT INTO "organization" ("id", "name", "slug", "createdAt")
    VALUES (${org.id}, 'Embedding models', ${org.slug}, now())
  `;

  /** Texts the fake embedded, per model — what each indexing run paid for. */
  const embedded: Record<string, number> = {};
  const embedServer = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: unknown) => {
      body += String(chunk);
    });
    req.on('end', () => {
      const { model, inputs } = readRequest(body);
      embedded[model] = (embedded[model] ?? 0) + inputs.length;
      res.setHeader('content-type', 'application/json');
      res.end(embeddingsPayload(body));
    });
  });
  await new Promise<void>((resolve) => {
    embedServer.listen(0, '127.0.0.1', resolve);
  });
  const address = embedServer.address();
  const embedPort =
    address !== null && typeof address === 'object' ? address.port : 0;
  const embedderOf = (model: string) =>
    new Embedder(
      {
        providerSlug: 'openai',
        model,
        dimensions: WIDTH,
        baseUrl: `http://127.0.0.1:${embedPort}/v1`,
      },
      'sk-itest-embedding-models',
      { organizationId: org.id },
    );

  const actor = {
    organizationId: org.id,
    userId: `itest-admin-${tag}`,
    email: 'admin@example.test',
  };
  const target = { organizationId: org.id, orgSlug: org.slug };
  const save = (providerSlug: string, model: string) =>
    saveKnowledgeEmbedding(
      sql,
      target,
      { providerSlug, model, dimensions: WIDTH },
      undefined,
      actor,
    );

  const pool = await getKnowledgePoolForOrg(org.slug);
  const dbUrl = await resolveOrgUrl(org.slug);
  const index = (
    ref: string,
    text: string,
    model: string,
    extra: { conversationId?: string } = {},
  ) =>
    indexWholeDocument({
      sql: pool,
      dbUrl,
      orgSlug: org.slug,
      fileId: ref,
      filename: `${ref.split('/').at(-1) ?? 'note'}.txt`,
      text,
      embedder: embedderOf(model),
      ...extra,
    });

  /** What a document's row records, by ref. */
  const recorded = async (ref: string) =>
    (
      await pool.unsafe<{ model: string | null }[]>(
        `SELECT embedding_model AS model
           FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
          WHERE org_slug = $1 AND file_id = $2`,
        [org.slug, ref],
      )
    )[0]?.model;
  /** The documents the dense leg finds when the settings state `model`. */
  const foundByMeaning = async (model: string, query: string) => {
    const embedding = await embedderOf(model).embed(query);
    const hits = await new DocumentCorpusReader(pool, org.slug, model).dense({
      query,
      limit: 5,
      embedding,
    });
    return [...new Set((hits ?? []).map((hit) => hit.source.ref))];
  };

  const handbook = `s3:itest/${org.slug}/handbook`;
  const policy = `s3:itest/${org.slug}/travel-policy`;
  const copy = `s3:itest/${org.slug}/handbook-copy`;
  const body = messageRef(randomUUID());
  const handbookText =
    'The Spiez office keeps the parental leave policy in the staff handbook.';
  const policyText =
    'Train tickets for client visits are booked in second class and refunded monthly.';
  const bodyText =
    'Please send the signed forklift inspection report for the Thun warehouse.';
  const fileIds: string[] = [];
  const fileRow = async (ref: string, name: string) => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO app.file_metadata (
        org_id, storage_ref, file_name, content_type, size, rag_status,
        lifecycle_status, created_at_ms
      ) VALUES (
        ${org.id}, ${ref}, ${name}, 'text/plain', 1, 'completed', 'trashed',
        ${Date.now()}
      )
      RETURNING id
    `;
    fileIds.push(row?.id ?? '');
    return row?.id ?? '';
  };
  const statusOf = async (fileId: string) =>
    (
      await sql<{ status: string | null }[]>`
        SELECT rag_status AS status FROM app.file_metadata WHERE id = ${fileId}
      `
    )[0]?.status ?? null;
  const jobsFor = async (name: string, key: string, value: string) =>
    Number(
      (
        await sql<{ n: string }[]>`
          SELECT count(*)::text AS n FROM pgboss.job
          WHERE name = ${name} AND data->>${key} = ${value}
        `
      )[0]?.n ?? '0',
    );

  try {
    // 1. Indexed under model A: each row records it, and a search reads
    //    only the vectors of the model its query is embedded with.
    await save('openai', MODEL_A);
    await index(handbook, handbookText, MODEL_A);
    await index(policy, policyText, MODEL_A);
    await index(body, bodyText, MODEL_A, { conversationId: randomUUID() });
    const handbookFile = await fileRow(handbook, 'handbook.txt');
    const policyFile = await fileRow(policy, 'travel-policy.txt');
    // The travel policy was indexed before the corpus recorded the model.
    await pool.unsafe(
      `UPDATE ${PRIVATE_KNOWLEDGE_SCHEMA}.documents SET embedding_model = NULL
        WHERE org_slug = $1 AND file_id = $2`,
      [org.slug, policy],
    );
    const recordedA = await recorded(handbook);
    const findsUnderA = await foundByMeaning(MODEL_A, handbookText);
    const findsUnderB = await foundByMeaning(MODEL_B, handbookText);
    record(
      'embedding model: a document records the model that embedded it, and search by meaning reads only that model’s vectors',
      recordedA === MODEL_A &&
        findsUnderA.includes(handbook) &&
        !findsUnderB.includes(handbook),
      `recorded=${recordedA ?? 'none'} (want ${MODEL_A}), found under ${MODEL_A}=${JSON.stringify(findsUnderA)} (want the handbook), under ${MODEL_B}=${JSON.stringify(findsUnderB)} (want no handbook)`,
    );

    // 2. Another model of the same width: the document indexed before the
    //    record is stamped with the model it was embedded with, then every
    //    document and the email body go back in the queue.
    const moved = await save('openai', MODEL_B);
    const policyRecorded = await recorded(policy);
    const handbookStatus = await statusOf(handbookFile);
    const policyStatus = await statusOf(policyFile);
    const bodyJobs = await jobsFor(
      'rag.index_message',
      'messageId',
      body.slice('msg:'.length),
    );
    const fileJobs = await jobsFor('rag.index_file', 'fileId', handbookFile);
    record(
      'embedding model: saving another model of the same width puts every indexed document and email body back in the queue, those indexed before the record included',
      moved.requeued === 3 &&
        policyRecorded === MODEL_A &&
        handbookStatus === 'queued' &&
        policyStatus === 'queued' &&
        bodyJobs === 1 &&
        fileJobs === 1,
      `requeued=${moved.requeued} (want 3), travel policy recorded=${policyRecorded ?? 'none'} (want ${MODEL_A}), statuses=${handbookStatus}/${policyStatus} (want queued), body jobs=${bodyJobs} (want 1), handbook jobs=${fileJobs} (want 1)`,
    );

    // 3. The next indexing embeds the document again from its first chunk
    //    under the new model, and it is found by meaning again. An identical
    //    document is copied only from one the new model embedded.
    const before = embedded[MODEL_B] ?? 0;
    const copiedTooEarly = await index(copy, handbookText, MODEL_B);
    const embeddedForCopy = (embedded[MODEL_B] ?? 0) - before;
    await pool.unsafe(
      `DELETE FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
        WHERE org_slug = $1 AND file_id = $2`,
      [org.slug, copy],
    );
    const again = await index(handbook, handbookText, MODEL_B);
    const recordedB = await recorded(handbook);
    const findsAgain = await foundByMeaning(MODEL_B, handbookText);
    const beforeClone = embedded[MODEL_B] ?? 0;
    const cloned = await index(copy, handbookText, MODEL_B);
    const embeddedForClone = (embedded[MODEL_B] ?? 0) - beforeClone;
    record(
      'embedding model: the next indexing embeds a document again under the new model, and copies identical content only from a document that model embedded',
      again.skipped === undefined &&
        again.chunksWritten === again.chunksTotal &&
        recordedB === MODEL_B &&
        findsAgain.includes(handbook) &&
        copiedTooEarly.skipped === undefined &&
        embeddedForCopy > 0 &&
        cloned.skipped === undefined &&
        embeddedForClone === 0,
      `re-index: skipped=${again.skipped ?? 'no'} written=${again.chunksWritten}/${again.chunksTotal}, recorded=${recordedB ?? 'none'} (want ${MODEL_B}), found=${JSON.stringify(findsAgain)}; a copy while the original held ${MODEL_A}'s vectors embedded ${embeddedForCopy} text(s) (want >0), once it held ${MODEL_B}'s ${embeddedForClone} (want 0, copied)`,
    );

    // 4. The same name through another provider, and a save of the same
    //    settings, put nothing back.
    await index(policy, policyText, MODEL_B);
    await index(body, bodyText, MODEL_B, { conversationId: randomUUID() });
    await sql`
      UPDATE app.file_metadata SET rag_status = 'completed'
      WHERE id = ANY(${fileIds})
    `;
    const viaGateway = await save('itest-gateway', MODEL_B);
    const resaved = await save('itest-gateway', MODEL_B);
    const statusesAfter = [
      await statusOf(handbookFile),
      await statusOf(policyFile),
    ];
    record(
      'embedding model: a save that keeps the model’s name — through another provider, or unchanged — puts nothing back in the queue',
      viaGateway.requeued === 0 &&
        resaved.requeued === 0 &&
        statusesAfter.every((status) => status === 'completed'),
      `another provider: requeued=${viaGateway.requeued} (want 0), same settings: requeued=${resaved.requeued} (want 0), statuses=${statusesAfter.join('/')} (want completed)`,
    );

    // 5. A run that read the settings before a save knows the model moved
    //    under it; one whose model only changed provider does not.
    const movedForA = await embeddingMovedSince(
      org.slug,
      embedderOf(MODEL_A).model,
    );
    const movedForB = await embeddingMovedSince(
      org.slug,
      embedderOf(MODEL_B).model,
    );
    record(
      'embedding model: a run that embedded with a model the settings no longer state learns the model moved',
      movedForA && !movedForB,
      `run under ${MODEL_A}: moved=${movedForA} (want true), under ${MODEL_B} through another provider: moved=${movedForB} (want false)`,
    );
  } finally {
    await new Promise<void>((resolve) => {
      embedServer.close(() => resolve());
    });
    await sql`DELETE FROM app.file_metadata WHERE id = ANY(${fileIds})`;
    await pool
      .unsafe(
        `DELETE FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents WHERE org_slug = $1`,
        [org.slug],
      )
      .catch((error: unknown) => {
        console.warn('[itest] embedding-model corpus cleanup failed:', error);
      });
    await rm(path.join(process.env.TALE_CONFIG_DIR ?? '', org.slug), {
      recursive: true,
      force: true,
    });
    await sql`DELETE FROM app.audit_logs WHERE org_id = ${org.id}`;
    await sql`DELETE FROM "organization" WHERE "id" = ${org.id}`;
  }
}
