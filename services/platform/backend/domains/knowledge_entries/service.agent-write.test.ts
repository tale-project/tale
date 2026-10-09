// @vitest-environment node

import type { Sql, TransactionSql } from 'postgres';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

/**
 * An agent's write of a fact by its topic (`upsertKnowledgeEntryByTopic`,
 * the lower half of the `knowledge_entry_write` workspace tool), around its
 * seams: the per-organization agent budget it is charged against, the blob
 * store it uploads to before the transaction, and the audit row and
 * realtime hint it leaves inside it. What is pinned is what an agent and a
 * person reading the knowledge base see: the source and author of a
 * version, the refusals that hand back the current text, and that nothing
 * is uploaded or charged for a write that writes nothing.
 */

const {
  addJobInTx,
  createAuditLog,
  emitDocumentChangeHints,
  limitRate,
  markRagQueued,
  resolveOrgSlug,
  store,
} = vi.hoisted(() => ({
  addJobInTx: vi.fn(),
  createAuditLog: vi.fn(),
  emitDocumentChangeHints: vi.fn(),
  limitRate: vi.fn(),
  markRagQueued: vi.fn(),
  resolveOrgSlug: vi.fn(),
  store: {
    resolveObjectStore: vi.fn(),
    buildObjectKey: vi.fn(),
    s3PresignPutUrl: vi.fn(),
  },
}));

vi.mock('../../jobs/enqueue.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../jobs/enqueue.ts')>()),
  addJobInTx,
}));
vi.mock('../knowledge/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../knowledge/service.ts')>()),
  markRagQueued,
}));
vi.mock('../../lib/org-config.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/org-config.ts')>()),
  resolveOrgSlug,
}));
vi.mock('../../lib/object-store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/object-store.ts')>()),
  ...store,
}));
vi.mock('../../lib/rate-limit.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/rate-limit.ts')>()),
  limitRate,
}));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../documents/hints.ts', () => ({ emitDocumentChangeHints }));

const {
  upsertKnowledgeEntryByTopic,
  listEntriesForAgent,
  KnowledgeEntryError,
} = await import('./service.ts');

interface Statement {
  text: string;
  values: unknown[];
}

interface TopicRow {
  id: string;
  topic: string;
  content: string;
  documentId: string | null;
  createdAt: number;
  documentActive?: boolean;
}

interface Script {
  /** The topic's current entry the read before the upload finds. */
  current?: TopicRow;
  /** What the read inside the transaction finds, when it differs. */
  currentInTx?: TopicRow | null;
  /** The blob ref the backing file carried before a rotation. */
  previousRef?: string;
}

/** A database double answering the statements the agent write issues, in
 * the shape each `RETURNING` expects, and recording every statement. */
function fakeSql(script: Script): {
  sql: Sql;
  statements: Statement[];
  transactions: () => number;
} {
  const statements: Statement[] = [];
  let reads = 0;
  let transactions = 0;
  const query = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    statements.push({ text, values });
    if (text.includes('SELECT id, topic, document_id')) {
      reads += 1;
      const row =
        reads > 1 && script.currentInTx !== undefined
          ? script.currentInTx
          : script.current;
      return Promise.resolve(row ? [{ documentActive: true, ...row }] : []);
    }
    if (text.includes('INSERT INTO app.knowledge_entries')) {
      return Promise.resolve([{ id: 'version-new' }]);
    }
    if (text.includes('INSERT INTO app.file_metadata')) {
      return Promise.resolve([{ id: 'file-1' }]);
    }
    if (text.includes('INSERT INTO app.documents')) {
      return Promise.resolve([{ id: 'doc-new' }]);
    }
    if (
      text.includes('UPDATE app.file_metadata') &&
      text.includes('RETURNING')
    ) {
      return Promise.resolve([{ id: 'file-1' }]);
    }
    if (text.includes('SELECT storage_ref')) {
      return Promise.resolve(
        script.previousRef !== undefined
          ? [{ storageRef: script.previousRef }]
          : [],
      );
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(query, {
    json: (value: unknown) => value,
    begin: (fn: (tx: TransactionSql) => Promise<unknown>) => {
      transactions += 1;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the double is the transaction
      return fn(query as unknown as TransactionSql);
    },
  });
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal Sql facade for the entry path
    sql: sql as unknown as Sql,
    statements,
    transactions: () => transactions,
  };
}

