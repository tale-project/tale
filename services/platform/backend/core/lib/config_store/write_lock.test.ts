// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  DEPLOYMENT_CONFIG_SCOPE,
  configWriteLockKey,
  withConfigWriteLock,
} from './write_lock.ts';

/**
 * The regression under test: every org-config write is a read-modify-write
 * over files (read current → snapshot into `.history/` → prune → write →
 * delete the superseded sibling), and nothing serialized two writers. The api
 * and the worker have always both mounted the store read-write, and a colour
 * flip runs two api replicas at once — so the mutex has to live in the one
 * place every writer shares.
 *
 * The second thing pinned here is the handle fork. postgres.js gives the root
 * `sql` a `begin` and a transaction handle a `savepoint`, never both; a
 * `pg_advisory_xact_lock` taken on the root without opening a transaction is
 * released by the implicit transaction before the work runs, and calling
 * `begin` on a transaction handle throws. Both shapes reach this helper.
 */

interface Recorded {
  text: string;
  values: unknown[];
}

function recordingTag(statements: Recorded[], events: string[]) {
  return (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({
      text: strings.join('?').replace(/\s+/g, ' ').trim(),
      values,
    });
    events.push('lock');
    return Promise.resolve([]);
  };
}

/** The ROOT handle: a `begin` and no `savepoint`. */
function fakeRootSql(): { sql: Sql; statements: Recorded[]; events: string[] } {
  const statements: Recorded[] = [];
  const events: string[] = [];
  const tx = recordingTag(statements, events);
  const begin = async (
    callback: (tx: unknown) => Promise<unknown>,
  ): Promise<unknown> => {
    events.push('begin');
    try {
      const out = await callback(tx);
      events.push('commit');
      return out;
    } catch (error) {
      events.push('rollback');
      throw error;
    }
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: { begin } as unknown as Sql, statements, events };
}

/** A TRANSACTION handle: a `savepoint` and no `begin`, exactly as
 *  postgres.js builds it. */
function fakeTransactionSql(): {
  sql: Sql;
  statements: Recorded[];
  events: string[];
} {
  const statements: Recorded[] = [];
  const events: string[] = [];
  const tag = recordingTag(statements, events);
  const handle = Object.assign(tag, { savepoint: () => Promise.resolve() });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: handle as unknown as Sql, statements, events };
}

describe('configWriteLockKey', () => {
  it('keys one lock per org and config domain', () => {
    expect(configWriteLockKey('acme', 'governance')).toBe(
      'config:acme:governance',
    );
    expect(configWriteLockKey('acme', 'branding')).toBe('config:acme:branding');
  });

  it('gives the deployment-scoped file a key no org can collide with', () => {
    expect(configWriteLockKey(DEPLOYMENT_CONFIG_SCOPE, 'deployment')).toBe(
      'config::deployment',
    );
  });

  it('does not let the whole-org scaffold key collide with a domain key', () => {
    expect(configWriteLockKey('acme', 'org')).not.toBe(
      configWriteLockKey('acme', 'governance'),
    );
  });
});

describe('withConfigWriteLock', () => {
  it('opens a transaction on the root handle and locks before the work runs', async () => {
    const { sql, statements, events } = fakeRootSql();

    const result = await withConfigWriteLock(
      sql,
      'acme',
      'governance',
      async () => {
        events.push('work');
        return 'written';
      },
    );

    expect(result).toBe('written');
    expect(events).toEqual(['begin', 'lock', 'work', 'commit']);
    expect(statements[0]?.text).toBe(
      'SELECT pg_advisory_xact_lock(hashtext(?))',
    );
    expect(statements[0]?.values).toEqual(['config:acme:governance']);
  });

  it('rolls the transaction back and rethrows when the work fails', async () => {
    const { sql, events } = fakeRootSql();

    await expect(
      withConfigWriteLock(sql, 'acme', 'governance', async () => {
        throw new Error('disk on fire');
      }),
    ).rejects.toThrow('disk on fire');
    // The lock releases on rollback too — a failed write must not wedge the
    // domain for the next writer.
    expect(events).toEqual(['begin', 'lock', 'rollback']);
  });

  it('joins a caller transaction instead of nesting one', async () => {
    const { sql, statements, events } = fakeTransactionSql();

    const result = await withConfigWriteLock(
      sql,
      'acme',
      'governance',
      async () => {
        events.push('work');
        return 'written';
      },
    );

    expect(result).toBe('written');
    // No `begin` — the caller's transaction owns the commit, and the lock is
    // held until IT ends, which is what makes the file write and the audit
    // row land together.
    expect(events).toEqual(['lock', 'work']);
    expect(statements[0]?.values).toEqual(['config:acme:governance']);
  });

  it('propagates a failure out of a caller transaction untouched', async () => {
    const { sql, events } = fakeTransactionSql();

    await expect(
      withConfigWriteLock(sql, 'acme', 'governance', async () => {
        throw new Error('disk on fire');
      }),
    ).rejects.toThrow('disk on fire');
    // The caller's transaction decides what a failure means; this helper must
    // not swallow it into a rollback of its own.
    expect(events).toEqual(['lock']);
  });
});
