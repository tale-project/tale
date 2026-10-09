// @vitest-environment node

/**
 * Organization policies over MCP, through the policy writer the Settings
 * pages use: the files, the audit chain and the sandbox service are
 * doubles, the gates and checks are the writer's own.
 */

import { POLICY_SCHEMAS } from '@tale/shared/schemas/governance';
import { configurationHash } from '@tale/shared/utils/configuration-hash';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createAuditLog,
  emitHintInTx,
  getSandboxDeploymentLimits,
  readGovernancePolicyForOrg,
  readGovernancePolicySnapshot,
  resolveOrgSlug,
  stored,
  writeGovernancePolicyFile,
} = vi.hoisted(() => ({
  createAuditLog: vi.fn(),
  emitHintInTx: vi.fn(),
  getSandboxDeploymentLimits: vi.fn(),
  readGovernancePolicyForOrg: vi.fn(),
  readGovernancePolicySnapshot: vi.fn(),
  resolveOrgSlug: vi.fn(async () => 'acme'),
  // The policy files of organization "acme", by policy.
  stored: new Map<string, unknown>(),
  writeGovernancePolicyFile: vi.fn(),
}));

vi.mock('@tale/shared/db/serializable', () => ({
  transactSerializable: (
    _sql: unknown,
    work: (tx: unknown) => Promise<unknown>,
  ) => work({ tx: true }),
}));
vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg,
  resolveOrgSlug,
}));
vi.mock('../../lib/governance-policy-write.ts', () => ({
  readGovernancePolicySnapshot,
  writeGovernancePolicyFile,
}));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx }));
vi.mock('../sandbox/limits.ts', () => ({ getSandboxDeploymentLimits }));
vi.mock('../sandbox/unused-rule.ts', () => ({
  recordUnusedWorkspaceRule: vi.fn(),
}));

import { ConfigurationError } from '../../core/lib/config_store/precondition';
import type { McpCaller } from '../mcp/caller.ts';
import { applySettings } from '../mcp/settings/apply.ts';
import { planSettings } from '../mcp/settings/plan.ts';
import type { SettingsContext } from '../mcp/settings/registry.ts';
import { governanceEffects, governanceSettings } from './settings-resource.ts';

const registry = { governance: governanceSettings };

function caller(role: string): McpCaller {
  return {
    organizationId: 'org-1',
    orgSlug: 'acme',
    userId: `user-${role}`,
    role,
    credential: { kind: 'api-key', apiKeyId: 'key-laptop' },
  };
}

/** A database that knows each caller's address and nothing else. */
function sqlDouble(): Sql {
  const tag = async () => [{ email: 'person@example.test' }];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return tag as unknown as Sql;
}

function contextOf(role: string): SettingsContext {
  return { sql: sqlDouble(), caller: caller(role) };
}

const hashOf = (config: unknown) => configurationHash(config);

beforeEach(() => {
  vi.clearAllMocks();
  stored.clear();
  stored.set('password_policy', {
    minLength: 12,
    requireUpper: true,
    requireLower: true,
    requireDigit: true,
    requireSpecial: true,
    rotationDays: 0,
  });
  stored.set('feature_flags', { rules: [], enabled: true });
  // The file read through the policy's own schema, as the writer reads it.
  readGovernancePolicySnapshot.mockImplementation(
    async (_slug: string, key: keyof typeof POLICY_SCHEMAS) => {
      const file = stored.get(key);
      return file === undefined
        ? { config: null, hash: null }
        : { config: POLICY_SCHEMAS[key].parse(file), hash: hashOf(file) };
    },
  );
  readGovernancePolicyForOrg.mockImplementation(
    async (_sql: unknown, _org: string, key: string) => stored.get(key) ?? null,
  );
  writeGovernancePolicyFile.mockImplementation(
    async (
      _tx: unknown,
      _slug: string,
      key: string,
      config: unknown,
      expected?: string | null,
    ) => {
      const current = stored.get(key);
      if (
        expected !== undefined &&
        (current === undefined ? null : hashOf(current)) !== expected
      ) {
        throw new ConfigurationError(
          'CONFIG_VERSION_CONFLICT',
          'Configuration changed since it was reviewed.',
        );
      }
      stored.set(key, config);
    },
  );
  getSandboxDeploymentLimits.mockResolvedValue({
    status: 'available',
    maxSessions: 16,
  });
});

