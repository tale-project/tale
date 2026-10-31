// @vitest-environment node

/**
 * The generic policy save's WRITE ORDER: the audit row and the realtime hint
 * land in the transaction first and the policy file is written last, inside
 * it — so a failed transaction never leaves a policy in force that the
 * tamper-evident audit chain knows nothing about, and `previousState` is the
 * file actually replaced, not the TTL cache's view of it.
 */

import {
  FILE_POLICY_TYPES,
  isPolicyReadableByMember,
} from '@tale/shared/schemas/governance';
import type { Context } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const {
  caller,
  createAuditLog,
  emitHintInTx,
  readGovernancePolicyForOrg,
  resolveOrgSlug,
  transactSerializable,
  writeGovernancePolicyFile,
  readGovernancePolicySnapshot,
  getSandboxDeploymentLimits,
  getUserTeamIds,
  listModelApiModels,
  mayCreateApiKeys,
  restoreSoftDeletedRow,
  syncRagDocumentScope,
  requeuePiiScanFailedDocuments,
  recordUnusedWorkspaceRule,
  projectChatAccess,
  readInFlightReservations,
} = vi.hoisted(() => ({
  caller: { role: 'admin' },
  createAuditLog: vi.fn(),
  emitHintInTx: vi.fn(),
  readGovernancePolicyForOrg: vi.fn(),
  resolveOrgSlug: vi.fn(),
  transactSerializable: vi.fn(),
  writeGovernancePolicyFile: vi.fn(),
  readGovernancePolicySnapshot: vi.fn(),
  getSandboxDeploymentLimits: vi.fn(),
  getUserTeamIds: vi.fn(),
  listModelApiModels: vi.fn(),
  mayCreateApiKeys: vi.fn(),
  restoreSoftDeletedRow: vi.fn(),
  syncRagDocumentScope: vi.fn(),
  requeuePiiScanFailedDocuments: vi.fn(),
  recordUnusedWorkspaceRule: vi.fn(),
  projectChatAccess: vi.fn(),
  readInFlightReservations: vi.fn(async () => ({})),
}));

vi.mock('@tale/shared/db/serializable', () => ({ transactSerializable }));
vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg,
  resolveOrgSlug,
}));
vi.mock('../../lib/governance-policy-write.ts', () => ({
  writeGovernancePolicyFile,
  readGovernancePolicySnapshot,
}));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx }));
vi.mock('../sandbox/limits.ts', () => ({ getSandboxDeploymentLimits }));
vi.mock('../sandbox/unused-rule.ts', () => ({ recordUnusedWorkspaceRule }));
vi.mock('../model_api/models.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../model_api/models.ts')>()),
  listModelApiModels,
}));
vi.mock('../../auth/api-key-create-gate.ts', () => ({ mayCreateApiKeys }));
vi.mock('../../auth/membership.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/membership.ts')>()),
  getUserTeamIds,
}));
vi.mock('./trash.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./trash.ts')>()),
  restoreSoftDeletedRow,
}));
vi.mock('../knowledge/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../knowledge/service.ts')>()),
  syncRagDocumentScope,
  requeuePiiScanFailedDocuments,
}));
vi.mock('../chat/threads.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../chat/threads.ts')>()),
  projectChatAccess,
}));
vi.mock('./budget-reservations.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./budget-reservations.ts')>()),
  readInFlightReservations,
}));

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u1', email: 'u@example.test' },
      } as never);
      await next();
    },
}));

vi.mock('../../auth/org.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/org.ts')>();
  return {
    ...actual,
    requireOrgMember:
      () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
        c.set('orgId', 'o1');
        c.set('orgMember', { role: caller.role } as never);
        await next();
      },
  };
});

import { ConfigurationError } from '../../core/lib/config_store/precondition';
import { createGovernanceRoutes } from './routes.ts';
import { TrashError } from './trash.ts';

const TX = { tx: true };

