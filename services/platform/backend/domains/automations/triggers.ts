import { transactSerializable } from '@tale/shared/db/serializable';
import {
  type MissedSummary,
  SKIP_DETAIL_MAX_ISSUES,
  SKIP_DETAIL_MAX_MESSAGE,
  type TriggerSkipDetail,
} from '@tale/shared/schemas/automation-trigger';
import { Hono, type Context } from 'hono';
import type { Sql, TransactionSql } from 'postgres';

import {
  decideDue,
  nextOccurrence,
  SCHEDULE_ON_TIME_GRACE_MS,
  scheduleOfTrigger,
} from '../../../lib/automations/schedule/occurrences.ts';
import { triggerRunInput } from '../../../lib/engine/core/slots.ts';
import {
  eventProjectId,
  isEmittedEventType,
} from '../../../lib/shared/event-types.ts';
import { parseRunStarter } from '../../../lib/shared/run-starter.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
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
import { jsonParam } from '../../db/sql.ts';
import { noStoreByDefault } from '../../lib/http-hygiene.ts';
import { rateLimitedResponse } from '../../lib/rate-limit-response.ts';
import {
  RateLimitExceededError,
  checkIpRateLimit,
  checkKeyedRateLimit,
} from '../../lib/rate-limit.ts';
import { lockAuditChain } from '../audit_logs/service.ts';
import type { EventOrigin } from '../events/origin.ts';
import {
  AutomationError,
  beginRunInTx,
  getRun,
  resolveRunProject,
} from './store.ts';

/**
 * Trigger DELIVERY — the 0.5 twins of `convex/automations/triggers.ts`:
 *
 *  - `scanScheduledTriggers` (a per-minute pg-boss schedule): each schedule
 *    keeps the instant it is next due (`next_due_at_ms`, 0170), and the scan
 *    claims only the schedules whose instant has come, by a partial index —
 *    plus the ones whose instant is not computed yet. Each is decided in its
 *    own short transaction on its freshly locked row (`FOR UPDATE SKIP
 *    LOCKED`): at most one occurrence starts (the latest; `catchUp` says how
 *    late it may be), the rest are counted as missed, and the run, the stamps
 *    and the next instant commit together, so two overlapping scans fire an
 *    occurrence once. When it happens is the shared evaluator's
 *    (`lib/automations/schedule/occurrences.ts`), daylight-saving changes
 *    included;
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
 *    triggers, wired into the events emit seam. An event a run raised never
 *    starts that run's automation, nor anything when the run was itself
 *    event-started (loop safety).
 *
 * On all three doors, a binding whose organization no longer exists (a
 * deletion before 0.5.9 left every automation row behind, and 0125 keeps
 * them whole under an active legal hold) starts nothing: the door that meets
 * it disables it and names it in one line — the scan without claiming it,
 * the webhook door behind the same 404 a disabled URL gets, the event door
 * in the producer's transaction.
 */

/** Rows per page of a scan walk — a page size, not a cap: each walk goes on
 * until every schedule it is for has been examined. */
const SCAN_PAGE_SIZE = 200;
/** How many bindings one log line names; the rest are counted. */
const NAMES_IN_LOG = 5;

interface TriggerRow {
  id: string;
  organizationId: string;
  name: string;
  kind: string;
  cron: string | null;
  timezone: string | null;
  /** `{repeat, startDate}` as stored, unread (0170). */
  scheduleRule: unknown;
  /** NULL reads as `latest` (0170). */
  catchUp: 'latest' | 'skip' | null;
  /** The earliest occurrence not handled yet; null when not computed. */
  nextDueAt: number | null;
  /** The fixed input every run it starts receives (0172), or null. */
  runInput: Record<string, unknown> | null;
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
  /** The last (re)bind — where a schedule's pending occurrences start when
   * nothing was claimed since, so a trigger saved, switched on or re-bound
   * as a schedule never fires an occurrence from before it. */
  updatedAt: number;
}