const ORG = 'org-1';
const AGENT = { organizationId: ORG, actorId: 'agent-7' };
const SUPPORT_HOURS: TopicRow = {
  id: 'version-1',
  topic: 'Support hours',
  content: 'Mon–Fri 9–17',
  documentId: 'doc-1',
  createdAt: 1_700_000_000_000,
};

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  vi.clearAllMocks();
  addJobInTx.mockResolvedValue(undefined);
  markRagQueued.mockResolvedValue(undefined);
  createAuditLog.mockResolvedValue(undefined);
  emitDocumentChangeHints.mockResolvedValue(undefined);
  limitRate.mockResolvedValue({ ok: true });
  resolveOrgSlug.mockResolvedValue('acme');
  store.resolveObjectStore.mockResolvedValue({ bucket: 'b' });
  store.buildObjectKey.mockReturnValue('acme/entry-blob');
  store.s3PresignPutUrl.mockResolvedValue('https://store.test/put');
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(null, { status: 200 }));
});

afterEach(() => {
  fetchSpy.mockRestore();
});

const inserted = (statements: Statement[]) =>
  statements.find((s) => s.text.includes('INSERT INTO app.knowledge_entries'));

describe('an agent adds a fact [KENTRY-R10]', () => {
  it('creates the entry under its topic, written by the agent with source agent', async () => {
    const { sql, statements } = fakeSql({});

    const written = await upsertKnowledgeEntryByTopic(sql, {
      ...AGENT,
      topic: '  Support   hours ',
      content: 'Mon–Fri 8–18',
    });

    expect(written).toEqual({
      outcome: 'created',
      versionId: 'version-new',
      documentId: 'doc-new',
      topic: 'Support   hours',
    });
    const row = inserted(statements);
    expect(row?.text).toContain("'agent'");
    expect(row?.values).toEqual(
      expect.arrayContaining([ORG, 'support hours', 'Mon–Fri 8–18', 'agent-7']),
    );
    // The topic's lock is taken inside the transaction, before its read.
    const lock = statements.findIndex((s) =>
      s.text.includes('pg_advisory_xact_lock'),
    );
    const reads = statements.flatMap((s, index) =>
      s.text.includes('SELECT id, topic, document_id') ? [index] : [],
    );
    expect(reads).toHaveLength(2);
    expect(lock).toBeGreaterThan(reads[0] ?? Infinity);
    expect(lock).toBeLessThan(reads[1] ?? -1);
    // No person stands behind the write: the audit trail names the agent.
    expect(createAuditLog).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      actorId: 'agent-7',
      actorType: 'api',
      action: 'knowledge_entry.created',
      category: 'data',
      resourceType: 'knowledge_entry',
      resourceId: 'version-new',
      resourceName: 'Support   hours',
      metadata: { viaAgent: true, documentId: 'doc-new' },
      status: 'success',
    });
    // An open Knowledge table refreshes from the hint, not from the indexer.
    expect(emitDocumentChangeHints).toHaveBeenCalledWith(expect.anything(), {
      orgId: ORG,
      entityId: 'doc-new',
      projectId: null,
    });
    expect(addJobInTx).toHaveBeenCalledWith(
      expect.anything(),
      'rag.index_file',
      { fileId: 'file-1' },
    );
  });

  it('writes a new version onto the version it read, keeping the topic spelling', async () => {
    const { sql, statements } = fakeSql({
      current: SUPPORT_HOURS,
      previousRef: 's3:acme/old-blob',
    });

    const written = await upsertKnowledgeEntryByTopic(sql, {
      ...AGENT,
      topic: 'SUPPORT HOURS',
      content: 'Mon–Fri 8–18',
      expectedVersionId: 'version-1',
    });

    expect(written).toEqual({
      outcome: 'updated',
      versionId: 'version-new',
      documentId: 'doc-1',
      topic: 'Support hours',
      previousVersionId: 'version-1',
    });
    expect(inserted(statements)?.values).toEqual(
      expect.arrayContaining(['Support hours', 'doc-1', 'agent-7']),
    );
    const supersede = statements.find((s) =>
      s.text.includes("status = 'superseded'"),
    );
    expect(supersede?.values).toEqual(
      expect.arrayContaining(['version-new', 'version-1']),
    );
    // The same document carries the new version; its old blob is released.
    expect(addJobInTx).toHaveBeenCalledWith(
      expect.anything(),
      'knowledge.release_refs',
      { organizationId: ORG, refs: ['s3:acme/old-blob'] },
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'knowledge_entry.updated',
        resourceId: 'version-new',
        metadata: {
          viaAgent: true,
          documentId: 'doc-1',
          previousVersionId: 'version-1',
        },
      }),
    );
  });

  it('writes nothing for a save that repeats the current text, whatever version it names', async () => {
    for (const expectedVersionId of [undefined, 'version-1', 'version-0']) {
      const { sql, statements, transactions } = fakeSql({
        current: SUPPORT_HOURS,
      });

      const written = await upsertKnowledgeEntryByTopic(sql, {
        ...AGENT,
        topic: 'support hours',
        content: ' Mon–Fri 9–17 ',
        ...(expectedVersionId !== undefined ? { expectedVersionId } : {}),
      });

      expect(written).toEqual({
        outcome: 'unchanged',
        versionId: 'version-1',
        documentId: 'doc-1',
        topic: 'Support hours',
      });
      expect(transactions()).toBe(0);
      expect(statements.some((s) => s.text.includes('INSERT'))).toBe(false);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(limitRate).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('refuses a topic over its limit before reading anything [KENTRY-R1]', async () => {
    const { sql, statements } = fakeSql({});
    await expect(
      upsertKnowledgeEntryByTopic(sql, {
        ...AGENT,
        topic: 't'.repeat(121),
        content: 'Too long a topic',
      }),
    ).rejects.toBeInstanceOf(KnowledgeEntryError);
    expect(statements).toEqual([]);
  });

  it('answers as not found when the document behind the entry is gone [KENTRY-R9]', async () => {
    const { sql } = fakeSql({
      current: { ...SUPPORT_HOURS, documentActive: false },
    });
    await expect(
      upsertKnowledgeEntryByTopic(sql, {
        ...AGENT,
        topic: 'Support hours',
        content: 'Mon–Fri 8–18',
        expectedVersionId: 'version-1',
      }),
    ).rejects.toMatchObject({
      code: 'KNOWLEDGE_ENTRY_NOT_FOUND',
      status: 404,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('an agent edit onto a fact it did not read [KENTRY-R12]', () => {
  const current = {
    versionId: 'version-1',
    topic: 'Support hours',
    content: 'Mon–Fri 9–17',
    updatedAt: 1_700_000_000_000,
  };

  it('refuses a change that names no version, handing back the current text', async () => {
    const { sql, transactions } = fakeSql({ current: SUPPORT_HOURS });

    expect(
      await upsertKnowledgeEntryByTopic(sql, {
        ...AGENT,
        topic: 'Support hours',
        content: 'Mon–Fri 8–18',
      }),
    ).toEqual({ outcome: 'refused', reason: 'version_required', current });
    expect(transactions()).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(limitRate).not.toHaveBeenCalled();
  });

  it('refuses a change onto a version that has been replaced', async () => {
    const { sql, transactions } = fakeSql({ current: SUPPORT_HOURS });

    expect(
      await upsertKnowledgeEntryByTopic(sql, {
        ...AGENT,
        topic: 'Support hours',
        content: 'Mon–Fri 8–18',
        expectedVersionId: 'version-0',
      }),
    ).toEqual({ outcome: 'refused', reason: 'version_conflict', current });
    expect(transactions()).toBe(0);
  });

  it('refuses a version of an entry deleted since, creating nothing', async () => {
    const { sql, statements } = fakeSql({});

    expect(
      await upsertKnowledgeEntryByTopic(sql, {
        ...AGENT,
        topic: 'Support hours',
        content: 'Mon–Fri 8–18',
        expectedVersionId: 'version-1',
      }),
    ).toEqual({ outcome: 'refused', reason: 'entry_gone', current: null });
    expect(statements.some((s) => s.text.includes('INSERT'))).toBe(false);
  });

  it('refuses inside the transaction when a person changed the fact after the first read, releasing the upload', async () => {
    const { sql, statements } = fakeSql({
      current: SUPPORT_HOURS,
      currentInTx: {
        ...SUPPORT_HOURS,
        id: 'version-2',
        content: 'Mon–Fri 8–17',
        createdAt: 1_700_000_100_000,
      },
    });

    expect(
      await upsertKnowledgeEntryByTopic(sql, {
        ...AGENT,
        topic: 'Support hours',
        content: 'Mon–Fri 8–18',
        expectedVersionId: 'version-1',
      }),
    ).toEqual({
      outcome: 'refused',
      reason: 'version_conflict',
      current: {
        versionId: 'version-2',
        topic: 'Support hours',
        content: 'Mon–Fri 8–17',
        updatedAt: 1_700_000_100_000,
      },
    });
    expect(inserted(statements)).toBeUndefined();
    expect(addJobInTx).toHaveBeenCalledWith(
      expect.anything(),
      'knowledge.release_refs',
      { organizationId: ORG, refs: ['s3:acme/entry-blob'] },
    );
    expect(createAuditLog).not.toHaveBeenCalled();
  });
});

describe('the agents’ own write budget [KENTRY-R13]', () => {
  it('charges a write against the organization’s agent budget, never the one people share', async () => {
    const { sql } = fakeSql({});
    await upsertKnowledgeEntryByTopic(sql, {
      ...AGENT,
      topic: 'Return window',
      content: '30 days',
    });
    expect(limitRate).toHaveBeenCalledTimes(1);
    expect(limitRate).toHaveBeenCalledWith(sql, 'knowledge:agent-write', {
      key: `org:${ORG}`,
    });
    // The charge comes before the upload: a refused write stores nothing.
    const chargedAt = limitRate.mock.invocationCallOrder[0] ?? Infinity;
    const uploadedAt = fetchSpy.mock.invocationCallOrder[0] ?? 0;
    expect(chargedAt).toBeLessThan(uploadedAt);
  });

  it('answers a spent budget with the time to wait, and writes nothing', async () => {
    limitRate.mockResolvedValue({ ok: false, retryAfter: 2_500 });
    const { sql, statements, transactions } = fakeSql({});

    expect(
      await upsertKnowledgeEntryByTopic(sql, {
        ...AGENT,
        topic: 'Return window',
        content: '30 days',
      }),
    ).toEqual({ outcome: 'rate_limited', retryAfterMs: 2_500 });
    expect(transactions()).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(statements.some((s) => s.text.includes('INSERT'))).toBe(false);
  });
});

describe('the agent-facing listing', () => {
  function listingSql(): { sql: Sql; statements: Statement[] } {
    const statements: Statement[] = [];
    const query = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      statements.push({ text, values });
      if (text.includes('min(created_at_ms)')) {
        return Promise.resolve([
          { documentId: 'doc-1', createdAt: 1_600_000_000_000 },
        ]);
      }
      return Promise.resolve([
        {
          id: 'version-3',
          topic: 'Support hours',
          content: 'Mon–Fri 8–18',
          source: 'agent',
          documentId: 'doc-1',
          createdBy: 'agent-7',
          createdAt: 1_700_000_000_000,
          seq: 12,
          ragStatus: null,
          ragIndexedAt: null,
          ragError: null,
          ragErrorCode: null,
        },
        {
          id: 'legacy-1',
          topic: 'Office',
          content: 'Spiez',
          source: 'manual',
          documentId: null,
          createdBy: 'u-1',
          createdAt: 1_650_000_000_000,
          seq: 4,
          ragStatus: null,
          ragIndexedAt: null,
          ragError: null,
          ragErrorCode: null,
        },
      ]);
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal Sql facade for the listing
    return { sql: query as unknown as Sql, statements };
  }

  it('names each entry’s current version and when it was first and last written', async () => {
    const { sql } = listingSql();
    const listed = await listEntriesForAgent(sql, {
      organizationId: ORG,
      numItems: 10,
      cursor: null,
    });
    expect(listed.page).toEqual([
      {
        id: 'version-3',
        topic: 'Support hours',
        content: 'Mon–Fri 8–18',
        source: 'agent',
        createdAt: 1_600_000_000_000,
        updatedAt: 1_700_000_000_000,
      },
      {
        id: 'legacy-1',
        topic: 'Office',
        content: 'Spiez',
        source: 'manual',
        createdAt: 1_650_000_000_000,
        updatedAt: 1_650_000_000_000,
      },
    ]);
  });

  it('looks in the content only when asked to', async () => {
    const topicsOnly = listingSql();
    await listEntriesForAgent(topicsOnly.sql, {
      organizationId: ORG,
      topic: 'opening hours',
      matchWords: true,
      numItems: 10,
      cursor: null,
    });
    const withContent = listingSql();
    await listEntriesForAgent(withContent.sql, {
      organizationId: ORG,
      topic: 'opening hours',
      matchWords: true,
      matchContent: true,
      numItems: 10,
      cursor: null,
    });
    const page = (statements: Statement[]) => statements[0];
    expect(page(topicsOnly.statements)?.text).toContain('lower(ke.content)');
    // The content clause is in the statement either way; its switch is the
    // bound flag, false for the chat legs and true for the agents' find.
    const flagOf = (statement: Statement | undefined): unknown => {
      if (statement === undefined) return undefined;
      const clause = statement.text
        .split('?')
        .findIndex((part) => part.includes('lower(ke.content)'));
      return statement.values[clause - 1];
    };
    expect(flagOf(page(topicsOnly.statements))).toBe(false);
    expect(flagOf(page(withContent.statements))).toBe(true);
  });
});
