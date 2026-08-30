import { describe, expect, it, vi, beforeEach } from 'vitest';

import { AppError } from '../../lib/shared/errors/app-error';

// Regression coverage for #2044: `saveGovernancePolicy` is a WRITE action and
// must gate on the `write orgSettings` capability. Only owner/admin hold it;
// every other role (notably `developer`, which carries `can('write','all')`)
// must be rejected with `ORG_FORBIDDEN`. The gate is the action's sole role
// check — `requireOrgMembershipById` only verifies membership.

const mockRequireOrgMembershipById = vi.fn();
vi.mock('../lib/auth/require_org_membership', () => ({
  requireOrgMembershipById: (...args: unknown[]) =>
    mockRequireOrgMembershipById(...args),
}));

// String sentinels — the handler only reaches these refs after the auth gate
// and a valid config parse, neither of which the gate tests below exercise.
vi.mock('../_generated/api', () => ({
  internal: {
    governance: {
      internal_queries: { getPolicyConfigInternal: 'getPolicyConfigInternal' },
      policy_audit: {
        recordGovernancePolicyAudit: 'recordGovernancePolicyAudit',
      },
    },
    lib: {
      config_cache: {
        actions: { syncConfigDomainFromFiles: 'syncConfigDomainFromFiles' },
        cache: { setConfigCacheEffectiveAt: 'setConfigCacheEffectiveAt' },
      },
    },
  },
}));

// Replace the Convex function builders with identity functions so the loaded
// action is the plain `{ args, returns, handler }` config object.
vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    action: (config: Record<string, unknown>) => config,
    internalAction: (config: Record<string, unknown>) => config,
  };
});

// oxlint-disable-next-line typescript/no-explicit-any -- builders mocked to identity (third-party gap per AGENTS.md)
type Handler = { handler: (...args: unknown[]) => Promise<any> };

async function loadSaveGovernancePolicy(): Promise<Handler> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
  const mod = (await import('./file_actions')) as unknown as Record<
    string,
    Handler
  >;
  return mod.saveGovernancePolicy;
}

function mockMember(role: string): void {
  mockRequireOrgMembershipById.mockResolvedValue({
    orgSlug: 'acme',
    userId: 'user_1',
    email: 'caller@example.com',
    member: { role },
  });
}

function errorCode(err: unknown): string | undefined {
  if (err instanceof AppError) {
    const data = err.data;
    if (typeof data === 'object' && data !== null && 'code' in data) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- AppError data shape is { code, message }
      return (data as { code?: string }).code;
    }
  }
  return undefined;
}

describe('saveGovernancePolicy authorization (#2044)', () => {
  beforeEach(() => {
    mockRequireOrgMembershipById.mockReset();
  });

  // The valid, non-special policy type used for every case so flow reaches the
  // auth gate; a deliberately invalid config makes the allowed roles fail at
  // the *config* check (proving the gate let them through) instead of touching
  // the filesystem.
  const VALID_POLICY_TYPE = 'login_policy';
  const INVALID_CONFIG = 'not-a-policy-object';
  const ctx = {} as unknown;

  it.each(['developer', 'editor', 'member', 'disabled'])(
    'rejects %s with ORG_FORBIDDEN',
    async (role) => {
      mockMember(role);
      const { handler } = await loadSaveGovernancePolicy();
      const err = await handler(ctx, {
        organizationId: 'org_1',
        policyType: VALID_POLICY_TYPE,
        config: INVALID_CONFIG,
      }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(AppError);
      expect(errorCode(err)).toBe('ORG_FORBIDDEN');
    },
  );

  it.each(['owner', 'admin'])(
    'allows %s past the auth gate (fails later on config, not ORG_FORBIDDEN)',
    async (role) => {
      mockMember(role);
      const { handler } = await loadSaveGovernancePolicy();
      const err = await handler(ctx, {
        organizationId: 'org_1',
        policyType: VALID_POLICY_TYPE,
        config: INVALID_CONFIG,
      }).then(
        () => null,
        (e: unknown) => e,
      );
      // Owner/admin clear the capability gate; the invalid config then trips
      // the schema check — proving the role was not rejected.
      expect(errorCode(err)).toBe('validation');
    },
  );
});