const TRIGGER_COLUMNS = `
  id, org_id AS "organizationId", name, kind, cron, timezone,
  schedule_rule AS "scheduleRule", catch_up AS "catchUp",
  next_due_at_ms::float8 AS "nextDueAt", run_input AS "runInput",
  token_hash AS "tokenHash", event, enabled,
  last_fired_at_ms::float8 AS "lastFiredAt",
  last_due_at_ms::float8 AS "lastDueAt",
  last_skipped_at_ms::float8 AS "lastSkippedAt",
  last_skip_reason AS "lastSkipReason",
  created_at_ms::float8 AS "createdAt",
  updated_at_ms::float8 AS "updatedAt"
`;

/** A schedule whose expression cannot be read is left alone until its next
 * edit; should the stamp that keeps it out of the walk ever fail to hold,
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

/** The binding came due and started nothing: when, and why — the reason
 * and its detail move together. */
async function stampSkipped(
  sql: Sql | TransactionSql,
  triggerId: string,
  at: number,
  detail: TriggerSkipDetail,
): Promise<void> {
  await sql`
    UPDATE app.automation_triggers
    SET last_skipped_at_ms = ${at}, last_skip_reason = ${detail.reason},
        last_skip_detail = ${detailParam(sql, detail)}
    WHERE id = ${triggerId}
  `;
}

/** A sentence, cut to `limit` characters. */
function bounded(message: string, limit = SKIP_DETAIL_MAX_MESSAGE): string {
  return message.length <= limit ? message : `${message.slice(0, limit - 1)}…`;
}

/** What a skip detail may weigh as JSON: the column's CHECK allows 8 KiB of
 * jsonb text (0171), which spaces its JSON out a little. */
const SKIP_DETAIL_BYTES = 6144;

const encoder = new TextEncoder();
const bytesOf = (value: unknown): number =>
  encoder.encode(JSON.stringify(value)).length;

/** The detail as stored: a refusal's problems are dropped from the last,
 * and then its sentence shortened, until it fits — ten problems of long,
 * multi-byte text must not fail the stamp, and with it the scan. */
function fittedDetail(detail: TriggerSkipDetail): TriggerSkipDetail {
  let fitted = detail;
  while (bytesOf(fitted) > SKIP_DETAIL_BYTES) {
    if (fitted.reason === 'start_refused' && fitted.issues !== undefined) {
      const { issues, ...rest } = fitted;
      fitted =
        issues.length > 1 ? { ...rest, issues: issues.slice(0, -1) } : rest;
    } else if (
      (fitted.reason === 'start_refused' ||
        fitted.reason === 'unusable_cron') &&
      fitted.message.length > 40
    ) {
      fitted = {
        ...fitted,
        message: bounded(fitted.message, Math.floor(fitted.message.length / 2)),
      };
    } else {
      break;
    }
  }
  return fitted;
}

/** A skip detail as one jsonb parameter, fitted to its column. */
const detailParam = (
  sql: Sql | TransactionSql,
  detail: TriggerSkipDetail,
): ReturnType<typeof jsonParam> => jsonParam(sql, fittedDetail(detail));

/** What a refused start leaves in the skip detail: its code, the version
 * that refused it, its sentence and its first problems. */
