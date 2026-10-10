// @vitest-environment node

/**
 * The release notes are open to every signed-in person: the door asks for a
 * session and for no organization or role. When nothing can be loaded it
 * answers an error with its own code, never an empty list.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Auth } from '../../auth/auth.ts';
import { createChangelogRoutes } from './routes.ts';

const { listReleases } = vi.hoisted(() => ({ listReleases: vi.fn() }));
vi.mock('./service.ts', () => ({ listReleases }));

/** The door behind an auth that answers `session` for every request. */
function doorFor(session: unknown) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  const auth = {
    api: { getSession: () => Promise.resolve(session) },
  } as unknown as Auth;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- never queried
  return createChangelogRoutes({ sql: {} as unknown as Sql, auth });
}

const MEMBER = {
  user: { id: 'u-mia', email: 'mia@example.test', name: 'Mia' },
  session: { id: 's-1' },
};

const RELEASE = {
  tag: 'v0.5.9',
  version: '0.5.9',
  name: null,
  body: null,
  htmlUrl: 'https://example.test/releases/v0.5.9',
  publishedAt: null,
};

describe('the release notes door', () => {
  beforeEach(() => {
    listReleases.mockReset();
  });

  it('answers a signed-in person who holds no organization role [CLOG-R1]', async () => {
    listReleases.mockResolvedValue([RELEASE]);
    const res = await doorFor(MEMBER).request('/releases?from=0.5.8');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ releases: [RELEASE] });
    expect(listReleases).toHaveBeenCalledWith({ from: '0.5.8' });
  });

  it('refuses a request without a session, reading nothing [CLOG-R1]', async () => {
    const res = await doorFor(null).request('/releases');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(listReleases).not.toHaveBeenCalled();
  });

  it('answers CHANGELOG_UNAVAILABLE when no release can be loaded [CLOG-R4]', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      listReleases.mockRejectedValue(new Error('offline'));
      const res = await doorFor(MEMBER).request('/releases');
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'CHANGELOG_UNAVAILABLE' });
    } finally {
      warn.mockRestore();
    }
  });
});
