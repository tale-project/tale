// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import type { Auth } from '../../auth/auth.ts';
import { checkOrganizationRateLimit } from '../../lib/rate-limit.ts';
import { createGoogleDriveRoutes } from './routes.ts';

/**
 * The regression under test: the Google Drive picker and import applied no
 * rate limit at all while their OneDrive twins did — one org could hammer
 * the vendor unbounded through one door and not the other. Both lanes now
 * charge their own buckets and answer the same 429 with Retry-After when
 * spent. Auth is stubbed to a fixed member; the limiter is stubbed spent.
 */

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () =>
    async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set('sessionBundle', { user: { id: 'user-1' } });
      await next();
    },
}));

vi.mock('../../auth/org.ts', () => ({
  requireOrgMember:
    () =>
    async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set('orgId', 'org-1');
      c.set('orgMember', { role: 'admin' });
      await next();
    },
  requireOrgAbility: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

vi.mock('../../lib/rate-limit.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../lib/rate-limit.ts')>();
  return {
    ...actual,
    checkOrganizationRateLimit: vi.fn(async () => {
      throw new actual.RateLimitExceededError('spent', 2500);
    }),
  };
});

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test doubles; auth and the limiter are mocked
const deps = { sql: {} as Sql, auth: {} as Auth };

const post = (route: string, body: unknown): Promise<Response> =>
  Promise.resolve(
    createGoogleDriveRoutes(deps).request(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

describe('Google Drive routes under a spent org budget', () => {
  it.each([
    ['/list-files', {}, 'external:google-drive-list'],
    [
      '/import',
      {
        items: [{ id: 'item', name: 'a.txt', size: 1 }],
        importType: 'one-time',
      },
      'external:google-drive-read',
    ],
  ] as const)(
    '%s charges its own bucket and answers 429 with Retry-After',
    async (route, body, rule) => {
      const res = await post(route, body);

      expect(res.status).toBe(429);
      expect(res.headers.get('retry-after')).toBe('3');
      expect(await res.json()).toEqual({
        error: 'RATE_LIMITED',
        data: { retryAfterMs: 2500 },
      });
      expect(checkOrganizationRateLimit).toHaveBeenLastCalledWith(
        deps.sql,
        rule,
        'org-1',
      );
    },
  );
});
