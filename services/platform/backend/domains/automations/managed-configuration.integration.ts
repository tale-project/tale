/** Native PostgreSQL proof: reviewed phases have one winner, retry by readback,
 * retain immutable runs and schedule accounting, and never undo a live pause. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import type { ManagedPlatformResource } from '@tale/shared/schemas/managed-configuration';
import type { Sql } from 'postgres';

import { createProject } from '../projects/service.ts';
import { managedConfigurationHash } from './managed-configuration-value.ts';
import {
  readManagedAutomation,
  writeManagedAutomation,
} from './managed-configuration.ts';
import {
  AutomationError,
  beginRun,
  cancelRun,
  deleteAutomationCascade,
  listTriggers,
  setTrigger,
  versionRow,
} from './store.ts';

export async function checkManagedAutomationConfiguration(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const name = `itest/managed-${randomUUID()}`;
  const auth = {
    organizationId: ctx.orgId,
    userId: ctx.userId,
    role: 'owner',
    teamIds: [] as string[],
  };
  const projectId = await sql.begin((tx) =>
    createProject(tx, auth, {
      name: 'Managed configuration integration',
      deriveKeyOnCollision: true,
    }),
  );
  const scope = { organizationId: ctx.orgId, name, projectId };
  const definition = (value: number) => ({
    projectId,
    name,
    document: {
      name,
      nodes: [{ id: 'value', type: 'transform', code: `return ${value};` }],
      output: '{{ nodes.value.output }}',
      tests: [
        { name: 'declared result', input: {}, expect: { output: value } },
      ],
    },
    settings: null,
    presentation: null,
    taskContract: null,
  });
  const write = (
    resource: ManagedPlatformResource,
    expectedHash: string | null,
    definitionSha256?: string,
  ) =>
    writeManagedAutomation(sql, ctx.orgId, ctx.userId, {
      resource,
      expectedHash,
      ...(definitionSha256 ? { definitionSha256 } : {}),
    });
  const read = (
    kind:
      | 'automation-definition'
      | 'automation-deployment'
      | 'automation-schedule',
  ) => readManagedAutomation(sql, scope, kind);
  const oneWinner = (outcomes: PromiseSettledResult<unknown>[]) => {
    assert.equal(
      outcomes.filter((item) => item.status === 'fulfilled').length,
      1,
    );
    const loser = outcomes.find((item) => item.status === 'rejected');
    assert.ok(loser?.status === 'rejected');
    assert.ok(loser.reason instanceof AutomationError);
    assert.equal(loser.reason.code, 'AUTOMATION_VERSION_STALE');
  };
  let runId: string | undefined;
  try {
    // Concurrent bootstrap cannot mint two versions, even for equal source.
    oneWinner(
      await Promise.allSettled(
        [0, 1].map(() =>
          write({ kind: 'automation-definition', config: definition(1) }, null),
        ),
      ),
    );
    const initial = await read('automation-definition');
    assert.equal(initial.hash, managedConfigurationHash(definition(1)));
    assert.equal(
      (await versionRow(sql, ctx.orgId, name, undefined))?.version,
      1,
    );
    await assert.rejects(
      write({ kind: 'automation-definition', config: definition(1) }, null),
      { code: 'AUTOMATION_VERSION_STALE' },
    );
    await write(
      { kind: 'automation-definition', config: definition(1) },
      initial.hash,
    );
    assert.equal(
      (await versionRow(sql, ctx.orgId, name, undefined))?.version,
      1,
    );
    const noTests = definition(2);
    noTests.document.tests = [];
    await assert.rejects(
      write({ kind: 'automation-definition', config: noTests }, initial.hash),
      { code: 'AUTOMATION_DEPLOY_REJECTED' },
    );
    const failing = definition(2);
    failing.document.tests[0] = {
      name: 'fails',
      input: {},
      expect: { output: 7 },
    };
    await assert.rejects(
      write({ kind: 'automation-definition', config: failing }, initial.hash),
      { code: 'AUTOMATION_DEPLOY_REJECTED' },
    );
    assert.equal(
      (await versionRow(sql, ctx.orgId, name, undefined))?.version,
      1,
    );
    record(
      'managed definitions require native passing tests and concurrent bootstrap saves one immutable version',
      true,
      'one winner; stale equal preimage rejected; current equal preimage is a no-op',
    );

    assert.ok(initial.hash);
    const deployed = { projectId, name, definitionSha256: initial.hash };
    await write({ kind: 'automation-deployment', config: deployed }, null);
    const promotion = await read('automation-deployment');
    await assert.rejects(
      write({ kind: 'automation-deployment', config: deployed }, null),
      { code: 'AUTOMATION_VERSION_STALE' },
    );
    await write(
      { kind: 'automation-deployment', config: deployed },
      promotion.hash,
    );
    const run = await beginRun(sql, {
      organizationId: ctx.orgId,
      name,
      input: {},
      mode: 'mock',
      startedBy: `user:${ctx.userId}`,
      projectId,
    });
    assert.ok(run);
    runId = run.runId;
    oneWinner(
      await Promise.allSettled(
        [2, 3].map((value) =>
          write(
            { kind: 'automation-definition', config: definition(value) },
            initial.hash,
          ),
        ),
      ),
    );
    const edited = await read('automation-definition');
    assert.ok(edited.hash);
    assert.equal(
      (await versionRow(sql, ctx.orgId, name, undefined))?.version,
      2,
    );
    assert.deepEqual(
      (await versionRow(sql, ctx.orgId, name, 1))?.document,
      definition(1).document,
    );
    await assert.rejects(
      write(
        { kind: 'automation-deployment', config: deployed },
        promotion.hash,
      ),
      { code: 'AUTOMATION_VERSION_STALE' },
    );
    const next = { projectId, name, definitionSha256: edited.hash };
    oneWinner(
      await Promise.allSettled(
        [0, 1].map(() =>
          write(
            { kind: 'automation-deployment', config: next },
            promotion.hash,
          ),
        ),
      ),
    );
    const runs = await sql<
      { id: string; version: number }[]
    >`SELECT id, version FROM app.automation_runs WHERE org_id = ${ctx.orgId} AND name = ${name}`;
    assert.deepEqual(
      runs.map(({ id, version }) => ({ id, version })),
      [{ id: runId, version: 1 }],
    );
    record(
      'managed promotion rejects stale source and preserves every admitted immutable run',
      true,
      'one promotion winner; existing run remains v1 and no configuration phase starts another run',
    );

    const schedule = {
      projectId,
      name,
      cron: '0 0 29 2 *',
      timezone: 'UTC',
      enabled: true,
    };
    oneWinner(
      await Promise.allSettled(
        [0, 1].map(() =>
          write(
            { kind: 'automation-schedule', config: schedule },
            null,
            edited.hash ?? undefined,
          ),
        ),
      ),
    );
    // Keep this synthetic schedule ahead of the background scheduler's due
    // window; ancient cursor fixtures would accidentally admit a real fire.
    const stamp = Date.now();
    await sql`UPDATE app.automation_triggers SET consecutive_failures = 2, last_fired_at_ms = ${stamp}, last_due_at_ms = ${stamp + 1}, last_skipped_at_ms = ${stamp + 2}, last_skip_reason = 'start_refused', last_failed_at_ms = ${stamp + 3}, last_failure_code = 'node_error' WHERE org_id = ${ctx.orgId} AND name = ${name}`;
    const before = await listTriggers(sql, ctx.orgId, name);
    const scheduleState = await read('automation-schedule');
    await write(
      { kind: 'automation-schedule', config: schedule },
      scheduleState.hash,
      edited.hash,
    );
    assert.deepEqual(await listTriggers(sql, ctx.orgId, name), before);
    await assert.rejects(
      write(
        { kind: 'automation-schedule', config: schedule },
        null,
        edited.hash,
      ),
      { code: 'AUTOMATION_VERSION_STALE' },
    );
    const changed = { ...schedule, cron: '0 1 29 2 *' };
    oneWinner(
      await Promise.allSettled(
        [0, 1].map(() =>
          write(
            { kind: 'automation-schedule', config: changed },
            scheduleState.hash,
            edited.hash ?? undefined,
          ),
        ),
      ),
    );
    const after = await listTriggers(sql, ctx.orgId, name);
    assert.deepEqual(
      [...after],
      before.map((trigger) =>
        Object.assign({}, trigger, { cron: changed.cron }),
      ),
    );
    for (const reason of [null, 'paused_after_failures']) {
      await sql`UPDATE app.automation_triggers SET enabled = false, last_skip_reason = ${reason} WHERE org_id = ${ctx.orgId} AND name = ${name}`;
      const paused = await read('automation-schedule');
      await assert.rejects(
        write(
          { kind: 'automation-schedule', config: changed },
          paused.hash,
          edited.hash,
        ),
        { code: 'AUTOMATION_TRIGGER_INVALID' },
      );
      assert.equal(
        (await listTriggers(sql, ctx.orgId, name))[0]?.enabled,
        false,
      );
    }
    // The native explicit recovery door retains its existing reset semantics.
    await setTrigger(sql, {
      organizationId: ctx.orgId,
      name,
      trigger: {
        kind: 'schedule',
        cron: changed.cron,
        timezone: 'UTC',
        enabled: false,
      },
      actor: ctx.userId,
    });
    assert.equal(
      (await listTriggers(sql, ctx.orgId, name))[0]?.consecutiveFailures,
      0,
    );
    record(
      'managed schedules preserve IDs, cursors, failure accounting and both deliberate and automatic pauses',
      true,
      'equal readback and cron edit retain every operational field; explicit native recovery still resets the streak',
    );

    await assert.rejects(
      readManagedAutomation(
        sql,
        { ...scope, projectId: 'unrelated-project' },
        'automation-definition',
      ),
      { code: 'AUTOMATION_PROJECT_UNKNOWN' },
    );
    await cancelRun(sql, ctx.orgId, runId, ctx.userId);
    runId = undefined;
    await deleteAutomationCascade(sql, {
      organizationId: ctx.orgId,
      name,
      actor: ctx.userId,
    });
    await assert.rejects(
      write({ kind: 'automation-definition', config: definition(1) }, null),
      { code: 'AUTOMATION_DELETED' },
    );
    record(
      'managed adoption cannot cross a project boundary or resurrect a deleted automation',
      true,
      'scope check and tombstone checked again under the native name lock',
    );
  } finally {
    if (runId) await cancelRun(sql, ctx.orgId, runId, ctx.userId);
    await deleteAutomationCascade(sql, {
      organizationId: ctx.orgId,
      name,
      actor: ctx.userId,
    });
  }
}
