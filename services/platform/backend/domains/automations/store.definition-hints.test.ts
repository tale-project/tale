// @vitest-environment node

/**
 * Unit lock for the definition doors' realtime contract (dead-end class):
 * every write to an automation's DEFINITION — deploy, trigger bind/unbind,
 * project bindings, the cascade delete — emits the `automation` hint inside
 * its own transaction, as saveVersion always did. Regression: only saves
 * emitted, so another member's list kept a deleted automation, the old
 * deployedVersion badge or the previous trigger until reload. The app keys
 * all of those reads under one `automation` entity prefix.
 */

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

// The definition writes' audit rows are their own concern (`audit.ts`,
// `audit.test.ts`); this double answers no audit-chain query.
vi.mock('./audit.ts', () => ({
  auditDefinitionWrite: vi.fn(async () => undefined),
  listDeployments: vi.fn(async () => []),
}));

import {
  bindProject,
  deleteAutomationCascade,
  deleteTrigger,
  deploy,
  setAutomationProjects,
} from './store.ts';

interface Statement {
  text: string;
  values: unknown[];
}

/**
 * Scripted `sql`: `begin` hands the same handle back as the transaction, so
 * a hint emitted OUTSIDE the door's transaction would still be recorded but
 * the door's own writes are visible in order for the "inside" assertion.
 */
