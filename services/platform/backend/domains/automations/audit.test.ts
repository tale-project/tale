// @vitest-environment node

import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(async () => 'row-1'),
}));

import { createAuditLog } from '../audit_logs/service.ts';
import { auditDefinitionWrite, listDeployments } from './audit.ts';

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
        actor,
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
      actor: 'api-key:user_ada',
      action: 'automation.deleted',
      name: 'billing/dunning',
      previousState: { versions: 3, deployedVersion: 2 },
    });
    const [, row] = vi.mocked(createAuditLog).mock.calls[0] ?? [];
    expect(row?.metadata).toBeUndefined();
    expect(row?.resourceName).toBe('billing/dunning');
  });
});

describe('listDeployments', () => {
  it('reads the deploys of one automation in one organization, newest first, skipping a row it cannot read', async () => {
    const statements: Array<{ text: string; values: unknown[] }> = [];
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      statements.push({ text: strings.join('?'), values });
      return Promise.resolve([
        {
          version: '7',
          previousVersion: '6',
          deployedAt: 30,
          deployedBy: 'user_ada',
          via: 'mcp',
        },
        {
          version: '6',
          previousVersion: null,
          deployedAt: 20,
          deployedBy: 'user_ben',
          via: null,
        },
        {
          version: null,
          previousVersion: null,
          deployedAt: 10,
          deployedBy: 'user_ben',
          via: null,
        },
      ]);
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
    const sql = tag as unknown as Sql;
    expect(await listDeployments(sql, 'org_1', 'billing/dunning')).toEqual([
      {
        version: 7,
        previousVersion: 6,
        deployedAt: 30,
        deployedBy: 'user_ada',
        via: 'mcp',
      },
      {
        version: 6,
        previousVersion: null,
        deployedAt: 20,
        deployedBy: 'user_ben',
        via: null,
      },
    ]);
    // Scoped to the organization and the automation, never another's rows.
    const [read] = statements;
    expect(read?.text).toContain('WHERE org_id = ?');
    expect(read?.values).toEqual(
      expect.arrayContaining(['org_1', 'billing/dunning']),
    );
    expect(read?.text).toContain("action = 'automation.deployed'");
  });
});
