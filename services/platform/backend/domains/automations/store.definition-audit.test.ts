// @vitest-environment node

/**
 * Every change to an automation's definition leaves an audit row, written in
 * the change's own transaction after the automation's name is locked — the
 * name before any trigger row, and no organization-wide lock at all: the
 * audit row takes none, the chain being sealed off the write path. A row names
 * versions, kinds and project ids, never a document, a webhook token or its
 * hash. A deploy and a delete can name the state they expect, and change
 * nothing when it moved.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../realtime/outbox.ts', () => ({
  emitHintInTx: vi.fn(async () => undefined),
}));
vi.mock('./audit.ts', () => ({
  auditDefinitionWrite: vi.fn(async () => undefined),
  listDeployments: vi.fn(async () => []),
}));

import { auditDefinitionWrite } from './audit.ts';
import {
  AutomationError,
  bindProjectInTx,
  deleteAutomationCascade,
  deleteTrigger,
  deploy,
  setAutomationProjects,
  setTrigger,
  unbindProjectInTx,
} from './store.ts';

interface Statement {
  text: string;
  values: unknown[];
}

/** A scripted database: each rule answers the first statement that
 * contains its text; anything else answers no rows (with `count: 0`). */
function fakeSql(rules: Array<[string, unknown[], number?]> = []) {
  const statements: Statement[] = [];
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    const rule = rules.find(([needle]) => text.includes(needle));
    const rows = rule?.[1] ?? [];
    return Promise.resolve(
      Object.assign([...rows], { count: rule?.[2] ?? rows.length }),
    );
  };
  const sql = Object.assign(tx, {
    json: (value: unknown) => value,
    begin: (callback: (handle: typeof tx) => Promise<unknown>) => callback(tx),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, tx: sql as never, statements };
}

/** Where the automation's name was locked, where the first advisory lock
 * was taken, and whether anything took the organization's chain key. */
function lockOrder(statements: Statement[], name: string) {
  const chain = statements.findIndex((s) =>
    s.values.includes('audit-chain:org_1'),
  );
  const nameLock = statements.findIndex(
    (s) => s.text.includes('pg_advisory_xact_lock') && s.values.includes(name),
  );
  const firstLock = statements.findIndex((s) =>
    s.text.includes('pg_advisory_xact_lock'),
  );
  return { chain, nameLock, firstLock };
}

const VERSION_ROW = {
  name: 'ops/greet',
  version: 2,
  document: {},
  message: null,
  testsPassed: true,
  testsCheckedAt: 1,
  taskContract: null,
  settings: null,
  presentation: null,
  createdBy: 'user_1',
  createdAt: 1,
  createdVia: 'app',
  apiKeyId: null,
  clientName: null,
};

beforeEach(() => {
  vi.mocked(auditDefinitionWrite).mockClear();
});

describe('deploy', () => {
  it('audits what was live and what is live now, after the name, with no organization-wide lock [AUTO-R28]', async () => {
    const fake = fakeSql([
      ['FROM app.automations WHERE org_id', [VERSION_ROW]],
      ['SELECT version FROM app.automation_deployments', [{ version: 1 }]],
    ]);
    const result = await deploy(fake.sql, {
      organizationId: 'org_1',
      name: 'ops/greet',
      version: 2,
      actor: 'api-key:user_ada',
    });
    expect(result).toEqual({
      name: 'ops/greet',
      version: 2,
      previousVersion: 1,
      trigger: null,
    });
    const { chain, nameLock, firstLock } = lockOrder(
      fake.statements,
      'ops/greet',
    );
    expect(chain).toBe(-1);
    expect(nameLock).toBeGreaterThanOrEqual(0);
    expect(firstLock).toBe(nameLock);
    expect(auditDefinitionWrite).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org_1',
      actor: 'api-key:user_ada',
      action: 'automation.deployed',
      name: 'ops/greet',
      version: 2,
      previousState: { deployedVersion: 1 },
      newState: { deployedVersion: 2 },
      metadata: { fromVersion: 1, toVersion: 2 },
    });
  });

  it('refuses a deploy that expected another live version, and moves nothing', async () => {
    const fake = fakeSql([
      ['FROM app.automations WHERE org_id', [VERSION_ROW]],
      ['SELECT version FROM app.automation_deployments', [{ version: 6 }]],
    ]);
    const refused = await deploy(fake.sql, {
      organizationId: 'org_1',
      name: 'ops/greet',
      version: 2,
      actor: 'user_ada',
      expectedDeployedVersion: 5,
    }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(AutomationError);
    expect(refused).toMatchObject({
      code: 'AUTOMATION_DEPLOYMENT_STALE',
      status: 409,
      data: { deployedVersion: 6 },
    });
    expect(
      fake.statements.some((s) =>
        s.text.includes('INSERT INTO app.automation_deployments'),
      ),
    ).toBe(false);
    expect(auditDefinitionWrite).not.toHaveBeenCalled();
  });

  it('takes an expected null as "nothing is live"', async () => {
    const fake = fakeSql([
      ['FROM app.automations WHERE org_id', [VERSION_ROW]],
    ]);
    await expect(
      deploy(fake.sql, {
        organizationId: 'org_1',
        name: 'ops/greet',
        version: 2,
        actor: 'user_ada',
        expectedDeployedVersion: null,
      }),
    ).resolves.toEqual({
      name: 'ops/greet',
      version: 2,
      previousVersion: null,
      trigger: null,
    });
  });
});

