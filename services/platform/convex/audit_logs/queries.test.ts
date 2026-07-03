import { describe, it, expect, vi, beforeEach } from 'vitest';

// #2016: the `!authUser` gates in the public audit-log queries must throw
// `ConvexError({ code: 'UNAUTHENTICATED' })` so the client can branch on the
// structured code. `read_access.test.ts` covers the FORBIDDEN (admin) path via
// `assertAuditLogReadAccess`; these tests lock the UNAUTHENTICATED `data.code`
// on the four query handlers themselves.

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    query: (config: Record<string, unknown>) => config,
  };
});

const mockGetAuthUserIdentity = vi.fn();
const mockGetOrganizationMember = vi.fn();
vi.mock('../lib/rls', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
  getOrganizationMember: (...args: unknown[]) =>
    mockGetOrganizationMember(...args),
}));

// Helpers/validators sit past the auth gate — stub them so importing
// queries.ts stays a unit test.
vi.mock('./helpers', () => ({
  listAuditLogs: vi.fn(),
  getActivitySummary: vi.fn(),
}));
vi.mock('./list_audit_logs_paginated', () => ({
  listAuditLogsPaginated: vi.fn(),
}));
vi.mock('./validators', () => ({
  auditLogFilterValidator: 'auditLogFilter:validator',
  auditLogItemValidator: 'auditLogItem:validator',
}));

vi.mock('convex/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('convex/server')>();
  return {
    ...actual,
    paginationOptsValidator: 'paginationOpts:validator',
  };
});

vi.mock('convex/values', () => {
  const stub = () => 'validator';
  return {
    v: {
      string: stub,
      number: stub,
      boolean: stub,
      optional: stub,
      union: stub,
      object: stub,
      literal: stub,
      array: stub,
      null: stub,
      id: stub,
      any: stub,
      record: stub,
    },
    ConvexError: class ConvexError extends Error {
      data: unknown;
      constructor(data: unknown) {
        super(typeof data === 'string' ? data : JSON.stringify(data));
        this.data = data;
      }
    },
  };
});

// The `query` mock replaces the Convex builder with an identity function, so
// the runtime shape is `{ args, returns, handler }`. The module's static type
// stays the original Convex function reference, hence the narrowing here.
// Treated as a "third-party gap" per AGENTS.md.
//
// oxlint-disable-next-line typescript/no-explicit-any -- see above
type QueryHandler = { handler: (...args: unknown[]) => Promise<any> };
async function importQueries(): Promise<Record<string, QueryHandler>> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
  return (await import('./queries')) as unknown as Record<string, QueryHandler>;
}

const PAGINATION = { numItems: 20, cursor: null };

const UNAUTH_GATED: Array<{ name: string; args: Record<string, unknown> }> = [
  { name: 'listAuditLogs', args: { organizationId: 'org_1' } },
  {
    name: 'listAuditLogsPaginated',
    args: { paginationOpts: PAGINATION, organizationId: 'org_1' },
  },
  {
    name: 'listErrorLogsPaginated',
    args: { paginationOpts: PAGINATION, organizationId: 'org_1' },
  },
  { name: 'getActivitySummary', args: { organizationId: 'org_1' } },
  {
    name: 'getAuditLogById',
    args: { organizationId: 'org_1', logId: 'log_1' },
  },
];

describe('audit_logs/queries UNAUTHENTICATED gate codes (#2016)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(UNAUTH_GATED)(
    '$name throws ConvexError UNAUTHENTICATED when not signed in',
    async ({ name, args }) => {
      mockGetAuthUserIdentity.mockResolvedValue(null);
      const handlers = await importQueries();
      const ctx = { db: {} };
      await expect(handlers[name].handler(ctx, args)).rejects.toMatchObject({
        data: { code: 'UNAUTHENTICATED' },
      });
    },
  );
});

// getAuditLogById backs the #1845 deep link + integrity-panel "open row". It is
// admin-gated and must fail closed (return null, never leak) for a malformed id
// or a row that belongs to another org.
describe('audit_logs/queries getAuditLogById', () => {
  const ROW = {
    _id: 'log_1',
    organizationId: 'org_1',
    action: 'add_member',
    timestamp: 1,
  };

  function makeCtx(rowsById: Record<string, unknown>) {
    return {
      db: {
        // Mirror Convex: an id that doesn't belong to the table normalizes to
        // null; a valid one passes through.
        normalizeId: (_table: string, id: string) =>
          id === 'malformed' ? null : id,
        get: async (id: string) => rowsById[id] ?? null,
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUserIdentity.mockResolvedValue({ subject: 'user_1' });
  });

  it('returns the row for an admin when id + org match', async () => {
    mockGetOrganizationMember.mockResolvedValue({ role: 'admin' });
    const handlers = await importQueries();
    const result = await handlers.getAuditLogById.handler(
      makeCtx({ log_1: ROW }),
      { organizationId: 'org_1', logId: 'log_1' },
    );
    expect(result).toEqual(ROW);
  });

  it('returns null when the row belongs to a different org', async () => {
    mockGetOrganizationMember.mockResolvedValue({ role: 'admin' });
    const handlers = await importQueries();
    const result = await handlers.getAuditLogById.handler(
      makeCtx({ log_1: { ...ROW, organizationId: 'org_2' } }),
      { organizationId: 'org_1', logId: 'log_1' },
    );
    expect(result).toBeNull();
  });

  it('returns null for a malformed id', async () => {
    mockGetOrganizationMember.mockResolvedValue({ role: 'admin' });
    const handlers = await importQueries();
    const result = await handlers.getAuditLogById.handler(makeCtx({}), {
      organizationId: 'org_1',
      logId: 'malformed',
    });
    expect(result).toBeNull();
  });

  it('throws FORBIDDEN for a non-admin member', async () => {
    mockGetOrganizationMember.mockResolvedValue({ role: 'member' });
    const handlers = await importQueries();
    await expect(
      handlers.getAuditLogById.handler(makeCtx({ log_1: ROW }), {
        organizationId: 'org_1',
        logId: 'log_1',
      }),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
  });
});
