import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql, TransactionSql } from 'postgres';

import { scheduleTriggerInput } from '../../../lib/engine/core/slots.ts';
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
import { noStoreByDefault } from '../../lib/http-hygiene.ts';
import { rateLimitedResponse } from '../../lib/rate-limit-response.ts';
import {
  RateLimitExceededError,
  checkIpRateLimit,
  checkKeyedRateLimit,
} from '../../lib/rate-limit.ts';
import { lockAuditChain } from '../audit_logs/service.ts';
import {
  AutomationError,
  beginRunInTx,
  getRun,
  resolveRunProject,
  type TriggerSkipReason,
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
 *
 * On all three doors, a binding whose organization no longer exists (a
 * deletion before 0.5.9 left every automation row behind, and 0125 keeps
 * them whole under an active legal hold) starts nothing: the door that meets
 * it disables it and names it in one line — the scan without claiming it,
 * the webhook door behind the same 404 a disabled URL gets, the event door
 * in the producer's transaction.
 */

/** Rows per page of the scan walk — a page size, not a cap: the walk goes on
 * until every enabled schedule has been examined. */
const SCAN_PAGE_SIZE = 200;
const DEFAULT_TIMEZONE = 'UTC';
const MINUTE_MS = 60_000;
/** How many bindings one log line names; the rest are counted. */
const NAMES_IN_LOG = 5;

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
  /** The last occurrence (schedule) or moment (event, webhook) this binding
   * STARTED A RUN for — stamped with the run, never before it. */
  lastFiredAt: number | null;
  /** The occurrence the scan last CLAIMED — the cursor an overlapping scan
   * loses against, whether or not a run followed (migration 0096). */
  lastDueAt: number | null;
  /** The last time the binding came due and started nothing, and why. */
  lastSkippedAt: number | null;
  lastSkipReason: string | null;
  createdAt: number;
  /** The last (re)bind — where a schedule's "since" starts when the bind
   * cleared its stamps (a kind change), so a trigger re-bound as a
   * schedule never fires an occurrence from before it was one. */
  updatedAt: number;
}

const TRIGGER_COLUMNS = `
  id, org_id AS "organizationId", name, kind, cron, timezone,
  token_hash AS "tokenHash", event, enabled,
  last_fired_at_ms::float8 AS "lastFiredAt",
  last_due_at_ms::float8 AS "lastDueAt",
  last_skipped_at_ms::float8 AS "lastSkippedAt",
  last_skip_reason AS "lastSkipReason",
  created_at_ms::float8 AS "createdAt",
  updated_at_ms::float8 AS "updatedAt"
`;

/** Why a binding came due and started nothing — the delivery paths' part of
 * the ledger's closed set (`TriggerSkipReason`; the column's CHECK). The
 * rest, a schedule that paused itself, is stamped by `trigger-failures.ts`
 * when a run lands. */
type SkipReason = Exclude<TriggerSkipReason, 'paused_after_failures'>;

/** A schedule whose expression cannot be read is left alone until its next
 * edit; should the stamp that keeps it out of the page ever fail to hold,
 * the line is written again at most this often. */
const UNUSABLE_WARN_INTERVAL_MS = 60 * 60 * 1000;

/** The binding started a run: the fire stamp and the run it names, in the
 * caller's transaction — the one that inserts the run. */
async function stampFired(
  sql: Sql | TransactionSql,
  triggerId: string,
  at: number,
  runId: string,
): Promise<void> {
  await sql`
    UPDATE app.automation_triggers
    SET last_fired_at_ms = ${at}, last_run_id = ${runId}
    WHERE id = ${triggerId}
  `;
}

/** The binding came due and started nothing. */
async function stampSkipped(
  sql: Sql | TransactionSql,
  triggerId: string,
  at: number,
  reason: SkipReason,
): Promise<void> {
  await sql`
    UPDATE app.automation_triggers
    SET last_skipped_at_ms = ${at}, last_skip_reason = ${reason}
    WHERE id = ${triggerId}
  `;
}

/** A binding as a door that could start its run reads it: the row, and
 * whether the organization it belongs to is still there. */
interface OrgCheckedTriggerRow extends TriggerRow {
  /** No `organization` row carries the binding's org id: the organization
   * was deleted and the binding outlived it (the teardown before 0.5.9 left
   * every automation row behind). */
  orgMissing: boolean;
}