describe('who reads and changes the policies', () => {
  it('lets every member read and only an owner or admin change', async () => {
    expect(await governanceSettings.access(contextOf('member'))).toEqual({
      read: true,
      write: false,
    });
    expect(await governanceSettings.access(contextOf('admin'))).toEqual({
      read: true,
      write: true,
    });
  });

  it('lists to a member only the policies any member may read', async () => {
    const page = await governanceSettings.list(contextOf('member'), {});
    expect(page.items.map((item) => item.id)).toEqual(['feature_flags']);
    const admin = await governanceSettings.list(contextOf('admin'), {});
    expect(admin.items.map((item) => item.id)).toEqual(
      expect.arrayContaining(['feature_flags', 'password_policy']),
    );
    expect(admin.items).toHaveLength(2);
    expect(admin.items[0]).toHaveProperty('hash');
  });

  it('refuses a member a policy named that only owners and admins read', async () => {
    await expect(
      governanceSettings.list(contextOf('member'), {
        ids: ['password_policy'],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('changes a policy only where the role can in the app [MCP-R10]', async () => {
    // Any member reads the feature flags; only an owner or admin changes them.
    const change = {
      kind: 'governance' as const,
      id: 'feature_flags',
      op: 'set' as const,
      config: { rules: [], enabled: false },
    };
    const expected = {
      'governance/feature_flags': hashOf(stored.get('feature_flags')),
    };
    const refused = await applySettings(
      contextOf('member'),
      registry,
      [change],
      expected,
    );
    expect(refused).toMatchObject({
      code: 'FORBIDDEN',
      error: 'Only owners and admins can change organization policies.',
      hint: expect.stringContaining('an owner or admin can'),
      applied: [],
    });
    expect(writeGovernancePolicyFile).not.toHaveBeenCalled();
    // A policy only owners and admins read is refused at the read.
    const hidden = await planSettings(contextOf('member'), registry, [
      {
        kind: 'governance',
        id: 'password_policy',
        op: 'set',
        config: stored.get('password_policy'),
      },
    ]);
    expect(hidden.changes[0]?.refusal).toMatchObject({ code: 'FORBIDDEN' });

    const applied = await applySettings(
      contextOf('admin'),
      registry,
      [change],
      expected,
    );
    expect(applied).toEqual({
      applied: [
        {
          kind: 'governance',
          id: 'feature_flags',
          key: 'governance/feature_flags',
          action: 'update',
          hash: hashOf(stored.get('feature_flags')),
        },
      ],
      skipped: [],
    });
    expect(stored.get('feature_flags')).toEqual({ rules: [], enabled: false });
    // The writer's own audit row, under the person who holds the key.
    expect(createAuditLog).toHaveBeenCalledWith(
      { tx: true },
      expect.objectContaining({
        actorId: 'user-admin',
        actorEmail: 'person@example.test',
        action: 'governance_policy.updated',
        resourceId: 'feature_flags',
      }),
    );
  });
});

describe('naming a policy', () => {
  it.each([
    [undefined, 'SETTINGS_ID_REQUIRED'],
    ['retention_policy', 'SETTINGS_TALE_ONLY'],
    ['dsar_governance', 'SETTINGS_TALE_ONLY'],
    ['conversation_access', 'UNKNOWN_POLICY_TYPE'],
    ['no_such_policy', 'UNKNOWN_POLICY_TYPE'],
  ])('refuses %j as %s', (id, code) => {
    expect(() =>
      governanceSettings.identify({
        kind: 'governance',
        ...(id === undefined ? {} : { id }),
        op: 'set',
        config: {},
      }),
    ).toThrow(expect.objectContaining({ code }));
  });
});

describe('planning a policy change', () => {
  it('names every problem of a config, a field the policy does not have among them', async () => {
    const plan = await planSettings(contextOf('admin'), registry, [
      {
        kind: 'governance',
        id: 'password_policy',
        op: 'set',
        config: { minLength: 3, minLenght: 14 },
      },
    ]);
    expect(plan.ok).toBe(false);
    expect(plan.changes[0]?.refusal).toMatchObject({
      code: 'SETTINGS_INVALID',
      data: {
        issues: [expect.objectContaining({ path: '/config/minLength' })],
      },
    });
    const misspelled = await planSettings(contextOf('admin'), registry, [
      {
        kind: 'governance',
        id: 'password_policy',
        op: 'set',
        config: { minLenght: 14 },
      },
    ]);
    expect(misspelled.changes[0]?.refusal?.data).toEqual({
      issues: [
        {
          path: '/config/minLenght',
          code: 'unrecognized_key',
          message: 'is not a field of this setting',
        },
      ],
    });
  });

  it('weighs sandbox budgets against the deployment, as the save does', async () => {
    const quota = {
      maxSessionsPerOrg: 9,
      maxWorkflowSessionsPerOrg: 8,
      maxRenderSessionsPerOrg: 6,
    };
    const over = await planSettings(contextOf('admin'), registry, [
      { kind: 'governance', id: 'sandbox_quota', op: 'set', config: quota },
    ]);
    expect(over.changes[0]?.refusal).toMatchObject({
      code: 'SANDBOX_QUOTA_EXCEEDS_DEPLOYMENT',
      data: { total: 23, maxSessions: 16 },
    });
    getSandboxDeploymentLimits.mockResolvedValue({
      status: 'unavailable',
      reason: 'unreachable',
    });
    const unknown = await planSettings(contextOf('admin'), registry, [
      { kind: 'governance', id: 'sandbox_quota', op: 'set', config: quota },
    ]);
    expect(unknown.changes[0]?.refusal).toMatchObject({
      code: 'SANDBOX_CAPACITY_UNAVAILABLE',
      hint: expect.stringContaining('lowering'),
    });
    expect(writeGovernancePolicyFile).not.toHaveBeenCalled();
  });

  it('refuses a standard agent runtime the managed lane cannot run, naming those it can', async () => {
    const plan = await planSettings(contextOf('admin'), registry, [
      {
        kind: 'governance',
        id: 'standard_agent',
        op: 'set',
        config: { enabled: true, harness: 'cursor' },
      },
    ]);
    expect(plan.changes[0]?.refusal).toMatchObject({
      code: 'STANDARD_AGENT_HARNESS_INVALID',
      data: { harnesses: expect.arrayContaining(['claude-code']) },
    });
  });

  it('says what a change does beyond its value, and that a change to what is stored does nothing', async () => {
    const current = stored.get('password_policy') as Record<string, unknown>;
    const plan = await planSettings(contextOf('admin'), registry, [
      {
        kind: 'governance',
        id: 'password_policy',
        op: 'set',
        config: { ...current, rotationDays: 90 },
      },
      {
        kind: 'governance',
        id: 'feature_flags',
        op: 'set',
        config: { rules: [], enabled: true },
      },
    ]);
    expect(plan.changes[0]).toMatchObject({
      action: 'update',
      effects: ['may-lock-out-members'],
      risk: 'critical',
      diff: [{ path: '/rotationDays', before: 0, after: 90 }],
    });
    expect(plan.changes[1]).toMatchObject({
      action: 'unchanged',
      effects: [],
      risk: 'low',
    });
  });
});

describe('applying a policy change', () => {
  it('lands only on the policy the agent read', async () => {
    const read = stored.get('feature_flags') as Record<string, unknown>;
    const before = hashOf(read);
    // Someone turns the flags off in the app after the agent read them.
    stored.set('feature_flags', { ...read, enabled: false });
    const answer = await applySettings(
      contextOf('admin'),
      registry,
      [
        {
          kind: 'governance',
          id: 'feature_flags',
          op: 'set',
          config: { rules: [], enabled: true },
        },
      ],
      { 'governance/feature_flags': before },
    );
    expect(answer).toMatchObject({
      code: 'SETTINGS_STALE',
      data: { currentHash: hashOf(stored.get('feature_flags')) },
    });
    expect(writeGovernancePolicyFile).not.toHaveBeenCalled();
  });

  it('creates a policy never saved, expecting none', async () => {
    const answer = await applySettings(
      contextOf('owner'),
      registry,
      [
        {
          kind: 'governance',
          id: 'session_idle_timeout',
          op: 'set',
          config: { enabled: true, idleTimeoutMinutes: 60 },
        },
      ],
      { 'governance/session_idle_timeout': null },
    );
    expect(answer).toMatchObject({
      applied: [{ action: 'create', key: 'governance/session_idle_timeout' }],
    });
    expect(writeGovernancePolicyFile).toHaveBeenCalledWith(
      { tx: true },
      'acme',
      'session_idle_timeout',
      { enabled: true, idleTimeoutMinutes: 60 },
      null,
    );
  });
});

describe('what a policy change does', () => {
  it('names a lockout, a sign-out or a removed approval only where one happens', () => {
    expect(governanceEffects('login_policy', null, { enabled: true })).toEqual([
      'may-lock-out-members',
    ]);
    expect(governanceEffects('login_policy', null, { enabled: false })).toEqual(
      [],
    );
    expect(
      governanceEffects(
        'password_policy',
        { rotationDays: 90 },
        { rotationDays: 180 },
      ),
    ).toEqual([]);
    expect(
      governanceEffects(
        'two_factor_policy',
        { enforced: true, gracePeriodDays: 7, exemptSsoUsers: true },
        { enforced: true, gracePeriodDays: 3, exemptSsoUsers: true },
      ),
    ).toEqual(['may-lock-out-members']);
    expect(
      governanceEffects(
        'two_factor_policy',
        { enforced: true, gracePeriodDays: 7, exemptSsoUsers: true },
        { enforced: true, gracePeriodDays: 14, exemptSsoUsers: true },
      ),
    ).toEqual([]);
    expect(
      governanceEffects(
        'session_idle_timeout',
        { enabled: true, idleTimeoutMinutes: 60 },
        { enabled: true, idleTimeoutMinutes: 30 },
      ),
    ).toEqual(['signs-out-members']);
    const gated = {
      rules: [{ connector: 'github', decision: 'require_approval' }],
    };
    expect(
      governanceEffects('approval_policy', gated, {
        rules: [{ connector: 'github', decision: 'auto_approve' }],
      }),
    ).toEqual(['removes-human-approval']);
    expect(governanceEffects('approval_policy', gated, { rules: [] })).toEqual([
      'removes-human-approval',
    ]);
    expect(governanceEffects('approval_policy', null, gated)).toEqual([]);
    expect(
      governanceEffects(
        'review_policy',
        { requireIndependentReviewer: true, requiredCompetences: ['legal'] },
        { requireIndependentReviewer: true, requiredCompetences: [] },
      ),
    ).toEqual(['removes-human-approval']);
    expect(governanceEffects('budgets', null, { rules: [] })).toEqual([]);
  });
});
