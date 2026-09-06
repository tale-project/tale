// @vitest-environment node

import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RAG_ERROR_INDEX_REBUILDING,
  RAG_ERROR_INDEX_REPAIR_FAILED,
} from '../../core/knowledge/rag_error_codes.ts';

/**
 * The production effects' SQL — what the requeue SELECTS, what the
 * re-stamp WRITES, and the delay a re-scheduled rebuild carries. The state
 * machine above them is tested with spies; this is the one place the
 * statements themselves are pinned, because getting the selection wrong
 * strands files in one direction and retries unrelated failures in the
 * other.
 */

const { addJobInTx, emitHintInTx, resolveOrgUrl } = vi.hoisted(() => ({
  addJobInTx: vi.fn(),
  emitHintInTx: vi.fn(),
  resolveOrgUrl: vi.fn(),
}));

vi.mock('../../jobs/enqueue.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../jobs/enqueue.ts')>()),
  addJobInTx,
}));
vi.mock('../../realtime/outbox.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../realtime/outbox.ts')>()),
  emitHintInTx,
}));
vi.mock('../../core/knowledge/pool.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/knowledge/pool.ts')>()),
  resolveOrgUrl,
}));

const { productionEffects } = await import('./index-health.ts');

interface Statement {
  text: string;
  values: unknown[];
}

/** A `sql` double: the org lookup answers one organization; the parked-file
 * UPDATE answers `parked` rows on its first call and none after. */
function fakeSql(parked: { id: string; orgId: string }[]) {
  const statements: Statement[] = [];
  let updates = 0;
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    statements.push({ text, values });
    if (text.includes('FROM "organization"')) {
      return Promise.resolve([{ id: 'org-1', slug: 'acme' }]);
    }
    if (text.includes('UPDATE app.file_metadata')) {
      updates += 1;
      return Promise.resolve(updates === 1 ? parked : []);
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(fn, {
    begin: (run: (tx: TransactionSql) => Promise<unknown>) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the double is the transaction
      run(fn as unknown as TransactionSql),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal Sql facade
  return { sql: sql as unknown as Sql, statements };
}

const URL = 'postgresql://tale:pw@knowledge-db:5432/tale_knowledge';
const PK = {
  schema: 'private_knowledge',
  name: 'idx_pk_chunks_bm25',
  sizeBytes: 1,
  valid: true,
};
const ORG_SCOPE = { kind: 'org', orgSlug: 'acme' } as const;

beforeEach(() => {
  vi.clearAllMocks();
  addJobInTx.mockResolvedValue(undefined);
  emitHintInTx.mockResolvedValue(undefined);
  resolveOrgUrl.mockResolvedValue(URL);
});

describe('requeueRefused', () => {
  it('re-queues files parked under BOTH index codes, then hints the org', async () => {
    const { sql, statements } = fakeSql([
      { id: 'f1', orgId: 'org-1' },
      { id: 'f2', orgId: 'org-1' },
    ]);

    const requeued = await productionEffects(sql).requeueRefused(
      ORG_SCOPE,
      URL,
    );

    expect(requeued).toBe(2);
    const update = statements.find((s) =>
      s.text.includes('UPDATE app.file_metadata'),
    );
    // A healthy index resumes what a rebuild parked AND what a failed repair
    // parked — an operator's REINDEX fixes both, and a row left under the
    // failed code would wait for a manual retry the prose no longer asks for.
    const codes = update?.values.find(
      (value): value is string[] =>
        Array.isArray(value) && value.includes(RAG_ERROR_INDEX_REBUILDING),
    );
    expect(codes).toEqual([
      RAG_ERROR_INDEX_REBUILDING,
      RAG_ERROR_INDEX_REPAIR_FAILED,
    ]);
    expect(update?.text).toContain("rag_status = 'queued'");
    expect(update?.text).toContain('rag_error_code = NULL');
    expect(
      addJobInTx.mock.calls.map(([, name, payload]) => [name, payload]),
    ).toEqual([
      ['rag.index_file', { fileId: 'f1' }],
      ['rag.index_file', { fileId: 'f2' }],
    ]);
    expect(emitHintInTx).toHaveBeenCalledTimes(1);
    expect(emitHintInTx.mock.calls[0]?.[1]).toEqual({
      orgId: 'org-1',
      entity: 'document',
      entityId: null,
    });
  });
});

describe('failRefused', () => {
  it('re-stamps the files parked as rebuilding with the operator code and prose', async () => {
    const { sql, statements } = fakeSql([{ id: 'f1', orgId: 'org-1' }]);

    const stamped = await productionEffects(sql).failRefused(
      ORG_SCOPE,
      URL,
      PK,
    );

    expect(stamped).toBe(1);
    const update = statements.find((s) =>
      s.text.includes('UPDATE app.file_metadata'),
    );
    expect(update?.values).toContain(RAG_ERROR_INDEX_REPAIR_FAILED);
    expect(update?.values).toContain(RAG_ERROR_INDEX_REBUILDING);
    expect(
      update?.values.some(
        (value) =>
          typeof value === 'string' &&
          value.includes('REINDEX INDEX private_knowledge.idx_pk_chunks_bm25'),
      ),
    ).toBe(true);
    // Only rows still promising an automatic resumption are re-stamped.
    expect(update?.text).toContain('WHERE rag_error_code =');
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(emitHintInTx).toHaveBeenCalledTimes(1);
  });
});

describe('scheduleRebuild', () => {
  it('defers the job by the requested delay under the same singleton key', async () => {
    const { sql } = fakeSql([]);
    const before = Date.now();

    await productionEffects(sql).scheduleRebuild(ORG_SCOPE, PK, {
      delayMs: 300_000,
    });

    const options = addJobInTx.mock.calls[0]?.[3] as {
      singletonKey?: string;
      startAfter?: Date;
    };
    expect(options.singletonKey).toBe(
      'acme:private_knowledge.idx_pk_chunks_bm25',
    );
    expect(options.startAfter?.getTime()).toBeGreaterThanOrEqual(
      before + 300_000,
    );
  });

  it('queues an immediate rebuild without a start time', async () => {
    const { sql } = fakeSql([]);

    await productionEffects(sql).scheduleRebuild(ORG_SCOPE, PK);

    expect(addJobInTx.mock.calls[0]?.[3]).toEqual({
      singletonKey: 'acme:private_knowledge.idx_pk_chunks_bm25',
    });
  });
});

describe('resumeRefused', () => {
  it('re-queues for every organization whose corpus resolves to that database', async () => {
    const { sql } = fakeSql([{ id: 'f1', orgId: 'org-1' }]);

    const requeued = await productionEffects(sql).resumeRefused(URL);

    // Decided by the same resolver the pool routes through, never by a
    // scope the write guard does not have.
    expect(resolveOrgUrl).toHaveBeenCalledWith('acme');
    expect(requeued).toBe(1);
    expect(addJobInTx).toHaveBeenCalledWith(
      expect.anything(),
      'rag.index_file',
      { fileId: 'f1' },
    );
  });

  it('touches no organization whose corpus lives elsewhere', async () => {
    const { sql, statements } = fakeSql([{ id: 'f1', orgId: 'org-1' }]);
    resolveOrgUrl.mockResolvedValue('postgresql://elsewhere/corpus');

    const requeued = await productionEffects(sql).resumeRefused(URL);

    expect(requeued).toBe(0);
    expect(
      statements.some((s) => s.text.includes('UPDATE app.file_metadata')),
    ).toBe(false);
  });
});