/** Disable bindings whose organization no longer exists — the one write
 * every door uses. Both halves are re-checked at the write — still enabled,
 * organization still missing — so of two scans or deliveries that meet the
 * same binding, only the one whose write switched it off gets it back, and
 * each binding is named once. */
async function retireOrphanedTriggers(
  sql: Sql | TransactionSql,
  triggerIds: string[],
): Promise<{ organizationId: string; name: string }[]> {
  return sql<{ organizationId: string; name: string }[]>`
    UPDATE app.automation_triggers t SET enabled = false
    WHERE t.id = ANY(${triggerIds}::text[]) AND t.enabled = true
      AND NOT EXISTS (
        SELECT 1 FROM "organization" o WHERE o."id" = t.org_id
      )
    RETURNING t.org_id AS "organizationId", t.name
  `;
}

/** The names a log line carries: the first few, then how many more. */
function namedList(count: number, names: readonly string[]): string {
  const more = count - names.length;
  return `${names.join(', ')}${more > 0 ? ` (+${more} more)` : ''}`;
}

/** Better Auth creates `organization` when an api role boots. A pure worker
 * (`ROLE=worker`) runs only the app migrations, so on a fresh install its
 * scan can come before the table does — every scan that asks whether an
 * organization still exists asks this first. */
export async function organizationTableExists(sql: Sql): Promise<boolean> {
  const rows = await sql<{ present: boolean }[]>`
    SELECT to_regclass('"organization"') IS NOT NULL AS present
  `;
  return rows[0]?.present ?? false;
}

