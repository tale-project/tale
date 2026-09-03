import { describe, expect, it, vi } from 'vitest';

import {
  scimGroupResourceImpl,
  scimUserResourceImpl,
  type ScimRc,
} from './http_actions';

/**
 * Per-resource SCIM ops must resolve the SAME resource id on both mounts:
 * the bare `/scim/v2` one and the 0.4 proxy-era `/http_api/scim/v2` alias —
 * the tenant URL the admin UI advertises to IdPs and the one `meta.location`
 * carries. `/http_api/scim/` is exactly as long as `/scim/v2/Users/`, so the
 * old blind prefix slice parsed the alias path into `id: 'v2'`: an IdP
 * configured with the advertised URL could create and list users but every
 * GET/PUT/PATCH/DELETE on `/Users/:id` and `/Groups/:id` answered 404 —
 * offboarding silently failed.
 */

function stubRc(): {
  rc: ScimRc;
  runQuery: ReturnType<typeof vi.fn>;
  runMutation: ReturnType<typeof vi.fn>;
} {
  // Queries answer "no record" and mutations "not-found": the dispatchers
  // then 404 with the id they RESOLVED, which is exactly what these tests
  // pin — resolution, not the data layer.
  const runQuery = vi.fn(async () => null);
  const runMutation = vi.fn(async () => 'not-found');
  const ctx = { runQuery, runMutation, runAction: vi.fn() };
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test stub
    rc: { ctx: ctx as never, organizationId: 'org_1', defaultRole: 'member' },
    runQuery,
    runMutation,
  };
}

describe('scimUserResourceImpl id resolution', () => {
  it.each([
    ['bare mount', 'https://tale.example/scim/v2/Users/u_123'],
    ['alias mount', 'https://tale.example/http_api/scim/v2/Users/u_123'],
  ])('resolves the user id on the %s', async (_mount, url) => {
    const { rc, runQuery } = stubRc();
    const res = await scimUserResourceImpl(rc, new Request(url));
    expect(runQuery).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org_1',
      userId: 'u_123',
    });
    // The stub has no record, so the honest answer is a 404 naming the REAL
    // id — never a 400 "Missing user id" or a lookup of the mis-parsed 'v2'.
    expect(res.status).toBe(404);
  });

  it('deletes by the real id on the alias mount', async () => {
    const { rc, runMutation } = stubRc();
    const res = await scimUserResourceImpl(
      rc,
      new Request('https://tale.example/http_api/scim/v2/Users/u_123', {
        method: 'DELETE',
      }),
    );
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org_1',
      userId: 'u_123',
    });
    expect(res.status).toBe(404);
  });

  it('still answers 400 when no id follows the collection path', async () => {
    const { rc, runQuery } = stubRc();
    const res = await scimUserResourceImpl(
      rc,
      new Request('https://tale.example/scim/v2/Users'),
    );
    expect(res.status).toBe(400);
    expect(runQuery).not.toHaveBeenCalled();
  });
});

describe('scimGroupResourceImpl id resolution', () => {
  it.each([
    ['bare mount', 'https://tale.example/scim/v2/Groups/team_9'],
    ['alias mount', 'https://tale.example/http_api/scim/v2/Groups/team_9'],
  ])('resolves the group id on the %s', async (_mount, url) => {
    const { rc, runQuery } = stubRc();
    const res = await scimGroupResourceImpl(rc, new Request(url));
    expect(runQuery).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org_1',
      teamId: 'team_9',
    });
    expect(res.status).toBe(404);
  });
});
