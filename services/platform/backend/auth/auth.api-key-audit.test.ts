// @vitest-environment node

/**
 * `@better-auth/api-key` exposes no lifecycle hooks, so the global after-hook
 * is the one seam where a key's create / revoke / update can be audited.
 * Before this, a bearer credential valid in every organization of its
 * holder could be minted and revoked with no row in any audit log. Each
 * event now lands once per organization the holder belongs to (the
 * second-factor posture), naming the key and — on create — its `start` and
 * last four characters, never the plaintext.
 *
 * `createAuth` only constructs a lazy `pg.Pool`; the after-hook is driven
 * directly with the context shape Better Auth hands it, against a recording
 * `sql` stand-in, with the audit writer and the serializable wrapper
 * replaced by spies.
 */

import { APIError } from 'better-auth/api';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAuditLog } = vi.hoisted(() => ({ createAuditLog: vi.fn() }));
vi.mock('../domains/audit_logs/service.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../domains/audit_logs/service.ts')
  >()),
  createAuditLog,
}));
vi.mock('@tale/shared/db/serializable', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/shared/db/serializable')>()),
  transactSerializable: (sql: Sql, fn: (tx: unknown) => unknown) =>
    (
      sql as unknown as { begin: (run: (tx: unknown) => unknown) => unknown }
    ).begin(fn),
}));
// The after-hook reads the trusted-proxy list from the governance config
// before anything else; a test has no config tree.
vi.mock('../lib/org-config.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/org-config.ts')>()),
  readGovernancePolicy: vi.fn(() => Promise.resolve(null)),
}));

import { createAuth } from './auth.ts';

interface Statement {
  text: string;
  values: unknown[];
}

/** A `postgres.js` stand-in: the holder belongs to two organizations. */
function recordingSql(): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('SELECT "organizationId" FROM "member"')) {
      return Promise.resolve([
        { organizationId: 'org-1' },
        { organizationId: 'org-2' },
      ]);
    }
    if (text.startsWith('SELECT "email" FROM "user"')) {
      return Promise.resolve([{ email: 'ada@example.test' }]);
    }
    return Promise.resolve([]);
  };
  (tag as unknown as { begin: unknown }).begin = (
    fn: (tx: unknown) => unknown,
  ) => Promise.resolve(fn(tag));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return { sql: tag as unknown as Sql, statements };
}

const BASE = {
  databaseUrl: 'postgresql://tale:pw@localhost:5432/tale_app',
  secret: 'test-secret-at-least-16-chars',
  baseUrl: 'https://tale.example.com',
};

/** Drive the after-hook with the fields Better Auth hands it. */
async function runAfterHook(
  sql: Sql,
  ctx: {
    path: string;
    body?: Record<string, unknown>;
    context: { returned: unknown; session?: unknown };
  },
): Promise<void> {
  const after = createAuth({ ...BASE, sql }).options.hooks?.after;
  if (after === undefined) throw new Error('the after-hook is not wired');
  await after({
    ...ctx,
    request: new Request(`https://tale.example.com/api/auth${ctx.path}`, {
      headers: { 'user-agent': 'itest-agent' },
    }),
  } as never);
}

const audited = () => createAuditLog.mock.calls.map((call) => call[1]);

const SESSION = { user: { id: 'user-1', email: 'ada@example.test' } };

