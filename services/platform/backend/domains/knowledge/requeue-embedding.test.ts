// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RAG_ERROR_EMBEDDING_NOT_CONFIGURED,
  RAG_ERROR_EMBEDDING_PROVIDER_REFUSED,
  RAG_ERROR_EMBEDDING_UPSTREAM,
  RAG_ERROR_SECRET_DETECTED,
} from '../../core/knowledge/rag_error_codes.ts';

/**
 * Configuring an embedding model has to fix the documents that failed for
 * want of one. It used to fix nothing: each stayed `failed`, and the failure
 * text told the operator to configure a model "then retry indexing" — one
 * document at a time, by hand.
 *
 * What is asserted here is the SELECTION and the enqueue, because getting the
 * selection wrong is the expensive mistake in both directions: too narrow and
 * the stall persists, too wide and a document that failed on a secret or a
 * PII block gets silently retried on every config save.
 */

const { addJobInTx, emitHintInTx, readOrgEmbeddingConfig, corpus } = vi.hoisted(
  () => ({
    addJobInTx: vi.fn(),
    emitHintInTx: vi.fn(),
    readOrgEmbeddingConfig: vi.fn(),
    /** The organization's knowledge pool: `unsafe` answers the corpus read. */
    corpus: { unsafe: vi.fn() },
  }),
);

vi.mock('../../core/knowledge/connection.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../core/knowledge/connection.ts')
  >()),
  readOrgEmbeddingConfig,
}));

vi.mock('../../core/knowledge/pool.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/knowledge/pool.ts')>()),
  getKnowledgePoolForOrg: vi.fn(async () => corpus),
}));

vi.mock('../../jobs/enqueue.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../jobs/enqueue.ts')>()),
  addJobInTx,
}));

vi.mock('../../realtime/outbox.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../realtime/outbox.ts')>()),
  emitHintInTx,
}));

const { requeueDocumentsWithoutVectors, requeueEmbeddingBlockedDocuments } =
  await import('./service.ts');
const { HELD_BY_DOCUMENT_SQL } = await import('./status-hints.ts');

interface ReturnedRow {
  id: string;
  orgId: string;
  /** A document holds the file, so a document list shows its status. */
  listed: boolean;
}

const doc = (id: string): ReturnedRow => ({
  id,
  orgId: 'org-1',
  listed: true,
});
const attachment = (id: string): ReturnedRow => ({
  id,
  orgId: 'org-1',
  listed: false,
});

