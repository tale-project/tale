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

  it("leaves out the deploys of a deleted automation of the same name — a rollback must never offer the old one's versions", async () => {
    // billing/dunning v5 was live, then deleted and saved again as v1, v2:
    // its deployments start after the delete.
    const statements: Array<{ text: string; values: unknown[] }> = [];
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      statements.push({ text: strings.join('?'), values });
      return Promise.resolve([]);
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
    const sql = tag as unknown as Sql;
    expect(await listDeployments(sql, 'org_1', 'billing/dunning')).toEqual([]);
    const [read] = statements;
    const text = (read?.text ?? '').replace(/\s+/g, ' ');
    // A deploy is kept only when no delete of the same name came after it:
    // "after" is the writing transaction's id where both rows carry one, and
    // the timestamp for rows written before the id was recorded.
    expect(text).toContain(
      "AND NOT EXISTS ( SELECT 1 FROM app.audit_logs d WHERE d.org_id = ? AND d.action = 'automation.deleted' AND d.resource_type = 'automation' AND d.resource_id = ?",
    );
    expect(text).toContain(
      'WHEN d.writer_xid IS NOT NULL AND app.audit_logs.writer_xid IS NOT NULL THEN d.writer_xid > app.audit_logs.writer_xid',
    );
    expect(text).toContain('WHEN d.writer_xid IS NOT NULL THEN true');
    expect(text).toContain(
      'WHEN app.audit_logs.writer_xid IS NOT NULL THEN false',
    );
    expect(text).toContain('ELSE d.ts >= app.audit_logs.ts');
    expect(text).not.toContain('max(ts)');
    // Newest first in the same order: the writer's id, then the timestamp.
    expect(text).toContain('ORDER BY writer_xid DESC NULLS LAST, ts DESC');
    expect(read?.values).toEqual([
      'org_1',
      'billing/dunning',
      'org_1',
      'billing/dunning',
      expect.any(Number),
    ]);
  });
});
