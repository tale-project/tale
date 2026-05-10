import { ConvexError } from 'convex/values';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../_generated/api', () => ({
  components: {
    betterAuth: { adapter: { findMany: 'betterAuth:adapter:findMany' } },
  },
  internal: {
    governance: {
      erasure: {
        beginProcessing: 'beginProcessing',
        eraseThreadById: 'eraseThreadById',
        finalizeProcessing: 'finalizeProcessing',
        eraseSubjectDocuments: 'eraseSubjectDocuments',
        eraseSubjectUserMemories: 'eraseSubjectUserMemories',
        eraseSubjectUserPreferences: 'eraseSubjectUserPreferences',
        eraseSubjectMessageFeedback: 'eraseSubjectMessageFeedback',
        eraseSubjectFileMetadata: 'eraseSubjectFileMetadata',
        eraseSubjectUsageLedger: 'eraseSubjectUsageLedger',
        eraseSubjectTwoFactorAttempts: 'eraseSubjectTwoFactorAttempts',
        eraseSubjectPolicyAcknowledgements:
          'eraseSubjectPolicyAcknowledgements',
        eraseSubjectOnedrive: 'eraseSubjectOnedrive',
        eraseSubjectLoginAttempts: 'eraseSubjectLoginAttempts',
        eraseSubjectNotifications: 'eraseSubjectNotifications',
        lookupSubjectEmail: 'lookupSubjectEmail',
        processErasureRequest: 'processErasureRequest',
      },
    },
    audit_logs: {
      internal_mutations: {
        createAuditLog: 'createAuditLog',
        scrubSubjectAuditLogs: 'scrubSubjectAuditLogs',
      },
    },
  },
}));

const mockGetAuthUser = vi.fn();
vi.mock('../../auth', () => ({
  authComponent: {
    getAuthUser: (...args: unknown[]) => mockGetAuthUser(...args),
  },
}));

const mockGetOrganizationMember = vi.fn();
vi.mock('../../lib/rls/organization/get_organization_member', () => ({
  getOrganizationMember: (...args: unknown[]) =>
    mockGetOrganizationMember(...args),
}));

const mockCreateAuditLog = vi.fn(
  async (..._args: unknown[]) => 'audit_id' as const,
);
vi.mock('../../audit_logs/helpers', () => ({
  createAuditLog: (...args: unknown[]) => mockCreateAuditLog(...args),
}));

vi.mock('../../lib/helpers/pii_hash', () => ({
  hashEmailForAudit: vi.fn(),
}));

vi.mock('../../lib/helpers/rag_config', () => ({
  ragFetch: vi.fn(),
}));

vi.mock('../../threads/cascade_helpers', () => ({
  cascadeDeleteThreadChildren: vi.fn(),
}));

vi.mock('../erase_document_blobs', () => ({
  eraseDocumentBlobs: vi.fn(),
}));

vi.mock('../legal_hold', () => ({
  loadActiveHolds: vi.fn(async () => ({
    orgHeld: false,
    userMembershipIds: new Set<string>(),
  })),
}));

vi.mock('../../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    mutation: (config: Record<string, unknown>) => config,
    internalMutation: (config: Record<string, unknown>) => config,
    internalAction: (config: Record<string, unknown>) => config,
  };
});

const DAY_MS = 86_400_000;
const NOW = 1_700_000_000_000;
const SLA_DEFAULT = NOW + 30 * DAY_MS;

const ADMIN_USER = { _id: 'admin_user', email: 'admin@example.com' };
const MEMBER_USER = { _id: 'member_user', email: 'member@example.com' };

interface ErasureRow {
  _id: string;
  organizationId: string;
  targetUserId: string;
  reason: string;
  reasonCode?: string;
  requestedBy: string;
  requestedAt: number;
  slaDeadlineAt: number;
  status: string;
  extensionGrantedAt?: number;
  extensionGrantedBy?: string;
  extensionReason?: string;
  extensionDeadlineAt?: number;
}

function createMockCtx(rows: ErasureRow[]) {
  return {
    db: {
      get: vi.fn(async (id: string) => rows.find((r) => r._id === id) ?? null),
      patch: vi.fn(async (_id: string, patch: Partial<ErasureRow>) => {
        const idx = rows.findIndex((r) => r._id === _id);
        if (idx >= 0) rows[idx] = { ...rows[idx], ...patch };
      }),
    },
  };
}

function rowFixture(overrides: Partial<ErasureRow> = {}): ErasureRow {
  return {
    _id: 'er_1',
    organizationId: 'org_1',
    targetUserId: 'user_target',
    reason: 'r',
    reasonCode: 'consent_withdrawn',
    requestedBy: 'admin_user',
    requestedAt: NOW,
    slaDeadlineAt: SLA_DEFAULT,
    status: 'pending',
    ...overrides,
  };
}