/** Captures the UPDATE and answers with the rows it "returned". */
function fakeSql(returned: ReturnedRow[]) {
  const statements: string[] = [];
  const values: unknown[][] = [];
  const tx = Object.assign(
    (strings: TemplateStringsArray, ...args: unknown[]) => {
      statements.push(strings.join('?'));
      values.push(args);
      return Promise.resolve(returned);
    },
    { unsafe: (raw: string) => raw },
  );
  return {
    statements,
    values,
    sql: {
      begin: (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    } as never,
  };
}

describe('requeueEmbeddingBlockedDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addJobInTx.mockResolvedValue(undefined);
    emitHintInTx.mockResolvedValue(undefined);
  });

  it('re-queues each blocked document and reports the count [KNOW-R10]', async () => {
    const { sql } = fakeSql([doc('f1'), doc('f2')]);

    const out = await requeueEmbeddingBlockedDocuments(sql, {
      organizationId: 'org-1',
    });

    expect(out).toEqual({ requeued: 2 });
    expect(
      addJobInTx.mock.calls.map(([, name, payload]) => [name, payload]),
    ).toEqual([
      ['rag.index_file', { fileId: 'f1' }],
      ['rag.index_file', { fileId: 'f2' }],
    ]);
  });

  it('selects on the error CODE, not merely on failed status [KNOW-R10]', async () => {
    const { sql, statements, values } = fakeSql([]);

    await requeueEmbeddingBlockedDocuments(sql, { organizationId: 'org-1' });

    const [statement] = statements;
    // Too wide would retry a secret-detected or PII-blocked document on
    // every save; too narrow leaves the stall in place.
    expect(statement).toContain('rag_error_code IN (');
    expect(statement).toContain("rag_status = 'failed'");
    // Every failure the embedding settings can cure: no model, a provider
    // refusing the account/credential or answering the wrong width, and a
    // provider that could not serve the call until the retries ran out (a
    // wrong endpoint reads that way). A save that fixes the endpoint used
    // to re-queue nothing, and the stalled file showed no Retry.
    expect(values[0]).toContain(RAG_ERROR_EMBEDDING_NOT_CONFIGURED);
    expect(values[0]).toContain(RAG_ERROR_EMBEDDING_PROVIDER_REFUSED);
    expect(values[0]).toContain(RAG_ERROR_EMBEDDING_UPSTREAM);
    expect(values[0]).not.toContain(RAG_ERROR_SECRET_DETECTED);
  });

  it('scopes to the organization and respects the skip flag [KNOW-R10]', async () => {
    const { sql, statements, values } = fakeSql([]);

    await requeueEmbeddingBlockedDocuments(sql, { organizationId: 'org-1' });

    expect(statements[0]).toContain('org_id =');
    expect(values[0]).toContain('org-1');
    // A document deliberately excluded from indexing must stay excluded.
    expect(statements[0]).toContain('skip_rag_indexing IS DISTINCT FROM true');
  });

  it('clears the stale failure so the UI stops showing it', async () => {
    const { sql, statements } = fakeSql([]);

    await requeueEmbeddingBlockedDocuments(sql, { organizationId: 'org-1' });

    // Leaving the old error text on a now-queued row reads as "queued AND
    // broken" in the document dialog.
    expect(statements[0]).toContain('rag_error = NULL');
    expect(statements[0]).toContain('rag_error_code = NULL');
    expect(statements[0]).toContain("rag_status = 'queued'");
  });

  it('enqueues nothing when no document was blocked', async () => {
    const { sql } = fakeSql([]);

    const out = await requeueEmbeddingBlockedDocuments(sql, {
      organizationId: 'org-1',
    });

    expect(out).toEqual({ requeued: 0 });
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(emitHintInTx).not.toHaveBeenCalled();
  });

  it('tells the document lists the rows moved, in the same transaction', async () => {
    const { sql } = fakeSql([doc('f1'), doc('f2')]);

    await requeueEmbeddingBlockedDocuments(sql, { organizationId: 'org-1' });

    // Without the hint every other viewer's list kept showing 'failed — no
    // embedding model' until the worker's first write per file, minutes
    // away behind a backlog. One org-wide hint (the list is keyed by
    // document, the status lives on the file row), never one per row.
    expect(emitHintInTx).toHaveBeenCalledTimes(1);
    expect(emitHintInTx.mock.calls[0]?.[1]).toEqual({
      orgId: 'org-1',
      entity: 'document',
      entityId: null,
    });
  });

  // Chat, task and email attachments fail on the embedding model too, and
  // no list shows them: a requeue of nothing else tells no one.
  it('tells no document list when only attachments were re-queued', async () => {
    const { sql, values } = fakeSql([attachment('f1'), attachment('f2')]);

    const out = await requeueEmbeddingBlockedDocuments(sql, {
      organizationId: 'org-1',
    });

    expect(out).toEqual({ requeued: 2 });
    expect(addJobInTx).toHaveBeenCalledTimes(2);
    // The write asks, per row, whether a document holds the file.
    expect(values[0]).toContain(HELD_BY_DOCUMENT_SQL);
    expect(emitHintInTx).not.toHaveBeenCalled();
  });

  it('tells the lists once when a listed row is among the attachments', async () => {
    const { sql } = fakeSql([attachment('f1'), doc('f2'), attachment('f3')]);

    await requeueEmbeddingBlockedDocuments(sql, { organizationId: 'org-1' });

    expect(emitHintInTx).toHaveBeenCalledTimes(1);
  });

  it('enqueues at default priority — a drain must not outrank an upload', async () => {
    const { sql } = fakeSql([doc('f1')]);

    await requeueEmbeddingBlockedDocuments(sql, { organizationId: 'org-1' });

    // Fourth argument is the enqueue options; a priority here would put a
    // whole backlog level with the file somebody is watching.
    expect(addJobInTx.mock.calls[0]?.[3]).toBeUndefined();
  });
});

/**
 * Vectors are kept per width. An organization that moves to a model of
 * another width has none of the new width on what it already indexed: every
 * document would stay findable by its words and be missing from search by
 * meaning until someone indexed it again, one at a time. The save does it.
 */
