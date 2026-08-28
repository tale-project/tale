import { Hono } from 'hono';
import type { Sql, TransactionSql } from 'postgres';

import { dueOccurrence } from '../../../convex/automations/cron.ts';
import {
  hashWebhookToken,
  isPlausibleWebhookToken,
  tokenHashEquals,
} from '../../../convex/automations/webhook_token.ts';
import { AutomationError, beginRun, beginRunInTx } from './store.ts';

/**
 * Trigger DELIVERY — the 0.5 twins of `convex/automations/triggers.ts`:
 *
 *  - `scanScheduledTriggers` (a per-minute pg-boss schedule): minute-cron
 *    matching through the REUSED matcher (`cron.ts` — IANA-zone wall clock,
 *    bounded catch-up), `lastFiredAt` stamped BEFORE the start so a throwing
 *    run never re-fires the same minute;
 *  - the webhook door `POST /api/automations/webhook/<token>` — the token in
 *    the path IS the credential (sha256 verifier + constant-time compare;
 *    unknown/disabled reads as a plain 404);
 *  - `dispatchAutomationEvent` — platform events fan out to enabled `event`
 *    triggers (never events raised BY an automation — loop safety), wired
 *    into the events emit seam.
 */

const SCAN_LIMIT = 200;
const DEFAULT_TIMEZONE = 'UTC';
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

interface TriggerRow {
  id: string;
  organizationId: string;
  name: string;
  kind: string;
  cron: string | null;
  timezone: string | null;
  tokenHash: string | null;
  event: string | null;
  enabled: boolean;
  lastFiredAt: number | null;
  createdAt: number;
}

const TRIGGER_COLUMNS = `
  id, org_id AS "organizationId", name, kind, cron, timezone,
  token_hash AS "tokenHash", event, enabled,
  last_fired_at_ms::float8 AS "lastFiredAt",
  created_at_ms::float8 AS "createdAt"
`;

export async function scanScheduledTriggers(
  sql: Sql,
): Promise<{ examined: number; fired: number }> {
  const now = Date.now();
  const triggers = await sql<TriggerRow[]>`
    SELECT ${sql.unsafe(TRIGGER_COLUMNS)} FROM app.automation_triggers
    WHERE kind = 'schedule' AND enabled = true
    LIMIT ${SCAN_LIMIT}
  `;
  let fired = 0;
  for (const trigger of triggers) {
    if (trigger.cron === null || trigger.cron === '') continue;
    const since = trigger.lastFiredAt ?? trigger.createdAt;
    let due: number | null;
    try {
      due = dueOccurrence(
        trigger.cron,
        trigger.timezone ?? DEFAULT_TIMEZONE,
        since,
        now,
      );
    } catch (error) {
      // A schedule the author wrote wrong must not stop the whole scan.
      console.warn(
        `[automations] trigger ${trigger.organizationId}/${trigger.name}: unusable schedule`,
        error instanceof Error ? error.message : error,
      );
      continue;
    }
    if (due === null) continue;
    // Stamp BEFORE starting: a run that throws must not leave the schedule
    // re-firing the same minute on every tick.
    await sql`
      UPDATE app.automation_triggers SET last_fired_at_ms = ${due}
      WHERE id = ${trigger.id}
    `;
    const started = await beginRun(sql, {
      organizationId: trigger.organizationId,
      name: trigger.name,
      input: { trigger: 'schedule', firedAt: due },
      mode: 'live',
      startedBy: `trigger:${trigger.id}`,
    });
    if (started) fired++;
    else {
      console.warn(
        `[automations] trigger ${trigger.organizationId}/${trigger.name}: no deployed version to run`,
      );
    }
  }
  return { examined: triggers.length, fired };
}

/** Platform events → enabled `event` triggers of the org. Events raised BY
 * an automation run never fire triggers (loop safety). */
export async function dispatchAutomationEvent(
  tx: TransactionSql,
  args: {
    organizationId: string;
    event: string;
    payload?: unknown;
    origin: 'platform' | 'automation';
  },
): Promise<{ started: string[]; refused: boolean }> {
  if (args.origin === 'automation') {
    console.warn(
      `[automations] event "${args.event}" raised by an automation run does not fire triggers (loop safety)`,
    );
    return { started: [], refused: true };
  }
  const triggers = await tx<TriggerRow[]>`
    SELECT ${tx.unsafe(TRIGGER_COLUMNS)} FROM app.automation_triggers
    WHERE org_id = ${args.organizationId} AND kind = 'event'
      AND enabled = true AND event = ${args.event}
  `;
  const started: string[] = [];
  for (const trigger of triggers) {
    await tx`
      UPDATE app.automation_triggers SET last_fired_at_ms = ${Date.now()}
      WHERE id = ${trigger.id}
    `;
    const run = await beginRunInTx(tx, {
      organizationId: args.organizationId,
      name: trigger.name,
      input: { trigger: 'event', event: args.event, payload: args.payload },
      mode: 'live',
      startedBy: `trigger:${trigger.id}`,
    });
    if (run) started.push(run.runId);
  }
  return { started, refused: false };
}

/** The inbound webhook door. Mounted at `/api/automations/webhook`. */
export function createWebhookRoutes(deps: { sql: Sql }): Hono {
  const app = new Hono();

  app.post('/:token', async (c) => {
    const token = c.req.param('token');
    if (!isPlausibleWebhookToken(token)) {
      return c.text('Not found', 404);
    }
    const raw = await c.req.text();
    if (raw.length > MAX_WEBHOOK_BODY_BYTES) {
      return c.text('Payload too large', 413);
    }
    let payload: unknown = raw;
    if (raw.length > 0) {
      try {
        payload = JSON.parse(raw);
      } catch (error) {
        // A non-JSON body is legitimate for some vendors; deliver as text.
        console.warn(
          '[automations] webhook body is not JSON; delivering it as text',
          error instanceof Error ? error.message : error,
        );
      }
    }
    const presented = await hashWebhookToken(token);
    const rows = await deps.sql<TriggerRow[]>`
      SELECT ${deps.sql.unsafe(TRIGGER_COLUMNS)} FROM app.automation_triggers
      WHERE token_hash = ${presented} AND kind = 'webhook'
      LIMIT 1
    `;
    const trigger = rows[0];
    // The index lookup already matched; the constant-time compare is the
    // belt-and-braces check that must never become a plain `===`.
    if (
      !trigger ||
      trigger.tokenHash === null ||
      !tokenHashEquals(presented, trigger.tokenHash) ||
      !trigger.enabled
    ) {
      return c.text('Not found', 404);
    }
    const requestedProject = c.req.query('projectId');
    try {
      const started = await beginRun(deps.sql, {
        organizationId: trigger.organizationId,
        name: trigger.name,
        input: { trigger: 'webhook', payload },
        mode: 'live',
        startedBy: `trigger:${trigger.id}`,
        ...(requestedProject !== undefined && requestedProject !== ''
          ? { projectId: requestedProject }
          : {}),
      });
      if (!started) {
        return c.json({ error: 'automation has no deployed version' }, 409);
      }
      return c.json({ runId: started.runId }, 202);
    } catch (error) {
      // The token proved the caller may start this automation, so a bad
      // projectId is a plain 400 with the reason — not the token-secrecy 404.
      if (error instanceof AutomationError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  return app;
}
