import { describe, expect, it, vi } from 'vitest';

import type { MutationCtx } from '../_generated/server';

vi.mock('../lib/helpers/audit_hash', () => ({
  computeAuditHash: vi.fn().mockResolvedValue('hash_stub'),
}));

import { logJoinedOrganization } from './helpers';

type AuditEntry = {
  actorId: string;
  action: string;
  organizationId: string;
};

function createMockCtx(byActorEntries: AuditEntry[] = []) {
  const insert = vi.fn().mockResolvedValue('audit_log_1');
  const patch = vi.fn().mockResolvedValue(undefined);

  // Query #1 — `by_organizationId_and_actorId` for dedup. Returns the
  // entries the caller pre-seeded.
  const dedupIterable = {
    [Symbol.asyncIterator]: async function* () {
      for (const entry of byActorEntries) {
        yield entry;
      }
    },
  };
  const dedupWithIndex = vi.fn().mockReturnValue(dedupIterable);

  // Query #2 — `by_organizationId_and_timestamp` for previousHash lookup
  // inside createAuditLog. Returns no prior entry → empty hash chain.
  const orderResult = { first: vi.fn().mockResolvedValue(null) };
  const chainWithIndex = vi.fn().mockReturnValue({
    order: vi.fn().mockReturnValue(orderResult),
  });

  // Query #3 — `by_organizationId` on `auditLogChainGenesis` (Round-2
  // CRITICAL #10 fix). Returns no existing sentinel → createAuditLog
  // takes the insert path. The actual side-effect is mocked via the
  // shared `insert` spy below.
  const genesisFirst = vi.fn().mockResolvedValue(null);

  const query = vi.fn().mockImplementation((tableName: string) => ({
    withIndex: vi.fn().mockImplementation((indexName: string) => {
      if (
        tableName === 'auditLogChainGenesis' &&
        indexName === 'by_organizationId'
      ) {
        return { first: genesisFirst };
      }
      if (indexName === 'by_organizationId_and_actorId') {
        return dedupIterable;
      }
      if (indexName === 'by_organizationId_and_timestamp') {
        return { order: () => orderResult };
      }
      throw new Error(`unexpected index: ${indexName}`);
    }),
  }));

  const ctx = {
    db: {
      query,
      insert,
      patch,
    },
  } as unknown as MutationCtx;

  return { ctx, insert, patch, dedupWithIndex, chainWithIndex };
}

describe('logJoinedOrganization', () => {
  const opts = {
    organizationId: 'org_1',
    userId: 'user_1',
    userEmail: 'user@example.com',
    userRole: 'member',
  };

  it('writes a joined_organization row when no prior entry exists', async () => {
    const { ctx, insert } = createMockCtx([]);

    const result = await logJoinedOrganization(ctx, opts);

    expect(result).toBe('audit_log_1');
    // Round-2 CRITICAL #10 fix: createAuditLog now also inserts an
    // `auditLogChainGenesis` sentinel row on first write per org.
    // Filter the assertion to only count `auditLogs` inserts.
    const auditLogInserts = insert.mock.calls.filter(
      ([table]) => table === 'auditLogs',
    );
    expect(auditLogInserts).toHaveLength(1);
    expect(insert).toHaveBeenCalledWith(
      'auditLogs',
      expect.objectContaining({
        organizationId: 'org_1',
        actorId: 'user_1',
        actorEmail: 'user@example.com',
        actorRole: 'member',
        actorType: 'user',
        action: 'joined_organization',
        category: 'member',
        resourceType: 'organization',
        resourceId: 'org_1',
        status: 'success',
      }),
    );
  });

  it('skips the write when a prior joined_organization row exists', async () => {
    const { ctx, insert } = createMockCtx([
      {
        actorId: 'user_1',
        action: 'joined_organization',
        organizationId: 'org_1',
      },
    ]);

    const result = await logJoinedOrganization(ctx, opts);

    expect(result).toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });

  it('does not skip when prior rows are for unrelated actions only', async () => {
    const { ctx, insert } = createMockCtx([
      {
        actorId: 'user_1',
        action: 'signed_in_to_organization',
        organizationId: 'org_1',
      },
      {
        actorId: 'user_1',
        action: 'add_member',
        organizationId: 'org_1',
      },
    ]);

    await logJoinedOrganization(ctx, opts);

    const auditLogInserts = insert.mock.calls.filter(
      ([table]) => table === 'auditLogs',
    );
    expect(auditLogInserts).toHaveLength(1);
  });
});
