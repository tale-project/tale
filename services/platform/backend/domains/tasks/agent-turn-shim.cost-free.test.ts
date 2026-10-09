// @vitest-environment node

/**
 * An op that ends without ever minting a key is closed at its terminal
 * stamp, which frees its hold. A subscription turn's hold is the request it
 * was, at no cost: whatever ended it — its host's release, a watchdog's
 * failure — it is booked before that stamp closes it, once.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { settleCostFreeTurn } from '../sandbox/spend-settlement.ts';
import { agentTurnShimHandlers } from './agent-turn-shim.ts';

vi.mock('../sandbox/spend-settlement.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sandbox/spend-settlement.ts')>()),
  settleCostFreeTurn: vi.fn(async () => undefined),
}));

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({
      text: strings.join('?').replace(/\s+/g, ' ').trim(),
      values,
    });
    return Promise.resolve([{ id: 'op-1' }]);
  };
  const sql = Object.assign(tag, {
    json: (value: unknown) => value,
    begin: async (work: (tx: unknown) => Promise<unknown>) => work(sql),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: sql as unknown as Sql, statements };
}

function upsert(sql: Sql, args: Record<string, unknown>) {
  const handler =
    agentTurnShimHandlers(sql)['sandbox/session_mutations:upsertSessionOp'];
  if (handler === undefined) throw new Error('upsertSessionOp is not wired');
  return handler({
    organizationId: 'org-1',
    sessionId: 'pa-alice',
    execId: 'exec-1',
    kind: 'task-agent',
    ...args,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('upsertSessionOp — a keyless op’s end', () => {
  it('books a subscription turn before the terminal stamp closes it [GOV-R16]', async () => {
    const { sql, statements } = fakeSql();
    vi.mocked(settleCostFreeTurn).mockImplementationOnce(async () => {
      statements.push({ text: 'settleCostFreeTurn', values: [] });
    });

    await upsert(sql, { status: 'failed' });

    expect(settleCostFreeTurn).toHaveBeenCalledWith(sql, {
      sessionId: 'pa-alice',
      execId: 'exec-1',
    });
    const booked = statements.findIndex((s) => s.text === 'settleCostFreeTurn');
    const stamped = statements.findIndex((s) =>
      s.text.startsWith('INSERT INTO app.sandbox_session_ops'),
    );
    expect(booked).toBeGreaterThanOrEqual(0);
    expect(stamped).toBeGreaterThan(booked);
  });

  it('settles nothing while the turn runs, or for an op that minted a key', async () => {
    const { sql } = fakeSql();

    await upsert(sql, { status: 'running' });
    await upsert(sql, { status: 'completed', mintedKeyId: 'vk-1' });

    expect(settleCostFreeTurn).not.toHaveBeenCalled();
  });
});
