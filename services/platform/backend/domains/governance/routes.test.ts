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
  createAuditLog,
  emitHintInTx,
  readGovernancePolicyForOrg,
  resolveOrgSlug,
  transactSerializable,
  writeGovernancePolicyFile,
} = vi.hoisted(() => ({
  createAuditLog: vi.fn(),
  emitHintInTx: vi.fn(),
  readGovernancePolicyForOrg: vi.fn(),
  resolveOrgSlug: vi.fn(),
  transactSerializable: vi.fn(),
  writeGovernancePolicyFile: vi.fn(),
}));

vi.mock('@tale/shared/db/serializable', () => ({ transactSerializable }));
vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg,
  resolveOrgSlug,
}));
vi.mock('../../lib/governance-policy-write.ts', () => ({
  writeGovernancePolicyFile,
}));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx }));

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
        c.set('orgMember', { role: 'admin' } as never);
        await next();
      },
  };
});

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

beforeEach(() => {
  vi.clearAllMocks();
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
