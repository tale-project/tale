// @vitest-environment node

/**
 * The session hooks `createAuth` gives Better Auth (#5164): a sign-in and a
 * refresh write the expiry `session-refresh.ts` chooses — four minutes short
 * of Better Auth's for a user an organization's idle window covers, so the
 * session refreshes every minute — and an update that writes no expiry goes
 * through as it is. Which expiry each user gets is `session-refresh.test.ts`'s.
 */

import pg from 'pg';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const windows = vi.hoisted(() => new Map<string, number>());

vi.mock('../lib/org-config.ts', async (original) => ({
  ...(await original<typeof import('../lib/org-config.ts')>()),
  readGovernancePolicyForOrg: vi.fn(
    async (_sql: unknown, organizationId: string) => {
      const minutes = windows.get(organizationId);
      return minutes === undefined
        ? null
        : { enabled: true, idleTimeoutMinutes: minutes };
    },
  ),
}));

import { createAuth } from './auth.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** How much earlier the hooks write a covered user's expiry. */
const ADVANCE_MS = 4 * MINUTE;

/** Tale's own reads behind the hooks: each user's member rows. */
function database(): { sql: Sql; memberReads: () => number } {
  let memberReads = 0;
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (!strings.join('?').includes('FROM "member"')) return [];
    memberReads += 1;
    const [userId] = values;
    if (userId === 'user-covered') {
      return [
        { id: 'm-1', organizationId: 'org-window', userId, role: 'member' },
      ];
    }
    if (userId === 'user-free') {
      return [
        { id: 'm-2', organizationId: 'org-free', userId, role: 'member' },
      ];
    }
    return [];
  };
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call is exercised
    sql: tag as unknown as Sql,
    memberReads: () => memberReads,
  };
}

/** The request context Better Auth hands a refresh: the presented session. */
function presenting(userId: string) {
  return { context: { session: { session: { userId } } } };
}

describe('the session hooks (#5164)', () => {
  let factory: ReturnType<typeof createAuth>;
  let db: ReturnType<typeof database>;

  beforeEach(() => {
    windows.clear();
    windows.set('org-window', 30);
    db = database();
    factory = createAuth({
      databaseUrl: 'postgres://unused.invalid/auth-fixture',
      baseUrl: 'https://tale.example.test',
      secret: 'session-refresh-unit-fixture-secret',
      sql: db.sql,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (factory.options.database instanceof pg.Pool)
      await factory.options.database.end();
  });

  const hooks = () => {
    const session = factory.options.databaseHooks?.session;
    const create = session?.create?.before;
    const update = session?.update?.before;
    if (typeof create !== 'function' || typeof update !== 'function')
      throw new Error('a session hook was missing');
    return { create, update };
  };

  /** Better Auth's expiry for a sign-in or refresh now, variable unset. */
  const fullLifetime = () => new Date(Date.now() + 7 * DAY);

  const signIn = (userId: string, expiresAt: Date) => ({
    id: `session-${userId}`,
    token: `token-${userId}`,
    userId,
    expiresAt,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it("writes a covered user's sign-in four minutes short", async () => {
    const expiresAt = fullLifetime();
    expect(
      await hooks().create(signIn('user-covered', expiresAt), null),
    ).toMatchObject({
      data: {
        userId: 'user-covered',
        expiresAt: new Date(expiresAt.getTime() - ADVANCE_MS),
      },
    });
  });

  it("keeps Better Auth's expiry for the sign-in of a user no window covers", async () => {
    const expiresAt = fullLifetime();
    expect(
      await hooks().create(signIn('user-free', expiresAt), null),
    ).toMatchObject({ data: { userId: 'user-free', expiresAt } });
  });

  it("writes a refresh four minutes short for the presented session's covered user", async () => {
    const expiresAt = fullLifetime();
    expect(
      await hooks().update(
        { expiresAt, updatedAt: new Date() },
        presenting('user-covered') as never,
      ),
    ).toEqual({
      data: { expiresAt: new Date(expiresAt.getTime() - ADVANCE_MS) },
    });
  });

  it("keeps Better Auth's expiry for the refresh of a user no window covers", async () => {
    const expiresAt = fullLifetime();
    expect(
      await hooks().update(
        { expiresAt, updatedAt: new Date() },
        presenting('user-free') as never,
      ),
    ).toEqual({ data: { expiresAt } });
  });

  it('refreshes every minute when no session is presented', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const expiresAt = fullLifetime();
    expect(
      await hooks().update({ expiresAt, updatedAt: new Date() }, null),
    ).toEqual({
      data: { expiresAt: new Date(expiresAt.getTime() - ADVANCE_MS) },
    });
    expect(warn).toHaveBeenCalledWith(
      '[session-refresh] a session write names no user: refreshing it every minute',
    );
    expect(db.memberReads()).toBe(0);
  });

  it('lets an update that writes no expiry through as it is, reading nothing', async () => {
    expect(
      await hooks().update(
        { activeOrganizationId: 'org-window' },
        presenting('user-covered') as never,
      ),
    ).toEqual({ data: {} });
    expect(db.memberReads()).toBe(0);
  });
});
