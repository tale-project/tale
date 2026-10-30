import { describe, expect, it, vi } from 'vitest';

import { isRecord } from '../../../lib/utils/type-utils';
import {
  scimGroupResourceImpl,
  scimGroupsImpl,
  scimUserResourceImpl,
  scimUsersImpl,
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

/**
 * Listing pages are delegated to the query: the dispatcher hands over the
 * RFC 7644 window (startIndex-1 / count, clamped) and reports the total the
 * query answers — it no longer loads and sorts the whole collection.
 */
describe('list paging is delegated to the query', () => {
  function pagedRc(
    records: unknown[],
    total: number,
  ): {
    rc: ScimRc;
    runQuery: ReturnType<typeof vi.fn>;
  } {
    const runQuery = vi.fn(async () => ({ records, total }));
    const ctx = { runQuery, runMutation: vi.fn(), runAction: vi.fn() };
    return {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test stub
      rc: { ctx: ctx as never, organizationId: 'org_1', defaultRole: 'member' },
      runQuery,
    };
  }

  it('lists users with the requested window and the collection total', async () => {
    const { rc, runQuery } = pagedRc(
      [{ userId: 'u_3', email: 'c@x.test', name: 'C', active: true }],
      7,
    );
    const res = await scimUsersImpl(
      rc,
      new Request('https://tale.example/scim/v2/Users?startIndex=3&count=2'),
    );
    expect(runQuery).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org_1',
      offset: 2,
      limit: 2,
    });
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(body).toMatchObject({
      totalResults: 7,
      startIndex: 3,
      itemsPerPage: 1,
    });
  });

  it('clamps the window to the RFC bounds before asking', async () => {
    const { rc, runQuery } = pagedRc([], 0);
    await scimGroupsImpl(
      rc,
      new Request('https://tale.example/scim/v2/Groups?startIndex=0&count=999'),
    );
    expect(runQuery).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org_1',
      offset: 0,
      limit: 200,
    });
  });
});

/**
 * `externalId` is the identity provider's own id for a resource (RFC 7643
 * §3.1), and a PATCH may set it like any other writable attribute (RFC 7644
 * §3.5.2). A PUT stored it, but the PATCH dispatchers dropped it and answered
 * 200 with the resource as it was, so a provider that keeps its directory in
 * step through PATCH left a stale `externalId` behind (#4773).
 */
describe('PATCH hands the write the externalId, as PUT does', () => {
  const USER_URL = 'https://tale.example/scim/v2/Users/u_1';
  const GROUP_URL = 'https://tale.example/scim/v2/Groups/t_1';
  const user = {
    userId: 'u_1',
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    active: true,
    externalId: 'idp-1',
  };
  const group = {
    teamId: 't_1',
    displayName: 'Finance',
    memberUserIds: [],
    externalId: 'idp-1',
  };

  /** Reads answer the stored record; `written` is what the dispatcher asked
   * its one mutation to write. */
  async function send(
    impl: typeof scimUserResourceImpl,
    url: string,
    method: 'PATCH' | 'PUT',
    body: unknown,
  ): Promise<{ status: number; written: Record<string, unknown> | undefined }> {
    const runQuery = vi.fn(async (_ref: unknown, args: object) =>
      'userId' in args ? user : group,
    );
    const runMutation = vi.fn(async (_ref: unknown, _args: unknown) => null);
    const ctx = { runQuery, runMutation, runAction: vi.fn() };
    const res = await impl(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test stub
      { ctx: ctx as never, organizationId: 'org_1', defaultRole: 'member' },
      new Request(url, {
        method,
        headers: { 'content-type': 'application/scim+json' },
        body: JSON.stringify(body),
      }),
    );
    const written = runMutation.mock.calls[0]?.[1];
    return {
      status: res.status,
      written: isRecord(written) ? written : undefined,
    };
  }

  const patchOp = (operation: unknown) => ({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
    Operations: [operation],
  });

  it.each([
    [
      'a user, by path',
      scimUserResourceImpl,
      USER_URL,
      { op: 'replace', path: 'externalId', value: 'idp-9' },
    ],
    [
      'a user, in a path-less value',
      scimUserResourceImpl,
      USER_URL,
      { op: 'replace', value: { externalId: 'idp-9' } },
    ],
    [
      'a group, by path',
      scimGroupResourceImpl,
      GROUP_URL,
      { op: 'replace', path: 'externalId', value: 'idp-9' },
    ],
    [
      'a group, in a path-less value',
      scimGroupResourceImpl,
      GROUP_URL,
      { op: 'replace', value: { externalId: 'idp-9' } },
    ],
  ])(
    'writes the externalId a PATCH sets on %s',
    async (_case, impl, url, operation) => {
      const { status, written } = await send(
        impl,
        url,
        'PATCH',
        patchOp(operation),
      );

      expect(status).toBe(200);
      expect(written?.externalId).toBe('idp-9');
    },
  );

  it('leaves the stored externalId alone when a PATCH does not name it', async () => {
    const userPatch = await send(
      scimUserResourceImpl,
      USER_URL,
      'PATCH',
      patchOp({ op: 'replace', path: 'displayName', value: 'Ada L' }),
    );
    expect(userPatch.written).toMatchObject({ name: 'Ada L' });
    expect(userPatch.written?.externalId).toBeUndefined();

    const groupPatch = await send(
      scimGroupResourceImpl,
      GROUP_URL,
      'PATCH',
      patchOp({ op: 'replace', path: 'displayName', value: 'Platform' }),
    );
    expect(groupPatch.written).toMatchObject({ displayName: 'Platform' });
    expect(groupPatch.written?.externalId).toBeUndefined();
  });

  it('writes the externalId a PUT of the same resource writes', async () => {
    const userPut = await send(scimUserResourceImpl, USER_URL, 'PUT', {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: 'ada@example.com',
      externalId: 'idp-9',
      active: true,
    });
    expect(userPut.written?.externalId).toBe('idp-9');

    const groupPut = await send(scimGroupResourceImpl, GROUP_URL, 'PUT', {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
      displayName: 'Finance',
      externalId: 'idp-9',
      members: [],
    });
    expect(groupPut.written?.externalId).toBe('idp-9');
  });
});