async function post(route: string, body: unknown): Promise<Response> {
  return await createGovernanceRoutes({
    sql: {} as never,
    auth: {} as never,
  }).request(route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const NEXT = { rules: [], enabled: true };
const ON_DISK = { rules: [], enabled: false };

describe('reviewed governance HTTP preconditions', () => {
  it('exposes an explicit strict fresh snapshot without the display fallback', async () => {
    readGovernancePolicySnapshot.mockResolvedValue({
      config: ON_DISK,
      hash: 'a'.repeat(64),
    });
    const response = await createGovernanceRoutes({
      sql: {} as never,
      auth: {} as never,
    }).request('/policies/feature_flags?orgId=o1&includeHash=1');
    expect(await response.json()).toEqual({
      policy: { key: 'feature_flags', config: ON_DISK },
      hash: 'a'.repeat(64),
    });
    expect(readGovernancePolicySnapshot).toHaveBeenCalledWith(
      'acme',
      'feature_flags',
    );
    expect(readGovernancePolicyForOrg).not.toHaveBeenCalled();
  });

  it('passes the exact preimage into the locked writer and reports its conflict', async () => {
    const hash = 'a'.repeat(64);
    expect(
      (
        await post('/policies/feature_flags?orgId=o1', {
          config: NEXT,
          expectedHash: hash,
        })
      ).status,
    ).toBe(200);
    expect(writeGovernancePolicyFile).toHaveBeenCalledWith(
      TX,
      'acme',
      'feature_flags',
      NEXT,
      hash,
    );
    writeGovernancePolicyFile.mockRejectedValue(
      new ConfigurationError(
        'CONFIG_VERSION_CONFLICT',
        'Configuration changed.',
      ),
    );
    expect(
      (
        await post('/policies/feature_flags?orgId=o1', {
          config: NEXT,
          expectedHash: hash,
        })
      ).status,
    ).toBe(409);
  });

  it('preserves specialized write doors and refuses malformed preconditions', async () => {
    for (const key of ['retention_policy', 'dsar_governance']) {
      expect(
        (
          await post(`/policies/${key}?orgId=o1`, {
            config: {},
            expectedHash: null,
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await post('/policies/feature_flags?orgId=o1', {
          config: NEXT,
          expectedHash: 'wrong',
        })
      ).status,
    ).toBe(400);
    expect(writeGovernancePolicyFile).not.toHaveBeenCalled();
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  caller.role = 'admin';
  getSandboxDeploymentLimits.mockResolvedValue({
    status: 'available',
    maxSessions: 16,
  });
  resolveOrgSlug.mockResolvedValue('acme');
  readGovernancePolicyForOrg.mockResolvedValue(ON_DISK);
  transactSerializable.mockImplementation(
    (_sql: unknown, callback: (tx: unknown) => Promise<unknown>) =>
      callback(TX),
  );
  createAuditLog.mockResolvedValue(undefined);
  emitHintInTx.mockResolvedValue(undefined);
  writeGovernancePolicyFile.mockResolvedValue(undefined);
  requeuePiiScanFailedDocuments.mockResolvedValue({ requeued: 0 });
});

describe('POST /policies/:policyType — write order', () => {
  it.each(['user', 'team', 'role'])(
    'refuses untargeted %s model access rules before any write',
    async (scope) => {
      for (const scopeId of [undefined, '', '   ']) {
        const response = await post('/policies/model_access?orgId=o1', {
          config: {
            enabled: true,
            mode: 'blocklist',
            rules: [
              {
                scope,
                scopeId,
                allowedModels: [],
                blockedModels: ['fixture/model'],
              },
            ],
          },
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: 'validation' });
      }
      expect(writeGovernancePolicyFile).not.toHaveBeenCalled();
      expect(createAuditLog).not.toHaveBeenCalled();
    },
  );

  it.each([
    'model_access',
    'vision_model',
    'transcription_model',
    'image_generation',
  ])(
    'refreshes provider-derived reads in every session when %s is saved',
    async (policyType) => {
      const response = await post(`/policies/${policyType}?orgId=o1`, {
        config:
          policyType === 'model_access'
            ? { enabled: false, mode: 'allowlist', rules: [] }
            : policyType === 'image_generation'
              ? { enabled: true }
              : {},
      });
      expect(response.status).toBe(200);
      expect(emitHintInTx).toHaveBeenCalledWith(TX, {
        orgId: 'o1',
        entity: 'governance_policy',
        entityId: policyType,
      });
      expect(emitHintInTx).toHaveBeenCalledWith(TX, {
        orgId: 'o1',
        entity: 'provider_credential',
        entityId: policyType,
      });
      const writeAt =
        writeGovernancePolicyFile.mock.invocationCallOrder[0] ?? 0;
      expect(Math.max(...emitHintInTx.mock.invocationCallOrder)).toBeLessThan(
        writeAt,
      );
    },
  );

  it('writes the file LAST, inside the audited transaction [GOV-R11]', async () => {
    const res = await post('/policies/feature_flags?orgId=o1', NEXT);

    expect(res.status).toBe(200);
    expect(writeGovernancePolicyFile).toHaveBeenCalledWith(
      expect.anything(),
      'acme',
      'feature_flags',
      NEXT,
    );
    const auditAt = createAuditLog.mock.invocationCallOrder[0] ?? Infinity;
    const hintAt = emitHintInTx.mock.invocationCallOrder[0] ?? Infinity;
    const writeAt = writeGovernancePolicyFile.mock.invocationCallOrder[0] ?? 0;
    expect(auditAt).toBeLessThan(writeAt);
    expect(hintAt).toBeLessThan(writeAt);
    // The audit row rides the transaction the file write is part of.
    expect(createAuditLog.mock.calls[0]?.[0]).toBe(TX);
    expect(getSandboxDeploymentLimits).not.toHaveBeenCalled();
  });

  it('leaves the file untouched when the audit row cannot be written [GOV-R11]', async () => {
    createAuditLog.mockRejectedValue(new Error('audit chain unavailable'));

    const res = await post('/policies/feature_flags?orgId=o1', NEXT);

    expect(res.status).toBe(500);
    expect(writeGovernancePolicyFile).not.toHaveBeenCalled();
  });

  it('audits the config actually on disk, read fresh past the TTL cache [GOV-R11]', async () => {
    await post('/policies/feature_flags?orgId=o1', NEXT);

    expect(readGovernancePolicyForOrg).toHaveBeenCalledWith(
      expect.anything(),
      'o1',
      'feature_flags',
      { fresh: true },
    );
    expect(createAuditLog.mock.calls[0]?.[1]).toMatchObject({
      action: 'governance_policy.updated',
      previousState: { config: ON_DISK },
      newState: { config: NEXT },
    });
  });
});

describe('POST /policies/sandbox_workspaces — the rule takes effect with the save', () => {
  it('records the rule in the save transaction, before the file', async () => {
    const order: string[] = [];
    recordUnusedWorkspaceRule.mockImplementationOnce(async () => {
      order.push('rule');
    });
    writeGovernancePolicyFile.mockImplementationOnce(async () => {
      order.push('file');
    });
    const response = await post('/policies/sandbox_workspaces?orgId=o1', {
      deleteUnused: true,
      unusedDays: 7,
    });
    expect(response.status).toBe(200);
    expect(recordUnusedWorkspaceRule).toHaveBeenCalledWith(
      expect.anything(),
      'o1',
      // A file without the disk and size fields reads their defaults.
      {
        deleteUnused: true,
        unusedDays: 7,
        reclaimOnDiskPressure: true,
        reclaimMinIdleHours: 24,
      },
      expect.any(Number),
    );
    expect(order).toEqual(['rule', 'file']);
  });

  it('records nothing for another policy, and nothing for a refused save', async () => {
    expect(
      (await post('/policies/sandbox_workspaces', { unusedDays: 0 })).status,
    ).toBe(400);
    await post('/policies/sandbox_quota', {
      maxSessionsPerOrg: 2,
      maxWorkflowSessionsPerOrg: 2,
      maxRenderSessionsPerOrg: 2,
    });
    expect(recordUnusedWorkspaceRule).not.toHaveBeenCalled();
  });
});

describe('POST /policies/pii_config — the documents it could not scan', () => {
  const PII_POLICY = {
    enabled: true,
    mode: 'block',
    enabledPatterns: ['email'],
  };

  it('queues them again after the save commits, also when nothing changed [KNOW-R9]', async () => {
    const order: string[] = [];
    writeGovernancePolicyFile.mockImplementation(async () => {
      order.push('file');
    });
    requeuePiiScanFailedDocuments.mockImplementation(async () => {
      order.push('requeue');
      return { requeued: 2 };
    });
    readGovernancePolicyForOrg.mockResolvedValue(PII_POLICY);

    // The same policy as on disk: an admin's way to say "try again".
    const response = await post('/policies/pii_config?orgId=o1', PII_POLICY);

    expect(response.status).toBe(200);
    expect(requeuePiiScanFailedDocuments).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'o1', orgSlug: 'acme' },
    );
    expect(order).toEqual(['file', 'requeue']);
  });

  it('keeps the save when the re-queue fails [KNOW-R9]', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    requeuePiiScanFailedDocuments.mockRejectedValue(new Error('pool down'));

    const response = await post('/policies/pii_config?orgId=o1', PII_POLICY);

    expect(response.status).toBe(200);
    expect(writeGovernancePolicyFile).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pool down'), {
      organizationId: 'o1',
    });
    warn.mockRestore();
  });

  it('queues nothing for another policy, nor for a refused save', async () => {
    expect(
      (
        await post('/policies/pii_config?orgId=o1', {
          ...PII_POLICY,
          mode: 'shred',
        })
      ).status,
    ).toBe(400);
    await post('/policies/sandbox_workspaces?orgId=o1', {
      deleteUnused: true,
      unusedDays: 7,
    });
    expect(requeuePiiScanFailedDocuments).not.toHaveBeenCalled();
  });
});

describe('POST /policies/sandbox_quota — deployment capacity', () => {
  const atCapacity = {
    maxSessionsPerOrg: 2,
    maxWorkflowSessionsPerOrg: 6,
    maxRenderSessionsPerOrg: 6,
    maxLightSessionsPerOrg: 2,
  };

  function expectNoWrite() {
    expect(transactSerializable).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(emitHintInTx).not.toHaveBeenCalled();
    expect(writeGovernancePolicyFile).not.toHaveBeenCalled();
  }

  it('saves an exact-capacity allocation with one audited file write', async () => {
    const response = await post('/policies/sandbox_quota?orgId=o1', atCapacity);
    expect(response.status).toBe(200);
    expect(getSandboxDeploymentLimits).toHaveBeenCalledOnce();
    expect(getSandboxDeploymentLimits).toHaveBeenCalledWith('o1');
    expect(writeGovernancePolicyFile).toHaveBeenCalledWith(
      expect.anything(),
      'acme',
      'sandbox_quota',
      atCapacity,
    );
    expect(createAuditLog).toHaveBeenCalledOnce();
    expect(createAuditLog.mock.calls[0]?.[1]).toMatchObject({
      organizationId: 'o1',
      newState: { config: atCapacity },
    });
  });

  it('rejects a total one above capacity before any audit or file write', async () => {
    const response = await post('/policies/sandbox_quota', {
      ...atCapacity,
      maxSessionsPerOrg: 3,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'SANDBOX_QUOTA_EXCEEDS_DEPLOYMENT',
      data: { total: 17, maxSessions: 16 },
    });
    expectNoWrite();
    expect(resolveOrgSlug).not.toHaveBeenCalled();
    expect(readGovernancePolicyForOrg).not.toHaveBeenCalled();
  });

  it('recomputes from validated fields and ignores forged totals and deployment limits', async () => {
    const response = await post('/policies/sandbox_quota', {
      config: {
        ...atCapacity,
        maxSessionsPerOrg: 3,
        total: 1,
        maxSessions: 500,
      },
      total: 1,
      maxSessions: 500,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'SANDBOX_QUOTA_EXCEEDS_DEPLOYMENT',
      data: { total: 17, maxSessions: 16 },
    });
    expectNoWrite();
  });

  it("counts the organization's connected devices toward the ceiling", async () => {
    getSandboxDeploymentLimits.mockResolvedValue({
      status: 'available',
      maxSessions: 10,
      deviceSessions: 6,
    });
    // 16 fits 10 deployment slots plus the organization's 6 device slots.
    expect((await post('/policies/sandbox_quota', atCapacity)).status).toBe(
      200,
    );
    getSandboxDeploymentLimits.mockResolvedValue({
      status: 'available',
      maxSessions: 10,
      deviceSessions: 5,
    });
    const response = await post('/policies/sandbox_quota', atCapacity);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'SANDBOX_QUOTA_EXCEEDS_DEPLOYMENT',
      data: { total: 16, maxSessions: 10, deviceSessions: 5 },
    });
  });

  it('rereads deployment capacity for each save after an operator changes it', async () => {
    getSandboxDeploymentLimits
      .mockResolvedValueOnce({ status: 'available', maxSessions: 16 })
      .mockResolvedValueOnce({ status: 'available', maxSessions: 10 });
    expect((await post('/policies/sandbox_quota', atCapacity)).status).toBe(
      200,
    );
    const response = await post('/policies/sandbox_quota', atCapacity);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'SANDBOX_QUOTA_EXCEEDS_DEPLOYMENT',
      data: { total: 16, maxSessions: 10 },
    });
    expect(getSandboxDeploymentLimits).toHaveBeenCalledTimes(2);
    expect(writeGovernancePolicyFile).toHaveBeenCalledOnce();
    expect(createAuditLog).toHaveBeenCalledOnce();
  });

  it.each(['not_configured', 'unreachable'])(
    'refuses to save when capacity is %s',
    async (reason) => {
      getSandboxDeploymentLimits.mockResolvedValue({
        status: 'unavailable',
        reason,
      });
      const response = await post('/policies/sandbox_quota', atCapacity);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: 'SANDBOX_CAPACITY_UNAVAILABLE',
      });
      expectNoWrite();
    },
  );

  it('still saves a total that does not grow while capacity is unavailable', async () => {
    // Shedding load is the one edit an admin needs during a sandbox outage;
    // lowering can never oversubscribe more than the saved total does.
    getSandboxDeploymentLimits.mockResolvedValue({
      status: 'unavailable',
      reason: 'unreachable',
    });
    readGovernancePolicyForOrg.mockResolvedValue(atCapacity);
    const lowered = { ...atCapacity, maxRenderSessionsPerOrg: 5 };
    expect((await post('/policies/sandbox_quota', lowered)).status).toBe(200);
    expect(writeGovernancePolicyFile).toHaveBeenCalledWith(
      expect.anything(),
      'acme',
      'sandbox_quota',
      lowered,
    );
    const raised = { ...atCapacity, maxRenderSessionsPerOrg: 7 };
    const response = await post('/policies/sandbox_quota', raised);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'SANDBOX_CAPACITY_UNAVAILABLE',
    });
    expect(writeGovernancePolicyFile).toHaveBeenCalledOnce();
  });

  it.each([0, 501, 2.5, '2', null])(
    'rejects an invalid field of %j before contacting runtime',
    async (value) => {
      const response = await post('/policies/sandbox_quota', {
        ...atCapacity,
        maxWorkflowSessionsPerOrg: value,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'validation' });
      expect(getSandboxDeploymentLimits).not.toHaveBeenCalled();
      expectNoWrite();
    },
  );

  it.each(['developer', 'editor', 'viewer'])(
    'refuses %s before reading capacity or changing policy',
    async (role) => {
      caller.role = role;
      const response = await post('/policies/sandbox_quota', atCapacity);
      expect(response.status).toBe(403);
      expect(getSandboxDeploymentLimits).not.toHaveBeenCalled();
      expectNoWrite();
    },
  );
});

