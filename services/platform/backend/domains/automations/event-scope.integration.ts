import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { toJson } from '../../db/sql.ts';
import { findOrCreateContactByEmail } from '../contacts/service.ts';
import {
  bindProject,
  deleteTrigger,
  deploy,
  saveVersion,
  setTrigger,
} from './store.ts';
/** Real Postgres proof of who an event starts, driven through real
 * producers: a run's connector step creating a task (the connector action
 * host, which enters the run's origin scope) and the mail ingest minting a
 * contact (no run, so the platform's origin).
 *
 * - A task a person's run creates in Billing starts the automations
 *   installed in Billing or nowhere, in Billing, never the run's own
 *   automation and never one installed only in Sales (AUTO-R12, AUTO-R35).
 * - A task an event-started run creates starts nothing at all (AUTO-R12).
 * - A contact, an event of no project, starts the automation that can take
 *   it, while one whose inputs refuse the event and one installed only in
 *   an archived project each record their refusal on their own trigger —
 *   every start in a savepoint of its own (AUTO-R8, AUTO-R35) — and the
 *   contact is saved (EVENT-R2). */
import { markAutomationWriterInTx } from './writer-protocol.ts';

interface TriggerState {
  id: string;
  lastFiredAt: number | null;
  lastRunId: string | null;
  lastSkipReason: string | null;
  lastSkipCode: string | null;
}

interface RunState {
  id: string;
  projectId: string | null;
  startedBy: string;
  via: string | null;
}

