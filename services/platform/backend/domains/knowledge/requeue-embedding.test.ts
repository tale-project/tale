// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PII_SCAN_FAILED_REASONS } from '../../core/knowledge/indexing.ts';
import {
  RAG_ERROR_EMBEDDING_NOT_CONFIGURED,
  RAG_ERROR_EMBEDDING_PROVIDER_REFUSED,
  RAG_ERROR_EMBEDDING_UPSTREAM,
  RAG_ERROR_PII_BLOCKED,
  RAG_ERROR_PII_SCAN_FAILED,
  RAG_ERROR_SECRET_DETECTED,
} from '../../core/knowledge/rag_error_codes.ts';
import { ORG_CONFIG_CACHE_TTL_MS } from '../../lib/org-config.ts';

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

const {
  embeddingMovedSince,
  requeueDocumentsNotEmbeddedByModel,
  requeueEmbeddingBlockedDocuments,
  requeuePiiScanFailedDocuments,
  stampUnrecordedEmbeddingModel,
} = await import('./service.ts');
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
describe('requeueDocumentsNotEmbeddedByModel', () => {
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

    await requeueDocumentsNotEmbeddedByModel(sql, ORG);

    const [text, params] = corpus.unsafe.mock.calls[0] ?? [];
    expect(text).toContain("d.status = 'completed'");
    expect(text).toContain('FROM private_knowledge.chunk_vectors_1024 v');
    // A repeated passage has no vector at any width and is not a gap.
    expect(text).toContain('NOT c.passage_repeat');
    expect(params).toEqual(['acme', 'embed']);
  });

  // Another model of the same width: every chunk has a vector, and only the
  // model the row records tells them apart. A row that records none passes
  // for the model stated (`<>` never picks NULL).
  it('asks for the indexed documents another model embedded, too [KNOW-R17]', async () => {
    const { sql } = fakeSql([]);

    await requeueDocumentsNotEmbeddedByModel(sql, ORG);

    const [text, params] = corpus.unsafe.mock.calls[0] ?? [];
    expect(text).toMatch(/\(d\.embedding_model <> \$2\s+OR EXISTS \(/);
    expect(params?.[1]).toBe('embed');
  });

  it('re-queues each such file and reports the count [KNOW-R17]', async () => {
    lacking('s3:a', 's3:b');
    const { sql, statements, values } = fakeSql([doc('f1'), doc('f2')]);

    const out = await requeueDocumentsNotEmbeddedByModel(sql, ORG);

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

    const out = await requeueDocumentsNotEmbeddedByModel(sql, ORG);

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

    const out = await requeueDocumentsNotEmbeddedByModel(sql, ORG);

    expect(out).toEqual({ requeued: 1 });
    expect(statements).toEqual([]);
    expect(addJobInTx).toHaveBeenCalledTimes(1);
  });

  // The usual save: the width is the one the documents were indexed under.
  it('moves nothing when every indexed document has its vectors', async () => {
    const { sql, statements } = fakeSql([]);

    const out = await requeueDocumentsNotEmbeddedByModel(sql, ORG);

    expect(out).toEqual({ requeued: 0 });
    expect(statements).toEqual([]);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('reads no corpus while the organization has no embedding model', async () => {
    readOrgEmbeddingConfig.mockResolvedValue(null);
    const { sql } = fakeSql([]);

    const out = await requeueDocumentsNotEmbeddedByModel(sql, ORG);

    expect(out).toEqual({ requeued: 0 });
    expect(corpus.unsafe).not.toHaveBeenCalled();
  });

  it('works through a large corpus in bounded transactions', async () => {
    lacking(...Array.from({ length: 450 }, (_value, index) => `s3:${index}`));
    const { sql, statements, values } = fakeSql([]);

    await requeueDocumentsNotEmbeddedByModel(sql, ORG);

    expect(statements.length).toBe(3);
    const batches = values.map((args) =>
      args.find((arg): arg is string[] => Array.isArray(arg)),
    );
    expect(batches.map((batch) => batch?.length)).toEqual([200, 200, 50]);
  });
});

describe('stampUnrecordedEmbeddingModel', () => {
  /**
   * The organization's corpus rows by ref, and the model each records
   * (`null`: none). Answers the page read and the stamp the way the corpus
   * does; a ref in `gone` is claimed or released by another run between the
   * read of its page and the stamp, so the stamp passes it over.
   */
  function unrecorded(refs: string[], gone: ReadonlySet<string> = new Set()) {
    const recorded = new Map<string, string | null>(
      refs.map((ref) => [ref, null]),
    );
    corpus.unsafe.mockImplementation(
      async (text: string, params: unknown[] = []) => {
        if (text.includes('SELECT file_id AS ref')) {
          const after = String(params[1]);
          return [...recorded]
            .filter(([ref, model]) => model === null && ref > after)
            .map(([ref]) => ref)
            .sort()
            .slice(0, 200)
            .map((ref) => ({ ref }));
        }
        if (text.includes('SET embedding_model')) {
          const stamped: { ref: string }[] = [];
          for (const ref of params[2] as string[]) {
            if (gone.has(ref) || recorded.get(ref) !== null) continue;
            recorded.set(ref, String(params[1]));
            stamped.push({ ref });
          }
          return stamped;
        }
        return [];
      },
    );
    return recorded;
  }
  const refs = (n: number) =>
    Array.from({ length: n }, (_value, index) => `s3:${1000 + index}`);

  beforeEach(() => {
    vi.clearAllMocks();
    readOrgEmbeddingConfig.mockResolvedValue({
      providerSlug: 'local',
      model: 'embed',
      dimensions: 1024,
    });
  });

  it('stamps the documents that record no model with the model stated now [KNOW-R17]', async () => {
    const recorded = unrecorded(['s3:a', 's3:b']);

    const out = await stampUnrecordedEmbeddingModel('acme');

    expect(out).toEqual({ stamped: 2 });
    expect([...recorded.values()]).toEqual(['embed', 'embed']);
    const statements = corpus.unsafe.mock.calls.map(([text]) => String(text));
    // Only this organization's rows, and only those that record nothing:
    // a stamped row keeps the model that embedded it.
    for (const text of statements) {
      expect(text).toContain('org_slug = $1');
      expect(text).toContain('embedding_model IS NULL');
    }
  });

  it('stamps a model no longer known when none is stated [KNOW-R17]', async () => {
    readOrgEmbeddingConfig.mockResolvedValue(null);
    const recorded = unrecorded(['s3:a']);

    await stampUnrecordedEmbeddingModel('acme');

    expect(recorded.get('s3:a')).toBe('');
  });

  it('stamps a model no longer known when the settings do not read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    readOrgEmbeddingConfig.mockRejectedValue(new Error('not valid JSON'));
    const recorded = unrecorded(['s3:a']);

    await stampUnrecordedEmbeddingModel('acme');

    expect(recorded.get('s3:a')).toBe('');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('works through a large corpus a page at a time, reading no row twice', async () => {
    const recorded = unrecorded(refs(407));

    const out = await stampUnrecordedEmbeddingModel('acme');

    expect(out).toEqual({ stamped: 407 });
    expect([...recorded.values()].every((model) => model === 'embed')).toBe(
      true,
    );
    const reads = corpus.unsafe.mock.calls.filter(([text]) =>
      String(text).includes('SELECT file_id AS ref'),
    );
    expect(reads.map(([, params]) => (params as unknown[])[1])).toEqual([
      '',
      's3:1199',
      's3:1399',
    ]);
    expect(String(reads[0]?.[0])).toContain('LIMIT 200');
  });

  // Rows another run claimed or released while the page was read are no
  // sign that the corpus ends there: the walk goes on to the next page.
  it('goes on past a page whose rows changed meanwhile', async () => {
    const recorded = unrecorded(
      refs(450),
      new Set(['s3:1003', 's3:1050', 's3:1150']),
    );

    const out = await stampUnrecordedEmbeddingModel('acme');

    expect(out).toEqual({ stamped: 447 });
    expect(recorded.get('s3:1449')).toBe('embed');
  });
});

describe('embeddingMovedSince', () => {
  const EMBEDDED = {
    providerSlug: 'local',
    model: 'embed',
    dimensions: 1024,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is a move when the settings name another model or another width [KNOW-R17]', async () => {
    readOrgEmbeddingConfig.mockResolvedValueOnce({
      ...EMBEDDED,
      model: 'embed-2',
    });
    expect(await embeddingMovedSince('acme', EMBEDDED)).toBe(true);
    readOrgEmbeddingConfig.mockResolvedValueOnce({
      ...EMBEDDED,
      dimensions: 1536,
    });
    expect(await embeddingMovedSince('acme', EMBEDDED)).toBe(true);
  });

  // The same model through another provider makes the same vectors.
  it('is no move when only the provider changed [KNOW-R17]', async () => {
    readOrgEmbeddingConfig.mockResolvedValueOnce({
      ...EMBEDDED,
      providerSlug: 'gateway',
    });
    expect(await embeddingMovedSince('acme', EMBEDDED)).toBe(false);
  });

  it('is no move when the model was removed or its settings do not read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    readOrgEmbeddingConfig.mockResolvedValueOnce(null);
    expect(await embeddingMovedSince('acme', EMBEDDED)).toBe(false);
    readOrgEmbeddingConfig.mockRejectedValueOnce(new Error('not valid JSON'));
    expect(await embeddingMovedSince('acme', EMBEDDED)).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('requeuePiiScanFailedDocuments', () => {
  const ORG = { organizationId: 'org-1', orgSlug: 'acme' };
  const BODY = '9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a';

  beforeEach(() => {
    vi.clearAllMocks();
    addJobInTx.mockResolvedValue(undefined);
    emitHintInTx.mockResolvedValue(undefined);
    corpus.unsafe.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-queues the files the policy could not scan, and only those [KNOW-R9]', async () => {
    const { sql, statements, values } = fakeSql([doc('f1'), attachment('f2')]);

    const out = await requeuePiiScanFailedDocuments(sql, ORG);

    expect(out).toEqual({ requeued: 2 });
    // A detection (`pii_blocked`) is the policy doing its work: a save never
    // retries it, nor a file that failed for another reason or opted out.
    expect(statements[0]).toContain("fm.rag_status = 'failed'");
    expect(statements[0]).toContain('fm.rag_error_code = ?');
    expect(statements[0]).toContain('skip_rag_indexing IS DISTINCT FROM true');
    expect(values[0]).toContain('org-1');
    expect(values[0]).toContain(RAG_ERROR_PII_SCAN_FAILED);
    expect(values[0]).not.toContain(RAG_ERROR_PII_BLOCKED);
    expect(
      addJobInTx.mock.calls.map(([, name, payload]) => [name, payload]),
    ).toEqual([
      ['rag.index_file', { fileId: 'f1' }],
      ['rag.index_file', { fileId: 'f2' }],
    ]);
    expect(emitHintInTx).toHaveBeenCalledTimes(1);
  });

  // An email body has no file row to carry a code: its corpus row is found
  // by the sentence its refusal stored, and its own job is queued.
  it('re-queues an email body it could not scan through the message job [KNOW-R9]', async () => {
    corpus.unsafe.mockResolvedValue([{ ref: `msg:${BODY}` }]);
    const { sql } = fakeSql([]);

    const out = await requeuePiiScanFailedDocuments(sql, ORG);

    expect(out).toEqual({ requeued: 1 });
    const [text, params] = corpus.unsafe.mock.calls[0] ?? [];
    expect(text).toContain("status = 'failed'");
    // Both causes, and no bound: the save queues all it could not scan.
    expect(params).toEqual([
      'acme',
      'msg:%',
      Object.values(PII_SCAN_FAILED_REASONS),
      null,
    ]);
    expect(
      addJobInTx.mock.calls.map(([, name, payload]) => [name, payload]),
    ).toEqual([['rag.index_message', { messageId: BODY }]]);
  });

  // The pass that resumes these scans on its own takes only the documents
  // refused because the protection could not start: a part that could not
  // be scanned whole fails again for the same text and policy.
  it('keeps the documents refused for one cause when asked to [KNOW-R9]', async () => {
    corpus.unsafe.mockResolvedValue([{ ref: `msg:${BODY}` }]);
    const { sql, values } = fakeSql([doc('f1')]);

    const out = await requeuePiiScanFailedDocuments(sql, ORG, {
      cause: 'unavailable',
    });

    expect(out).toEqual({ requeued: 2 });
    expect(values[0]).toContainEqual([PII_SCAN_FAILED_REASONS.unavailable]);
    expect(values[0]).not.toContainEqual(
      expect.arrayContaining([PII_SCAN_FAILED_REASONS.incomplete]),
    );
    const [, params] = corpus.unsafe.mock.calls[0] ?? [];
    expect(params).toEqual([
      'acme',
      'msg:%',
      [PII_SCAN_FAILED_REASONS.unavailable],
      null,
    ]);
  });

  it('matches the files by their code alone when no cause is named', async () => {
    const { sql, values } = fakeSql([]);

    await requeuePiiScanFailedDocuments(sql, ORG);

    for (const reason of Object.values(PII_SCAN_FAILED_REASONS)) {
      expect(values[0]).not.toContainEqual(expect.arrayContaining([reason]));
    }
  });

  it('queues no more than its limit, files first [KNOW-R9]', async () => {
    corpus.unsafe.mockResolvedValue([{ ref: `msg:${BODY}` }]);
    const { sql, statements, values } = fakeSql([doc('f1'), doc('f2')]);

    const out = await requeuePiiScanFailedDocuments(sql, ORG, { limit: 3 });

    expect(out).toEqual({ requeued: 3 });
    expect(statements[0]).toContain('LIMIT ?');
    expect(values[0]).toContain(3);
    // The bodies get what the files left of the limit.
    const [text, params] = corpus.unsafe.mock.calls[0] ?? [];
    expect(text).toContain('LIMIT $4');
    expect(params).toEqual([
      'acme',
      'msg:%',
      Object.values(PII_SCAN_FAILED_REASONS),
      1,
    ]);
  });

  it('reads no email body when the files took the whole limit', async () => {
    const { sql } = fakeSql([doc('f1'), doc('f2')]);

    const out = await requeuePiiScanFailedDocuments(sql, ORG, { limit: 2 });

    expect(out).toEqual({ requeued: 2 });
    expect(corpus.unsafe).not.toHaveBeenCalled();
  });

  // A body has no status row to flip: its corpus row reads Failed until its
  // job claims it, so only the job says it is queued already.
  it('leaves out the email bodies whose job still waits or runs when asked to [KNOW-R9]', async () => {
    const QUEUED = BODY;
    const REFUSED = `${BODY.slice(0, -3)}999`;
    corpus.unsafe.mockResolvedValue([
      { ref: `msg:${QUEUED}` },
      { ref: `msg:${REFUSED}` },
    ]);
    const fake = fakeSql([]);
    const asked: { text: string; values: unknown[] }[] = [];
    const sql = Object.assign(
      (strings: TemplateStringsArray, ...args: unknown[]) => {
        asked.push({ text: strings.join('?'), values: args });
        return Promise.resolve([{ messageId: QUEUED }]);
      },
      fake.sql as object,
    ) as never;

    const out = await requeuePiiScanFailedDocuments(sql, ORG, {
      skipQueuedBodies: true,
    });

    expect(out).toEqual({ requeued: 1 });
    expect(
      addJobInTx.mock.calls.map(([, name, payload]) => [name, payload]),
    ).toEqual([['rag.index_message', { messageId: REFUSED }]]);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.text).toContain('FROM pgboss.job');
    // A running job counts too: a second one would scan the body beside
    // it, and if it refuses the body again, the next pass sees that.
    expect(asked[0]?.values).toEqual([true, [QUEUED, REFUSED]]);
  });

  it('waits out the policy cache before any job runs [KNOW-R9]', async () => {
    // A replica still holding the policy from before the save would scan
    // with it, and could refuse the document again.
    vi.useFakeTimers({
      now: new Date('2026-10-31T12:00:00Z'),
      toFake: ['Date'],
    });
    corpus.unsafe.mockResolvedValue([{ ref: `msg:${BODY}` }]);
    const { sql } = fakeSql([doc('f1')]);

    await requeuePiiScanFailedDocuments(sql, ORG);

    const startAfter = new Date(
      Date.parse('2026-10-31T12:00:00Z') + ORG_CONFIG_CACHE_TTL_MS,
    );
    expect(addJobInTx.mock.calls.map(([, , , options]) => options)).toEqual([
      { startAfter },
      { startAfter },
    ]);
  });

  it('queues many email bodies in bounded transactions', async () => {
    corpus.unsafe.mockResolvedValue(
      Array.from({ length: 450 }, (_value, index) => ({
        ref: `msg:${BODY.slice(0, -3)}${String(index).padStart(3, '0')}`,
      })),
    );
    const fake = fakeSql([]);
    const begin = vi.spyOn(
      fake.sql as unknown as {
        begin: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
      },
      'begin',
    );

    const out = await requeuePiiScanFailedDocuments(fake.sql, ORG);

    expect(out).toEqual({ requeued: 450 });
    // The files' transaction, then 200 + 200 + 50 bodies.
    expect(begin).toHaveBeenCalledTimes(4);
    expect(addJobInTx).toHaveBeenCalledTimes(450);
  });
});