describe('POST /policies/standard_agent — the runtime a project agent may use', () => {
  it('refuses a runtime the managed lane cannot run, naming the ones it can, before any write', async () => {
    const response = await post('/policies/standard_agent', {
      config: { enabled: true, harness: 'cursor' },
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: string;
      data: { harnesses: string[] };
    };
    expect(body.error).toBe('STANDARD_AGENT_HARNESS_INVALID');
    expect(body.data.harnesses).toContain('claude-code');
    expect(body.data.harnesses).not.toContain('cursor');
    expect(writeGovernancePolicyFile).not.toHaveBeenCalled();
  });

  it('saves a runtime the managed lane can run, and Automatic', async () => {
    for (const config of [
      { enabled: true, harness: 'codex' },
      { enabled: false },
    ]) {
      writeGovernancePolicyFile.mockClear();
      const response = await post('/policies/standard_agent', { config });
      expect(response.status).toBe(200);
      expect(writeGovernancePolicyFile).toHaveBeenCalledWith(
        expect.anything(),
        'acme',
        'standard_agent',
        config,
      );
    }
  });
});

describe('POST /policies/model_access — the hosts attested as processing in the EU/EEA', () => {
  function modelAccess(hosts: string[]) {
    return {
      enabled: false,
      mode: 'blocklist',
      rules: [],
      euProcessing: { enabled: true, hosts },
    };
  }

  it('refuses a vendor host the rule ignores, naming the vendor’s EU endpoint, before any write [GOV-R17]', async () => {
    const response = await post('/policies/model_access', {
      config: modelAccess([
        'llm.example.eu',
        'openrouter.ai',
        'us.api.openai.com',
      ]),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: string;
      message: string;
      data: { hosts: string[] };
    };
    expect(body.error).toBe('EU_PROCESSING_HOST_NOT_ATTESTABLE');
    expect(body.data.hosts).toEqual(['openrouter.ai', 'us.api.openai.com']);
    expect(body.message).toContain('openrouter.ai (use eu.openrouter.ai)');
    expect(body.message).toContain('us.api.openai.com (use eu.api.openai.com)');
    expect(body.message).not.toContain('llm.example.eu');
    expect(writeGovernancePolicyFile).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('saves a host of the organization’s own and a vendor’s EU endpoint [GOV-R17]', async () => {
    const config = modelAccess(['llm.example.eu', 'eu.openrouter.ai']);
    const response = await post('/policies/model_access', { config });

    expect(response.status).toBe(200);
    expect(writeGovernancePolicyFile).toHaveBeenCalledWith(
      expect.anything(),
      'acme',
      'model_access',
      config,
    );
  });
});

describe('GET /my/model-api', () => {
  async function read(sql: never = {} as never): Promise<Response> {
    return await createGovernanceRoutes({ sql, auth: {} as never }).request(
      '/my/model-api?orgId=o1',
    );
  }

  beforeEach(() => {
    readGovernancePolicyForOrg.mockReset();
    listModelApiModels.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('answers whether the organization turned the model endpoints on and whether this member may call them', async () => {
    caller.role = 'developer';
    readGovernancePolicyForOrg.mockResolvedValue({
      enabled: false,
      mode: 'blocklist',
      rules: [],
      modelApi: { enabled: true },
    });
    resolveOrgSlug.mockResolvedValue('acme');
    listModelApiModels.mockResolvedValue([
      {
        id: 'deepseek/deepseek-v4-flash',
        label: 'DeepSeek V4 Flash',
        providerSlug: 'deepseek',
      },
    ]);
    const res = await read();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      enabled: true,
      allowed: true,
      models: [
        { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
      ],
    });
    expect(listModelApiModels).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'o1',
      orgSlug: 'acme',
      userId: 'u1',
    });
    // The switch is read the way an authorization policy must be.
    expect(readGovernancePolicyForOrg).toHaveBeenCalledWith(
      expect.anything(),
      'o1',
      'model_access',
      { strict: true },
    );
  });

  it('answers a member without the grant, and the switch off, as they are', async () => {
    caller.role = 'member';
    readGovernancePolicyForOrg.mockResolvedValue(null);
    const grants: unknown[][] = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      // `vouchesForUser` is a fragment nested in the grant read: it hands
      // its values to the read instead of reading.
      if (!/^\s*SELECT/.test(strings[0] ?? '')) return { fragment: values };
      grants.push(values);
      return Promise.resolve([]);
    }) as never;
    expect(await (await read(sql)).json()).toEqual({
      enabled: false,
      allowed: false,
      models: [],
    });
    // The member's own grant or their team's, live at the time of asking.
    expect(grants).toEqual([
      ['o1', 'tale:models.api', expect.any(Number), { fragment: ['u1', 'u1'] }],
    ]);
    // Nothing to list for a member the endpoints would refuse.
    expect(listModelApiModels).not.toHaveBeenCalled();
  });

  it('leaves out the models the EU/EEA rule refuses on both wires, and says why [GOV-R22]', async () => {
    vi.stubEnv('TALE_CONFIG_DIR', '/config');
    caller.role = 'developer';
    readGovernancePolicyForOrg.mockResolvedValue({
      enabled: false,
      mode: 'blocklist',
      rules: [],
      modelApi: { enabled: true },
      euProcessing: { enabled: true, hosts: ['llm.acme.eu'] },
    });
    resolveOrgSlug.mockResolvedValue('acme');
    listModelApiModels.mockResolvedValue([
      {
        id: 'deepseek/deepseek-v4-flash',
        label: 'DeepSeek V4 Flash',
        providerSlug: 'deepseek',
        connector: { name: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' },
      },
      {
        id: 'acme/acme-large',
        label: 'Acme Large',
        providerSlug: 'acme',
        connector: { name: 'acme', baseUrl: 'https://llm.acme.eu/v1' },
      },
    ]);
    expect(await (await read()).json()).toEqual({
      enabled: true,
      allowed: true,
      models: [{ id: 'acme/acme-large', label: 'Acme Large' }],
      modelsHiddenBy: 'eu',
    });
  });
});

describe('GET /my/api-keys', () => {
  it.each([
    [true, true],
    [false, true],
    [false, false],
  ])(
    'answers whether the caller may create a personal API key (%s) and holds one (%s)',
    async (mayCreate, holdsKeys) => {
      caller.role = 'member';
      mayCreateApiKeys.mockReset().mockResolvedValue(mayCreate);
      const keyReads: unknown[][] = [];
      const sql = (async (
        _strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        keyReads.push(values);
        return holdsKeys ? [{ id: 'key-1' }] : [];
      }) as never;
      const res = await createGovernanceRoutes({
        sql,
        auth: {} as never,
      }).request('/my/api-keys?orgId=o1');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ mayCreate, holdsKeys });
      // The person's right, whichever organization's page asks, and the keys
      // that work here: their own, and the ones made for them in this one.
      expect(mayCreateApiKeys).toHaveBeenCalledWith(expect.anything(), 'u1');
      expect(keyReads).toEqual([['u1', 'o1']]);
    },
  );
});