function refusalDetail(
  error: AutomationError,
  occurrence: number,
): Extract<TriggerSkipDetail, { reason: 'start_refused' }> {
  const data = error.data ?? {};
  const version =
    typeof data.version === 'number' && Number.isInteger(data.version)
      ? data.version
      : null;
  const issues = Array.isArray(data.issues)
    ? data.issues
        .filter(
          (issue): issue is { path: string; message: string } =>
            isRecord(issue) &&
            typeof issue.path === 'string' &&
            typeof issue.message === 'string',
        )
        .slice(0, SKIP_DETAIL_MAX_ISSUES)
        .map((issue) => ({
          path: bounded(issue.path),
          message: bounded(issue.message),
        }))
    : [];
  return {
    reason: 'start_refused',
    occurrence,
    code: error.code.slice(0, 100),
    version,
    message: bounded(error.message),
    ...(issues.length > 0 ? { issues } : {}),
  };
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
  /** Schedules this scan locked and looked at, across both walks. */
  examined: number;
  /** Occurrences this scan started a run for. */
  fired: number;
  /** Keyset pages the walks took (at least 1 whenever they ran). */
  pages: number;
  /** Occurrences whose automation has no deployed version to run. */
  undeployed: number;
  /** Occurrences whose deployed version refused the run. */
  refused: number;
  /** Schedules whose rule, expression or zone could not be read, or that
   * never come due. */
  unusable: number;
  /** Schedules of an organization that no longer exists, disabled by this
   * scan — never claimed, never run. */
  orphaned: number;
  /** Schedules whose next instant this scan computed (new, edited, or
   * switched on) and found still to come. */
  initialized: number;
  /** Occurrences counted as missed, not run. */
  missed: number;
  /** Occurrences started later than the on-time grace. */
  late: number;
  /** Schedules another scan or a save held while this one came by; the
   * next scan takes them. */
  busy: number;
}

/** What one schedule's transaction did. */
type RowOutcome =
  | { kind: 'busy' | 'idle' | 'initialized' }
  | { kind: 'orphaned'; label: string }
  | { kind: 'unusable' }
  | {
      kind: 'decided';
      label: string;
      fired: boolean;
      late: boolean;
      missed: number;
      skip: 'not_deployed' | 'start_refused' | null;
      refusal?: string;
    };

/**
 * Decide one schedule, in its own transaction, from its row as locked now
 * — never from a page read earlier, so two scans can never act on one stale
 * read. Locked elsewhere (another scan, a save) it is left for the next
 * scan. The occurrence's run, the fire or skip stamp, the claim cursor and
 * the next instant commit together, or none of them do: an interrupted
 * scan leaves the schedule exactly as due as it was.
 */
