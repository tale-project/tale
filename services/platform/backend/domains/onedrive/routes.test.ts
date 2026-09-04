// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import type { Auth } from '../../auth/auth.ts';
import { checkOrganizationRateLimit } from '../../lib/rate-limit.ts';
import { createOneDriveRoutes } from './routes.ts';

/**
 * The regression under test: `checkOrganizationRateLimit` throws
 * `RateLimitExceededError`, and no OneDrive route caught it — a member
 * browsing the picker briskly got a 500 (and a Sentry page) instead of the
 * retryable 429 every sibling door answers. The org-wide budget is one
 * bucket for all members, so this is the picker's normal weather, not an
 * edge. Auth is stubbed to a fixed member; the limiter is stubbed spent.
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
    createOneDriveRoutes(deps).request(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

describe('OneDrive routes under a spent org budget', () => {
  it.each([
    ['/list-files', {}, 'external:onedrive-list'],
    ['/sharepoint/sites', {}, 'external:onedrive-list'],
    ['/sharepoint/drives', { siteId: 'site' }, 'external:onedrive-list'],
    [
      '/sharepoint/files',
      { siteId: 'site', driveId: 'drive' },
      'external:onedrive-list',
    ],
    [
      '/import',
      {
        items: [{ id: 'item', name: 'a.txt', size: 1 }],
        importType: 'one-time',
      },
      'external:onedrive-read',
    ],
  ] as const)('%s answers 429 with Retry-After', async (route, body, rule) => {
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
  });
});
