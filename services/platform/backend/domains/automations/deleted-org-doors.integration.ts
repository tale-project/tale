/**
 * Real Postgres proof that the webhook door and the event door — the
 * schedule scan's two siblings (`deleted-org-schedules.integration.ts`) —
 * never start a run for a binding whose organization no longer exists. What
 * an organization deletion before 0.5.9 left behind, and what 0125 keeps
 * whole under an active legal hold, is planted under an org id no
 * `organization` row carries: two deployed automations, one behind a webhook
 * whose token the lane holds, one listening for `contact.created`. Two
 * deliveries to the URL answer the 404 of a disabled URL, two events emitted
 * in the organization's name start nothing, and each binding ends up
 * disabled — never fired, never stamped skipped — and named in one line.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import {
  hashWebhookToken,
  mintWebhookToken,
} from '../../core/automations/webhook_token.ts';
import { emitEvent } from '../events/emit.ts';

interface TriggerState {
  enabled: boolean;
  lastFiredAt: number | null;
  lastSkipReason: string | null;
}

export async function checkDeletedOrgDoors(
  sql: Sql,
  base: string,
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const deadOrgId = `itest-deleted-org-${randomUUID()}`;
  const hookName = 'ops/orphaned-webhook';
  const eventName = 'ops/orphaned-event';
  const event = 'contact.created';
  const backdated = Date.now() - 120_000;
  const token = mintWebhookToken();
  const tokenHash = await hashWebhookToken(token);
  for (const name of [hookName, eventName]) {
    await sql`
      INSERT INTO app.automations (
        org_id, name, version, document, created_by, created_at_ms
      ) VALUES (
        ${deadOrgId}, ${name}, 1,
        ${sql.json({
          version: 1,
          name,
          nodes: [
            {
              id: 'echo',
              type: 'transform',
              input: { via: '{{ input.trigger }}' },
              code: 'return { ok: input.via }',
            },
          ],
          output: '{{ nodes.echo.output.ok }}',
        })},
        'itest', ${backdated}
      )
    `;
    await sql`
      INSERT INTO app.automation_deployments (
        org_id, name, version, deployed_by, deployed_at_ms
      ) VALUES (${deadOrgId}, ${name}, 1, 'itest', ${backdated})
    `;
  }
  const planted = await sql<{ id: string; kind: string }[]>`
    INSERT INTO app.automation_triggers (
      org_id, name, kind, token_hash, event, enabled, created_by,
      created_at_ms, updated_at_ms
    ) VALUES
      (${deadOrgId}, ${hookName}, 'webhook', ${tokenHash}, NULL, true,
       'itest', ${backdated}, ${backdated}),
      (${deadOrgId}, ${eventName}, 'event', NULL, ${event}, true,
       'itest', ${backdated}, ${backdated})
    RETURNING id, kind
  `;
  const hookId = planted.find((row) => row.kind === 'webhook')?.id ?? '';
  const eventId = planted.find((row) => row.kind === 'event')?.id ?? '';
  const stateOf = async (id: string): Promise<TriggerState | undefined> =>
    (
      await sql<TriggerState[]>`
        SELECT enabled, last_fired_at_ms::float8 AS "lastFiredAt",
               last_skip_reason AS "lastSkipReason"
        FROM app.automation_triggers WHERE id = ${id}
      `
    )[0];
  const runsOf = async (name: string): Promise<number> => {
    const rows = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.automation_runs
      WHERE org_id = ${deadOrgId} AND name = ${name}
    `;
    return rows[0]?.count ?? -1;
  };

  // Every line the doors write, so "named once" is observed, not assumed.
  const lines: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
    warn(...args);
  };
  const deliveries: { status: number; code: string }[] = [];
  let hookRuns = -1;
  let eventRuns = -1;
  let hook: TriggerState | undefined;
  let listener: TriggerState | undefined;
  try {
    for (const attempt of [1, 2]) {
      const response = await fetch(`${base}/api/automations/webhook/${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attempt }),
      });
      const body: unknown = await response.json().catch(() => ({}));
      deliveries.push({
        status: response.status,
        code:
          typeof body === 'object' &&
          body !== null &&
          'code' in body &&
          typeof body.code === 'string'
            ? body.code
            : '',
      });
    }
    // Each emit in a producer's transaction of its own, as a write in the
    // dead organization's name would raise it.
    for (const attempt of [1, 2]) {
      await sql.begin((tx) =>
        emitEvent(tx, {
          organizationId: deadOrgId,
          eventType: event,
          eventData: { contactId: `itest-contact-${attempt}` },
        }),
      );
    }
    hookRuns = await runsOf(hookName);
    eventRuns = await runsOf(eventName);
    hook = await stateOf(hookId);
    listener = await stateOf(eventId);
  } finally {
    console.warn = warn;
    // Only a door that failed this proof started runs; they go too.
    await sql`DELETE FROM app.automation_runs WHERE org_id = ${deadOrgId}`;
    await sql`
      DELETE FROM app.automation_triggers WHERE org_id = ${deadOrgId}
    `;
    await sql`
      DELETE FROM app.automation_deployments WHERE org_id = ${deadOrgId}
    `;
    await sql`DELETE FROM app.automations WHERE org_id = ${deadOrgId}`;
  }
  const naming = (name: string): string[] =>
    lines.filter(
      (line) =>
        line.includes(`${deadOrgId}/${name}`) &&
        line.includes('whose organization no longer exists'),
    );
  record(
    'a webhook delivery to a trigger whose organization no longer exists starts no run: 404, disabled, named once',
    hookId !== '' &&
      deliveries.length === 2 &&
      deliveries.every(
        (delivery) => delivery.status === 404 && delivery.code === 'NOT_FOUND',
      ) &&
      hookRuns === 0 &&
      hook?.enabled === false &&
      hook.lastFiredAt === null &&
      hook.lastSkipReason === null &&
      naming(hookName).length === 1,
    `deliveries=${deliveries.map((delivery) => `${delivery.status} ${delivery.code}`).join(', ')} (want 404 NOT_FOUND twice), runs=${hookRuns} (want 0), enabled=${hook?.enabled} (want false), fired=${hook?.lastFiredAt ?? 'never'}, skip=${hook?.lastSkipReason ?? 'none'}, lines naming it=${naming(hookName).length} (want 1)`,
  );
  record(
    'an event in the name of an organization that no longer exists starts no run: its trigger disabled, named once',
    eventId !== '' &&
      eventRuns === 0 &&
      listener?.enabled === false &&
      listener.lastFiredAt === null &&
      listener.lastSkipReason === null &&
      naming(eventName).length === 1,
    `runs=${eventRuns} (want 0), enabled=${listener?.enabled} (want false), fired=${listener?.lastFiredAt ?? 'never'}, skip=${listener?.lastSkipReason ?? 'none'}, lines naming it=${naming(eventName).length} (want 1)`,
  );
}
