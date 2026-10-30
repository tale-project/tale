// @vitest-environment node

import type postgres from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BOOT_INDEXES, buildBootIndexes } from './boot-indexes.ts';

/**
 * Boot builds the indexes Better Auth does not declare — concurrently, by
 * one replica under a lock nobody waits for, only the missing ones, an
 * interrupted (INVALID) one dropped and built again — and an index it cannot
 * build is reported, never fatal, unless the database itself went away.
 */

function fakeDatabase(options: {
  claimed?: boolean;
  /** Index name → whether it is valid; an absent name does not exist. */
  present?: Record<string, boolean>;
  /** The first statement containing `on` rejects with `error`. */
  fail?: { on: string; error: Error };
}) {
  const statements: string[] = [];
  const tag = (
    first: TemplateStringsArray | string,
    ...values: unknown[]
  ): unknown => {
    // `sql(name)`: postgres.js's identifier helper.
    if (typeof first === 'string') return { identifier: first };
    const text = first.join('?').replace(/\s+/g, ' ').trim();
    const shown = values.map((value) =>
      typeof value === 'object' && value !== null && 'identifier' in value
        ? `"${String(value.identifier)}"`
        : String(value),
    );
    statements.push(shown.length > 0 ? `${text} [${shown.join(',')}]` : text);
    if (text.includes('pg_try_advisory_lock')) {
      return Promise.resolve([{ claimed: options.claimed ?? true }]);
    }
    if (text.includes('FROM pg_index')) {
      const valid = options.present?.[String(values[0]).replaceAll('"', '')];
      return Promise.resolve(valid === undefined ? [] : [{ valid }]);
    }
    if (options.fail !== undefined && text.includes(options.fail.on)) {
      return Promise.reject(options.fail.error);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call and the identifier helper are exercised
  return { sql: tag as unknown as postgres.Sql, statements };
}

const CREATE_EMAIL =
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_email_lower_idx" ON "user" (lower("email"))';
const CREATE_EXPIRES =
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS "session_expiresAt_idx" ON "session" ("expiresAt")';
const CREATE_UPDATED =
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS "session_updatedAt_expiresAt_idx" ON "session" ("updatedAt", "expiresAt")';
const UNLOCK = 'SELECT pg_advisory_unlock(?) [72085003]';

const allValid = Object.fromEntries(BOOT_INDEXES.map((name) => [name, true]));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildBootIndexes', () => {
  it('leaves the build to the replica holding the lock', async () => {
    const { sql, statements } = fakeDatabase({ claimed: false });
    const log = vi.fn();
    await buildBootIndexes(sql, log);
    expect(statements).toEqual([
      'SELECT pg_try_advisory_lock(?) AS claimed [72085003]',
    ]);
    expect(log).not.toHaveBeenCalled();
  });

  it('touches nothing but the lock when every index is valid', async () => {
    const { sql, statements } = fakeDatabase({ present: allValid });
    const log = vi.fn();
    await buildBootIndexes(sql, log);
    expect(
      statements.filter((text) => !text.includes('FROM pg_index')),
    ).toEqual(['SELECT pg_try_advisory_lock(?) AS claimed [72085003]', UNLOCK]);
    expect(log).not.toHaveBeenCalled();
  });

  it('looks each index up by its quoted name, through the search path', async () => {
    const { sql, statements } = fakeDatabase({ present: allValid });
    await buildBootIndexes(sql, vi.fn());
    expect(statements.filter((text) => text.includes('FROM pg_index'))).toEqual(
      BOOT_INDEXES.map(
        (name) =>
          `SELECT i.indisvalid AS valid FROM pg_index i WHERE i.indexrelid = to_regclass(?) ["${name}"]`,
      ),
    );
  });

  it('builds the missing indexes concurrently, then releases the lock', async () => {
    const { sql, statements } = fakeDatabase({
      present: { user_email_lower_idx: true },
    });
    const log = vi.fn();
    await buildBootIndexes(sql, log);
    const built = statements.filter((text) => !text.includes('FROM pg_index'));
    expect(built).toEqual([
      'SELECT pg_try_advisory_lock(?) AS claimed [72085003]',
      CREATE_EXPIRES,
      CREATE_UPDATED,
      UNLOCK,
    ]);
    expect(log.mock.calls).toEqual([
      ['[backend] building the index session_expiresAt_idx'],
      ['[backend] building the index session_updatedAt_expiresAt_idx'],
    ]);
  });

  it('drops an interrupted (INVALID) index before building it again', async () => {
    const { sql, statements } = fakeDatabase({
      present: { ...allValid, session_updatedAt_expiresAt_idx: false },
    });
    const log = vi.fn();
    await buildBootIndexes(sql, log);
    const built = statements.filter((text) => !text.includes('FROM pg_index'));
    expect(built).toEqual([
      'SELECT pg_try_advisory_lock(?) AS claimed [72085003]',
      'DROP INDEX CONCURRENTLY IF EXISTS ? ["session_updatedAt_expiresAt_idx"]',
      CREATE_UPDATED,
      UNLOCK,
    ]);
    expect(log).toHaveBeenCalledWith(
      '[backend] rebuilding the interrupted index session_updatedAt_expiresAt_idx',
    );
  });

  it('reports a build that fails and still builds the others', async () => {
    const failure = Object.assign(
      new Error('canceling statement due to statement timeout'),
      { code: '57014' },
    );
    const { sql, statements } = fakeDatabase({
      fail: { on: '"user_email_lower_idx" ON', error: failure },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(buildBootIndexes(sql, vi.fn())).resolves.toBeUndefined();
    expect(statements).toEqual(
      expect.arrayContaining([
        CREATE_EMAIL,
        CREATE_EXPIRES,
        CREATE_UPDATED,
        UNLOCK,
      ]),
    );
    expect(warn).toHaveBeenCalledWith(
      '[backend] the index user_email_lower_idx was not built; the next boot retries:',
      failure,
    );
  });

  it('fails the boot step when the database went away, and still unlocks', async () => {
    const outage = Object.assign(
      new Error('terminating connection due to administrator command'),
      { code: '57P01' },
    );
    const { sql, statements } = fakeDatabase({
      fail: { on: '"session_expiresAt_idx" ON', error: outage },
    });
    await expect(buildBootIndexes(sql, vi.fn())).rejects.toBe(outage);
    expect(statements).not.toContain(CREATE_UPDATED);
    expect(statements.at(-1)).toBe(UNLOCK);
  });

  it('ignores a failed unlock: the lock goes with the session', async () => {
    const { sql } = fakeDatabase({
      present: allValid,
      fail: { on: 'pg_advisory_unlock', error: new Error('socket closed') },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(buildBootIndexes(sql, vi.fn())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      '[backend] boot index unlock failed (ignored):',
      expect.any(Error),
    );
  });
});
