import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql, TransactionSql } from 'postgres';

import { dueOccurrence } from '../../core/automations/cron.ts';
import {
  deliveryIdentity,
  type DeliveryIdentity,
  MAX_WEBHOOK_BODY_BYTES,
  readWebhookBody,
} from '../../core/automations/webhook_delivery.ts';
import {
  hashWebhookToken,
  isPlausibleWebhookToken,
  tokenHashEquals,
} from '../../core/automations/webhook_token.ts';
import {
  getClientIp,
  nodePeerAddress,
} from '../../core/lib/utils/client_ip.ts';
import { rateLimitedResponse } from '../../lib/rate-limit-response.ts';
import {
  RateLimitExceededError,
  checkIpRateLimit,
  checkKeyedRateLimit,
} from '../../lib/rate-limit.ts';
import {
  AutomationError,
  beginRun,
  beginRunInTx,
  getRun,
  resolveRunProject,
} from './store.ts';

/**
 * Trigger DELIVERY — the 0.5 twins of `convex/automations/triggers.ts`:
 *
 *  - `scanScheduledTriggers` (a per-minute pg-boss schedule): minute-cron
 *    matching through the REUSED matcher (`cron.ts` — IANA-zone wall clock,
 *    bounded catch-up). The scan WALKS every enabled schedule (keyset pages,
 *    never a cap an arbitrary subset could hide behind) and CLAIMS each due
 *    occurrence with a conditional stamp, so a throwing run never re-fires
 *    the same minute and two overlapping scans fire it once;
 *  - the webhook doors for organization and explicitly named projects — the token in
 *    the path IS the credential (sha256 verifier + constant-time compare;
 *    unknown/disabled reads as a plain 404). Deliveries are IDEMPOTENT: a
 *    redelivery (the sender's delivery id, or a byte-identical body inside
 *    the short window — `webhook_delivery.ts`) answers with the run the
 *    first delivery started instead of starting another. Nothing
 *    authenticates the sender, so the door is budgeted twice: per sender IP
 *    before the token is hashed (`webhook:ip`), and per verified trigger
 *    (`webhook:trigger`), so a leaked URL starts a bounded number of runs;
 *  - `dispatchAutomationEvent` — platform events fan out to enabled `event`
 *    triggers (never events raised BY an automation — loop safety), wired
 *    into the events emit seam.
 */

/** Rows per page of the scan walk — a page size, not a cap: the walk goes on
 * until every enabled schedule has been examined. */
const SCAN_PAGE_SIZE = 200;
const DEFAULT_TIMEZONE = 'UTC';
const MINUTE_MS = 60_000;
/** How many undeployed schedules one scan names in its summary line. */
const UNDEPLOYED_NAMES_IN_LOG = 5;

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
  /** The last (re)bind — where a schedule's "since" starts when the bind
   * cleared its fire stamp (a kind change), so a trigger re-bound as a
   * schedule never fires an occurrence from before it was one. */
  updatedAt: number;
}

const TRIGGER_COLUMNS = `
  id, org_id AS "organizationId", name, kind, cron, timezone,
  token_hash AS "tokenHash", event, enabled,
  last_fired_at_ms::float8 AS "lastFiredAt",
  created_at_ms::float8 AS "createdAt",
  updated_at_ms::float8 AS "updatedAt"
`;

export interface ScheduleScanResult {
  /** Enabled schedules examined — every one of them, across all pages. */
  examined: number;
  /** Occurrences this scan claimed AND started a run for. */
  fired: number;
  /** Keyset pages the walk took (1 for fleets under the page size). */
  pages: number;
  /** Occurrences claimed whose automation has no deployed version to run. */
  undeployed: number;
}

