/**
 * `reserveChunk` — the first-attempt race. The reserve used to lock the
 * `(message_id, chunk_index)` row with SELECT … FOR UPDATE and branch on it;
 * with no row present nothing is locked, so two concurrent first reserves
 * both reached the INSERT and the loser died on the unique index — a raw 500
 * to the player instead of the `in-flight` answer it polls on. The reserve
 * now serializes per (message, index) on an advisory lock taken before the
 * read; the second racer then sees the winner's pending row.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  budgets: null as unknown,
  ledger: vi.fn(async () => undefined),
}));

vi.mock('../../lib/rate-limit.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../lib/rate-limit.ts')>();
  return {
    ...actual,
    checkUserRateLimit: vi.fn(async () => undefined),
    checkOrganizationRateLimit: vi.fn(async () => undefined),
  };
});
vi.mock('../../auth/membership.ts', () => ({
  findOrganizationMember: vi.fn(async () => null),
  getUserTeamIds: vi.fn(async () => []),
}));
vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn(async (_sql: unknown, _org, type) =>
    type === 'budgets' ? mocks.budgets : null,
  ),
  readSettingsForOrg: vi.fn(async () => null),
}));
vi.mock('../../jobs/enqueue.ts', () => ({
  addJobInTx: vi.fn(async () => 'job-1'),
}));
vi.mock('../files/service.ts', () => ({
  deleteOrgBlobRefs: vi.fn(async () => undefined),
  putOrgBlobBytes: vi.fn(),
}));
vi.mock('../governance/service.ts', () => ({
  incrementUsageLedger: mocks.ledger,
}));

import { reserveChunk } from './service.ts';

type Statement = { text: string; values: unknown[] };

/** A `sql` stand-in recording every statement; `begin` runs the callback on
 * the same tag so the transaction's statements are inspectable in order. */
function recordingSql(answer: (text: string) => unknown[]) {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(answer(text));
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
    begin: (fn: (tx: unknown) => Promise<unknown>) => fn(sql),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: sql as unknown as Sql, statements };
}

const ARGS = {
  organizationId: 'org-1',
  userId: 'user-1',
  messageId: 'msg-1',
  threadId: 'thr-1',
  index: 3,
  text: 'Hello there.',
  locale: 'en',
  agentSlug: null,
  prospectiveCostCentsPerMChars: undefined,
  providerName: 'provider',
  modelId: 'model',
};

beforeEach(() => {
  mocks.budgets = null;
  mocks.ledger.mockClear();
});

