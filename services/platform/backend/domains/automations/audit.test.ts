// @vitest-environment node

import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(async () => 'row-1'),
}));

import { appOrigin, mcpOrigin } from '../../lib/write-origin.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { auditDefinitionWrite } from './audit.ts';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the audit writer is a double; the handle is never read
const tx = {} as TransactionSql;

beforeEach(() => {
  vi.mocked(createAuditLog).mockClear();
});

describe('auditDefinitionWrite [AUTO-R28]', () => {
  it.each([
    ['user_ada', 'user_ada', 'user'],
    ['user:user_ada', 'user_ada', 'user'],
    ['api-key:user_ada', 'user_ada', 'api'],
    ['system:provisioning', 'system:provisioning', 'system'],
  ])(
    'records the writer %s as %s (%s), in the automation category',
    async (actor, actorId, actorType) => {
      await auditDefinitionWrite(tx, {
        organizationId: 'org_1',
        origin: appOrigin(actor),
        action: 'automation.version.saved',
        name: 'billing/dunning',
        version: 6,
        newState: { version: 6 },
      });
      expect(createAuditLog).toHaveBeenCalledWith(tx, {
        organizationId: 'org_1',
        actorId,
        actorType,
        action: 'automation.version.saved',
        category: 'workflow',
        resourceType: 'automation',
        resourceId: 'billing/dunning',
        resourceName: 'billing/dunning@6',
        newState: { version: 6 },
        status: 'success',
      });
    },
  );

  it('never names the door itself — the request channel does, inside an MCP call', async () => {
    await auditDefinitionWrite(tx, {
      organizationId: 'org_1',
      origin: mcpOrigin({ userId: 'user_ada' }),
      action: 'automation.deleted',
      name: 'billing/dunning',
      previousState: { versions: 3, deployedVersion: 2 },
    });
    const [, row] = vi.mocked(createAuditLog).mock.calls[0] ?? [];
    expect(row?.metadata).toBeUndefined();
    expect(row?.resourceName).toBe('billing/dunning');
  });
});