describe('GET /my/budget-status in a project’s chat', () => {
  /** The ledger sums by the scope each query names (a project's own
   * buckets, the caller's `user_id`, or the whole org), the member row and
   * the project's name. */
  function database(projectCostCents: number) {
    const zero = { totalTokens: 0, costEstimate: 0, requestCount: 0 };
    const sql = async (strings: TemplateStringsArray) => {
      const text = strings.join('?');
      if (text.includes('app.project_usage')) {
        return [{ ...zero, costEstimate: projectCostCents }];
      }
      if (text.includes('FROM "member"')) {
        return [
          { id: 'm1', organizationId: 'o1', userId: 'u1', role: 'member' },
        ];
      }
      if (text.includes('FROM app.projects')) {
        return [{ name: 'Website relaunch' }];
      }
      return [zero];
    };
    return sql as never;
  }

  async function read(sql: never, query: string): Promise<Response> {
    return await createGovernanceRoutes({ sql, auth: {} as never }).request(
      `/my/budget-status?orgId=o1${query}`,
    );
  }

  beforeEach(() => {
    caller.role = 'member';
    getUserTeamIds.mockResolvedValue([]);
    projectChatAccess.mockReset().mockResolvedValue('ok');
    readGovernancePolicyForOrg.mockImplementation(
      async (_sql: unknown, _org: string, policyType: string) =>
        policyType === 'budgets'
          ? { enabled: true, rules: [] }
          : policyType === 'project_budgets'
            ? {
                rules: [
                  {
                    scope: 'project',
                    scopeId: 'project-1',
                    period: 'monthly',
                    maxCostCents: 1_000,
                    warningThresholdPercent: 80,
                  },
                ],
              }
            : null,
    );
  });

  it('warns about the project’s cap by name once its usage crosses the threshold [GOV-R6]', async () => {
    const response = await read(database(850), '&projectId=project-1');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: {
        exceeded: false,
        code: null,
        period: null,
        used: null,
        limit: null,
        reason: null,
        warnings: [
          {
            code: 'COST_WARNING',
            scope: 'project',
            projectId: 'project-1',
            projectName: 'Website relaunch',
            period: 'monthly',
            used: 850,
            limit: 1_000,
            percent: 85,
          },
        ],
      },
    });
    expect(projectChatAccess).toHaveBeenCalledWith(expect.anything(), {
      projectId: 'project-1',
      organizationId: 'o1',
      userId: 'u1',
    });
  });

  it('names the project whose reached cap blocks its chat [GOV-R14]', async () => {
    const response = await read(database(1_000), '&projectId=project-1');

    expect(await response.json()).toEqual({
      status: expect.objectContaining({
        exceeded: true,
        code: 'COST_LIMIT',
        scope: 'project',
        projectId: 'project-1',
        projectName: 'Website relaunch',
      }),
    });
  });

  it('leaves the project out of a chat outside it, and of a project the member cannot read', async () => {
    expect(await (await read(database(1_000), '')).json()).toEqual({
      status: null,
    });
    projectChatAccess.mockResolvedValue('forbidden');
    expect(
      await (await read(database(1_000), '&projectId=project-1')).json(),
    ).toEqual({ status: null });
  });
});