async function processScheduleRow(
  sql: Sql,
  triggerId: string,
  now: number,
): Promise<RowOutcome> {
  return sql.begin(async (tx): Promise<RowOutcome> => {
    const rows = await tx<OrgCheckedTriggerRow[]>`
      SELECT ${tx.unsafe(TRIGGER_COLUMNS)},
        NOT EXISTS (
          SELECT 1 FROM "organization" o WHERE o."id" = t.org_id
        ) AS "orgMissing"
      FROM app.automation_triggers t
      WHERE id = ${triggerId}
      FOR UPDATE OF t SKIP LOCKED
    `;
    const row = rows[0];
    if (row === undefined) return { kind: 'busy' };
    if (row.kind !== 'schedule' || !row.enabled) return { kind: 'idle' };
    const label = `${row.organizationId}/${row.name}`;
    // Whatever its schedule says, nothing may start in the name of an
    // organization that is gone.
    if (row.orgMissing) {
      const retired = await retireOrphanedTriggers(tx, [row.id]);
      return retired.length > 0
        ? { kind: 'orphaned', label }
        : { kind: 'idle' };
    }
    const unusable = async (message: string): Promise<RowOutcome> => {
      // A schedule the author wrote wrong must not stop the scan. The skip
      // stamp is what the trigger read shows for it and what keeps it out
      // of the next walk; the line is written when the reason is news (or
      // once an hour, should the stamp not hold).
      if (
        row.lastSkipReason !== 'unusable_cron' ||
        row.lastSkippedAt === null ||
        now - row.lastSkippedAt > UNUSABLE_WARN_INTERVAL_MS
      ) {
        console.warn(
          `[automations] trigger ${label}: unusable schedule`,
          message,
        );
      }
      await tx`
        UPDATE app.automation_triggers
        SET next_due_at_ms = NULL, last_skipped_at_ms = ${now},
            last_skip_reason = 'unusable_cron',
            last_skip_detail = ${detailParam(tx, {
              reason: 'unusable_cron',
              message: bounded(message),
            })}
        WHERE id = ${row.id}
      `;
      return { kind: 'unusable' };
    };
    const read = scheduleOfTrigger(row);
    if ('issue' in read) return unusable(read.issue);
    const schedule = read.schedule;
    // What an earlier scan of either image already claimed or fired: the
    // previous image claims on `last_due_at_ms` and fires on
    // `last_fired_at_ms` (0096), so the later of the two is handled.
    const stamps = [row.lastDueAt, row.lastFiredAt].filter(
      (stamp): stamp is number => stamp !== null,
    );
    const handled = stamps.length > 0 ? Math.max(...stamps) : null;
    const pendingFrom =
      row.nextDueAt ??
      nextOccurrence(schedule, Math.max(handled ?? 0, row.updatedAt));
    if (pendingFrom === null) {
      return unusable('the schedule never comes due');
    }
    if (pendingFrom > now) {
      if (row.nextDueAt === pendingFrom) return { kind: 'idle' };
      await tx`
        UPDATE app.automation_triggers SET next_due_at_ms = ${pendingFrom}
        WHERE id = ${row.id}
      `;
      return { kind: 'initialized' };
    }
    const decision = decideDue(
      schedule,
      pendingFrom,
      handled ?? pendingFrom - 1,
      now,
      row.catchUp ?? 'latest',
    );
    const policy = row.catchUp ?? 'latest';
    const missed: MissedSummary | undefined =
      decision.missed === null ? undefined : { ...decision.missed, policy };
    let runId: string | null = null;
    let skip: TriggerSkipDetail | null = null;
    let refusal: string | undefined;
    if (decision.fire !== null) {
      const fire = decision.fire;
      // The run joins this transaction: it commits with the claim, or not
      // at all. `beginRunInTx` refuses before it writes anything, so the
      // transaction stays usable for the skip stamp. A refused start keeps
      // its claim — retrying the same refusal every minute helps nobody.
      try {
        const started = await beginRunInTx(tx, {
          organizationId: row.organizationId,
          name: row.name,
          input: triggerRunInput(
            { kind: 'schedule', firedAt: fire },
            row.runInput,
          ),
          mode: 'live',
          startedBy: `trigger:${row.id}`,
        });
        if (started === null) {
          skip = {
            reason: 'not_deployed',
            occurrence: fire,
            ...(missed !== undefined ? { missed } : {}),
          };
        } else {
          runId = started.runId;
        }
      } catch (error) {
        if (!(error instanceof AutomationError)) throw error;
        refusal = error.message;
        skip = {
          ...refusalDetail(error, fire),
          ...(missed !== undefined ? { missed } : {}),
        };
      }
    }
    // A fire outcome (refused, not deployed) wins over the missed count,
    // which rides in its detail. A run with others missed stamps both.
    if (skip === null && missed !== undefined) {
      skip = {
        reason: 'missed_occurrences',
        missed,
        firedLatest: runId !== null,
      };
    }
    // One write: the next instant, the claim cursor, and whichever stamps
    // apply. It names none of the columns the 0170 trigger watches.
    const fired = runId !== null;
    await tx`
      UPDATE app.automation_triggers SET
        next_due_at_ms = ${decision.next},
        last_due_at_ms = GREATEST(COALESCE(last_due_at_ms, 0), ${decision.handledThrough}::bigint),
        last_fired_at_ms = CASE WHEN ${fired}::boolean THEN ${decision.fire}::bigint ELSE last_fired_at_ms END,
        last_run_id = CASE WHEN ${fired}::boolean THEN ${runId}::text ELSE last_run_id END,
        last_skipped_at_ms = CASE WHEN ${skip !== null}::boolean THEN ${now}::bigint ELSE last_skipped_at_ms END,
        last_skip_reason = CASE WHEN ${skip !== null}::boolean THEN ${skip?.reason ?? null}::text ELSE last_skip_reason END,
        last_skip_detail = CASE WHEN ${skip !== null}::boolean THEN ${skip === null ? null : detailParam(tx, skip)}::jsonb ELSE last_skip_detail END
      WHERE id = ${row.id}
    `;
    return {
      kind: 'decided',
      label,
      fired,
      late:
        fired &&
        decision.fire !== null &&
        now - decision.fire > SCHEDULE_ON_TIME_GRACE_MS,
      missed: decision.missed?.count ?? 0,
      skip:
        skip?.reason === 'not_deployed' || skip?.reason === 'start_refused'
          ? skip.reason
          : null,
      ...(refusal !== undefined ? { refusal } : {}),
    };
  });
}