describe('deleteAutomationCascade', () => {
  it('audits the removal with how many versions went, after the name, with no organization-wide lock [AUTO-R28]', async () => {
    const fake = fakeSql([
      ['DELETE FROM app.automations', [], 4],
      ['DELETE FROM app.automation_deployments', [{ version: 3 }]],
    ]);
    await expect(
      deleteAutomationCascade(fake.sql, {
        organizationId: 'org_1',
        name: 'ops/greet',
        actor: 'user_ada',
      }),
    ).resolves.toEqual({ versions: 4 });
    const { chain, nameLock, firstLock } = lockOrder(
      fake.statements,
      'ops/greet',
    );
    expect(chain).toBe(-1);
    expect(nameLock).toBeGreaterThanOrEqual(0);
    expect(firstLock).toBe(nameLock);
    expect(auditDefinitionWrite).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org_1',
      actor: 'user_ada',
      action: 'automation.deleted',
      name: 'ops/greet',
      previousState: { versions: 4, deployedVersion: 3 },
    });
  });

  it('refuses a delete that expected an older latest version, and removes nothing', async () => {
    const fake = fakeSql([['SELECT max(version)', [{ latest: 5 }]]]);
    const refused = await deleteAutomationCascade(fake.sql, {
      organizationId: 'org_1',
      name: 'ops/greet',
      actor: 'user_ada',
      expectedLatestVersion: 4,
    }).catch((error: unknown) => error);
    expect(refused).toMatchObject({
      code: 'AUTOMATION_VERSION_STALE',
      data: { latestVersion: 5, expectedLatestVersion: 4 },
    });
    expect(fake.statements.some((s) => s.text.startsWith('DELETE'))).toBe(
      false,
    );
    expect(auditDefinitionWrite).not.toHaveBeenCalled();
  });
});