export interface ScheduleScanResult {
  /** Enabled schedules examined — every one of them, across all pages. */
  examined: number;
  /** Occurrences this scan claimed AND started a run for. */
  fired: number;
  /** Keyset pages the walk took (1 for fleets under the page size). */
  pages: number;
  /** Occurrences claimed whose automation has no deployed version to run. */
  undeployed: number;
  /** Occurrences claimed whose deployed version refused the run's input. */
  refused: number;
  /** Schedules whose expression or zone could not be read this scan. */
  unusable: number;
  /** Schedules of an organization that no longer exists, disabled by this
   * scan — never claimed, never run. */
  orphaned: number;
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
    refused: 0,
    unusable: 0,
    orphaned: 0,
  };
  // No table means no organization yet, so no schedule can belong to one:
  // there is nothing to fire or retire, and every page query would die on
  // the missing relation — once a minute until an api role boots. Enabled
  // schedules without it are not a fresh install: this connection cannot
  // see Better Auth's tables, and none of them fires until it can.
  if (!(await organizationTableExists(sql))) {
    const waiting = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.automation_triggers
      WHERE kind = 'schedule' AND enabled = true
    `;
    const count = waiting[0]?.count ?? 0;
    if (count > 0) {
      console.warn(
        `[automations] trigger scan: ${count} enabled schedule(s) wait, but this connection sees no "organization" table — none fires until Better Auth's tables are reachable (check the worker's database and search_path)`,
      );
    }
    return result;
  }
  const undeployedNames: string[] = [];
  const refusedNames: string[] = [];
  const orphanedNames: string[] = [];
  let cursor: string | null = null;
  try {
    for (;;) {
      // A keyset walk in id order: deterministic, complete, and bounded per
      // page — the LIMIT is how much sits in memory at once, not how many
      // triggers the platform serves. The 0.4-era `LIMIT 200` with no ORDER BY
      // handed the 201st enabled schedule to heap order, i.e. to never.
      // The cursor is the LATER of the claim and the fire stamp: a previous
      // image still claims on `last_fired_at_ms` alone during a roll (0096).
      // A schedule stamped unusable stays out of the page until it is edited
      // — re-parsing a broken expression every minute told nobody anything.
      // Each row says whether its organization still exists: a binding the
      // organization's deletion left behind must not start a run in its name.
      const page: OrgCheckedTriggerRow[] = await sql<OrgCheckedTriggerRow[]>`
        SELECT ${sql.unsafe(TRIGGER_COLUMNS)},
          NOT EXISTS (
            SELECT 1 FROM "organization" o WHERE o."id" = t.org_id
          ) AS "orgMissing"
        FROM app.automation_triggers t
        WHERE kind = 'schedule' AND enabled = true
          AND (GREATEST(last_due_at_ms, last_fired_at_ms) IS NULL
               OR GREATEST(last_due_at_ms, last_fired_at_ms) < ${floor})
          AND (last_skip_reason IS DISTINCT FROM 'unusable_cron'
               OR last_skipped_at_ms IS NULL
               OR updated_at_ms > last_skipped_at_ms)
          AND (${cursor}::text IS NULL OR id > ${cursor})
        ORDER BY id
        LIMIT ${pageSize}
      `;
      result.pages++;
      result.examined += page.length;
      // Whatever its expression says, nothing may start in the name of an
      // organization that is gone. The page's orphans are disabled first,
      // in one write before any claim, so a claim that throws further down
      // cannot keep them enabled for the next scan.
      const orphans = page
        .filter((trigger) => trigger.orgMissing)
        .map((trigger) => trigger.id);
      if (orphans.length > 0) {
        for (const retired of await retireOrphanedTriggers(sql, orphans)) {
          result.orphaned++;
          if (orphanedNames.length < NAMES_IN_LOG) {
            orphanedNames.push(`${retired.organizationId}/${retired.name}`);
          }
        }
      }
      for (const trigger of page) {
        if (trigger.orgMissing) continue;
        if (trigger.cron === null || trigger.cron === '') continue;
        const stamps = [trigger.lastDueAt, trigger.lastFiredAt].filter(
          (stamp): stamp is number => stamp !== null,
        );
        const since =
          stamps.length > 0 ? Math.max(...stamps) : trigger.updatedAt;
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
          // The skip stamp is what the trigger read shows for it and what
          // keeps it out of the next page; the line is written when the
          // reason is news (or once an hour, should the stamp not hold).
          result.unusable++;
          if (
            trigger.lastSkipReason !== 'unusable_cron' ||
            trigger.lastSkippedAt === null ||
            now - trigger.lastSkippedAt > UNUSABLE_WARN_INTERVAL_MS
          ) {
            console.warn(
              `[automations] trigger ${trigger.organizationId}/${trigger.name}: unusable schedule`,
              error instanceof Error ? error.message : error,
            );
          }
          await stampSkipped(sql, trigger.id, now, 'unusable_cron');
          continue;
        }
        if (due === null) continue;
        // CLAIM the occurrence first, conditionally: two overlapping scans (an
        // expired job's retry, two workers) must fire it once — the loser's
        // UPDATE waits on the row and then matches nothing. The claim, the
        // run and the fire stamp commit TOGETHER, so the stamp can never
        // precede the run it names and a start that fails to commit takes
        // its claim with it. What the deployed version refuses keeps its
        // claim — rolling it back would retry the same refusal every minute.
        // Re-check the binding as well as the cursor: a run may have paused
        // it, or a person may have saved it, since this page was read. That
        // stale occurrence has no authority to start another run.
        const outcome = await sql.begin(async (tx) => {
          const claimed = await tx<{ id: string }[]>`
            UPDATE app.automation_triggers SET last_due_at_ms = ${due}
            WHERE id = ${trigger.id}
              AND kind = 'schedule' AND enabled = true
              AND updated_at_ms = ${trigger.updatedAt}
              AND (GREATEST(last_due_at_ms, last_fired_at_ms) IS NULL
                   OR GREATEST(last_due_at_ms, last_fired_at_ms) < ${due})
            RETURNING id
          `;
          if (claimed.length === 0) return { kind: 'lost' as const };
          let started: { runId: string; version: number } | null;
          try {
            started = await beginRunInTx(tx, {
              organizationId: trigger.organizationId,
              name: trigger.name,
              input: scheduleTriggerInput(due),
              mode: 'live',
              startedBy: `trigger:${trigger.id}`,
            });
          } catch (error) {
            if (!(error instanceof AutomationError)) throw error;
            await stampSkipped(tx, trigger.id, now, 'start_refused');
            return { kind: 'refused' as const, reason: error.message };
          }
          if (started === null) {
            await stampSkipped(tx, trigger.id, now, 'not_deployed');
            return { kind: 'not_deployed' as const };
          }
          await stampFired(tx, trigger.id, due, started.runId);
          return { kind: 'fired' as const };
        });
        const label = `${trigger.organizationId}/${trigger.name}`;
        switch (outcome.kind) {
          case 'fired':
            result.fired++;
            break;
          case 'not_deployed':
            result.undeployed++;
            if (undeployedNames.length < NAMES_IN_LOG) {
              undeployedNames.push(label);
            }
            break;
          case 'refused':
            result.refused++;
            if (refusedNames.length < NAMES_IN_LOG) {
              refusedNames.push(`${label} (${outcome.reason})`);
            }
            break;
          case 'lost':
            break;
        }
      }
      if (page.length < pageSize) break;
      const last = page.at(-1);
      if (last === undefined) break;
      cursor = last.id;
    }
  } finally {
    // Written whether the walk finished or a page threw: the schedules the
    // pages before it disabled never enter a page again, so this is the
    // only line that ever names them. One line per outcome and scan, not
    // one per trigger: a fleet's worth of undeployed schedules must not
    // turn the scan log into a flood. Each disabled binding is named once —
    // only the scan whose write disabled it has it back.
    if (result.undeployed > 0) {
      console.warn(
        `[automations] trigger scan: ${result.undeployed} due schedule(s) have no deployed version to run: ${namedList(result.undeployed, undeployedNames)}`,
      );
    }
    if (result.refused > 0) {
      console.warn(
        `[automations] trigger scan: ${result.refused} due schedule(s) were refused by their deployed version: ${namedList(result.refused, refusedNames)}`,
      );
    }
    if (result.orphaned > 0) {
      console.warn(
        `[automations] trigger scan: disabled ${result.orphaned} schedule(s) whose organization no longer exists: ${namedList(result.orphaned, orphanedNames)}`,
      );
    }
  }
  return result;
}

/** Platform events → enabled `event` triggers of the org. Events raised BY
 * an automation run never fire triggers (loop safety), and neither does an
 * event of an organization that no longer exists: its listening triggers
 * are disabled instead (`refused` answers both).
 *
 * Before it stamps a trigger, the dispatch takes the organization's audit
 * chain (`lockAuditChain`): a run of that trigger landing meanwhile holds
 * the chain for its audit row and only then writes the trigger's failure
 * streak (`trigger-failures.ts`), so the chain comes first here too. Most
 * producers audit before they emit and hold it already; one that emits
 * first (a comment edit, a conversation opened before its first message, an
 * external-ref intake) now takes it at the dispatch instead of at its own
 * audit a few statements later — never the trigger row first, which is
 * what deadlocked against the landing run. */
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
  const triggers = await tx<OrgCheckedTriggerRow[]>`
    SELECT ${tx.unsafe(TRIGGER_COLUMNS)},
      NOT EXISTS (
        SELECT 1 FROM "organization" o WHERE o."id" = t.org_id
      ) AS "orgMissing"
    FROM app.automation_triggers t
    WHERE org_id = ${args.organizationId} AND kind = 'event'
      AND enabled = true AND event = ${args.event}
  `;
  if (triggers.length === 0) return { started: [], refused: false };
  await lockAuditChain(tx, args.organizationId);
  if (triggers.some((trigger) => trigger.orgMissing)) {
    // The event names an organization that no longer exists: a producer
    // still writing rows its deletion left behind. Nothing may start in
    // its name, so the bindings listening for it are switched off instead —
    // after the audit chain, like any other write to a trigger here. The
    // switch commits with the producer: one that rolls back takes it along,
    // and the next event switches them off, and names them, again.
    const retired = await retireOrphanedTriggers(
      tx,
      triggers.map((trigger) => trigger.id),
    );
    if (retired.length > 0) {
      const names = retired
        .slice(0, NAMES_IN_LOG)
        .map((row) => `${row.organizationId}/${row.name}`);
      console.warn(
        `[automations] event "${args.event}": disabled ${retired.length} trigger(s) whose organization no longer exists: ${namedList(retired.length, names)}`,
      );
    }
    return { started: [], refused: true };
  }
  const started: string[] = [];
  for (const trigger of triggers) {
    // The producer's transaction carries the run AND the stamp that names
    // it; a binding whose automation has nothing deployed records the
    // skip instead of a "fire" that started nothing.
    const run = await beginRunInTx(tx, {
      organizationId: args.organizationId,
      name: trigger.name,
      input: { trigger: 'event', event: args.event, payload: args.payload },
      mode: 'live',
      startedBy: `trigger:${trigger.id}`,
    });
    const now = Date.now();
    if (run) {
      await stampFired(tx, trigger.id, now, run.runId);
      started.push(run.runId);
    } else {
      await stampSkipped(tx, trigger.id, now, 'not_deployed');
    }
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
 * whether one is archived (the store refuses it with the scope, and the
 * door checks again below), or what the automation behind the token is
 * called (its slug used to ride in the "not bound" sentence). */
const PROJECT_SCOPE_CODES: ReadonlySet<string> = new Set([
  'AUTOMATION_PROJECT_UNKNOWN',
  'AUTOMATION_PROJECT_FORBIDDEN',
  'PROJECT_ARCHIVED',
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
    // Cross-scope guard: the same delivery, still live, first taken at a
    // scope that differs from this one by organization-vs-project. Two
    // different projects are a legitimate per-project fan-out (each starts
    // its own run), so only the organization↔project transition is the
    // mismatch the docs name — an operator moved the automation between
    // scopes and the sender re-posted, and without this the event ran twice
    // (2026-09-18 evaluation, J3-1). Legacy rows carry no `identity_hash`
    // and never match; the same-scope replay shares `delivery_key` and is
    // the duplicate path below, never a mismatch.
    const currentProject = args.projectId ?? null;
    const sameIdentity = await tx<{ runId: string | null }[]>`
      SELECT run_id AS "runId" FROM app.automation_webhook_deliveries
      WHERE trigger_id = ${trigger.id}
        AND identity_hash = ${identity.identityHash}
        AND expires_at_ms > ${now}
    `;
    for (const row of sameIdentity) {
      if (row.runId === null) continue;
      const other = await getRun(tx, trigger.organizationId, row.runId);
      const otherProject = other?.projectId ?? null;
      if (
        otherProject !== currentProject &&
        (otherProject === null || currentProject === null)
      ) {
        throw new AutomationError(
          'AUTOMATION_DELIVERY_SCOPE_MISMATCH',
          'The recorded delivery belongs to a different scope.',
          409,
        );
      }
    }
    const claimed = await tx<{ triggerId: string }[]>`
      INSERT INTO app.automation_webhook_deliveries AS d (
        trigger_id, delivery_key, identity_hash, source, run_id,
        received_at_ms, expires_at_ms
      ) VALUES (
        ${trigger.id}, ${identity.key}, ${identity.identityHash},
        ${identity.source}, NULL, ${now}, ${now + identity.windowMs}
      )
      ON CONFLICT (trigger_id, delivery_key) DO UPDATE SET
        identity_hash = EXCLUDED.identity_hash,
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
    // The trigger's `lastFiredAt` and `lastRunId` are what the trigger read
    // shows about a webhook's history; the schedule and event paths stamp
    // them, and this path never did — an accepted delivery left them null
    // forever. A replayed delivery reuses its run and stamps nothing.
    await stampFired(tx, trigger.id, now, started.runId);
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
  // Every answer on this door — the 202, the 404 a bad token gets, the 413,
  // the 429 — is per-delivery and per-moment, so nothing between a sender's
  // relay and the door may cache it: `no-store` by default, the same stamp
  // the REST door carries (lib/http-hygiene.ts). The door is mounted
  // outside `/api/v1`, so the REST stamper never saw it and a caching
  // intermediary could keep a token's 404 past the point it became valid.
  app.use(noStoreByDefault());

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
    const rows = await deps.sql<OrgCheckedTriggerRow[]>`
      SELECT ${deps.sql.unsafe(TRIGGER_COLUMNS)},
        NOT EXISTS (
          SELECT 1 FROM "organization" o WHERE o."id" = t.org_id
        ) AS "orgMissing"
      FROM app.automation_triggers t
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
    if (trigger.orgMissing) {
      // A genuine token whose organization is gone: whoever still holds the
      // URL must not start a run in its name. The binding is switched off
      // (named once, by the delivery whose write did it) and the answer is
      // the 404 a disabled URL gets — nothing about the organization leaks.
      const retired = await retireOrphanedTriggers(deps.sql, [trigger.id]);
      if (retired.length > 0) {
        console.warn(
          `[automations] webhook: disabled trigger ${trigger.organizationId}/${trigger.name} whose organization no longer exists`,
        );
      }
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
        // The delivery's transaction rolled back with its claim; the skip
        // is recorded on its own, so the trigger read shows that the URL
        // was hit and why nothing started.
        await stampSkipped(deps.sql, trigger.id, Date.now(), 'not_deployed');
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