function fakeSql(script: {
  versionRow?: { testsPassed: boolean | null };
  triggerDeleted?: boolean;
  /** The removed trigger's skip reason, as the DELETE's RETURNING reads it
   * (only when `triggerDeleted`). */
  triggerSkipReason?: string | null;
  bindingInserted?: boolean;
}): { sql: Sql; statements: Statement[]; inTx: boolean[] } {
  const statements: Statement[] = [];
  const inTx: boolean[] = [];
  let depth = 0;
  const fn = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown> => {
    const text = strings.join('?');
    statements.push({ text, values });
    inTx.push(depth > 0);
    if (text.includes('FROM app.automations') && text.includes('document')) {
      return Promise.resolve(
        script.versionRow === undefined
          ? []
          : [
              {
                name: 'ops/greet',
                version: 2,
                document: {},
                message: null,
                testsPassed: script.versionRow.testsPassed,
                taskContract: null,
                settings: null,
                presentation: null,
                createdBy: 'user_1',
                createdAt: 1,
              },
            ],
      );
    }
    if (text.includes('DELETE FROM app.automation_triggers')) {
      return Promise.resolve(
        script.triggerDeleted === true
          ? [{ id: 'trg_1', lastSkipReason: script.triggerSkipReason ?? null }]
          : [],
      );
    }
    if (text.includes('UPDATE app.user_notifications')) {
      return Promise.resolve([{ userId: 'admin_1' }]);
    }
    if (text.includes('FROM app.projects')) {
      return Promise.resolve([{ id: 'proj_1' }]);
    }
    if (text.includes('INSERT INTO app.automation_project_bindings')) {
      const rows: unknown[] & { count?: number } = [];
      rows.count = script.bindingInserted === false ? 0 : 1;
      return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  };
  fn.begin = async (
    callback: (tx: unknown) => Promise<unknown>,
  ): Promise<unknown> => {
    depth += 1;
    try {
      return await callback(fn);
    } finally {
      depth -= 1;
    }
  };
  fn.json = (value: unknown): unknown => value;
  return { sql: fn as unknown as Sql, statements, inTx };
}

function hints(fake: { statements: Statement[]; inTx: boolean[] }): {
  values: unknown[];
  inTx: boolean;
}[] {
  return fake.statements
    .map((statement, index) => ({ statement, inTx: fake.inTx[index] ?? false }))
    .filter(({ statement }) =>
      statement.text.includes('INSERT INTO app_realtime.outbox'),
    )
    .map(({ statement, inTx }) => ({ values: statement.values, inTx }));
}

const HINT = ['org_1', null, 'automation', 'ops/greet'];

describe('definition doors emit the automation hint in their transaction', () => {
  it('deploy', async () => {
    const fake = fakeSql({ versionRow: { testsPassed: true } });
    await deploy(fake.sql, {
      organizationId: 'org_1',
      name: 'ops/greet',
      version: 2,
      actor: 'user_1',
    });
    expect(hints(fake)).toEqual([{ values: HINT, inTx: true }]);
    // The deployment upsert rides the same transaction as the hint.
    expect(
      fake.inTx[
        fake.statements.findIndex((statement) =>
          statement.text.includes('INSERT INTO app.automation_deployments'),
        )
      ],
    ).toBe(true);
  });

  it('deploy refused by the tests gate emits nothing', async () => {
    const fake = fakeSql({ versionRow: { testsPassed: false } });
    await expect(
      deploy(fake.sql, {
        organizationId: 'org_1',
        name: 'ops/greet',
        version: 2,
        actor: 'user_1',
      }),
    ).rejects.toMatchObject({ code: 'AUTOMATION_DEPLOY_REJECTED' });
    expect(hints(fake)).toEqual([]);
  });

  it('deleteTrigger — only when a row went away', async () => {
    const deleted = fakeSql({ triggerDeleted: true });
    await expect(
      deleteTrigger(deleted.sql, 'org_1', 'ops/greet', 'user_1'),
    ).resolves.toBe(true);
    expect(hints(deleted)).toEqual([{ values: HINT, inTx: true }]);

    const absent = fakeSql({ triggerDeleted: false });
    await expect(
      deleteTrigger(absent.sql, 'org_1', 'ops/greet', 'user_1'),
    ).resolves.toBe(false);
    expect(hints(absent)).toEqual([]);
  });

  it('setAutomationProjects', async () => {
    const fake = fakeSql({});
    await setAutomationProjects(fake.sql, {
      organizationId: 'org_1',
      name: 'ops/greet',
      projectIds: ['proj_1'],
      actor: 'user_1',
    });
    expect(hints(fake)).toEqual([{ values: HINT, inTx: true }]);
  });

  it('bindProject — only when the binding is new', async () => {
    const fresh = fakeSql({ bindingInserted: true });
    await expect(
      bindProject(fresh.sql, {
        organizationId: 'org_1',
        name: 'ops/greet',
        projectId: 'proj_1',
        actor: 'user_1',
      }),
    ).resolves.toEqual({ bound: true });
    expect(hints(fresh)).toEqual([{ values: HINT, inTx: true }]);

    const again = fakeSql({ bindingInserted: false });
    await expect(
      bindProject(again.sql, {
        organizationId: 'org_1',
        name: 'ops/greet',
        projectId: 'proj_1',
        actor: 'user_1',
      }),
    ).resolves.toEqual({ bound: false });
    expect(hints(again)).toEqual([]);
  });

  it('deleteAutomationCascade', async () => {
    const fake = fakeSql({});
    await deleteAutomationCascade(fake.sql, {
      organizationId: 'org_1',
      name: 'ops/greet',
      actor: 'user_1',
    });
    expect(hints(fake)).toEqual([{ values: HINT, inTx: true }]);
  });
});

/** The paused-schedule notices a door marked read — the dismissal
 * `dismissTriggerPausedNotifications` writes. */
function dismissals(fake: { statements: Statement[]; inTx: boolean[] }): {
  values: unknown[];
  inTx: boolean;
}[] {
  return fake.statements
    .map((statement, index) => ({ statement, inTx: fake.inTx[index] ?? false }))
    .filter(
      ({ statement }) =>
        statement.text.includes('UPDATE app.user_notifications') &&
        statement.text.includes("type = 'automation_failed'"),
    )
    .map(({ statement, inTx }) => ({ values: statement.values, inTx }));
}

describe('removing a schedule its failures paused reads the admins’ notices of it', () => {
  it('deleteTrigger — for a paused schedule, in its transaction', async () => {
    const paused = fakeSql({
      triggerDeleted: true,
      triggerSkipReason: 'paused_after_failures',
    });
    await expect(
      deleteTrigger(paused.sql, 'org_1', 'ops/greet', 'user_1'),
    ).resolves.toBe(true);
    expect(dismissals(paused)).toEqual([
      { values: [expect.any(Number), 'org_1', 'trg_1'], inTx: true },
    ]);
    // The recipients' bells refresh.
    expect(
      paused.statements.some(
        (statement) =>
          statement.text.includes('INSERT INTO app_realtime.outbox') &&
          statement.values.includes('admin_1'),
      ),
    ).toBe(true);
  });

  it.each([null, 'not_deployed', 'start_refused'])(
    'deleteTrigger — none for a trigger whose skip reason is %s',
    async (triggerSkipReason) => {
      const fake = fakeSql({ triggerDeleted: true, triggerSkipReason });
      await deleteTrigger(fake.sql, 'org_1', 'ops/greet', 'user_1');
      expect(dismissals(fake)).toEqual([]);
    },
  );

  it('deleteTrigger — none when no trigger was removed', async () => {
    const fake = fakeSql({ triggerDeleted: false });
    await deleteTrigger(fake.sql, 'org_1', 'ops/greet', 'user_1');
    expect(dismissals(fake)).toEqual([]);
  });

  it('deleteAutomationCascade — for its paused schedule, in its transaction', async () => {
    const paused = fakeSql({
      triggerDeleted: true,
      triggerSkipReason: 'paused_after_failures',
    });
    await deleteAutomationCascade(paused.sql, {
      organizationId: 'org_1',
      name: 'ops/greet',
      actor: 'user_1',
    });
    expect(dismissals(paused)).toEqual([
      { values: [expect.any(Number), 'org_1', 'trg_1'], inTx: true },
    ]);
  });

  it('deleteAutomationCascade — none for a trigger that is not paused', async () => {
    const running = fakeSql({ triggerDeleted: true, triggerSkipReason: null });
    await deleteAutomationCascade(running.sql, {
      organizationId: 'org_1',
      name: 'ops/greet',
      actor: 'user_1',
    });
    expect(dismissals(running)).toEqual([]);

    const none = fakeSql({ triggerDeleted: false });
    await deleteAutomationCascade(none.sql, {
      organizationId: 'org_1',
      name: 'ops/greet',
      actor: 'user_1',
    });
    expect(dismissals(none)).toEqual([]);
  });
});