describe('extendErasureDeadline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it('rejects when caller is not authenticated', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const { extendErasureDeadline } =
      (await import('../erasure')) as unknown as {
        extendErasureDeadline: { handler: Function };
      };
    const ctx = createMockCtx([rowFixture()]);
    await expect(
      extendErasureDeadline.handler(ctx, {
        requestId: 'er_1',
        extraDays: 7,
        extensionReason: 'complex multi-jurisdiction review',
      }),
    ).rejects.toThrow(/sign in/i);
  });

  it('rejects when caller is not an admin', async () => {
    mockGetAuthUser.mockResolvedValue(MEMBER_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'member' });
    const { extendErasureDeadline } =
      (await import('../erasure')) as unknown as {
        extendErasureDeadline: { handler: Function };
      };
    const ctx = createMockCtx([rowFixture()]);
    await expect(
      extendErasureDeadline.handler(ctx, {
        requestId: 'er_1',
        extraDays: 7,
        extensionReason: 'complex multi-jurisdiction review',
      }),
    ).rejects.toThrow(/admin/i);
  });

  it('rejects extraDays out of range', async () => {
    mockGetAuthUser.mockResolvedValue(ADMIN_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'admin' });
    const { extendErasureDeadline } =
      (await import('../erasure')) as unknown as {
        extendErasureDeadline: { handler: Function };
      };
    const ctx = createMockCtx([rowFixture()]);
    for (const extraDays of [0, -3, 61, 9999]) {
      await expect(
        extendErasureDeadline.handler(ctx, {
          requestId: 'er_1',
          extraDays,
          extensionReason: 'complex multi-jurisdiction review',
        }),
      ).rejects.toThrow(/extraDays/);
    }
  });

  it('rejects extensionReason shorter than 10 chars', async () => {
    mockGetAuthUser.mockResolvedValue(ADMIN_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'admin' });
    const { extendErasureDeadline } =
      (await import('../erasure')) as unknown as {
        extendErasureDeadline: { handler: Function };
      };
    const ctx = createMockCtx([rowFixture()]);
    await expect(
      extendErasureDeadline.handler(ctx, {
        requestId: 'er_1',
        extraDays: 7,
        extensionReason: 'short',
      }),
    ).rejects.toThrow(/10 characters/);
  });

  it('rejects extension on terminal (done/failed) requests', async () => {
    mockGetAuthUser.mockResolvedValue(ADMIN_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'admin' });
    const { extendErasureDeadline } =
      (await import('../erasure')) as unknown as {
        extendErasureDeadline: { handler: Function };
      };
    for (const status of ['done', 'failed'] as const) {
      const ctx = createMockCtx([rowFixture({ status })]);
      await expect(
        extendErasureDeadline.handler(ctx, {
          requestId: 'er_1',
          extraDays: 7,
          extensionReason: 'complex multi-jurisdiction review',
        }),
      ).rejects.toMatchObject({
        data: { code: 'NOT_EXTENDABLE' },
      });
    }
  });

  it('rejects a second extension once one has been granted', async () => {
    mockGetAuthUser.mockResolvedValue(ADMIN_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'admin' });
    const { extendErasureDeadline } =
      (await import('../erasure')) as unknown as {
        extendErasureDeadline: { handler: Function };
      };
    const ctx = createMockCtx([
      rowFixture({
        extensionGrantedAt: NOW - DAY_MS,
        extensionGrantedBy: 'admin_other',
        extensionReason: 'prior reason',
        extensionDeadlineAt: SLA_DEFAULT + 30 * DAY_MS,
      }),
    ]);
    await expect(
      extendErasureDeadline.handler(ctx, {
        requestId: 'er_1',
        extraDays: 30,
        extensionReason: 'second extension attempt',
      }),
    ).rejects.toMatchObject({
      data: { code: 'ALREADY_EXTENDED' },
    });
  });

  it('rejects when slaDeadlineAt has already lapsed', async () => {
    mockGetAuthUser.mockResolvedValue(ADMIN_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'admin' });
    const { extendErasureDeadline } =
      (await import('../erasure')) as unknown as {
        extendErasureDeadline: { handler: Function };
      };
    const ctx = createMockCtx([rowFixture({ slaDeadlineAt: NOW - DAY_MS })]);
    await expect(
      extendErasureDeadline.handler(ctx, {
        requestId: 'er_1',
        extraDays: 7,
        extensionReason: 'complex multi-jurisdiction review',
      }),
    ).rejects.toMatchObject({
      data: { code: 'DEADLINE_LAPSED' },
    });
  });

  it('grants the extension on a valid request and writes the audit row', async () => {
    mockGetAuthUser.mockResolvedValue(ADMIN_USER);
    mockGetOrganizationMember.mockResolvedValue({ role: 'admin' });
    const { extendErasureDeadline } =
      (await import('../erasure')) as unknown as {
        extendErasureDeadline: { handler: Function };
      };
    const rows = [rowFixture({ status: 'partial' })];
    const ctx = createMockCtx(rows);
    const result = await extendErasureDeadline.handler(ctx, {
      requestId: 'er_1',
      extraDays: 14,
      extensionReason: 'complex multi-jurisdiction review',
    });
    expect(result.extensionDeadlineAt).toBe(SLA_DEFAULT + 14 * DAY_MS);
    expect(rows[0].extensionGrantedAt).toBe(NOW);
    expect(rows[0].extensionGrantedBy).toBe('admin_user');
    expect(rows[0].extensionReason).toBe('complex multi-jurisdiction review');
    expect(rows[0].extensionDeadlineAt).toBe(SLA_DEFAULT + 14 * DAY_MS);
    expect(mockCreateAuditLog).toHaveBeenCalledTimes(1);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        action: 'gdpr_erasure_extended',
        category: 'admin',
        resourceType: 'user',
        status: 'success',
      }),
    );
  });
});

// Smoke check that ConvexError is reachable in this env (used in matchers).
describe('module sanity', () => {
  it('exposes ConvexError', () => {
    expect(typeof ConvexError).toBe('function');
  });
});
