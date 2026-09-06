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
import { describe, expect, it } from 'vitest';

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
        script.triggerDeleted === true ? [{ id: 'trg_1' }] : [],
      );
    }
    if (text.includes('SELECT id FROM app.projects')) {
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
      deleteTrigger(deleted.sql, 'org_1', 'ops/greet'),
    ).resolves.toBe(true);
    expect(hints(deleted)).toEqual([{ values: HINT, inTx: true }]);

    const absent = fakeSql({ triggerDeleted: false });
    await expect(deleteTrigger(absent.sql, 'org_1', 'ops/greet')).resolves.toBe(
      false,
    );
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