describe('GET /my/budget-usage', () => {
  interface Usage {
    totalTokens: number;
    costEstimate: number;
    requestCount: number;
  }

  /** The ledger sums by the scope each query names (a team's members, the
   * caller's `user_id`, or the whole org; the scoped id is the 3rd binding)
   * and the team-name read, recorded in call order. */
  function database(answers: {
    user: Usage;
    teams: Record<string, Usage>;
    org: Usage;
    teamRows: { id: string; name: string }[];
  }) {
    const queries: string[] = [];
    const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      queries.push(text);
      if (text.includes('"teamMember"')) {
        return [answers.teams[String(values[2])]];
      }
      if (text.includes('FROM "team"')) return answers.teamRows;
      if (text.includes('user_id =')) return [answers.user];
      return [answers.org];
    };
    return { sql: sql as never, queries };
  }

  async function read(sql: never): Promise<Response> {
    return await createGovernanceRoutes({ sql, auth: {} as never }).request(
      '/my/budget-usage?orgId=o1',
    );
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 8, 15, 13));
    caller.role = 'member';
    getUserTeamIds.mockResolvedValue(['team-1']);
    return () => {
      vi.useRealTimers();
    };
  });

  it('answers a plain member the caps that bind them with their usage [GOV-R7]', async () => {
    readGovernancePolicyForOrg.mockImplementation(
      async (_sql: unknown, _org: string, policyType: string) =>
        policyType === 'budgets'
          ? {
              enabled: true,
              rules: [
                {
                  scope: 'default',
                  period: 'monthly',
                  maxCostCents: 5_000,
                  warningThresholdPercent: 80,
                },
                {
                  scope: 'user',
                  scopeId: 'someone-else',
                  period: 'monthly',
                  maxCostCents: 1,
                },
                {
                  scope: 'team',
                  scopeId: 'team-1',
                  period: 'weekly',
                  maxRequests: 400,
                },
                { scope: 'org', period: 'monthly', maxTokens: 9_000_000 },
              ],
            }
          : null,
    );
    const { sql } = database({
      user: { totalTokens: 41_000, costEstimate: 1_240, requestCount: 30 },
      teams: {
        'team-1': {
          totalTokens: 90_000,
          costEstimate: 3_000,
          requestCount: 260,
        },
      },
      org: { totalTokens: 2_500_000, costEstimate: 40_000, requestCount: 900 },
      teamRows: [{ id: 'team-1', name: 'Design' }],
    });

    const response = await read(sql);

    expect(response.status).toBe(200);
    const nextMonth = Date.UTC(2026, 9, 1);
    const nextMonday = Date.UTC(2026, 8, 21);
    expect(await response.json()).toEqual({
      limits: [
        {
          scope: 'user',
          teamId: null,
          teamName: null,
          period: 'weekly',
          periodKey: '2026-W38',
          resetsAt: nextMonday,
          warningThresholdPercent: null,
          tokens: null,
          costCents: null,
          requests: { used: 30, limit: 400 },
        },
        {
          scope: 'team',
          teamId: 'team-1',
          teamName: 'Design',
          period: 'weekly',
          periodKey: '2026-W38',
          resetsAt: nextMonday,
          warningThresholdPercent: null,
          tokens: null,
          costCents: null,
          requests: { used: 260, limit: 400 },
        },
        {
          scope: 'user',
          teamId: null,
          teamName: null,
          period: 'monthly',
          periodKey: '2026-09',
          resetsAt: nextMonth,
          warningThresholdPercent: 80,
          tokens: null,
          costCents: { used: 1_240, limit: 5_000 },
          requests: null,
        },
        {
          scope: 'org',
          teamId: null,
          teamName: null,
          period: 'monthly',
          periodKey: '2026-09',
          resetsAt: nextMonth,
          warningThresholdPercent: null,
          tokens: { used: 2_500_000, limit: 9_000_000 },
          costCents: null,
          requests: null,
        },
      ],
    });
    expect(getUserTeamIds).toHaveBeenCalledWith(sql, 'o1', 'u1');
  });

  it('answers no limits, and reads no team names, when budgets are off', async () => {
    readGovernancePolicyForOrg.mockResolvedValue(null);
    const { sql, queries } = database({
      user: { totalTokens: 0, costEstimate: 0, requestCount: 0 },
      teams: {},
      org: { totalTokens: 0, costEstimate: 0, requestCount: 0 },
      teamRows: [],
    });

    const response = await read(sql);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ limits: [] });
    expect(queries).toEqual([]);
  });
});

