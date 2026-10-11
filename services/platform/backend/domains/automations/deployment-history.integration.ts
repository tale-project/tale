/** Real Postgres proof of an automation's deployment history
 * (`deployments.ts`, migration 0199): a deploy, a newer one and a rollback
 * are kept newest first, the live version deployed again records nothing,
 * a history reads a page at a time, a deploy that expected another live
 * version is refused naming who put the live one live, two such deploys at
 * once let exactly one through, a pointer an earlier image moved is
 * recorded before the next deploy, and the history goes with the
 * automation. Then migration 0199 itself, run twice: it rebuilds the
 * history the audit log held, records a live version no row says, leaves
 * the deploys of a deleted automation out, and inserts nothing the second
 * time. The lane deletes what it wrote before it ends. */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { Sql } from 'postgres';

import { appOrigin } from '../../lib/write-origin.ts';
import { listDeploymentEvents, readDeploymentPointer } from './deployments.ts';
import {
  AutomationError,
  deleteAutomationCascade,
  deploy,
  saveVersion,
} from './store.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

export async function checkDeploymentHistory(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const origin = appOrigin(userId);
  const names = {
    history: `itest-deploys-${suffix}`,
    backfill: `itest-deploys-backfill-${suffix}`,
    deleted: `itest-deploys-deleted-${suffix}`,
    found: `itest-deploys-found-${suffix}`,
  };
  const save = (name: string, label: string) =>
    saveVersion(sql, {
      organizationId: orgId,
      name,
      document: {
        version: 1,
        name,
        nodes: [{ id: 'noop', type: 'transform', code: `return '${label}';` }],
        output: '{{ nodes.noop.output }}',
      },
      origin,
    });
  const deployOf = (
    name: string,
    version: number,
    expectedDeployedVersion?: number | null,
  ) =>
    deploy(sql, {
      organizationId: orgId,
      name,
      version,
      origin,
      ...(expectedDeployedVersion !== undefined && { expectedDeployedVersion }),
    });
  const eventsOf = async (name: string) =>
    sql<
      { id: string; kind: string; version: number; previous: number | null }[]
    >`
      SELECT id, kind, version, previous_version AS previous
      FROM app.automation_deployment_events
      WHERE org_id = ${orgId} AND name = ${name}
      ORDER BY at_ms DESC, id DESC
    `;
  const said = (
    rows: { kind: string; version: number; previous: number | null }[],
  ) =>
    rows
      .map((row) => `${row.kind}:${row.version}:${String(row.previous)}`)
      .join('|');

  try {
    // The store.
    const { history } = names;
    await save(history, 'one');
    await save(history, 'two');
    const first = await deployOf(history, 1);
    const second = await deployOf(history, 2);
    const back = await deployOf(history, 1);
    const before = await readDeploymentPointer(sql, orgId, history);
    const again = await deployOf(history, 1);
    const after = await readDeploymentPointer(sql, orgId, history);
    const read = await listDeploymentEvents(sql, orgId, history);
    record(
      'deployment history: a deploy, a newer one and a rollback are kept newest first; the live version deployed again records nothing [AUTO-R46]',
      first.kind === 'deploy' &&
        second.kind === 'deploy' &&
        back.kind === 'rollback' &&
        again.kind === 'unchanged' &&
        again.deploymentId === null &&
        said(
          read.events.map((event) => ({
            kind: event.kind,
            version: event.version,
            previous: event.previousVersion,
          })),
        ) === 'rollback:1:2|deploy:2:1|deploy:1:null' &&
        before !== null &&
        after?.deployedAtMs === before.deployedAtMs &&
        read.live?.version === 1 &&
        read.live.via === 'app' &&
        read.live.activeRuns === 0,
      JSON.stringify({ first, second, back, again, before, after, read }),
    );

    const page1 = await listDeploymentEvents(sql, orgId, history, { limit: 2 });
    const page2 =
      page1.nextBefore === null
        ? null
        : await listDeploymentEvents(sql, orgId, history, {
            limit: 2,
            before: page1.nextBefore,
          });
    record(
      'deployment history: reads a page at a time, by time and id',
      page1.events.length === 2 &&
        page2 !== null &&
        page2.events.map((event) => event.version).join('|') === '1' &&
        page2.events[0]?.previousVersion === null &&
        page2.nextBefore === null,
      JSON.stringify({ page1, page2 }),
    );

    const refused = await deployOf(history, 2, 2).catch(
      (error: unknown) => error,
    );
    record(
      'a deploy that expected another live version is refused, naming who put the live one live and through which door',
      refused instanceof AutomationError &&
        refused.code === 'AUTOMATION_DEPLOYMENT_STALE' &&
        refused.status === 409 &&
        refused.data?.deployedVersion === 1 &&
        refused.data.deployedBy === userId &&
        refused.data.deployedVia === 'app',
      refused instanceof AutomationError
        ? JSON.stringify({ code: refused.code, data: refused.data })
        : String(refused),
    );

    const countBefore = (await eventsOf(history)).length;
    const both = await Promise.allSettled([
      deployOf(history, 2, 1),
      deployOf(history, 2, 1),
    ]);
    const won = both.filter((result) => result.status === 'fulfilled');
    const lost = both.filter(
      (result) =>
        result.status === 'rejected' &&
        result.reason instanceof AutomationError &&
        result.reason.code === 'AUTOMATION_DEPLOYMENT_STALE',
    );
    const countAfter = (await eventsOf(history)).length;
    record(
      'two deploys that expected the same live version at once: exactly one goes through, and the history gains one row',
      won.length === 1 && lost.length === 1 && countAfter === countBefore + 1,
      JSON.stringify({ both, countBefore, countAfter }),
    );

    // An earlier image puts v1 live during a rolling deploy: no event.
    await sql`
      UPDATE app.automation_deployments
      SET version = 1, deployed_by = ${userId}, deployed_at_ms = ${Date.now()}
      WHERE org_id = ${orgId} AND name = ${history}
    `;
    const pending = await listDeploymentEvents(sql, orgId, history);
    await deployOf(history, 2);
    const healed = await eventsOf(history);
    const leading = pending.events[0];
    record(
      'a version an earlier image put live is read as found, and recorded before the next deploy',
      leading !== undefined &&
        leading.synthesized &&
        leading.kind === 'recorded' &&
        leading.version === 1 &&
        said(healed.slice(0, 2)) === 'deploy:2:1|recorded:1:null',
      JSON.stringify({ pending: pending.events.slice(0, 2), healed }),
    );

    await deleteAutomationCascade(sql, {
      organizationId: orgId,
      name: history,
      origin,
    });
    record(
      'the deployment history goes with the automation [AUTO-R15]',
      (await eventsOf(history)).length === 0,
      JSON.stringify(await eventsOf(history)),
    );

    // Migration 0199, run on what the audit log and the pointers hold.
    const { backfill, deleted, found } = names;
    await save(backfill, 'one');
    await save(backfill, 'two');
    await deployOf(backfill, 1);
    await deployOf(backfill, 2);
    // Before 0199 there were no events: the audit rows are the history.
    await sql`
      DELETE FROM app.automation_deployment_events
      WHERE org_id = ${orgId} AND name = ${backfill}
    `;
    const audited = await sql<{ id: string }[]>`
      SELECT id FROM app.audit_logs
      WHERE org_id = ${orgId} AND action = 'automation.deployed'
        AND resource_type = 'automation' AND resource_id = ${backfill}
    `;
    await save(deleted, 'one');
    await deployOf(deleted, 1);
    await deleteAutomationCascade(sql, {
      organizationId: orgId,
      name: deleted,
      origin,
    });
    // A version live with no row saying so.
    await save(found, 'one');
    await sql`
      INSERT INTO app.automation_deployments (
        org_id, name, version, deployed_by, deployed_at_ms
      ) VALUES (${orgId}, ${found}, 1, ${userId}, ${Date.now()})
    `;
    const migration = await readFile(
      new URL(
        '../../db/migrations/0199_automation_deployment_events.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await sql.unsafe(migration);
    const once = {
      backfill: await eventsOf(backfill),
      deleted: await eventsOf(deleted),
      found: await eventsOf(found),
    };
    await sql.unsafe(migration);
    const twice = {
      backfill: await eventsOf(backfill),
      deleted: await eventsOf(deleted),
      found: await eventsOf(found),
    };
    record(
      'migration 0199 rebuilds the history the audit log held, records a live version no row says, leaves out a deleted automation, and inserts nothing the second time',
      audited.length === 2 &&
        said(once.backfill) === 'deploy:2:1|deploy:1:null' &&
        once.backfill.every((row) => row.id.startsWith('audit:')) &&
        once.deleted.length === 0 &&
        said(once.found) === 'recorded:1:null' &&
        JSON.stringify(twice) === JSON.stringify(once),
      JSON.stringify({ audited: audited.length, once, twice }),
    );
  } finally {
    for (const name of Object.values(names)) {
      await deleteAutomationCascade(sql, {
        organizationId: orgId,
        name,
        origin,
      }).catch((error: unknown) => {
        console.warn(
          `[itest] cleanup of ${name}:`,
          error instanceof Error ? error.message : error,
        );
      });
    }
    await sql`
      DELETE FROM app.automation_deployment_events
      WHERE org_id = ${orgId} AND name IN ${sql(Object.values(names))}
    `;
  }
}