describe('reserveChunk — per-(message, index) serialization [TTS-R3]', () => {
  it('takes the advisory lock before the FOR UPDATE read on a fresh chunk, then inserts', async () => {
    const { sql, statements } = recordingSql((text) =>
      text.includes('INSERT INTO app.tts_audio_chunks')
        ? [{ id: 'chunk-1' }]
        : [],
    );

    const outcome = await reserveChunk(sql, ARGS);

    expect(outcome).toMatchObject({ kind: 'reserved', chunkId: 'chunk-1' });
    const budgetIndex = statements.findIndex((s) =>
      s.text.includes('INSERT INTO app.budget_admissions'),
    );
    const lockIndex = statements.findIndex((s) =>
      s.text.includes("hashtextextended('tts:'"),
    );
    const readIndex = statements.findIndex(
      (s) =>
        s.text.includes('FROM app.tts_audio_chunks') &&
        s.text.includes('FOR UPDATE'),
    );
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(budgetIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeGreaterThan(budgetIndex);
    expect(readIndex).toBeGreaterThan(lockIndex);
    // The lock key is the chunk identity the unique index guards.
    expect(statements[lockIndex]?.values).toEqual(['msg-1', '3']);
    const insert = statements.find((s) =>
      s.text.includes('INSERT INTO app.tts_audio_chunks'),
    );
    expect(insert?.text).toContain(
      'provider_name, model_id, reserved_cost_cents, project_ids',
    );
    expect(insert?.values).toContain('provider');
    expect(insert?.values).toContain('model');
    expect(insert?.values.at(-1)).toEqual([]);
    expect(insert?.values.at(-2)).toBe(0.018);
  });

  it('answers in-flight, without inserting, once the winner’s pending row is visible', async () => {
    const { sql, statements } = recordingSql((text) => {
      if (
        text.includes('FROM app.tts_audio_chunks') &&
        text.includes('FOR UPDATE')
      ) {
        return [
          {
            id: 'chunk-1',
            organizationId: 'org-1',
            threadId: 'thr-1',
            status: 'pending',
            storageRef: null,
            createdAt: Date.now(),
          },
        ];
      }
      return [];
    });

    const outcome = await reserveChunk(sql, ARGS);

    expect(outcome).toEqual({ kind: 'pending-in-flight' });
    expect(
      statements.some((s) =>
        s.text.includes('INSERT INTO app.tts_audio_chunks'),
      ),
    ).toBe(false);
  });

  it('replaces only the exact prior hold and advances a same-millisecond retry identity', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const { sql, statements } = recordingSql((text) => {
        if (
          text.includes('FROM app.tts_audio_chunks') &&
          text.includes('FOR UPDATE')
        )
          return [
            {
              id: 'chunk-1',
              organizationId: ARGS.organizationId,
              threadId: ARGS.threadId,
              status: 'failed',
              storageRef: null,
              createdAt: now,
              attemptCreatedAt: now,
              reservedCostCents: null,
              usageRecordedAt: null,
            },
          ];
        if (text.includes('SELECT project_id AS "projectId"'))
          return [{ projectId: 'project-1' }];
        return [];
      });
      const outcome = await reserveChunk(sql, ARGS);
      expect(outcome).toEqual({
        kind: 'reserved',
        chunkId: 'chunk-1',
        attemptCreatedAt: now + 1,
      });
      const holds = statements.find((s) => s.text.includes('WITH holds AS'));
      expect(holds?.values).toContain('chunk-1');
      expect(holds?.values).toContain(now);
      const update = statements.find((s) =>
        s.text.includes('UPDATE app.tts_audio_chunks SET'),
      );
      expect(update?.text).toContain('reserved_cost_cents =');
      expect(update?.text).toContain('project_ids =');
      expect(update?.values).toContainEqual(['project-1']);
      expect(update?.values).toContain(now + 1);
    } finally {
      clock.mockRestore();
    }
  });

  it('books a stale attempt before budget evaluation, and refuses a replacement beyond the cap', async () => {
    mocks.budgets = {
      enabled: true,
      rules: [],
      projectRules: [
        {
          scope: 'project',
          scopeId: 'project-1',
          period: 'monthly',
          maxCostCents: 1.5,
        },
      ],
    };
    const { sql, statements } = recordingSql((text) => {
      if (
        text.includes('FROM app.tts_audio_chunks') &&
        text.includes('FOR UPDATE')
      )
        return [
          {
            id: 'chunk-1',
            organizationId: ARGS.organizationId,
            threadId: ARGS.threadId,
            userId: ARGS.userId,
            status: 'pending',
            storageRef: null,
            createdAt: 1,
            attemptCreatedAt: 1,
            reservedCostCents: 1,
            usageRecordedAt: null,
            projectIds: ['project-1'],
            teamId: null,
            modelId: 'old-model',
            providerName: 'old-provider',
            text: 'old',
          },
        ];
      if (text.includes('SELECT project_id AS "projectId"'))
        return [{ projectId: 'project-1' }];
      if (text.includes('FROM app.project_usage'))
        return [
          {
            totalTokens: 0,
            costEstimate: mocks.ledger.mock.calls.length,
            requestCount: 1,
          },
        ];
      return [];
    });
    await expect(
      reserveChunk(sql, {
        ...ARGS,
        text: 'x'.repeat(1000),
        prospectiveCostCentsPerMChars: 1000,
      }),
    ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    expect(mocks.ledger).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({
        costEstimateCents: 1,
        projectIds: ['project-1'],
        model: 'old-model',
        provider: 'old-provider',
      }),
    );
    expect(
      statements.some(({ text }) => text.includes("SET status = 'pending'")),
    ).toBe(false);
    const stamped = statements.findIndex(({ text }) =>
      text.includes('SET usage_recorded_at_ms'),
    );
    const read = statements.findIndex(({ text }) =>
      text.includes('WITH holds AS'),
    );
    expect(read).toBeGreaterThan(stamped);
    // The real PG lane owns the transaction rollback/retained-hold assertion.
  });
});