export async function checkEventScopeAndIsolation(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const at = (leaf: string) => `itest/event-scope-${suffix}/${leaf}`;
  const names = {
    raiser: at('raiser'),
    orgWide: at('org-wide'),
    billing: at('billing'),
    sales: at('sales'),
    strict: at('strict'),
    archivedOnly: at('archived-only'),
    open: at('open'),
  };
  const now = Date.now();
  const projects = {
    billing: randomUUID(),
    sales: randomUUID(),
    archived: randomUUID(),
  };
  for (const [label, id] of Object.entries(projects)) {
    await sql`
      INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
      VALUES (${id}, ${orgId}, ${`Event scope ${label} ${suffix}`}, ${userId},
        ${now}, ${now})
    `;
  }

  const install = async (
    name: string,
    event: string,
    options: { inputs?: Record<string, unknown>; projectIds?: string[] } = {},
  ): Promise<void> => {
    await saveVersion(sql, {
      organizationId: orgId,
      name,
      document: {
        version: 1,
        name,
        ...(options.inputs !== undefined ? { inputs: options.inputs } : {}),
        nodes: [{ id: 'noop', type: 'transform', code: 'return null;' }],
        output: '{{ nodes.noop.output }}',
      },
      actor: userId,
    });
    await deploy(sql, {
      organizationId: orgId,
      name,
      version: 1,
      actor: userId,
    });
    for (const projectId of options.projectIds ?? []) {
      await bindProject(sql, {
        organizationId: orgId,
        name,
        projectId,
        actor: userId,
      });
    }
    await setTrigger(sql, {
      organizationId: orgId,
      name,
      trigger: { kind: 'event', event },
      actor: userId,
    });
  };

  const trigger = async (name: string): Promise<TriggerState> => {
    const rows = await sql<TriggerState[]>`
      SELECT id, last_fired_at_ms::float8 AS "lastFiredAt",
             last_run_id AS "lastRunId",
             last_skip_reason AS "lastSkipReason",
             last_skip_detail->>'code' AS "lastSkipCode"
      FROM app.automation_triggers
      WHERE org_id = ${orgId} AND name = ${name}
    `;
    const row = rows[0];
    if (row === undefined) throw new Error(`no trigger bound for ${name}`);
    return row;
  };
  /** The runs a trigger door started for `name`. */
  const triggerRuns = (name: string): Promise<RunState[]> =>
    sql<RunState[]>`
      SELECT id, project_id AS "projectId", started_by AS "startedBy",
             input->>'trigger' AS via
      FROM app.automation_runs
      WHERE org_id = ${orgId} AND name = ${name}
        AND started_by LIKE 'trigger:%'
      ORDER BY started_at_ms
    `;
  const untouched = (state: TriggerState): boolean =>
    state.lastFiredAt === null && state.lastSkipReason === null;
  const describe = async (name: string): Promise<string> => {
    const state = await trigger(name);
    const runs = await triggerRuns(name);
    return `${name.split('/').at(-1)}: runs=${runs.length}${runs.length > 0 ? ` (${runs.map((run) => run.projectId ?? 'org').join(',')})` : ''} fired=${state.lastFiredAt !== null} skip=${state.lastSkipReason ?? '-'}${state.lastSkipCode !== null ? `/${state.lastSkipCode}` : ''}`;
  };

  /** A run of the raiser mid-flight, started by a person: no step job and
   * no wake stamp, so nothing but this lane acts as it. */
  const personRun = async (): Promise<string> => {
    const rows = await sql.begin(async (tx) => {
      await markAutomationWriterInTx(tx);
      return tx<{ id: string }[]>`
        INSERT INTO app.automation_runs (
          org_id, name, version, project_id, status, mode, started_by,
          input, checkpoints, claim_epoch, started_at_ms
        ) VALUES (
          ${orgId}, ${names.raiser}, 1, NULL, 'running', 'live',
          ${`user:${userId}`}, ${sql.json(toJson(JSON.stringify({})))},
          ${sql.json(toJson({ nodes: {}, executions: 1 }))}, 1, ${Date.now()}
        )
        RETURNING id
      `;
    });
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('itest run insert failed');
    return id;
  };

  const { runConnectorAction } = await import('../connectors/service.ts');
  /** A connector step of `runId` creating a task in Billing — the door
   * every native write of a run passes through. */
  const createTaskAsRun = (runId: string, externalId: string) =>
    runConnectorAction(sql, {
      organizationId: orgId,
      connector: 'task',
      action: 'upsert',
      input: {
        projectId: projects.billing,
        externalSystem: 'itest',
        externalId,
        title: `Event scope probe ${externalId}`,
      },
      mode: 'live',
      caller: { kind: 'workflow', runId, nodeId: 'file' },
    });

  let raisingRunId: string | null = null;
  try {
    await install(names.raiser, 'task.created');
    await install(names.orgWide, 'task.created');
    await install(names.billing, 'task.created', {
      projectIds: [projects.billing],
    });
    await install(names.sales, 'task.created', {
      projectIds: [projects.sales],
    });
    await install(names.strict, 'contact.created', {
      inputs: {
        type: 'object',
        required: ['owner'],
        properties: { owner: { type: 'string' } },
      },
    });
    await install(names.archivedOnly, 'contact.created', {
      projectIds: [projects.archived],
    });
    await install(names.open, 'contact.created');
    // Archived after it was installed there: choosing an archived project
    // is refused (AUTO-R8), keeping an installation in one is not.
    await sql`
      UPDATE app.projects SET archived_at_ms = ${Date.now()}
      WHERE id = ${projects.archived}
    `;

    // ---- a person's run creates a task in Billing ----------------------
    raisingRunId = await personRun();
    const filed = await createTaskAsRun(raisingRunId, `scope-${suffix}-1`);
    const raiserRuns = await triggerRuns(names.raiser);
    const orgWideRuns = await triggerRuns(names.orgWide);
    const billingRuns = await triggerRuns(names.billing);
    const salesRuns = await triggerRuns(names.sales);
    const raiser = await trigger(names.raiser);
    const orgWide = await trigger(names.orgWide);
    const billing = await trigger(names.billing);
    const sales = await trigger(names.sales);
    const inBilling = (runs: RunState[], state: TriggerState): boolean =>
      runs.length === 1 &&
      runs[0]?.projectId === projects.billing &&
      runs[0]?.startedBy === `trigger:${state.id}` &&
      runs[0]?.via === 'event' &&
      state.lastRunId === runs[0]?.id;
    record(
      'a task a person’s run creates in a project starts the automations installed there or nowhere, in that project — never the run’s own, never one installed elsewhere [AUTO-R12] [AUTO-R35]',
      filed.status === 'ok' &&
        raiserRuns.length === 0 &&
        untouched(raiser) &&
        inBilling(orgWideRuns, orgWide) &&
        inBilling(billingRuns, billing) &&
        salesRuns.length === 0 &&
        untouched(sales),
      `task upsert ${filed.status} (want ok); ${(
        await Promise.all(
          [names.raiser, names.orgWide, names.billing, names.sales].map(
            describe,
          ),
        )
      ).join(
        '; ',
      )} (want raiser 0 unstamped, org-wide and billing 1 in Billing, sales 0 unstamped)`,
    );

    // ---- an event-started run creates a task ---------------------------
    const eventStarted = orgWideRuns[0]?.id;
    const counts = async (): Promise<number[]> =>
      Promise.all(
        [names.raiser, names.orgWide, names.billing, names.sales].map(
          async (name) => (await triggerRuns(name)).length,
        ),
      );
    const before = await counts();
    const chained =
      eventStarted === undefined
        ? null
        : await createTaskAsRun(eventStarted, `scope-${suffix}-2`);
    const after = await counts();
    record(
      'a task an event-started run creates starts no automation at all [AUTO-R12]',
      chained?.status === 'ok' &&
        before.join(',') === after.join(',') &&
        before.join(',') === '0,1,1,0',
      `event-started run=${eventStarted ?? 'none'}, task upsert ${chained?.status ?? 'not run'} (want ok), trigger runs raiser/org-wide/billing/sales ${before.join(',')} → ${after.join(',')} (want 0,1,1,0 unchanged)`,
    );

    // ---- a contact: an event of no project -----------------------------
    const email = `event-scope-${suffix}@itest.example`;
    const contact = await sql.begin((tx) =>
      findOrCreateContactByEmail(tx, {
        organizationId: orgId,
        email,
        name: 'Event scope probe',
        source: 'conversation',
      }),
    );
    const saved = await sql<{ id: string }[]>`
      SELECT id FROM app.contacts WHERE org_id = ${orgId} AND id = ${contact.contactId}
    `;
    const strict = await trigger(names.strict);
    const archivedOnly = await trigger(names.archivedOnly);
    const open = await trigger(names.open);
    const strictRuns = await triggerRuns(names.strict);
    const archivedRuns = await triggerRuns(names.archivedOnly);
    const openRuns = await triggerRuns(names.open);
    record(
      'a contact starts the automation that can take it while one refusing its input and one installed only in an archived project each record why, and the contact is saved [AUTO-R8] [AUTO-R35]',
      contact.created &&
        saved.length === 1 &&
        strictRuns.length === 0 &&
        strict.lastSkipReason === 'start_refused' &&
        strict.lastSkipCode === 'AUTOMATION_INPUT_INVALID' &&
        archivedRuns.length === 0 &&
        archivedOnly.lastSkipReason === 'start_refused' &&
        archivedOnly.lastSkipCode === 'PROJECT_ARCHIVED' &&
        openRuns.length === 1 &&
        openRuns[0]?.projectId === null &&
        open.lastRunId === openRuns[0]?.id,
      `contact created=${contact.created}, saved=${saved.length === 1}; ${(
        await Promise.all(
          [names.strict, names.archivedOnly, names.open].map(describe),
        )
      ).join(
        '; ',
      )} (want strict start_refused/AUTOMATION_INPUT_INVALID, archived-only start_refused/PROJECT_ARCHIVED, open 1 run of the organization)`,
    );
  } finally {
    for (const name of Object.values(names)) {
      await deleteTrigger(sql, orgId, name, 'itest');
    }
    if (raisingRunId !== null) {
      const runId = raisingRunId;
      await sql.begin(async (tx) => {
        await markAutomationWriterInTx(tx);
        await tx`
          UPDATE app.automation_runs
          SET status = 'cancelled', finished_at_ms = ${Date.now()}
          WHERE org_id = ${orgId} AND id = ${runId} AND status = 'running'
        `;
      });
    }
  }
}
