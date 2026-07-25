import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
//
// These tests exercise the REAL `requireOrgAdminOrDeveloper` capability gate on
// top of a mocked membership primitive (the same strategy as
// agents/file_actions.test.ts): the inner `requireOrgMembershipById` is mocked
// to return a chosen role, and the real CASL `developerSettings` check decides
// whether the mutation is allowed. A plain `member` must be rejected with
// FORBIDDEN_DEVELOPER_SETTINGS before any credential delete/patch.
// ---------------------------------------------------------------------------

vi.mock('../_generated/server', () => ({
  mutation: vi.fn((config) => config),
  internalMutation: vi.fn((config) => config),
}));

vi.mock('../_generated/api', () => ({
  internal: {
    integrations: {
      cascade: { cascadeIntegration: 'cascadeIntegration' },
    },
  },
}));

const mockGetAuthUserIdentity = vi.fn();
vi.mock('../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
}));

const mockRequireOrgMembershipById = vi.fn();
vi.mock('../lib/auth/require_org_membership', () => ({
  requireOrgMembershipById: (...args: unknown[]) =>
    mockRequireOrgMembershipById(...args),
}));

vi.mock('../audit_logs/helpers', () => ({
  logSuccess: vi.fn().mockResolvedValue(undefined),
  redactSensitiveFields: (x: unknown) => x,
}));

vi.mock('./slack_installations', () => ({
  deleteSlackInstallationsForCredential: vi.fn().mockResolvedValue(undefined),
}));

const { updateCredentials, updateCredentialsInternal, deleteCredentials } =
  await import('./credential_mutations');

type MutationConfig = {
  handler: (ctx: never, args: never) => Promise<unknown>;
};

const updateHandler = (updateCredentials as unknown as MutationConfig).handler;
const updateInternalHandler = (
  updateCredentialsInternal as unknown as MutationConfig
).handler;
const deleteHandler = (deleteCredentials as unknown as MutationConfig).handler;

function createMockCtx(
  cred: Record<string, unknown> = { status: 'active', isActive: true },
) {
  return {
    db: {
      get: vi.fn().mockResolvedValue({
        _id: 'cred-1',
        organizationId: 'org-123',
        slug: 'slack',
        authMethod: 'apiKey',
        ...cred,
      }),
      patch: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    storage: { delete: vi.fn().mockResolvedValue(undefined) },
    scheduler: { runAfter: vi.fn().mockResolvedValue(undefined) },
  };
}

/** The cascade mode scheduled by a handler, or null when none was scheduled. */
function scheduledCascadeMode(
  ctx: ReturnType<typeof createMockCtx>,
): string | null {
  const call = ctx.scheduler.runAfter.mock.calls.find(
    (args: unknown[]) => args[1] === 'cascadeIntegration',
  );
  if (!call) return null;
  const payload = call[2] as { mode: string };
  return payload.mode;
}

describe('credential mutations capability gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUserIdentity.mockResolvedValue({
      userId: 'user-1',
      email: 'a@b.com',
    });
  });

  function asMember() {
    mockRequireOrgMembershipById.mockResolvedValue({
      orgId: 'org-123',
      orgSlug: 'default',
      userId: 'user-1',
      email: 'a@b.com',
      member: { _id: 'm-1', role: 'member' },
    });
  }

  function asDeveloper() {
    mockRequireOrgMembershipById.mockResolvedValue({
      orgId: 'org-123',
      orgSlug: 'default',
      userId: 'user-1',
      email: 'a@b.com',
      member: { _id: 'm-1', role: 'developer' },
    });
  }

  describe('deleteCredentials', () => {
    it('rejects a plain member and deletes nothing', async () => {
      asMember();
      const ctx = createMockCtx();

      await expect(
        deleteHandler(ctx as never, { credentialId: 'cred-1' } as never),
      ).rejects.toMatchObject({
        data: { code: 'FORBIDDEN_DEVELOPER_SETTINGS' },
      });
      expect(ctx.db.delete).not.toHaveBeenCalled();
    });

    it('allows a developer to delete the credential', async () => {
      asDeveloper();
      const ctx = createMockCtx();

      await deleteHandler(ctx as never, { credentialId: 'cred-1' } as never);

      expect(ctx.db.delete).toHaveBeenCalledWith('cred-1');
    });
  });

  describe('updateCredentials', () => {
    it('rejects a plain member and patches nothing', async () => {
      asMember();
      const ctx = createMockCtx();

      await expect(
        updateHandler(
          ctx as never,
          { credentialId: 'cred-1', status: 'inactive' } as never,
        ),
      ).rejects.toMatchObject({
        data: { code: 'FORBIDDEN_DEVELOPER_SETTINGS' },
      });
      expect(ctx.db.patch).not.toHaveBeenCalled();
    });

    it('allows a developer to update the credential', async () => {
      asDeveloper();
      const ctx = createMockCtx();

      await updateHandler(
        ctx as never,
        { credentialId: 'cred-1', errorMessage: 'x' } as never,
      );

      expect(ctx.db.patch).toHaveBeenCalled();
    });
  });

  // The cascade re-enables agents a disconnect disabled AND provisions the
  // schedules of the automations bound to the integration. It must fire on BOTH
  // connected-state edges — reconnect used to schedule nothing, which left the
  // `enable` half of cascade.ts unreachable.
  describe('connected-state cascade', () => {
    it('cascades disable when a connected credential is deactivated', async () => {
      asDeveloper();
      const ctx = createMockCtx({ status: 'active', isActive: true });

      await updateHandler(
        ctx as never,
        {
          credentialId: 'cred-1',
          isActive: false,
          status: 'inactive',
        } as never,
      );

      expect(scheduledCascadeMode(ctx)).toBe('disable');
    });

    it('cascades enable when a disconnected credential is reactivated', async () => {
      asDeveloper();
      const ctx = createMockCtx({ status: 'inactive', isActive: false });

      await updateHandler(
        ctx as never,
        { credentialId: 'cred-1', isActive: true, status: 'active' } as never,
      );

      expect(scheduledCascadeMode(ctx)).toBe('enable');
    });

    it('schedules nothing when the connected state does not change', async () => {
      asDeveloper();
      const ctx = createMockCtx({ status: 'active', isActive: true });

      await updateHandler(
        ctx as never,
        { credentialId: 'cred-1', errorMessage: 'transient' } as never,
      );

      expect(scheduledCascadeMode(ctx)).toBeNull();
    });

    it('cascades enable from the internal mutation (the OAuth2 exchange path)', async () => {
      const ctx = createMockCtx({ status: 'inactive', isActive: false });

      await updateInternalHandler(
        ctx as never,
        { credentialId: 'cred-1', isActive: true, status: 'active' } as never,
      );

      expect(scheduledCascadeMode(ctx)).toBe('enable');
    });

    it('does not cascade on an internal token refresh of a live credential', async () => {
      const ctx = createMockCtx({ status: 'active', isActive: true });

      await updateInternalHandler(
        ctx as never,
        { credentialId: 'cred-1', status: 'active', isActive: true } as never,
      );

      expect(scheduledCascadeMode(ctx)).toBeNull();
    });
  });
});