describe('Better Auth after-hook — API-key lifecycle audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('records api_key.created in every organization of the holder, without the plaintext', async () => {
    const { sql, statements } = recordingSql();

    // The create endpoint runs no session middleware: the returned row
    // names its owner, and the e-mail is looked up.
    await runAfterHook(sql, {
      path: '/api-key/create',
      body: { name: 'CI' },
      context: {
        returned: {
          id: 'key-1',
          name: 'CI',
          start: 'tale_abc',
          key: 'tale_abcdefgh1234',
          expiresAt: null,
          referenceId: 'user-1',
        },
      },
    });

    expect(audited()).toEqual([
      expect.objectContaining({
        organizationId: 'org-1',
        actorId: 'user-1',
        actorEmail: 'ada@example.test',
        actorType: 'user',
        action: 'api_key.created',
        category: 'security',
        resourceType: 'api_key',
        resourceId: 'key-1',
        resourceName: 'CI',
        newState: {
          name: 'CI',
          start: 'tale_abc',
          suffix: '1234',
          expiresAt: null,
        },
        userAgent: 'itest-agent',
        status: 'success',
      }),
      expect.objectContaining({
        organizationId: 'org-2',
        action: 'api_key.created',
        resourceId: 'key-1',
      }),
    ]);
    expect(JSON.stringify(audited())).not.toContain('tale_abcdefgh1234');
    // The suffix persist that predates the audit still runs.
    expect(
      statements.find((s) => s.text.startsWith('UPDATE "apikey" SET "suffix"'))
        ?.values,
    ).toEqual(['1234', 'key-1']);
  });

  it('records api_key.revoked by the key id under the session user', async () => {
    const { sql, statements } = recordingSql();

    await runAfterHook(sql, {
      path: '/api-key/delete',
      body: { keyId: 'key-1' },
      context: { returned: { success: true }, session: SESSION },
    });

    expect(audited()).toEqual([
      expect.objectContaining({
        organizationId: 'org-1',
        actorId: 'user-1',
        actorEmail: 'ada@example.test',
        action: 'api_key.revoked',
        resourceType: 'api_key',
        resourceId: 'key-1',
      }),
      expect.objectContaining({
        organizationId: 'org-2',
        action: 'api_key.revoked',
      }),
    ]);
    expect(audited()[0]).not.toHaveProperty('resourceName');
    // The session carried the e-mail: no lookup.
    expect(
      statements.some((s) => s.text.startsWith('SELECT "email" FROM "user"')),
    ).toBe(false);
  });

  it('records api_key.updated with the fields the body changed', async () => {
    const { sql } = recordingSql();

    await runAfterHook(sql, {
      path: '/api-key/update',
      body: { keyId: 'key-1', name: 'CI 2', expiresIn: 3600 },
      context: {
        returned: {
          id: 'key-1',
          name: 'CI 2',
          enabled: true,
          expiresAt: new Date(1_800_000_000_000),
          referenceId: 'user-1',
        },
        session: SESSION,
      },
    });

    expect(audited()[0]).toEqual(
      expect.objectContaining({
        action: 'api_key.updated',
        resourceId: 'key-1',
        resourceName: 'CI 2',
        changedFields: ['expiresIn', 'name'],
        newState: { name: 'CI 2', enabled: true, expiresAt: 1_800_000_000_000 },
      }),
    );
    expect(audited()).toHaveLength(2);
  });

  it('records nothing for a refused call or another path', async () => {
    const { sql } = recordingSql();

    await runAfterHook(sql, {
      path: '/api-key/delete',
      body: { keyId: 'key-1' },
      context: {
        returned: new APIError('NOT_FOUND', { message: 'no such key' }),
        session: SESSION,
      },
    });
    await runAfterHook(sql, {
      path: '/api-key/get',
      body: { id: 'key-1' },
      context: { returned: { id: 'key-1', referenceId: 'user-1' } },
    });

    expect(audited()).toEqual([]);
  });

  // The key already exists (or is already gone) when the hook runs: a row
  // that cannot be written is logged, never surfaced as a failed request.
  it('never fails the caller when the audit rows cannot be written', async () => {
    createAuditLog.mockRejectedValueOnce(new Error('chain locked'));
    const { sql } = recordingSql();

    await expect(
      runAfterHook(sql, {
        path: '/api-key/delete',
        body: { keyId: 'key-1' },
        context: { returned: { success: true }, session: SESSION },
      }),
    ).resolves.toBeUndefined();
  });
});