/**
 * Fire the schedules that came due. Two keyset walks, each on its own
 * partial index (0170): the schedules whose next instant is not computed
 * yet (new or edited by any writer, switched back on, the first scan after
 * the migration), and the ones whose instant has come, most overdue first.
 * The cost is the due and the uncomputed rows, not every enabled schedule.
 *
 * `now` is the clock the decisions read (a test pins it). `signal` is the
 * process's shutdown: the scan stops between schedules, and what it did not
 * reach stays due for the next scan.
 */
export async function scanScheduledTriggers(
  sql: Sql,
  options: { pageSize?: number; now?: number; signal?: AbortSignal } = {},
): Promise<ScheduleScanResult> {
  const pageSize = options.pageSize ?? SCAN_PAGE_SIZE;
  const now = options.now ?? Date.now();
  const signal = options.signal;
  const result: ScheduleScanResult = {
    examined: 0,
    fired: 0,
    pages: 0,
    undeployed: 0,
    refused: 0,
    unusable: 0,
    orphaned: 0,
    initialized: 0,
    missed: 0,
    late: 0,
    busy: 0,
  };
  // No table means no organization yet, so no schedule can belong to one:
  // there is nothing to fire or retire, and every walk would die on the
  // missing relation — once a minute until an api role boots. Enabled
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
  const take = async (id: string): Promise<void> => {
    const outcome = await processScheduleRow(sql, id, now);
    if (outcome.kind !== 'busy') result.examined++;
    switch (outcome.kind) {
      case 'busy':
        result.busy++;
        return;
      case 'idle':
        return;
      case 'initialized':
        result.initialized++;
        return;
      case 'unusable':
        result.unusable++;
        return;
      case 'orphaned':
        result.orphaned++;
        if (orphanedNames.length < NAMES_IN_LOG) {
          orphanedNames.push(outcome.label);
        }
        return;
      case 'decided':
        if (outcome.fired) result.fired++;
        if (outcome.late) result.late++;
        result.missed += outcome.missed;
        if (outcome.skip === 'not_deployed') {
          result.undeployed++;
          if (undeployedNames.length < NAMES_IN_LOG) {
            undeployedNames.push(outcome.label);
          }
        }
        if (outcome.skip === 'start_refused') {
          result.refused++;
          if (refusedNames.length < NAMES_IN_LOG) {
            refusedNames.push(
              `${outcome.label} (${outcome.refusal ?? 'refused'})`,
            );
          }
        }
        return;
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
  };
  try {
    // (a) Not computed yet. A schedule stamped unusable stays out until it
    // is edited — re-reading a broken expression every minute told nobody
    // anything.
    let cursor: string | null = null;
    for (;;) {
      if (signal?.aborted) break;
      const page: { id: string }[] = await sql<{ id: string }[]>`
        SELECT id FROM app.automation_triggers
        WHERE kind = 'schedule' AND enabled AND next_due_at_ms IS NULL
          AND (last_skip_reason IS DISTINCT FROM 'unusable_cron'
               OR last_skipped_at_ms IS NULL
               OR updated_at_ms > last_skipped_at_ms)
          AND (${cursor}::text IS NULL OR id > ${cursor})
        ORDER BY id
        LIMIT ${pageSize}
      `;
      result.pages++;
      for (const { id } of page) {
        if (signal?.aborted) break;
        await take(id);
      }
      const last = page.at(-1);
      if (page.length < pageSize || last === undefined) break;
      cursor = last.id;
    }
    // (b) Due, most overdue first. A row decided above moved its instant
    // past `now` and is not met again.
    let due: { at: number; id: string } | null = null;
    for (;;) {
      if (signal?.aborted) break;
      const page: { id: string; nextDueAt: number }[] = await sql<
        { id: string; nextDueAt: number }[]
      >`
        SELECT id, next_due_at_ms::float8 AS "nextDueAt"
        FROM app.automation_triggers
        WHERE kind = 'schedule' AND enabled AND next_due_at_ms IS NOT NULL
          AND next_due_at_ms <= ${now}
          AND (${due === null}::boolean
               OR (next_due_at_ms, id) > (${due?.at ?? 0}::bigint, ${due?.id ?? ''}::text))
        ORDER BY next_due_at_ms, id
        LIMIT ${pageSize}
      `;
      result.pages++;
      for (const { id } of page) {
        if (signal?.aborted) break;
        await take(id);
      }
      const last = page.at(-1);
      if (page.length < pageSize || last === undefined) break;
      due = { at: last.nextDueAt, id: last.id };
    }
  } finally {
    // Written whether the walks finished or one threw: the schedules the
    // walks disabled never enter a walk again, so this is the only line
    // that ever names them. One line per outcome and scan, not one per
    // trigger: a fleet's worth of undeployed schedules must not turn the
    // scan log into a flood. Each disabled binding is named once — only
    // the scan whose write disabled it has it back.
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
    if (result.missed > 0) {
      console.warn(
        `[automations] trigger scan: ${result.missed} occurrence(s) were missed and counted, not run`,
      );
    }
  }
  return result;
}

/** The run whose work raised an event, as the loop rule reads it: its
 * automation, and whether an event trigger started it — the run input's
 * `trigger` says which kind of trigger did (the trigger's own fields are set
 * over any fixed input, so no input can claim another kind), and only a
 * trigger door starts a run with it. */
interface RaisingRun {
  name: string;
  eventStarted: boolean;
}

async function raisingRun(
  tx: TransactionSql,
  organizationId: string,
  runId: string,
): Promise<RaisingRun | null> {
  const rows = await tx<
    { name: string; startedBy: string; via: string | null }[]
  >`
    SELECT name, started_by AS "startedBy", input->>'trigger' AS via
    FROM app.automation_runs
    WHERE id = ${runId} AND org_id = ${organizationId}
    LIMIT 1
  `;
  const row = rows[0];
  if (row === undefined) return null;
  return {
    name: row.name,
    eventStarted:
      parseRunStarter(row.startedBy).kind === 'trigger' && row.via === 'event',
  };
}

/** Platform events → enabled `event` triggers of the org. An event that an
 * automation run raised starts other automations, but never the one whose
 * run raised it, and nothing at all when that run was itself started by an
 * event (AUTO-R12): a chain of event starts is one long, so no automation
 * loops on itself or with another. An event of a project starts only the
 * automations installed in it or in none, and their runs start in that
 * project (AUTO-R30). Each trigger starts in a savepoint of its own, so a
 * start one refuses — its inputs, its project — is stamped `start_refused`
 * on that trigger and leaves the others' runs in place. An event of an
 * organization that no longer exists starts nothing either: its listening
 * triggers are disabled instead (`refused` answers that and a loop-held
 * event).
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
    origin: EventOrigin;
  },
): Promise<{ started: string[]; refused: boolean }> {
  const listening = await tx<OrgCheckedTriggerRow[]>`
    SELECT ${tx.unsafe(TRIGGER_COLUMNS)},
      NOT EXISTS (
        SELECT 1 FROM "organization" o WHERE o."id" = t.org_id
      ) AS "orgMissing"
    FROM app.automation_triggers t
    WHERE org_id = ${args.organizationId} AND kind = 'event'
      AND enabled = true AND event = ${args.event}
  `;
  if (listening.length === 0) return { started: [], refused: false };
  let triggers: OrgCheckedTriggerRow[] = listening;
  if (args.origin.kind === 'automation') {
    const run = await raisingRun(tx, args.organizationId, args.origin.runId);
    if (run === null || run.eventStarted) {
      // A run the dispatch cannot read is held like an event-started one:
      // the loop rule must not depend on a row it could not see.
      console.warn(
        `[automations] event "${args.event}" raised by run ${args.origin.runId}${run === null ? ', which could not be read,' : ` (${run.name}), itself started by an event,`} starts no automation (loop safety)`,
      );
      return { started: [], refused: true };
    }
    triggers = listening.filter((trigger) => trigger.name !== run.name);
    if (triggers.length < listening.length) {
      console.warn(
        `[automations] event "${args.event}" raised by run ${args.origin.runId} does not start its own automation ${run.name} (loop safety)`,
      );
    }
    if (triggers.length === 0) return { started: [], refused: false };
  }
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
  const eventProject = isEmittedEventType(args.event)
    ? eventProjectId(args.event, args.payload)
    : null;
  const installs = await installedProjects(
    tx,
    args.organizationId,
    triggers.map((trigger) => trigger.name),
  );
  const started: string[] = [];
  const refusals: string[] = [];
  for (const trigger of triggers) {
    const bound = installs.get(trigger.name) ?? [];
    // An event of a project starts the automations installed there or
    // nowhere (AUTO-R30); one installed only elsewhere does not hear it.
    if (eventProject !== null && bound.length > 0) {
      if (!bound.includes(eventProject)) continue;
    }
    // Where the run goes: the event's project, else the automation's sole
    // installation. Named either way, so a project that cannot take a run
    // (archived, AUTO-R8) refuses it here instead of taking it unchecked.
    const projectId =
      eventProject ?? (bound.length === 1 ? bound[0] : undefined);
    const now = Date.now();
    try {
      // Each trigger starts in a savepoint of its own: a start this
      // trigger's version or project refuses rolls back its work alone,
      // and the other automations listening for the event keep their runs.
      const runId = await tx.savepoint(async (sp) => {
        // The producer's transaction carries the run AND the stamp that
        // names it; a binding whose automation has nothing deployed
        // records the skip instead of a "fire" that started nothing.
        const run = await beginRunInTx(sp, {
          organizationId: args.organizationId,
          name: trigger.name,
          input: triggerRunInput(
            { kind: 'event', event: args.event, payload: args.payload },
            trigger.runInput,
          ),
          mode: 'live',
          startedBy: `trigger:${trigger.id}`,
          ...(projectId !== undefined ? { projectId } : {}),
        });
        if (run === null) {
          await stampSkipped(sp, trigger.id, now, {
            reason: 'not_deployed',
            occurrence: now,
          });
          return null;
        }
        await stampFired(sp, trigger.id, now, run.runId);
        return run.runId;
      });
      if (runId !== null) started.push(runId);
    } catch (error) {
      // Only the store's coded refusal is this trigger's alone; a fault of
      // the database is the dispatch's, and `emitEvent` rolls it back.
      if (!(error instanceof AutomationError)) throw error;
      await stampSkipped(tx, trigger.id, now, refusalDetail(error, now));
      refusals.push(`${trigger.name} (${error.code})`);
    }
  }
  if (refusals.length > 0) {
    console.warn(
      `[automations] event "${args.event}": ${refusals.length} trigger(s) could not start a run: ${namedList(refusals.length, refusals.slice(0, NAMES_IN_LOG))}`,
    );
  }
  return { started, refused: false };
}

/** The projects each named automation is installed in — none for an
 * automation of the organization. One read for every listening trigger. */
async function installedProjects(
  tx: TransactionSql,
  organizationId: string,
  names: string[],
): Promise<Map<string, string[]>> {
  const rows = await tx<{ name: string; projectId: string }[]>`
    SELECT automation_name AS name, project_id AS "projectId"
    FROM app.automation_project_bindings
    WHERE org_id = ${organizationId} AND automation_name = ANY(${names}::text[])
  `;
  const installs = new Map<string, string[]>();
  for (const row of rows) {
    const list = installs.get(row.name) ?? [];
    list.push(row.projectId);
    installs.set(row.name, list);
  }
  return installs;
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
      input: triggerRunInput(
        { kind: 'webhook', payload: args.payload },
        trigger.runInput,
      ),
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
        const at = Date.now();
        await stampSkipped(deps.sql, trigger.id, at, {
          reason: 'not_deployed',
          occurrence: at,
        });
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
