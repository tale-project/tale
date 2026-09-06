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
import { describe, expect, it, vi } from 'vitest';

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
  getUserTeamIds: vi.fn(async () => []),
}));
vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn(async () => null),
  readSettingsForOrg: vi.fn(async () => null),
}));
vi.mock('../../jobs/enqueue.ts', () => ({
  addJobInTx: vi.fn(async () => 'job-1'),
}));
vi.mock('../files/service.ts', () => ({
  deleteOrgBlobRefs: vi.fn(async () => undefined),
  putOrgBlobBytes: vi.fn(),
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
};

describe('reserveChunk — per-(message, index) serialization', () => {
  it('takes the advisory lock before the FOR UPDATE read on a fresh chunk, then inserts', async () => {
    const { sql, statements } = recordingSql((text) =>
      text.includes('INSERT INTO app.tts_audio_chunks')
        ? [{ id: 'chunk-1' }]
        : [],
    );

    const outcome = await reserveChunk(sql, ARGS);

    expect(outcome).toMatchObject({ kind: 'reserved', chunkId: 'chunk-1' });
    const lockIndex = statements.findIndex((s) =>
      s.text.includes('pg_advisory_xact_lock'),
    );
    const readIndex = statements.findIndex(
      (s) =>
        s.text.includes('FROM app.tts_audio_chunks') &&
        s.text.includes('FOR UPDATE'),
    );
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(readIndex).toBeGreaterThan(lockIndex);
    // The lock key is the chunk identity the unique index guards.
    expect(statements[lockIndex]?.values).toEqual(['msg-1', '3']);
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
});
