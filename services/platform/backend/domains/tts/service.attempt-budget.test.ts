import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ledger: vi.fn(async () => undefined),
  blobs: vi.fn(async () => undefined),
}));
vi.mock('../governance/service.ts', () => ({
  incrementUsageLedger: mocks.ledger,
}));
vi.mock('../files/service.ts', () => ({
  deleteOrgBlobRefs: mocks.blobs,
  putOrgBlobBytes: vi.fn(),
}));
vi.mock('../../jobs/enqueue.ts', () => ({
  addJobInTx: vi.fn(async () => 'job'),
}));
vi.mock('../../lib/rate-limit.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../lib/rate-limit.ts')>();
  return { ...actual, limitRate: vi.fn(async () => ({ ok: true })) };
});

import {
  gcExpiredTtsChunks,
  markChunkReadyAndRecordUsage,
  runTtsCleanup,
  runTtsWatchdog,
} from './service.ts';

type Statement = { text: string; values: unknown[] };
function recordingSql(answer: (statement: Statement) => unknown[]) {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = {
      text: strings.join('?').replace(/\s+/g, ' ').trim(),
      values,
    };
    statements.push(statement);
    return Promise.resolve(answer(statement));
  };
  const sql = Object.assign(tag, {
    unsafe: (value: string) => value,
    json: (value: unknown) => value,
    begin: (run: (tx: unknown) => Promise<unknown>) => run(sql),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- inspect the actual postgres tag calls without a database
  return { sql: sql as unknown as Sql, statements };
}

const SETTLE = {
  chunkId: 'chunk',
  attemptCreatedAt: 10,
  organizationId: 'org',
  storageRef: 'new-blob',
  voice: 'voice',
  providerName: 'provider',
  modelId: 'model',
  format: 'mp3',
  characterCount: 100,
  costEstimateCents: 7,
};

const ATTEMPT = {
  id: 'chunk',
  organizationId: 'org',
  threadId: 'thread',
  userId: 'user',
  teamId: null,
  projectIds: ['admitted'],
  reservedCostCents: 9,
  usageRecordedAt: null,
  index: 1,
  text: 'attempt',
  modelId: 'model',
  providerName: 'provider',
  attemptCreatedAt: 11,
};

beforeEach(() => {
  mocks.ledger.mockClear();
  mocks.blobs.mockClear();
});

describe('TTS attempt hold replacement [GOV-R14]', () => {
  it('books actual cost under the admitted project in the exact attempt transaction', async () => {
    const { sql, statements } = recordingSql(({ text }) =>
      text.includes('FOR UPDATE')
        ? [
            {
              id: 'chunk',
              organizationId: 'org',
              threadId: 'thread',
              userId: 'user',
              teamId: null,
              projectIds: ['admitted'],
              reservedCostCents: 9,
              index: 1,
            },
          ]
        : [],
    );
    await expect(markChunkReadyAndRecordUsage(sql, SETTLE)).resolves.toEqual({
      stale: false,
    });
    expect(mocks.ledger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectIds: ['admitted'],
        costEstimateCents: 7,
        characterCount: 100,
      }),
    );
    expect(
      statements.some(({ text }) => text.includes('FROM app.thread_metadata')),
    ).toBe(false);
    expect(
      statements.some(({ text }) =>
        text.includes('INSERT INTO app.budget_admissions'),
      ),
    ).toBe(false);
    expect(
      statements
        .find(({ text }) => text.includes('FOR UPDATE'))
        ?.values.slice(1),
    ).toEqual(['chunk', 'org', 10]);
  });

  it('a stale provider result cannot book or release a newer attempt', async () => {
    const { sql, statements } = recordingSql(() => []);
    await expect(markChunkReadyAndRecordUsage(sql, SETTLE)).resolves.toEqual({
      stale: true,
    });
    expect(mocks.ledger).not.toHaveBeenCalled();
    expect(mocks.blobs).toHaveBeenCalledWith(expect.anything(), 'org', [
      'new-blob',
    ]);
    expect(
      statements.some(({ text }) =>
        text.startsWith('UPDATE app.tts_audio_chunks'),
      ),
    ).toBe(false);
  });

  it('a stale watchdog does nothing; the exact attempt books its unknown estimate before release', async () => {
    const stale = recordingSql(() => []);
    await runTtsWatchdog(stale.sql, { chunkId: 'chunk', attemptCreatedAt: 10 });
    expect(
      stale.statements.some(
        ({ text }) =>
          text.includes('budget_admissions') || text.startsWith('UPDATE'),
      ),
    ).toBe(false);

    const current = recordingSql(({ text }) => {
      if (text.includes('FOR UPDATE')) return [ATTEMPT];
      return [];
    });
    await runTtsWatchdog(current.sql, {
      chunkId: 'chunk',
      attemptCreatedAt: 11,
    });
    expect(
      current.statements.some(({ text }) =>
        text.includes('INSERT INTO app.budget_admissions'),
      ),
    ).toBe(false);
    expect(
      current.statements
        .find(({ text }) => text.includes('FOR UPDATE'))
        ?.values.slice(1),
    ).toEqual(['chunk', 11]);
    expect(
      current.statements.find(({ text }) => text.includes("status = 'failed'"))
        ?.values,
    ).toEqual(['WATCHDOG_TIMEOUT', 'chunk']);
    expect(mocks.ledger).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({
        costEstimateCents: 9,
        projectIds: ['admitted'],
        model: 'model',
        provider: 'provider',
        characterCount: 7,
      }),
    );
    const receipt = current.statements.findIndex(({ text }) =>
      text.includes('SET usage_recorded_at_ms'),
    );
    const failure = current.statements.findIndex(({ text }) =>
      text.includes("SET status = 'failed'"),
    );
    expect(receipt).toBeGreaterThanOrEqual(0);
    expect(failure).toBeGreaterThan(receipt);
  });

  it('a duplicate watchdog cannot book an already recorded attempt again', async () => {
    const { sql, statements } = recordingSql(({ text }) =>
      text.includes('FOR UPDATE') ? [{ ...ATTEMPT, usageRecordedAt: 20 }] : [],
    );
    await runTtsWatchdog(sql, { chunkId: 'chunk', attemptCreatedAt: 11 });
    expect(mocks.ledger).not.toHaveBeenCalled();
    expect(
      statements.some(({ text }) => text.includes('SET usage_recorded_at_ms')),
    ).toBe(false);
  });

  it('does not invent an estimate for a legacy NULL reservation', async () => {
    const { sql } = recordingSql(({ text }) =>
      text.includes('FOR UPDATE')
        ? [{ ...ATTEMPT, reservedCostCents: null, projectIds: null }]
        : [],
    );
    await runTtsWatchdog(sql, { chunkId: 'chunk', attemptCreatedAt: 11 });
    expect(mocks.ledger).not.toHaveBeenCalled();
  });

  it('keeps a deliberately empty project stamp for an unknown outcome', async () => {
    const { sql, statements } = recordingSql(({ text }) =>
      text.includes('FOR UPDATE') ? [{ ...ATTEMPT, projectIds: [] }] : [],
    );
    await runTtsWatchdog(sql, { chunkId: 'chunk', attemptCreatedAt: 11 });
    expect(mocks.ledger).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.not.objectContaining({ projectIds: expect.anything() }),
    );
    expect(
      statements.some(({ text }) => text.includes('FROM app.thread_metadata')),
    ).toBe(false);
  });

  it('an expired candidate retried before GC deletion keeps its new row and blob', async () => {
    const { sql, statements } = recordingSql(({ text }) =>
      text.startsWith('SELECT id, org_id')
        ? [{ id: 'chunk', orgId: 'org', storageRef: 'old-blob' }]
        : [],
    );
    await expect(
      gcExpiredTtsChunks(sql, { now: 1_000_000_000 }),
    ).resolves.toEqual({ deleted: 0 });
    const deletion = statements.find(({ text }) =>
      text.startsWith('DELETE FROM app.tts_audio_chunks'),
    );
    expect(deletion?.text).toContain('created_at_ms <');
    expect(deletion?.text).toContain("status <> 'pending'");
    expect(
      statements.find(({ text }) => text.startsWith('SELECT id, org_id'))?.text,
    ).toContain("status <> 'pending'");
    expect(deletion?.text).toContain('RETURNING storage_ref');
    expect(mocks.blobs).not.toHaveBeenCalled();
  });

  it('the lazy age sweep rechecks pending status before deleting a selected row', async () => {
    const { sql, statements } = recordingSql(({ text }) =>
      text.startsWith('SELECT id, org_id')
        ? [{ id: 'chunk', orgId: 'org', storageRef: null }]
        : [],
    );
    await runTtsCleanup(sql, { threadId: 'thread' });
    for (const statement of statements.filter(({ text }) =>
      text.includes('app.tts_audio_chunks'),
    ))
      expect(statement.text).toContain("status <> 'pending'");
    expect(mocks.ledger).not.toHaveBeenCalled();
    expect(mocks.blobs).not.toHaveBeenCalled();
  });

  it('GC reclaims only the blob returned by an actually deleted expired row', async () => {
    const { sql } = recordingSql(({ text }) => {
      if (text.startsWith('SELECT id, org_id'))
        return [{ id: 'chunk', orgId: 'org', storageRef: 'snapshot-blob' }];
      if (text.startsWith('DELETE FROM app.tts_audio_chunks'))
        return [{ storageRef: 'deleted-blob' }];
      return [];
    });
    await expect(
      gcExpiredTtsChunks(sql, { now: 1_000_000_000 }),
    ).resolves.toEqual({ deleted: 1 });
    expect(mocks.blobs).toHaveBeenCalledWith(expect.anything(), 'org', [
      'deleted-blob',
    ]);
  });
});
