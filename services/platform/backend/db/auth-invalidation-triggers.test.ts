// @vitest-environment node

import type postgres from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AUTH_INVALIDATION_TRIGGERS,
  installAuthInvalidationTriggers,
} from './auth-invalidation-triggers.ts';

/**
 * Boot installs the triggers that feed the auth invalidation log on Better
 * Auth's tables — only the missing ones, each in its own transaction under
 * a lock timeout, and a trigger it cannot install is reported, never fatal.
 */

function fakeDatabase(options: {
  present: readonly string[];
  failOn?: string;
}) {
  const transactions: string[][] = [];
  const tag =
    (log: string[]) =>
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?').replace(/\s+/g, ' ').trim();
      log.push(values.length > 0 ? `${text} [${values.join(',')}]` : text);
      if (text.includes('FROM pg_trigger')) {
        return Promise.resolve(options.present.map((name) => ({ name })));
      }
      if (
        options.failOn !== undefined &&
        text.includes(`TRIGGER ${options.failOn} `)
      ) {
        return Promise.reject(
          new Error('canceling statement due to lock timeout'),
        );
      }
      return Promise.resolve([]);
    };
  const reads: string[] = [];
  const sql = Object.assign(tag(reads), {
    begin: async (work: (tx: unknown) => Promise<unknown>) => {
      const log: string[] = [];
      transactions.push(log);
      return work(tag(log));
    },
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call and begin are exercised
  return { sql: sql as unknown as postgres.Sql, transactions, reads };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('installAuthInvalidationTriggers', () => {
  it('touches nothing when every trigger is there', async () => {
    const { sql, transactions } = fakeDatabase({
      present: AUTH_INVALIDATION_TRIGGERS,
    });
    const log = vi.fn();
    await installAuthInvalidationTriggers(sql, log);
    expect(transactions).toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  it('creates each missing trigger in its own transaction, under a lock timeout', async () => {
    const { sql, transactions } = fakeDatabase({
      present: ['auth_session_deleted', 'auth_user_changed'],
    });
    const log = vi.fn();
    await installAuthInvalidationTriggers(sql, log);
    expect(transactions).toHaveLength(2);
    for (const statements of transactions) {
      expect(statements[0]).toBe(
        "SELECT set_config('lock_timeout', ?, true) [10s]",
      );
    }
    expect(transactions[0]?.[1]).toContain(
      'CREATE OR REPLACE TRIGGER auth_session_updated AFTER UPDATE ON "session"',
    );
    // A refresh — `expiresAt` and `updatedAt` alone — fires nothing.
    expect(transactions[0]?.[1]).toContain(
      "to_jsonb(OLD) - ARRAY['expiresAt', 'updatedAt']",
    );
    expect(transactions[1]?.[1]).toContain(
      'CREATE OR REPLACE TRIGGER auth_member_changed AFTER INSERT OR UPDATE OR DELETE ON "member"',
    );
    expect(log.mock.calls.map((call) => String(call[0]))).toEqual([
      '[backend] installed auth invalidation trigger auth_session_updated',
      '[backend] installed auth invalidation trigger auth_member_changed',
    ]);
  });

  it('reports a trigger it cannot install and goes on with the rest', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { sql, transactions } = fakeDatabase({
      present: [],
      failOn: 'auth_session_deleted',
    });
    const log = vi.fn();
    await expect(
      installAuthInvalidationTriggers(sql, log),
    ).resolves.toBeUndefined();
    expect(transactions).toHaveLength(4);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('auth_session_deleted');
    expect(log).toHaveBeenCalledTimes(3);
  });
});