export async function scanScheduledTriggers(
  sql: Sql,
  options: { pageSize?: number } = {},
): Promise<ScheduleScanResult> {
  const pageSize = options.pageSize ?? SCAN_PAGE_SIZE;
  const now = Date.now();
  // Nothing newer than the current minute can be due, so a trigger already
  // stamped at or past it is left out in SQL rather than fetched to be skipped.
  const floor = Math.floor(now / MINUTE_MS) * MINUTE_MS;
  const result: ScheduleScanResult = {
    examined: 0,
    fired: 0,
    pages: 0,
    undeployed: 0,
  };
  const undeployedNames: string[] = [];
  let cursor: string | null = null;
  for (;;) {
    // A keyset walk in id order: deterministic, complete, and bounded per
    // page — the LIMIT is how much sits in memory at once, not how many
    // triggers the platform serves. The 0.4-era `LIMIT 200` with no ORDER BY
    // handed the 201st enabled schedule to heap order, i.e. to never.
    const page: TriggerRow[] = await sql<TriggerRow[]>`
      SELECT ${sql.unsafe(TRIGGER_COLUMNS)} FROM app.automation_triggers
      WHERE kind = 'schedule' AND enabled = true
        AND (last_fired_at_ms IS NULL OR last_fired_at_ms < ${floor})
        AND (${cursor}::text IS NULL OR id > ${cursor})
      ORDER BY id
      LIMIT ${pageSize}
    `;
    result.pages++;
    result.examined += page.length;
    for (const trigger of page) {
      if (trigger.cron === null || trigger.cron === '') continue;
      const since = trigger.lastFiredAt ?? trigger.updatedAt;
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
      // CLAIM the occurrence BEFORE starting — and conditionally: a run that
      // throws must not leave the schedule re-firing the same minute on every
      // tick, and two overlapping scans (an expired job's retry, two workers)
      // must fire it once. The loser's UPDATE matches no row and moves on.
      const claimed = await sql<{ id: string }[]>`
        UPDATE app.automation_triggers SET last_fired_at_ms = ${due}
        WHERE id = ${trigger.id}
          AND (last_fired_at_ms IS NULL OR last_fired_at_ms < ${due})
        RETURNING id
      `;
      if (claimed.length === 0) continue;
      const started = await beginRun(sql, {
        organizationId: trigger.organizationId,
        name: trigger.name,
        input: { trigger: 'schedule', firedAt: due },
        mode: 'live',
        startedBy: `trigger:${trigger.id}`,
      });
      if (started) {
        result.fired++;
      } else {
        result.undeployed++;
        if (undeployedNames.length < UNDEPLOYED_NAMES_IN_LOG) {
          undeployedNames.push(`${trigger.organizationId}/${trigger.name}`);
        }
      }
    }
    if (page.length < pageSize) break;
    const last = page.at(-1);
    if (last === undefined) break;
    cursor = last.id;
  }
  if (result.undeployed > 0) {
    // One line per scan, not one per trigger: a fleet's worth of undeployed
    // schedules must not turn the scan log into a flood.
    const more = result.undeployed - undeployedNames.length;
    console.warn(
      `[automations] trigger scan: ${result.undeployed} due schedule(s) have no deployed version to run: ${undeployedNames.join(', ')}${more > 0 ? ` (+${more} more)` : ''}`,
    );
  }
  return result;
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

/** Thrown inside the delivery transaction when the automation has no deployed
 * version: rolls the delivery claim back with the (absent) run, so the same
 * delivery runs once the deployment exists. */
class NotDeployedError extends Error {
  constructor() {
    super('automation has no deployed version');
    this.name = 'NotDeployedError';
  }
}

/** The store's project-scope refusals, which the token door answers as ONE
 * 403 that names neither the automation nor the reason: a caller holding
 * only a URL must not learn which project ids exist in the organization,
 * whether one is archived, or what the automation behind the token is
 * called (its slug used to ride in the "not bound" sentence). */
const PROJECT_SCOPE_CODES: ReadonlySet<string> = new Set([
  'AUTOMATION_PROJECT_UNKNOWN',
  'AUTOMATION_PROJECT_FORBIDDEN',
  'AUTOMATION_PROJECT_ARCHIVED',
]);

function projectForbidden(): AutomationError {
  return new AutomationError(
    'AUTOMATION_PROJECT_FORBIDDEN',
    'The automation cannot run in that project.',
    403,
  );
}

/**
 * Accept one webhook delivery: claim its identity and start the run in ONE
 * transaction. The claim goes first so a concurrent repeat blocks on the row
 * lock until this commit and then reads the run started here; a repeat inside
 * the identity's window answers with that run (`duplicate: true`); an expired
 * identity is taken over and runs again as the new delivery it is.
 */
async function acceptWebhookDelivery(
  sql: Sql,
  args: {
    trigger: TriggerRow;
    identity: DeliveryIdentity;
    payload: unknown;
    projectId: string | undefined;
  },
): Promise<{ runId: string; duplicate: boolean }> {
  const { trigger, identity } = args;
  const now = Date.now();
  return transactSerializable(sql, async (tx) => {
    // A token grants one automation's installations, not a user's project
    // visibility. Recheck scope even on retries: removing an installation or
    // archiving its project also closes cached-delivery access.
    const scope =
      args.projectId === undefined
        ? { requireOrgScope: true }
        : { projectId: args.projectId, requireProjectBinding: true };
    try {
      await resolveRunProject(tx, {
        organizationId: trigger.organizationId,
        name: trigger.name,
        ...scope,
      });
    } catch (error) {
      if (
        error instanceof AutomationError &&
        PROJECT_SCOPE_CODES.has(error.code)
      )
        throw projectForbidden();
      throw error;
    }
    if (args.projectId !== undefined) {
      // The project exists in the organization (`resolveRunProject` refused
      // it otherwise); an archived one is closed to deliveries, replays
      // included, with the same uninformative refusal.
      const projects = await tx<{ archivedAt: number | null }[]>`
        SELECT archived_at_ms AS "archivedAt" FROM app.projects
        WHERE org_id = ${trigger.organizationId} AND id = ${args.projectId}
        LIMIT 1
      `;
      if ((projects[0]?.archivedAt ?? null) !== null) throw projectForbidden();
    }
    const claimed = await tx<{ triggerId: string }[]>`
      INSERT INTO app.automation_webhook_deliveries AS d (
        trigger_id, delivery_key, source, run_id, received_at_ms, expires_at_ms
      ) VALUES (
        ${trigger.id}, ${identity.key}, ${identity.source}, NULL,
        ${now}, ${now + identity.windowMs}
      )
      ON CONFLICT (trigger_id, delivery_key) DO UPDATE SET
        source = EXCLUDED.source,
        run_id = NULL,
        received_at_ms = EXCLUDED.received_at_ms,
        expires_at_ms = EXCLUDED.expires_at_ms
      WHERE d.expires_at_ms <= EXCLUDED.received_at_ms
      RETURNING trigger_id AS "triggerId"
    `;
    if (claimed.length === 0) {
      // A live identity: the first delivery's run is the answer.
      const existing = await tx<{ runId: string | null }[]>`
        SELECT run_id AS "runId" FROM app.automation_webhook_deliveries
        WHERE trigger_id = ${trigger.id} AND delivery_key = ${identity.key}
      `;
      const runId = existing[0]?.runId ?? null;
      if (runId === null) {
        // Unreachable for a committed row (the claim and the run commit
        // together); named so a future ledger writer cannot hide behind it.
        throw new Error(
          `webhook delivery ledger row for trigger ${trigger.id} carries no run`,
        );
      }
      // Old flat-URL ledger entries may point at a formerly inferred project.
      // Never return that identity through a different current URL scope.
      const run = await getRun(tx, trigger.organizationId, runId);
      if (run === null || run.projectId !== (args.projectId ?? null)) {
        throw new AutomationError(
          'AUTOMATION_DELIVERY_SCOPE_MISMATCH',
          'The recorded delivery belongs to a different scope.',
          409,
        );
      }
      return { runId, duplicate: true };
    }
    const started = await beginRunInTx(tx, {
      organizationId: trigger.organizationId,
      name: trigger.name,
      input: { trigger: 'webhook', payload: args.payload },
      mode: 'live',
      startedBy: `trigger:${trigger.id}`,
      ...scope,
    });
    if (!started) throw new NotDeployedError();
    await tx`
      UPDATE app.automation_webhook_deliveries SET run_id = ${started.runId}
      WHERE trigger_id = ${trigger.id} AND delivery_key = ${identity.key}
    `;
    // The trigger's `lastFiredAt` is the one thing the trigger read shows
    // about a webhook's history; the schedule and event paths stamp it,
    // and this path never did — an accepted delivery left it null forever.
    // A replayed delivery reuses its run and stamps nothing.
    await tx`
      UPDATE app.automation_triggers SET last_fired_at_ms = ${now}
      WHERE id = ${trigger.id}
    `;
    // Lazy housekeeping on the accepted path: this trigger's expired
    // identities go with the delivery that outlived them (no sweeper job).
    await tx`
      DELETE FROM app.automation_webhook_deliveries
      WHERE trigger_id = ${trigger.id} AND expires_at_ms <= ${now}
    `;
    return { runId: started.runId, duplicate: false };
  });
}

/** Token-only ingress, mounted at `/api/automations/webhook` and
 * `/api/projects/:id/automations/webhook`; the latter supplies URL scope.
 * `trustedProxies` is the deployment's proxy list (`loadTrustedProxies`),
 * injected by the mount so this module — which every domain service reaches
 * through the events seam — never pulls the auth stack in. */
export function createWebhookRoutes(deps: {
  sql: Sql;
  trustedProxies: () => Promise<string[]>;
}): Hono {
  const app = new Hono();

  // Every refusal on this door is the flat JSON envelope the API reference
  // promises of every non-2xx — the 404 and 413 used to be plain text, the
  // one place a webhook sender's JSON error handling could not parse.
  const notFound = (c: Context) =>
    c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);

  /** The 429 for a spent budget, `Retry-After` included; null to proceed. */
  const charge = async (
    c: Context,
    check: () => Promise<void>,
  ): Promise<Response | null> => {
    try {
      await check();
      return null;
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        return rateLimitedResponse(c, error);
      }
      throw error;
    }
  };

  app.post('/:token', async (c) => {
    const token = c.req.param('token');
    if (!isPlausibleWebhookToken(token)) {
      return notFound(c);
    }
    // No key authenticates a sender, so the sender's IP — derived through
    // the deployment's trusted-proxy list, exactly as the REST door's
    // pre-auth lane does — is charged before the body is read or the token
    // hashed: a flood of plausible tokens costs the door nothing past this.
    const ip = getClientIp(c.req.raw.headers, await deps.trustedProxies(), {
      peer: nodePeerAddress(c.env),
    });
    const ipLimited = await charge(c, () =>
      checkIpRateLimit(deps.sql, 'webhook:ip', ip),
    );
    if (ipLimited) return ipLimited;
    // The cap is enforced in BYTES as the body streams — nothing past it is
    // buffered, and a declared Content-Length over it is refused before the
    // first byte. (The former `text().length` check counted UTF-16 code units
    // after reading everything: a 300 KB body of two-byte characters passed
    // as "150 K".)
    const body = await readWebhookBody(c.req.raw);
    if (!body.ok) {
      return c.json(
        {
          error: `Payload too large — the webhook body is capped at ${MAX_WEBHOOK_BODY_BYTES} bytes`,
          code: 'BODY_TOO_LARGE',
        },
        413,
      );
    }
    const { bytes } = body;
    const raw = new TextDecoder().decode(bytes);
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
      return notFound(c);
    }
    // A verified token's trigger has a budget of its own — a delivery costs
    // a durable run, so it is the run-start lane's size — keyed on the
    // trigger id, which no sender can choose.
    const triggerLimited = await charge(c, () =>
      checkKeyedRateLimit(deps.sql, 'webhook:trigger', `trigger:${trigger.id}`),
    );
    if (triggerLimited) return triggerLimited;
    if (c.req.query('projectId') !== undefined) {
      return c.json(
        {
          error: 'Project scope must be supplied in the webhook URL path.',
          code: 'INVALID_QUERY',
        },
        400,
      );
    }
    const projectId = c.req.param('id');
    const identity = await deliveryIdentity({
      headers: c.req.raw.headers,
      body: bytes,
      ...(projectId !== undefined ? { projectId } : {}),
    });
    try {
      const outcome = await acceptWebhookDelivery(deps.sql, {
        trigger,
        identity,
        payload,
        projectId,
      });
      return c.json(
        outcome.duplicate
          ? { runId: outcome.runId, duplicate: true }
          : { runId: outcome.runId },
        202,
      );
    } catch (error) {
      if (error instanceof NotDeployedError) {
        return c.json(
          { error: error.message, code: 'AUTOMATION_NOT_DEPLOYED' },
          409,
        );
      }
      // The token proved the caller may start this automation, so its
      // refusals answer with their own status and code — the 409 of a bound
      // automation at the flat URL or of a delivery recorded in another
      // scope, the 400 of an input the schema refuses (its problems under
      // `data.issues`), the one 403 of a project it cannot run in — never a
      // flat 400 that made a client branch on the URL instead of the code,
      // and never the token-secrecy 404.
      if (error instanceof AutomationError) {
        return c.json(
          {
            error: error.message,
            code: error.code,
            ...(error.data === undefined ? {} : { data: error.data }),
          },
          error.status,
        );
      }
      throw error;
    }
  });

  return app;
}