/**
 * A list filter the dispatcher does not evaluate — another attribute, another
 * operator, or one it cannot read — is declined with 400 `invalidFilter`
 * (RFC 7644 §3.4.2.2, §3.12), before any lookup. An empty list would tell the
 * IdP that the member or team is missing, and it would create it again.
 */
describe('a filter Tale cannot evaluate is declined [SCIM-R9]', () => {
  const SUPPORTED = { Users: 'userName eq', Groups: 'displayName eq' } as const;

  async function list(
    collection: 'Users' | 'Groups',
    filter: string,
  ): Promise<{ res: Response; runQuery: ReturnType<typeof vi.fn> }> {
    const { rc, runQuery } = stubRc();
    const impl = collection === 'Users' ? scimUsersImpl : scimGroupsImpl;
    const res = await impl(
      rc,
      new Request(
        `https://tale.example/scim/v2/${collection}?filter=${encodeURIComponent(filter)}`,
      ),
    );
    return { res, runQuery };
  }

  it.each([
    ['Users', 'externalId eq "abc-123"'],
    ['Users', 'userName co "ada"'],
    ['Users', 'userName eq "ada@example.com" and active eq true'],
    ['Users', 'userName eq'],
    ['Groups', 'externalId eq "grp-1"'],
    ['Groups', 'displayName sw "Fin"'],
    ['Groups', 'displayName eq "Finance'],
  ] as const)(
    'answers %s?filter=%s with 400 invalidFilter',
    async (collection, filter) => {
      const { res, runQuery } = await list(collection, filter);
      expect(res.status).toBe(400);
      const body: unknown = await res.json();
      expect(body).toMatchObject({
        scimType: 'invalidFilter',
        status: '400',
        detail: expect.stringContaining(SUPPORTED[collection]),
      });
      expect(runQuery).not.toHaveBeenCalled();
    },
  );

  it('still looks up a user by userName eq', async () => {
    const { res, runQuery } = await list(
      'Users',
      'userName eq "Ada@Example.com"',
    );
    expect(res.status).toBe(200);
    expect(runQuery).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org_1',
      userName: 'ada@example.com',
    });
  });

  it('still looks up a group by displayName eq', async () => {
    const { res, runQuery } = await list('Groups', 'displayName eq "Finance"');
    expect(res.status).toBe(200);
    expect(runQuery).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org_1',
      displayName: 'Finance',
    });
  });
});