describe('requeueDocumentsWithoutVectors', () => {
  const ORG = { organizationId: 'org-1', orgSlug: 'acme' };
  const lacking = (...refs: string[]) =>
    corpus.unsafe.mockResolvedValue(refs.map((ref) => ({ ref })));

  beforeEach(() => {
    vi.clearAllMocks();
    addJobInTx.mockResolvedValue(undefined);
    emitHintInTx.mockResolvedValue(undefined);
    readOrgEmbeddingConfig.mockResolvedValue({
      providerSlug: 'local',
      model: 'embed',
      dimensions: 1024,
    });
    corpus.unsafe.mockResolvedValue([]);
  });

  it('asks the corpus for the indexed documents that have no vector of the stated width [KNOW-R17]', async () => {
    const { sql } = fakeSql([]);

    await requeueDocumentsWithoutVectors(sql, ORG);

    const [text, params] = corpus.unsafe.mock.calls[0] ?? [];
    expect(text).toContain("d.status = 'completed'");
    expect(text).toContain('FROM private_knowledge.chunk_vectors_1024 v');
    // A repeated passage has no vector at any width and is not a gap.
    expect(text).toContain('NOT c.passage_repeat');
    expect(params).toEqual(['acme']);
  });

  it('re-queues each such file and reports the count [KNOW-R17]', async () => {
    lacking('s3:a', 's3:b');
    const { sql, statements, values } = fakeSql([doc('f1'), doc('f2')]);

    const out = await requeueDocumentsWithoutVectors(sql, ORG);

    expect(out).toEqual({ requeued: 2 });
    expect(
      addJobInTx.mock.calls.map(([, name, payload]) => [name, payload]),
    ).toEqual([
      ['rag.index_file', { fileId: 'f1' }],
      ['rag.index_file', { fileId: 'f2' }],
    ]);
    // Only what reads as indexed, in this organization, by its ref: a file
    // in flight, one that failed and one opted out are left as they are.
    expect(statements[0]).toContain("fm.rag_status = 'completed'");
    expect(statements[0]).toContain('fm.storage_ref = ANY(');
    expect(statements[0]).toContain('skip_rag_indexing IS DISTINCT FROM true');
    expect(values[0]).toContain('org-1');
    expect(values[0]).toContainEqual(['s3:a', 's3:b']);
    expect(emitHintInTx).toHaveBeenCalledTimes(1);
  });

  // An email body is a message, not a file row: it has its own job.
  it('re-queues an email body through the message job [KNOW-R17]', async () => {
    lacking('msg:9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a', 's3:a');
    const { sql, values } = fakeSql([attachment('f1')]);

    const out = await requeueDocumentsWithoutVectors(sql, ORG);

    expect(out).toEqual({ requeued: 2 });
    expect(values[0]).toContainEqual(['s3:a']);
    expect(
      addJobInTx.mock.calls.map(([, name, payload]) => [name, payload]),
    ).toEqual([
      ['rag.index_file', { fileId: 'f1' }],
      [
        'rag.index_message',
        { messageId: '9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a' },
      ],
    ]);
  });

  it('writes no file row for a batch of email bodies alone', async () => {
    lacking('msg:9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a');
    const { sql, statements } = fakeSql([]);

    const out = await requeueDocumentsWithoutVectors(sql, ORG);

    expect(out).toEqual({ requeued: 1 });
    expect(statements).toEqual([]);
    expect(addJobInTx).toHaveBeenCalledTimes(1);
  });

  // The usual save: the width is the one the documents were indexed under.
  it('moves nothing when every indexed document has its vectors', async () => {
    const { sql, statements } = fakeSql([]);

    const out = await requeueDocumentsWithoutVectors(sql, ORG);

    expect(out).toEqual({ requeued: 0 });
    expect(statements).toEqual([]);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('reads no corpus while the organization has no embedding model', async () => {
    readOrgEmbeddingConfig.mockResolvedValue(null);
    const { sql } = fakeSql([]);

    const out = await requeueDocumentsWithoutVectors(sql, ORG);

    expect(out).toEqual({ requeued: 0 });
    expect(corpus.unsafe).not.toHaveBeenCalled();
  });

  it('works through a large corpus in bounded transactions', async () => {
    lacking(...Array.from({ length: 450 }, (_value, index) => `s3:${index}`));
    const { sql, statements, values } = fakeSql([]);

    await requeueDocumentsWithoutVectors(sql, ORG);

    expect(statements.length).toBe(3);
    const batches = values.map((args) =>
      args.find((arg): arg is string[] => Array.isArray(arg)),
    );
    expect(batches.map((batch) => batch?.length)).toEqual([200, 200, 50]);
  });
});
