// @vitest-environment node

/**
 * The agent document upsert converges concurrent runs on ONE row. Its
 * SELECT … FOR UPDATE cannot lock a row that is not there, so two runs both
 * missed and both inserted — and every later refresh updated only the
 * oldest, leaving the twin in listings and RAG forever. The key is unique in
 * the schema now (0073); the insert is `ON CONFLICT DO NOTHING`, and a run
 * that loses the insert race refreshes the winner's row instead. The live
 * race rides the integration check; this double locks the statement shape
 * and the lost-race path.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAuditLog } from '../audit_logs/service.ts';
import { upsertAgentDocument } from './agent-write.ts';

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../files/service.ts', () => ({
  putOrgBlobBytes: vi.fn(),
  registerUploadedBytes: vi.fn(),
}));
vi.mock('../knowledge/service.ts', () => ({ markRagQueued: vi.fn() }));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));

interface Statement {
  text: string;
  values: unknown[];
}

function fakeUpsert(script: {
  lookups: { id: string; record: Record<string, unknown> | null }[][];
  inserts: { id: string }[][];
}): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('SELECT content_hash')) {
      return Promise.resolve([{ contentHash: 'sha-1' }]);
    }
    if (text.startsWith('SELECT id, record FROM app.documents')) {
      return Promise.resolve(script.lookups.shift() ?? []);
    }
    if (text.startsWith('INSERT INTO app.documents')) {
      return Promise.resolve(script.inserts.shift() ?? []);
    }
    return Promise.resolve([]);
  };
  const sql = {
    begin: (callback: (t: typeof tx) => unknown): unknown => callback(tx),
  } as unknown as Sql;
  return { sql, statements };
}

const args = {
  organizationId: 'org_1',
  externalItemId: 'agent:report.md',
  title: 'report.md',
  fileRef: 's3:acme/blob-1',
  mimeType: 'text/markdown',
  createdBy: 'agent-1',
  auditActorId: 'user-1',
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('upsertAgentDocument', () => {
  it('inserts with an ON CONFLICT claim on the unique key', async () => {
    const fake = fakeUpsert({ lookups: [[]], inserts: [[{ id: 'doc-1' }]] });

    const result = await upsertAgentDocument(fake.sql, args);

    expect(result).toEqual({ documentId: 'doc-1', action: 'created' });
    const insert = fake.statements.find((s) =>
      s.text.startsWith('INSERT INTO app.documents'),
    );
    expect(insert?.text).toContain(
      'ON CONFLICT (org_id, external_item_id) WHERE external_item_id IS NOT NULL DO NOTHING',
    );
    expect(insert?.text).toContain('RETURNING id');
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'document.created',
        resourceId: 'doc-1',
      }),
    );
  });

  it('refreshes the winner row when a concurrent run inserted first', async () => {
    const fake = fakeUpsert({
      // Nothing on the first locked read; the winner's row on the re-read.
      lookups: [[], [{ id: 'doc-winner', record: null }]],
      // The insert conflicted — no row back.
      inserts: [[]],
    });

    const result = await upsertAgentDocument(fake.sql, args);

    expect(result).toEqual({ documentId: 'doc-winner', action: 'updated' });
    const lookups = fake.statements.filter((s) =>
      s.text.startsWith('SELECT id, record FROM app.documents'),
    );
    expect(lookups).toHaveLength(2);
    for (const lookup of lookups) expect(lookup.text).toContain('FOR UPDATE');
    const update = fake.statements.find((s) =>
      s.text.startsWith('UPDATE app.documents'),
    );
    expect(update?.values).toContain('doc-winner');
    expect(update?.values).toContain('s3:acme/blob-1');
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'document.updated',
        resourceId: 'doc-winner',
      }),
    );
  });

  it('refreshes an existing row (any lifecycle) without inserting', async () => {
    const fake = fakeUpsert({
      lookups: [[{ id: 'doc-1', record: null }]],
      inserts: [],
    });

    const result = await upsertAgentDocument(fake.sql, args);

    expect(result).toEqual({ documentId: 'doc-1', action: 'updated' });
    expect(
      fake.statements.some((s) =>
        s.text.startsWith('INSERT INTO app.documents'),
      ),
    ).toBe(false);
    const lookup = fake.statements.find((s) =>
      s.text.startsWith('SELECT id, record FROM app.documents'),
    );
    expect(lookup?.text).not.toContain('lifecycle_status');
  });
});