describe('GET /policies/:policyType — who may read [GOV-R10]', () => {
  // The app's route loaders warm these for a caller whose role they do not
  // know yet (`isPolicyReadableByMember`), so this door must answer a member
  // exactly them and refuse the rest (#3098).
  const MEMBER_READABLE: ReadonlySet<string> = new Set([
    'data_classification_notice',
    'feature_flags',
    'pii_config',
    'chat_filter',
    'custom_instructions',
    'upload_policy',
    'default_models',
    'session_idle_timeout',
  ]);

  async function read(policyType: string): Promise<Response> {
    return await createGovernanceRoutes({
      sql: {} as never,
      auth: {} as never,
    }).request(`/policies/${policyType}?orgId=o1`);
  }

  beforeEach(() => {
    readGovernancePolicyForOrg.mockResolvedValue(null);
  });

  it.each(FILE_POLICY_TYPES)(
    'answers a member %s only when any member may read it',
    async (policyType) => {
      caller.role = 'member';

      const response = await read(policyType);

      expect(isPolicyReadableByMember(policyType)).toBe(
        MEMBER_READABLE.has(policyType),
      );
      expect(response.status).toBe(MEMBER_READABLE.has(policyType) ? 200 : 403);
    },
  );

  it.each(FILE_POLICY_TYPES)('answers an admin %s', async (policyType) => {
    caller.role = 'admin';

    expect((await read(policyType)).status).toBe(200);
  });

  it('reads chat_tools the way the chat does: a file that cannot be read is reported to the page, never shown as every switch on [CHAT-R26]', async () => {
    caller.role = 'admin';
    readGovernancePolicyForOrg.mockRejectedValue(
      new ConfigurationError(
        'GOVERNANCE_POLICY_INVALID',
        'Governance policy is unavailable or invalid; restore valid configuration before retrying.',
        400,
      ),
    );

    const response = await read('chat_tools');

    expect(readGovernancePolicyForOrg).toHaveBeenCalledWith(
      expect.anything(),
      'o1',
      'chat_tools',
      { strict: true },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'GOVERNANCE_POLICY_INVALID',
    });
  });
});

