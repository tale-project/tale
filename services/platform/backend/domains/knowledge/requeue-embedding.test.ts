// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RAG_ERROR_EMBEDDING_NOT_CONFIGURED } from '../../core/knowledge/rag_error_codes.ts';

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

const { addJobInTx, emitHintInTx } = vi.hoisted(() => ({
  addJobInTx: vi.fn(),
  emitHintInTx: vi.fn(),
}));

vi.mock('../../jobs/enqueue.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../jobs/enqueue.ts')>()),
  addJobInTx,
}));

vi.mock('../../realtime/outbox.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../realtime/outbox.ts')>()),
  emitHintInTx,
}));

const { requeueEmbeddingBlockedDocuments } = await import('./service.ts');

/** Captures the UPDATE and answers with the rows it "returned". */
function fakeSql(returned: Array<{ id: string }>) {
  const statements: string[] = [];
  const values: unknown[][] = [];
  const tx = (strings: TemplateStringsArray, ...args: unknown[]) => {
    statements.push(strings.join('?'));
    values.push(args);
    return Promise.resolve(returned);
  };
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

  it('re-queues each blocked document and reports the count', async () => {
    const { sql } = fakeSql([{ id: 'f1' }, { id: 'f2' }]);

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

  it('selects on the error CODE, not merely on failed status', async () => {
    const { sql, statements, values } = fakeSql([]);

    await requeueEmbeddingBlockedDocuments(sql, { organizationId: 'org-1' });

    const [statement] = statements;
    // Too wide would retry a secret-detected or PII-blocked document on
    // every save; too narrow leaves the stall in place.
    expect(statement).toContain('rag_error_code =');
    expect(statement).toContain("rag_status = 'failed'");
    expect(values[0]).toContain(RAG_ERROR_EMBEDDING_NOT_CONFIGURED);
  });

  it('scopes to the organization and respects the skip flag', async () => {
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
    const { sql } = fakeSql([{ id: 'f1' }, { id: 'f2' }]);

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

  it('enqueues at default priority — a drain must not outrank an upload', async () => {
    const { sql } = fakeSql([{ id: 'f1' }]);

    await requeueEmbeddingBlockedDocuments(sql, { organizationId: 'org-1' });

    // Fourth argument is the enqueue options; a priority here would put a
    // whole backlog level with the file somebody is watching.
    expect(addJobInTx.mock.calls[0]?.[3]).toBeUndefined();
  });
});
