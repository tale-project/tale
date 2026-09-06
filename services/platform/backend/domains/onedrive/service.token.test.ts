// @vitest-environment node

/**
 * The OneDrive token lane is grant-only. The retired fallback to the Better
 * Auth Microsoft login account could never yield a Files.Read token (SSO
 * sign-in strips Graph file scopes; a scope-less refresh returns a
 * scope-less token) — it only produced a misleading Graph 403 in place of
 * the actionable "connect from Documents" message, plus a token refresh and
 * an `account` row write on every scan.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveCloudAccessToken } from '../cloud_import/service.ts';
import { resolveGraphTokenForUser } from './service.ts';

vi.mock('../cloud_import/service.ts', () => ({
  resolveCloudAccessToken: vi.fn(),
}));

function recordingSql(): { sql: Sql; queries: string[] } {
  const queries: string[] = [];
  const fn = (strings: TemplateStringsArray) => {
    queries.push(strings.join('?'));
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: fn as unknown as Sql, queries };
}

const args = { organizationId: 'org-1', userId: 'user-1' };

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('resolveGraphTokenForUser', () => {
  it('serves the cloud grant', async () => {
    vi.mocked(resolveCloudAccessToken).mockResolvedValue({
      success: true,
      accessToken: 'graph-grant-token',
    });
    await expect(
      resolveGraphTokenForUser(recordingSql().sql, args),
    ).resolves.toEqual({ success: true, token: 'graph-grant-token' });
  });

  it('refuses a missing/dead grant with the connect message — no account read, no vendor call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.mocked(resolveCloudAccessToken).mockResolvedValue({
      success: false,
      error: 'Cloud import is not authorized for this provider',
      needsReauth: true,
    });
    const { sql, queries } = recordingSql();

    const result = await resolveGraphTokenForUser(sql, args);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Connect Microsoft 365 from Documents');
    }
    expect(queries).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('passes a retryable refresh failure through as itself', async () => {
    vi.mocked(resolveCloudAccessToken).mockResolvedValue({
      success: false,
      error:
        'Cloud authorization could not be refreshed right now (HTTP 503) — the next sync retries',
      needsReauth: false,
    });

    const result = await resolveGraphTokenForUser(recordingSql().sql, args);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('HTTP 503');
      expect(result.error).not.toContain('Connect Microsoft 365');
    }
  });
});