describe('POST /trash/restore — the corpus row of a restored document', () => {
  // A restored document can be its ref's holder again — the lowest-id
  // active document holding a shared ref, whose scope the corpus row
  // carries — and a restore edits no scope: without a re-stamp the row kept
  // the twin's scope until the nightly reconcile counted it as drift.
  beforeEach(() => {
    caller.role = 'admin';
    restoreSoftDeletedRow.mockResolvedValue(undefined);
    syncRagDocumentScope.mockResolvedValue(undefined);
  });

  it('re-stamps a restored document’s ref from its holder, after the restore commits', async () => {
    // The transaction counts as committed once its body has resolved; the
    // re-stamp records whether it had.
    let committed = false;
    let restampedAfterCommit: boolean | undefined;
    transactSerializable.mockImplementation(
      async (_sql: unknown, callback: (tx: unknown) => Promise<unknown>) => {
        const result = await callback(TX);
        committed = true;
        return result;
      },
    );
    syncRagDocumentScope.mockImplementation(() => {
      restampedAfterCommit = committed;
      return Promise.resolve();
    });

    const response = await post('/trash/restore?orgId=o1', {
      resourceType: 'document',
      id: 'doc-1',
    });

    expect(response.status).toBe(200);
    expect(syncRagDocumentScope).toHaveBeenCalledWith(
      expect.anything(),
      'o1',
      'doc-1',
    );
    expect(restampedAfterCommit).toBe(true);
  });

  it('re-stamps nothing for a row that is not a document', async () => {
    const response = await post('/trash/restore?orgId=o1', {
      resourceType: 'fileMetadata',
      id: 'fm-1',
    });

    expect(response.status).toBe(200);
    expect(syncRagDocumentScope).not.toHaveBeenCalled();
  });

  it('re-stamps nothing when the restore is refused', async () => {
    restoreSoftDeletedRow.mockRejectedValue(
      new TrashError('ROW_NOT_FOUND', 'Nothing to restore', 404),
    );

    const response = await post('/trash/restore?orgId=o1', {
      resourceType: 'document',
      id: 'doc-1',
    });

    expect(response.status).toBe(404);
    expect(syncRagDocumentScope).not.toHaveBeenCalled();
  });
});

