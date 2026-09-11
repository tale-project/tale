// @vitest-environment node

/**
 * The generic policy save's WRITE ORDER: the audit row and the realtime hint
 * land in the transaction first and the policy file is written last, inside
 * it — so a failed transaction never leaves a policy in force that the
 * tamper-evident audit chain knows nothing about, and `previousState` is the
 * file actually replaced, not the TTL cache's view of it.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});

describe('POST /policies/:policyType — write order', () => {
  it('writes the file LAST, inside the audited transaction', async () => {
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

  it('leaves the file untouched when the audit row cannot be written', async () => {
    createAuditLog.mockRejectedValue(new Error('audit chain unavailable'));

    const res = await post('/policies/feature_flags?orgId=o1', NEXT);

    expect(res.status).toBe(500);
    expect(writeGovernancePolicyFile).not.toHaveBeenCalled();
  });

  it('audits the config actually on disk, read fresh past the TTL cache', async () => {
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

describe('POST /policies/sandbox_quota — deployment capacity', () => {
  const atCapacity = {
    maxSessionsPerOrg: 2,
    maxWorkflowSessionsPerOrg: 8,
    maxRenderSessionsPerOrg: 6,
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