describe('triggers', () => {
  it('audits a bind with what the binding was and is — never its token or hash [AUTO-R28]', async () => {
    const fake = fakeSql([
      [
        'FOR UPDATE',
        [
          {
            id: 'trg_1',
            kind: 'webhook',
            tokenHash: 'stored-hash',
            cron: null,
            timezone: null,
            event: null,
            enabled: true,
            lastSkipReason: null,
          },
        ],
      ],
      ['INSERT INTO app.automation_triggers', [{ tokenHash: 'new-hash' }]],
    ]);
    const outcome = await setTrigger(fake.sql, {
      organizationId: 'org_1',
      name: 'ops/greet',
      trigger: { kind: 'webhook', rotateToken: true },
      actor: 'user_ada',
    });
    const { chain, nameLock } = lockOrder(fake.statements, 'ops/greet');
    const rowLock = fake.statements.findIndex((s) =>
      s.text.includes('FOR UPDATE'),
    );
    expect(chain).toBe(-1);
    expect(nameLock).toBeGreaterThanOrEqual(0);
    expect(rowLock).toBeGreaterThan(nameLock);
    expect(auditDefinitionWrite).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org_1',
      actor: 'user_ada',
      action: 'automation.trigger.set',
      name: 'ops/greet',
      previousState: { kind: 'webhook', enabled: true },
      newState: { kind: 'webhook', enabled: true },
      metadata: { rotated: true },
    });
    const audited = JSON.stringify(vi.mocked(auditDefinitionWrite).mock.calls);
    expect(audited).not.toContain('stored-hash');
    expect(audited).not.toContain('new-hash');
    // The hash of the token this bind minted is in the upsert, and nowhere
    // in the row.
    const minted = fake.statements
      .find((s) => s.text.includes('INSERT INTO app.automation_triggers'))
      ?.values.find(
        (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value),
      );
    expect(typeof minted).toBe('string');
    expect(audited).not.toContain(String(minted));
    expect(outcome.revoked).toBeUndefined();
  });

  it('audits a schedule wake claim change without changing the inherited definition audit identity [AUTO-R28]', async () => {
    const fake = fakeSql([
      [
        'FOR UPDATE',
        [
          {
            id: 'trg_1',
            kind: 'schedule',
            tokenHash: null,
            cron: '0 9 * * 1',
            timezone: 'UTC',
            event: null,
            enabled: true,
            wakeOnSlotFreed: false,
            lastSkipReason: null,
          },
        ],
      ],
      ['INSERT INTO app.automation_triggers', [{ tokenHash: null }]],
    ]);
    await setTrigger(fake.sql, {
      organizationId: 'org_1',
      name: 'ops/greet',
      actor: 'user_ada',
      trigger: {
        kind: 'schedule',
        cron: '0 9 * * 1',
        timezone: 'UTC',
        wakeOnSlotFreed: true,
      },
    });
    expect(auditDefinitionWrite).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org_1',
        actor: 'user_ada',
        action: 'automation.trigger.set',
        name: 'ops/greet',
        previousState: expect.objectContaining({ wakeOnSlotFreed: false }),
        newState: expect.objectContaining({ wakeOnSlotFreed: true }),
      }),
    );
    const order = lockOrder(fake.statements, 'ops/greet');
    expect(order.chain).toBe(-1);
    expect(order.firstLock).toBe(order.nameLock);
  });

  it('audits a removal with what was bound, after the name [AUTO-R28]', async () => {
    const fake = fakeSql([
      [
        'DELETE FROM app.automation_triggers',
        [
          {
            id: 'trg_1',
            lastSkipReason: null,
            kind: 'schedule',
            cron: '0 9 * * 1',
            timezone: 'Europe/Zurich',
            event: null,
            enabled: true,
          },
        ],
      ],
    ]);
    await expect(
      deleteTrigger(fake.sql, 'org_1', 'ops/greet', 'user_ada'),
    ).resolves.toBe(true);
    expect(lockOrder(fake.statements, 'ops/greet')).toMatchObject({
      chain: -1,
      firstLock: 0,
      nameLock: 0,
    });
    expect(auditDefinitionWrite).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org_1',
      actor: 'user_ada',
      action: 'automation.trigger.deleted',
      name: 'ops/greet',
      previousState: {
        kind: 'schedule',
        cron: '0 9 * * 1',
        timezone: 'Europe/Zurich',
        enabled: true,
      },
    });
  });

  it('audits nothing when no trigger was bound', async () => {
    const fake = fakeSql();
    await expect(
      deleteTrigger(fake.sql, 'org_1', 'ops/greet', 'user_ada'),
    ).resolves.toBe(false);
    expect(auditDefinitionWrite).not.toHaveBeenCalled();
  });
});

describe('installations', () => {
  it('audits an install and an uninstall only when one happened [AUTO-R28]', async () => {
    const bound = fakeSql([
      ['SELECT id FROM app.projects', [{ id: 'p-1' }]],
      ['INSERT INTO app.automation_project_bindings', [], 1],
    ]);
    await bindProjectInTx(bound.tx, {
      organizationId: 'org_1',
      name: 'ops/greet',
      projectId: 'p-1',
      actor: 'user_ada',
    });
    const again = fakeSql([['SELECT id FROM app.projects', [{ id: 'p-1' }]]]);
    await bindProjectInTx(again.tx, {
      organizationId: 'org_1',
      name: 'ops/greet',
      projectId: 'p-1',
      actor: 'user_ada',
    });
    const unbound = fakeSql([
      ['DELETE FROM app.automation_project_bindings', [], 1],
    ]);
    await unbindProjectInTx(unbound.tx, {
      organizationId: 'org_1',
      name: 'ops/greet',
      projectId: 'p-1',
      actor: 'user_ada',
    });
    expect(
      vi.mocked(auditDefinitionWrite).mock.calls.map(([, args]) => ({
        action: args.action,
        newState: args.newState,
        previousState: args.previousState,
      })),
    ).toEqual([
      {
        action: 'automation.project.bound',
        newState: { projectId: 'p-1' },
        previousState: undefined,
      },
      {
        action: 'automation.project.unbound',
        newState: undefined,
        previousState: { projectId: 'p-1' },
      },
    ]);
  });

  it('audits each project a set of installations added and removed', async () => {
    const fake = fakeSql([
      ['FROM app.projects', [{ id: 'p-2', archivedAt: null }]],
      ['DELETE FROM app.automation_project_bindings', [{ projectId: 'p-1' }]],
      ['INSERT INTO app.automation_project_bindings', [], 1],
    ]);
    await setAutomationProjects(fake.sql, {
      organizationId: 'org_1',
      name: 'ops/greet',
      projectIds: ['p-2'],
      actor: 'user_ada',
    });
    expect(lockOrder(fake.statements, 'ops/greet')).toMatchObject({
      chain: -1,
      firstLock: 0,
      nameLock: 0,
    });
    expect(
      vi.mocked(auditDefinitionWrite).mock.calls.map(([, args]) => args.action),
    ).toEqual(['automation.project.unbound', 'automation.project.bound']);
  });
});