describe('POST /dsar/policy/cancel-pending — any admin can cancel a staged weakening [GOV-R24]', () => {
  /** A database whose transaction finds `pending` staged rows to delete. */
  function database(pending: number) {
    const statements: string[] = [];
    const tx = async (strings: TemplateStringsArray) => {
      const text = strings.join('?');
      statements.push(text);
      return text.includes('DELETE FROM app.dsar_policy_pending_changes')
        ? Array.from({ length: pending }, () => ({ id: 'pending-1' }))
        : [];
    };
    const sql = {
      begin: async (callback: (tx: unknown) => Promise<unknown>) =>
        await callback(tx),
    };
    return { sql: sql as never, tx, statements };
  }

  async function cancel(sql: never): Promise<Response> {
    return await createGovernanceRoutes({ sql, auth: {} as never }).request(
      '/dsar/policy/cancel-pending?orgId=o1',
      { method: 'POST' },
    );
  }

  it.each(['admin', 'owner', 'Admin'])(
    'lets an %s cancel it, and the audit row in the same transaction names them',
    async (role) => {
      caller.role = role;
      const { sql, tx, statements } = database(1);

      const response = await cancel(sql);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(statements).toEqual([
        expect.stringContaining('DELETE FROM app.dsar_policy_pending_changes'),
      ]);
      expect(createAuditLog).toHaveBeenCalledExactlyOnceWith(
        tx,
        expect.objectContaining({
          organizationId: 'o1',
          actorId: 'u1',
          actorEmail: 'u@example.test',
          action: 'policy.dsar_governance_loosening_cancelled',
          status: 'success',
        }),
      );
    },
  );

  it.each(['member', 'developer'])(
    'refuses a %s and cancels nothing',
    async (role) => {
      caller.role = role;
      const { sql, statements } = database(1);

      const response = await cancel(sql);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'FORBIDDEN' });
      expect(statements).toEqual([]);
      expect(createAuditLog).not.toHaveBeenCalled();
    },
  );

  it('answers NO_PENDING_CHANGE, and audits nothing, when nothing is left to cancel', async () => {
    const { sql } = database(0);

    const response = await cancel(sql);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: 'NO_PENDING_CHANGE',
    });
    expect(createAuditLog).not.toHaveBeenCalled();
  });
});
