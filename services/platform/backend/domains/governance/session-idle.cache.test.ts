// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(() => Promise.resolve()),
}));

import { revokeIdleSessions } from './session-idle.ts';

const NOW = Date.parse('2026-10-08T12:00:00Z');

/** One org, one member, one session last touched `idleMs` ago. */
function world(idleMs: number) {
  const deleted: string[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('DELETE FROM "session"')) {
      deleted.push(...(values[0] as string[]));
      return Promise.resolve([]);
    }
    if (text.includes('FROM "organization"'))
      return Promise.resolve([{ id: 'o1' }]);
    if (text.includes('FROM "member"')) {
      return Promise.resolve([{ userId: 'u1', organizationId: 'o1' }]);
    }
    if (text.includes('FROM "session"')) {
      return Promise.resolve([
        {
          id: 's1',
          userId: 'u1',
          updatedAt: new Date(NOW - idleMs),
          expiresAt: new Date(NOW + 86_400_000),
        },
      ]);
    }
    return Promise.resolve([]);
  }) as unknown as Sql;
  Object.assign(sql, {
    begin: (run: (tx: Sql) => Promise<unknown>) => run(sql),
  });
  return { sql, deleted };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('idle revocation beside the session cookie cache', () => {
  it('revokes a session idle past its window when the cache is off', async () => {
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', '10');
    const { sql, deleted } = world(10 * 60_000 + 30_000);
    expect((await revokeIdleSessions(sql, { now: NOW })).revoked).toBe(1);
    expect(deleted).toEqual(['s1']);
  });

  it('allows for the cache: a stamp that may lag by the cache length is not idle yet', async () => {
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', '10');
    vi.stubEnv('SESSION_COOKIE_CACHE_SECONDS', '60');
    const lagging = world(10 * 60_000 + 30_000);
    expect((await revokeIdleSessions(lagging.sql, { now: NOW })).revoked).toBe(
      0,
    );
    const idle = world(10 * 60_000 + 90_000);
    expect((await revokeIdleSessions(idle.sql, { now: NOW })).revoked).toBe(1);
  });
});
