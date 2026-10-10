import {
  TRIGGER_ISSUE_CODES,
  type ParsedTriggerWrite,
  type TriggerIssue,
  triggerIssues,
  type TriggerKind,
  triggerSkipDetailSchema,
  type TriggerView,
  type TriggerWrite,
  triggerWriteSchema,
} from '@tale/shared/schemas/automation-trigger';
import {
  normalizeScheduleRule,
  type ScheduleRule,
} from '@tale/shared/schemas/schedule-rule';
import type { Sql, TransactionSql } from 'postgres';
import type { z } from 'zod';

import {
  CronImpossibleDateError,
  parseCron,
} from '../../../lib/automations/cron.ts';
import {
  nextOccurrence,
  type Schedule,
  scheduleOfTrigger,
  storedScheduleRuleSchema,
} from '../../../lib/automations/schedule/occurrences.ts';
import { triggerInputSample } from '../../../lib/automations/trigger-input.ts';
import type {
  LegacyRunQuarantine,
  RunSummary,
} from '../../../lib/engine/api/dispatch.ts';
import { ENGINE_PROTOCOL } from '../../../lib/engine/core/protocol.ts';
import type { NodeRunWrite } from '../../../lib/engine/core/record/recorder.ts';
import type { Issue } from '../../../lib/engine/core/types.ts';
import {
  AUTOMATION_NAME_MAX_LENGTH,
  AUTOMATION_NAME_RE,
} from '../../../lib/engine/core/validate/name.ts';
import {
  compileSchemaCached,
  describeSchemaErrors,
} from '../../../lib/engine/core/validate/schema.ts';
import {
  type InputsCheck,
  triggerInputWarnings,
} from '../../../lib/engine/core/validate/trigger-input.ts';
import { formatIsoDate } from '../../../lib/shared/calendar.ts';
import {
  EMITTED_EVENT_TYPES,
  isEmittedEventType,
} from '../../../lib/shared/event-types.ts';
import { parseRunStarter } from '../../../lib/shared/run-starter.ts';
import { localDateIn } from '../../../lib/shared/zoned-time.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import {
  boundCheckpointTrace,
  truncateRunDetail,
} from '../../core/automations/bound_run_payload.ts';
import {
  mergeParkedAgentCursor,
  type NodeCheckpoint,
  parkedAgentSettled,
  parksAgentTurn,
} from '../../core/automations/checkpoints.ts';
import {
  ENGINE_DEFER_MS,
  ENGINE_DEFER_WINDOW_MS,
  IN_DOUBT_POLL_MS,
  LIVENESS_SWEEP_LIMIT,
  RUN_CLAIM_PROMISE_MS,
  RUN_LEASE_MS,
} from '../../core/automations/liveness.ts';
import {
  runIdempotencyRequestHash,
  runIdempotencyScopeKey,
} from '../../core/automations/run_idempotency.ts';
import { HEADER_LANE_WINDOW_MS } from '../../core/automations/webhook_delivery.ts';
import {
  hashWebhookToken,
  mintWebhookToken,
} from '../../core/automations/webhook_token.ts';
import { jsonParam, toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { engineVersion, instanceId } from '../../lib/instance.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import {
  dismissAgentQuestionNotifications,
  dismissTriggerPausedNotifications,
} from '../collab/service.ts';
import { stopWorkflowSessionSlotsInTx } from '../sandbox/idle-release.ts';
import { retractAskOnTask } from './ask-retraction.ts';
import { auditDefinitionWrite } from './audit.ts';
import {
  describeLegacyQuarantine,
  legacyRunStopSchema,
} from './legacy-quarantine.ts';
import {
  managedConfigurationHash,
  managedDefinitionValue,
  managedScheduleValue,
} from './managed-configuration-value';
import { nodeRunBytes, startNodeRun, writeNodeRunsInTx } from './node-runs.ts';
import { type RunEventKind, recordRunEventInTx } from './run-events.ts';
import { recordTriggerRunOutcome } from './trigger-failures.ts';
import { markAutomationWriterInTx } from './writer-protocol.ts';

/**
 * The automation store over PG — versions (immutable, contiguous),
 * bindings, deployments, triggers, tombstones, and the durable RUN
 * substrate the reused 0.4 stepper drives: a claim that takes a lease (one
 * walker per run) and bumps the epoch fence, heartbeat/progress renewing the
 * lease and the wakeAt liveness promise, suspend with a chainSeq-fenced poll
 * chain, continue hand-offs, and a single terminal door — every run-state
 * write ONE statement fenced by the walker's epoch and a live status.
 * Scheduling maps 1:1 from the 0.4 scheduler onto pg-boss
 * (`automation.step` / `automation.poll` jobs with `startAfter`), enqueued
 * IN the same transaction as the state write (the constitution's
 * transactional-enqueue rule) so a scheduled resume can never outrun or
 * miss its row.
 */

export class AutomationError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409;
  /** Structured detail a door forwards beside the sentence, under `data` —
   * the schema problems of a refused run input (`issues`), say. */
  readonly data: Record<string, unknown> | undefined;

  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 409 = 400,
    data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AutomationError';
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

/** The `AUTOMATION_PROJECT_FORBIDDEN` sentence — one copy for the run
 * insert's binding check and the REST task intake's, which had drifted
 * apart ("that" / "this project", TALE-75 review). Static, like every
 * refusal a task door relays (`domains/tasks/errors.test.ts`): the
 * automation's name is what the caller sent. */
export const AUTOMATION_NOT_BOUND_SENTENCE =
  'The automation is not bound to that project.';

/** The engine's name grammar (`lib/engine/core/validate/name.ts`) — ONE rule
 * for the document validator, the subautomation reference parser, this store
 * and the `__` URL codec, so a name the validator passes is a name this store
 * saves and every address resolves. */
export function assertAutomationName(name: string): string {
  const trimmed = name.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > AUTOMATION_NAME_MAX_LENGTH ||
    !AUTOMATION_NAME_RE.test(trimmed)
  ) {
    throw new AutomationError(
      'AUTOMATION_NAME_INVALID',
      `"${name}" is not a valid automation name — lowercase slug segments separated by "/".`,
    );
  }
  return trimmed;
}

/**
 * First path segments the automations API keeps for its own fixed routes
 * (`GET /automations/runs`, `/metrics`, …) and the app keeps for its fixed
 * pages (`/automations/metrics`). Those routes are matched ahead of the
 * `/:name{.+}` detail routes, so an automation whose name STARTS with one of
 * these would save fine and then never open — the fixed route answers first.
 * `routes.reserved-segments.test.ts` asserts every fixed route lives here.
 */
export const RESERVED_AUTOMATION_SEGMENTS: readonly string[] = [
  'asks',
  'builder',
  'catalog',
  'listing',
  'metrics',
  'runs',
  'serving-preview',
  'upload',
];

/**
 * The create-time half of the name rule: a valid name whose first segment
 * the router keeps for itself. Checked when the FIRST version of a name is
 * saved (see `saveVersion`), so no one creates an automation they can never
 * open — and only then, so a row that predates the rule stays saveable and
 * runnable instead of turning into a stranded record.
 */
export function assertAutomationNameCreatable(name: string): string {
  const valid = assertAutomationName(name);
  const first = valid.split('/')[0] ?? '';
  if (RESERVED_AUTOMATION_SEGMENTS.includes(first)) {
    throw new AutomationError(
      'AUTOMATION_NAME_RESERVED',
      `"${valid}" cannot be an automation name — "${first}" is a word the platform keeps for its own pages. Start the name with a different segment, for example "ops/${valid}".`,
    );
  }
  return valid;
}

// ------------------------------------------------------------- definitions

/** The doors a version can be saved through — `automations.created_via`
 * (0181): the editor, a package upload, a coding agent over MCP, the REST
 * API, managed configuration, the shipped default packs. */
export const AUTOMATION_WRITE_VIAS = [
  'app',
  'upload',
  'mcp',
  'rest',
  'managed',
  'system',
] as const;

export type AutomationWriteVia = (typeof AUTOMATION_WRITE_VIAS)[number];

/** Which door a definition write came through, and — for a keyed door —
 * with which key and client. Recorded on the version a save writes. */
export interface AutomationWriteOrigin {
  via: AutomationWriteVia;
  /** The API key the door authenticated, by id. */
  apiKeyId?: string;
  /** The name the agent's client gave itself, already cleaned by
   * `displayClientName` (at most 80 characters). */
  clientName?: string;
}

/** The three version fields beside the document a save can carry forward
 * from the latest version. */
export const CARRIED_VERSION_FIELDS = [
  'settings',
  'taskContract',
  'presentation',
] as const;

export type CarriedVersionField = (typeof CARRIED_VERSION_FIELDS)[number];

export interface SaveVersionArgs {
  organizationId: string;
  name: string;
  document: unknown;
  actor: string;
  /** Install target for a NEW automation — the first version binds the name
   * to this project atomically with the insert (the 0.4 `storeSave`
   * contract). Saves of an existing name ignore it: membership is managed
   * via `setAutomationProjects`, so saving a version cannot move an
   * automation between surfaces. */
  projectId?: string;
  /** Create-only: refuse with `AUTOMATION_NAME_TAKEN` (409) when the name
   * already has versions, instead of appending one to — and letting the
   * caller then rebind the trigger of — a live automation that happens to
   * share the slug (the wizard's contract, the 0.4 `create: true`). */
  create?: boolean;
  message?: string;
  /** The save's own tests verdict, when the saver ran them (the builder,
   * an MCP save of a document with tests); stamps `tests_checked_at_ms`
   * beside it. Absent = no verdict yet. */
  testsPassed?: boolean;
  taskContract?: unknown;
  settings?: unknown;
  presentation?: unknown;
  /** The version the saver's draft started from. When given and the name's
   * latest version is another one, the save is refused with
   * `AUTOMATION_VERSION_STALE` (409, `data.latestVersion`) instead of
   * appending a version built on stale content — two editor tabs used to
   * silently revert each other's work (2026-09-26 evaluation, D-15). A
   * saver that passes none (the builder's autosave, an upload, MCP)
   * appends as before. */
  baseVersion?: number;
  /** How `settings`, `taskContract` and `presentation` are read. `explicit`
   * (the default — the editor, an upload, managed configuration): an absent
   * field stores none. `carry` (a coding agent's save, which sends only
   * what it changes): an absent field keeps the latest version's value,
   * copied under the name lock so no save lands between the read and the
   * write; `null` stores none. The answer's `carried` names what was kept. */
  metadataMode?: 'explicit' | 'carry';
  /** The door the save came through, recorded on the version (0181). */
  origin?: AutomationWriteOrigin;
  /** Declarative ownership is field/value bounded and checked under the
   * same native name lock as every version writer. */
  managed?: { projectId: string; expectedHash: string | null };
  /** The door's own check of THIS save, run under the name lock once the
   * latest version is known (null: the save creates the automation) and
   * before anything is written — so what it decides cannot change before
   * the insert: a coding agent's save refuses an automation the person
   * cannot see, and checks the project it installs a NEW one in only when
   * the save creates it. A refusal it throws leaves nothing written. */
  authorize?: (tx: TransactionSql, latest: number | null) => Promise<void>;
}

/** What a save stored, and which version fields it kept from the version
 * before it (`metadataMode: 'carry'` only). */
export interface SavedVersion {
  name: string;
  version: number;
  carried?: CarriedVersionField[];
}

/** The version fields a carry-mode save stores: an absent field is copied
 * from the latest version, `null` stores none, a value stores itself. */
function carryVersionFields(
  args: SaveVersionArgs,
  latest: VersionRow | null,
): {
  fields: Pick<SaveVersionArgs, CarriedVersionField>;
  carried: CarriedVersionField[];
} {
  const fields: Pick<SaveVersionArgs, CarriedVersionField> = {};
  const carried: CarriedVersionField[] = [];
  for (const field of CARRIED_VERSION_FIELDS) {
    const sent = args[field];
    if (sent !== undefined) {
      if (sent !== null) fields[field] = sent;
      continue;
    }
    const kept: unknown = latest?.[field];
    if (kept === null || kept === undefined) continue;
    fields[field] = kept;
    carried.push(field);
  }
  return { fields, carried };
}

/** Serialize every writer of ONE automation name (two tabs, the builder's
 * autosave racing the editor, MCP `save_automation`): the version number is
 * `max(version) + 1` read inside the transaction, so without this the loser
 * of two concurrent saves trips UNIQUE (org_id, name, version) and surfaces
 * as an opaque 500 — and the create-only check below would be a
 * check-then-act race. The same idiom the sandbox admission and the skill
 * writer use. */
async function lockAutomationName(
  tx: TransactionSql,
  organizationId: string,
  name: string,
): Promise<void> {
  await tx`
    SELECT pg_advisory_xact_lock(
      hashtextextended('automation:' || ${organizationId} || '/' || ${name}, 0)
    )
  `;
}

function assertManagedHash(
  actual: string | null,
  expected: string | null,
): void {
  if (actual !== expected)
    throw new AutomationError(
      'AUTOMATION_VERSION_STALE',
      'Managed configuration changed since planning.',
      409,
    );
}

async function assertManagedProject(
  tx: TransactionSql,
  organizationId: string,
  name: string,
  projectId: string,
  bound: boolean,
): Promise<void> {
  if (await automationTombstone(tx, organizationId, name))
    throw new AutomationError(
      'AUTOMATION_DELETED',
      'Deleted automation requires explicit recovery before managed adoption.',
      409,
    );
  const projects = await tx<{ id: string }[]>`
    SELECT id FROM app.projects
    WHERE id = ${projectId} AND org_id = ${organizationId} AND archived_at_ms IS NULL
    FOR SHARE
  `;
  if (projects.length !== 1)
    throw new AutomationError(
      'AUTOMATION_PROJECT_UNKNOWN',
      'Managed configuration requires the declared active project.',
      404,
    );
  if (bound) {
    const bindings = await tx<{ projectId: string }[]>`
      SELECT project_id AS "projectId" FROM app.automation_project_bindings
      WHERE org_id = ${organizationId} AND automation_name = ${name} AND project_id = ${projectId}
      FOR SHARE
    `;
    if (bindings.length !== 1)
      throw new AutomationError(
        'AUTOMATION_PROJECT_UNKNOWN',
        'Managed configuration cannot adopt an automation outside its declared project.',
        409,
      );
  }
}

export async function saveVersion(
  sql: Sql,
  args: SaveVersionArgs,
): Promise<SavedVersion> {
  const name = assertAutomationName(args.name);
  return sql.begin(async (tx) => {
    // The name first, as every definition writer takes it (`audit.ts`).
    await lockAutomationName(tx, args.organizationId, name);
    // The latest version, read under the lock: null is the create (a name
    // the router keeps for itself is refused here, once, before anything is
    // written); otherwise it is what a base version is checked against.
    const heads = await tx<{ latest: number | null }[]>`
      SELECT max(version)::int AS latest FROM app.automations
      WHERE org_id = ${args.organizationId} AND name = ${name}
    `;
    const latest = heads[0]?.latest ?? null;
    if (latest === null) assertAutomationNameCreatable(name);
    await args.authorize?.(tx, latest);
    if (args.managed) {
      await assertManagedProject(
        tx,
        args.organizationId,
        name,
        args.managed.projectId,
        latest !== null,
      );
      const current =
        latest === null
          ? null
          : await versionRow(tx, args.organizationId, name, latest);
      const actual = managedDefinitionValue(
        args.managed.projectId,
        name,
        current,
      );
      const desired = managedDefinitionValue(
        args.managed.projectId,
        name,
        args,
      );
      assertManagedHash(
        managedConfigurationHash(actual),
        args.managed.expectedHash,
      );
      if (
        latest !== null &&
        managedConfigurationHash(actual) === managedConfigurationHash(desired)
      )
        return { name, version: latest };
      if (args.testsPassed !== true)
        throw new AutomationError(
          'AUTOMATION_DEPLOY_REJECTED',
          'Managed automation definitions require passing native tests.',
          409,
        );
    }
    if (args.create === true && latest !== null) {
      throw new AutomationError(
        'AUTOMATION_NAME_TAKEN',
        `An automation named "${name}" already exists — pick a different name.`,
        409,
      );
    }
    if (args.baseVersion !== undefined && latest !== args.baseVersion) {
      throw new AutomationError(
        'AUTOMATION_VERSION_STALE',
        latest === null
          ? `"${name}" has no version any more — your draft started from v${args.baseVersion}. Save it under a new name, or save anyway to recreate the automation from it.`
          : `v${latest} of "${name}" was saved after your draft started from v${args.baseVersion}. Reload to see it, or save anyway to append your version on top of it.`,
        409,
        { latestVersion: latest, baseVersion: args.baseVersion },
      );
    }
    // A carry-mode save keeps what it does not restate, read from the
    // latest version under the lock this transaction holds.
    const carry =
      args.metadataMode === 'carry'
        ? carryVersionFields(
            args,
            latest === null
              ? null
              : await versionRow(tx, args.organizationId, name, latest),
          )
        : null;
    const stored = carry?.fields ?? args;
    const now = Date.now();
    const rows = await tx<{ version: number }[]>`
      INSERT INTO app.automations (
        org_id, name, version, document, message, tests_passed,
        tests_checked_at_ms, task_contract, settings, presentation,
        created_by, created_at_ms, created_via, api_key_id, client_name
      )
      SELECT ${args.organizationId}, ${name},
             coalesce(max(version), 0) + 1,
             ${tx.json(toJson(args.document))}, ${args.message ?? null},
             ${args.testsPassed ?? null},
             ${args.testsPassed === undefined ? null : now},
             ${stored.taskContract === undefined || stored.taskContract === null ? null : tx.json(toJson(stored.taskContract))},
             ${stored.settings === undefined || stored.settings === null ? null : tx.json(toJson(stored.settings))},
             ${stored.presentation === undefined || stored.presentation === null ? null : tx.json(toJson(stored.presentation))},
             ${args.actor}, ${now}, ${args.origin?.via ?? null},
             ${args.origin?.apiKeyId ?? null}, ${args.origin?.clientName ?? null}
      FROM app.automations
      WHERE org_id = ${args.organizationId} AND name = ${name}
      RETURNING version
    `;
    const version = rows[0]?.version;
    if (version === undefined) throw new Error('version insert failed');
    // Saving under a deleted name makes it alive again.
    await tx`
      DELETE FROM app.automation_tombstones
      WHERE org_id = ${args.organizationId} AND name = ${name}
    `;
    await auditDefinitionWrite(tx, {
      organizationId: args.organizationId,
      actor: args.actor,
      action: 'automation.version.saved',
      name,
      version,
      newState: { version },
      metadata: {
        version,
        ...(args.baseVersion === undefined
          ? {}
          : { baseVersion: args.baseVersion }),
        ...(carry === null ? {} : { carried: carry.carried }),
        ...(args.testsPassed === undefined
          ? {}
          : { testsPassed: args.testsPassed }),
      },
    });
    if (version === 1 && args.projectId !== undefined) {
      const projectId = args.projectId;
      const owned = await tx<{ id: string }[]>`
        SELECT id FROM app.projects
        WHERE org_id = ${args.organizationId} AND id = ${projectId}
        LIMIT 1
      `;
      if (owned.length === 0) {
        throw new AutomationError(
          'AUTOMATION_PROJECT_UNKNOWN',
          'One of the projects does not exist in this organization.',
          404,
        );
      }
      // The database derives the binding's claim and refuses a second wake.
      const bound = await claimingWake(
        () => tx`
          INSERT INTO app.automation_project_bindings (
            org_id, automation_name, project_id, bound_at_ms, bound_by
          ) VALUES (
            ${args.organizationId}, ${name}, ${projectId}, ${Date.now()},
            ${args.actor}
          )
          ON CONFLICT (org_id, automation_name, project_id) DO NOTHING
        `,
      );
      if (bound.count > 0) {
        await auditDefinitionWrite(tx, {
          organizationId: args.organizationId,
          actor: args.actor,
          action: 'automation.project.bound',
          name,
          newState: { projectId },
        });
      }
    }
    await emitDefinitionHint(tx, args.organizationId, name);
    return {
      name,
      version,
      ...(carry === null ? {} : { carried: carry.carried }),
    };
  });
}

/**
 * Every write to an automation's DEFINITION — a version, a deploy, a trigger,
 * a project binding, the delete — emits the `automation` hint inside its own
 * transaction, the realtime contract the run doors already honour for
 * `automation_run`: the app keys the list, the detail page, the trigger and
 * the binding reads under one `automation` entity prefix, so this is what
 * keeps another member's screen from showing a deleted automation, a stale
 * deployedVersion badge or the previous trigger until reload.
 */
async function emitDefinitionHint(
  tx: TransactionSql | Sql,
  organizationId: string,
  name: string,
): Promise<void> {
  await emitHintInTx(tx, {
    orgId: organizationId,
    entity: 'automation',
    entityId: name,
  });
}

export interface VersionRow {
  name: string;
  version: number;
  document: unknown;
  message: string | null;
  testsPassed: boolean | null;
  /** When `testsPassed` was last judged — null while no verdict exists. */
  testsCheckedAt: number | null;
  taskContract: unknown;
  settings: unknown;
  presentation: unknown;
  createdBy: string;
  createdAt: number;
  /** The door the version was saved through (0181) — null for a version
   * saved before the door was recorded. */
  createdVia: AutomationWriteVia | null;
  /** The API key a keyed door saved it with, by id. */
  apiKeyId: string | null;
  /** The name the saving agent's client gave itself. */
  clientName: string | null;
}

export async function versionRow(
  sql: Sql | TransactionSql,
  organizationId: string,
  name: string,
  version: number | undefined,
): Promise<VersionRow | null> {
  // Omitted version = the LATEST saved one (the 0.4 `versionRow` contract);
  // in-tx callers always resolve a concrete version first.
  const rows = await sql<VersionRow[]>`
    SELECT name, version, document, message, tests_passed AS "testsPassed",
           tests_checked_at_ms::float8 AS "testsCheckedAt",
           task_contract AS "taskContract", settings, presentation,
           created_by AS "createdBy", created_at_ms::float8 AS "createdAt",
           created_via AS "createdVia", api_key_id AS "apiKeyId",
           client_name AS "clientName"
    FROM app.automations
    WHERE org_id = ${organizationId} AND name = ${name}
      AND (${version ?? null}::int IS NULL OR version = ${version ?? null})
    ORDER BY version DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Whether any version of the automation exists in this org — one column
 * of one row, never a document: the doors used to fetch the whole latest
 * version to learn that a name is taken. */
export async function automationExists(
  sql: Sql | TransactionSql,
  organizationId: string,
  name: string,
): Promise<boolean> {
  const rows = await sql<{ present: number }[]>`
    SELECT 1 AS present FROM app.automations
    WHERE org_id = ${organizationId} AND name = ${name}
    LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * The tombstone a deleted automation leaves — when and by whom — or null
 * for a name nobody deleted (never saved, or saved again since). Read by
 * the app's single read so a run page of a deleted automation can say
 * "deleted on …" over its retained history instead of "not found".
 */
export async function automationTombstone(
  sql: Sql | TransactionSql,
  organizationId: string,
  name: string,
): Promise<{ deletedAt: number; deletedBy: string } | null> {
  const rows = await sql<{ deletedAt: number; deletedBy: string }[]>`
    SELECT deleted_at_ms::float8 AS "deletedAt", deleted_by AS "deletedBy"
    FROM app.automation_tombstones
    WHERE org_id = ${organizationId} AND name = ${name}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Whether any run in the org bears the name — the history a deleted
 * automation leaves behind: the delete keeps it, readable by id and on the
 * org-wide list, so the by-name run door answers it too instead of saying
 * the automation never existed (2026-09-19 evaluation, K8-5). */
export async function automationRunsExist(
  sql: Sql | TransactionSql,
  organizationId: string,
  name: string,
  /** Only runs in this scope: a project's, or (null) the organization's
   * own — absent, runs anywhere in the organization. */
  scope?: { projectId: string | null },
): Promise<boolean> {
  const rows = await sql<{ present: number }[]>`
    SELECT 1 AS present FROM app.automation_runs
    WHERE org_id = ${organizationId} AND name = ${name}
      AND (${scope === undefined}
           OR project_id IS NOT DISTINCT FROM ${scope?.projectId ?? null}::text)
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function deployedVersion(
  sql: Sql | TransactionSql,
  organizationId: string,
  name: string,
): Promise<number | undefined> {
  const rows = await sql<{ version: number }[]>`
    SELECT version FROM app.automation_deployments
    WHERE org_id = ${organizationId} AND name = ${name}
    LIMIT 1
  `;
  return rows[0]?.version;
}

/**
 * Record the tests verdict a gate just reached for one saved version — the
 * LATEST verdict wins, `false` included, and `tests_checked_at_ms` says
 * when. The deploy gate used to answer its failing report and persist
 * nothing, so the row read `testsPassed: null` forever and a release
 * pipeline could not tell "no tests" from "the tests fail" (2026-09-13
 * evaluation, E4-04). The raw write: callers emit the definition hint
 * (`recordTestVerdict` does, for a standalone verdict).
 */
export async function setTestsVerdict(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    name: string;
    version: number;
    testsPassed: boolean;
    at?: number;
  },
): Promise<void> {
  await sql`
    UPDATE app.automations
    SET tests_passed = ${args.testsPassed},
        tests_checked_at_ms = ${args.at ?? Date.now()}
    WHERE org_id = ${args.organizationId} AND name = ${args.name}
      AND version = ${args.version}
  `;
}

/** {@link setTestsVerdict} as its own write — the deploy gate refusing a
 * version — with the definition hint every write to an automation emits,
 * so the builder's version list reads the verdict without a reload. */
export async function recordTestVerdict(
  sql: Sql,
  args: {
    organizationId: string;
    name: string;
    version: number;
    testsPassed: boolean;
  },
): Promise<void> {
  await sql.begin(async (tx) => {
    await setTestsVerdict(tx, args);
    await emitDefinitionHint(tx, args.organizationId, args.name);
  });
}

export async function deploy(
  sql: Sql,
  args: {
    organizationId: string;
    name: string;
    version: number;
    actor: string;
    /** The deploy gate's verdict when it ran the version's tests just now.
     * A fresh verdict WINS over the stored one: `true` stamps a version
     * saved without one (`tests_passed` NULL) and lifts a `false` an
     * earlier gate recorded, so `GET /automations/{name}` reads the last
     * run's word; without a fresh verdict a version saved with failing
     * tests stays refused. */
    testsPassed?: boolean;
    /** Compare-and-set on the live version: the version the caller read as
     * deployed (`null`: nothing deployed). Another one live now refuses the
     * deploy with `AUTOMATION_DEPLOYMENT_STALE` (409, `data.deployedVersion`)
     * and changes nothing. Absent, no check (the editor's deploy). */
    expectedDeployedVersion?: number | null;
    managed?: {
      projectId: string;
      expectedHash: string | null;
      definitionSha256: string;
    };
  },
): Promise<DeployResult> {
  const row = await versionRow(
    sql,
    args.organizationId,
    args.name,
    args.version,
  );
  if (!row) {
    throw new AutomationError(
      'AUTOMATION_VERSION_UNKNOWN',
      `cannot deploy unknown version ${args.name}@${args.version}`,
      404,
    );
  }
  const failing =
    args.testsPassed === false ||
    (args.testsPassed === undefined && row.testsPassed === false);
  if (failing) {
    throw new AutomationError(
      'AUTOMATION_DEPLOY_REJECTED',
      `deploy gate: ${args.name}@${args.version} was saved with failing tests — fix them and save a new version`,
      409,
    );
  }
  let previousVersion: number | null = null;
  await sql.begin(async (tx) => {
    // Serialize promotion with saves and other promoters. Existing runs keep
    // their immutable version; only future admissions read this pointer.
    await lockAutomationName(tx, args.organizationId, args.name);
    const live =
      (await deployedVersion(tx, args.organizationId, args.name)) ?? null;
    previousVersion = live;
    if (
      args.expectedDeployedVersion !== undefined &&
      args.expectedDeployedVersion !== live
    ) {
      throw new AutomationError(
        'AUTOMATION_DEPLOYMENT_STALE',
        live === null
          ? `"${args.name}" has no deployed version any more — the deploy expected v${String(args.expectedDeployedVersion)}.`
          : `v${live} of "${args.name}" is live now — the deploy expected ${args.expectedDeployedVersion === null ? 'nothing deployed' : `v${args.expectedDeployedVersion}`}.`,
        409,
        { deployedVersion: live },
      );
    }
    if (args.managed) {
      await assertManagedProject(
        tx,
        args.organizationId,
        args.name,
        args.managed.projectId,
        true,
      );
      const latest = await versionRow(
        tx,
        args.organizationId,
        args.name,
        undefined,
      );
      const definition = managedDefinitionValue(
        args.managed.projectId,
        args.name,
        latest,
      );
      if (
        latest?.version !== args.version ||
        managedConfigurationHash(definition) !== args.managed.definitionSha256
      )
        throw new AutomationError(
          'AUTOMATION_VERSION_STALE',
          'The managed definition changed before deployment.',
          409,
        );
      const deployed = await deployedVersion(
        tx,
        args.organizationId,
        args.name,
      );
      const previous =
        deployed === undefined
          ? null
          : await versionRow(tx, args.organizationId, args.name, deployed);
      const current =
        previous === null
          ? null
          : {
              name: args.name,
              projectId: args.managed.projectId,
              definitionSha256: managedConfigurationHash(
                managedDefinitionValue(
                  args.managed.projectId,
                  args.name,
                  previous,
                ),
              ),
            };
      const desired = {
        name: args.name,
        projectId: args.managed.projectId,
        definitionSha256: args.managed.definitionSha256,
      };
      assertManagedHash(
        managedConfigurationHash(current),
        args.managed.expectedHash,
      );
      if (
        managedConfigurationHash(current) === managedConfigurationHash(desired)
      )
        return;
      if (args.testsPassed !== true)
        throw new AutomationError(
          'AUTOMATION_DEPLOY_REJECTED',
          'Managed deployment requires passing native tests.',
          409,
        );
    }
    await tx`
      INSERT INTO app.automation_deployments (
        org_id, name, version, deployed_by, deployed_at_ms
      ) VALUES (
        ${args.organizationId}, ${args.name}, ${args.version}, ${args.actor},
        ${Date.now()}
      )
      ON CONFLICT (org_id, name) DO UPDATE SET
        version = EXCLUDED.version, deployed_by = EXCLUDED.deployed_by,
        deployed_at_ms = EXCLUDED.deployed_at_ms
    `;
    if (args.testsPassed !== undefined) {
      await setTestsVerdict(tx, {
        organizationId: args.organizationId,
        name: args.name,
        version: args.version,
        testsPassed: args.testsPassed,
      });
    }
    await auditDefinitionWrite(tx, {
      organizationId: args.organizationId,
      actor: args.actor,
      action: 'automation.deployed',
      name: args.name,
      version: args.version,
      previousState: { deployedVersion: live },
      newState: { deployedVersion: args.version },
      metadata: {
        fromVersion: live,
        toVersion: args.version,
        ...(args.testsPassed === undefined
          ? {}
          : { testsPassed: args.testsPassed }),
      },
    });
    await emitDefinitionHint(tx, args.organizationId, args.name);
  });
  return {
    name: args.name,
    version: args.version,
    previousVersion,
    trigger: await deployedTrigger(sql, args.organizationId, args.name),
  };
}

/** What a deploy answers: the version that runs now, and the trigger that
 * starts it — whether it is on, when it next runs, and what it would meet
 * in this version — so the editor can offer to turn on a trigger that is
 * off, or to review one whose runs would be refused. */
export interface DeployResult {
  name: string;
  version: number;
  /** The version that ran before this deploy; deploy it again to roll
   * back. Null when none was deployed. */
  previousVersion: number | null;
  trigger: {
    kind: string;
    enabled: boolean;
    nextRunAt: number | null;
    warnings: Issue[];
  } | null;
}

async function deployedTrigger(
  sql: Sql,
  organizationId: string,
  name: string,
): Promise<DeployResult['trigger']> {
  const bound = (await listTriggers(sql, organizationId, name))[0];
  if (bound === undefined) return null;
  return {
    kind: bound.kind,
    enabled: bound.enabled,
    nextRunAt: bound.nextRunAt,
    warnings: await triggerWarnings(sql, organizationId, name, bound),
  };
}

export interface AutomationListing {
  name: string;
  latestVersion: number;
  deployedVersion: number | null;
  /** The document's `description` — the DEPLOYED version's, else the
   * newest saved one's; null when neither declares one. */
  description: string | null;
  /** The document's `inputs` schema, chosen the same way — what a run
   * launcher validates against before it starts the version that runs. */
  inputs: unknown;
  presentation: unknown;
  projectIds: string[];
  /** What starts the automation, if anything is bound: the kind, whether
   * it is switched on, and the fire ledger's health stamps (0096) — the
   * same three `listTriggers` reads, so ONE listing call finds every
   * binding that is enabled and not firing (a trigger bound before its
   * automation was deployed skips every occurrence as `not_deployed`; a
   * caller used to learn that only by reading each automation's triggers
   * one at a time). Null for an automation with no trigger. */
  trigger: {
    kind: string;
    enabled: boolean;
    /** A schedule's next start; null while it is off or not a schedule. */
    nextRunAt: number | null;
    lastFiredAt: number | null;
    lastSkippedAt: number | null;
    lastSkipReason: TriggerListing['lastSkipReason'];
  } | null;
}

/**
 * The presentation a listing shows is the newest NON-NULL one: a version
 * saved from the canvas, over MCP or by an upload without a manifest carries
 * no presentation of its own, and reading the latest row alone made the
 * name the wizard stored vanish on the next save (2026-09-26 evaluation,
 * D-03). A declared name outlives the versions that did not restate it.
 * A JSON `null` stored by an older save counts as absent too (the save
 * writes SQL NULL for it now).
 */
export async function listAutomations(
  sql: Sql,
  organizationId: string,
): Promise<AutomationListing[]> {
  const rows = await sql<
    {
      name: string;
      latestVersion: number;
      deployedVersion: number | null;
      description: string | null | undefined;
      inputs: unknown;
      presentation: unknown;
    }[]
  >`
    SELECT a.name, max(a.version) AS "latestVersion",
           d.version AS "deployedVersion",
           (array_agg(a.document->>'description'
              ORDER BY a.version = d.version DESC NULLS LAST, a.version DESC))[1]
             AS description,
           (array_agg(a.document->'inputs'
              ORDER BY a.version = d.version DESC NULLS LAST, a.version DESC))[1]
             AS inputs,
           (array_agg(a.presentation ORDER BY a.version DESC)
              FILTER (WHERE a.presentation IS NOT NULL
                        AND jsonb_typeof(a.presentation) <> 'null'))[1]
             AS presentation
    FROM app.automations a
    LEFT JOIN app.automation_deployments d
      ON d.org_id = a.org_id AND d.name = a.name
    WHERE a.org_id = ${organizationId}
    GROUP BY a.name, d.version
    ORDER BY a.name
  `;
  const bindings = await sql<{ automationName: string; projectId: string }[]>`
    SELECT automation_name AS "automationName", project_id AS "projectId"
    FROM app.automation_project_bindings
    WHERE org_id = ${organizationId}
  `;
  const byName = new Map<string, string[]>();
  for (const binding of bindings) {
    const list = byName.get(binding.automationName) ?? [];
    list.push(binding.projectId);
    byName.set(binding.automationName, list);
  }
  // The one trigger read, so the listing's health and next start are the
  // binding's own (a schedule's next start is computed there when the scan
  // has not yet).
  const triggerByName = new Map(
    (await listTriggers(sql, organizationId)).map((row) => [
      row.name,
      {
        kind: row.kind,
        enabled: row.enabled,
        nextRunAt: row.nextRunAt,
        lastFiredAt: row.lastFiredAt,
        lastSkippedAt: row.lastSkippedAt,
        lastSkipReason: row.lastSkipReason,
      },
    ]),
  );
  return rows.map((row) => ({
    name: row.name,
    latestVersion: row.latestVersion,
    deployedVersion: row.deployedVersion,
    description: row.description ?? null,
    inputs: row.inputs ?? null,
    presentation: row.presentation,
    projectIds: byName.get(row.name) ?? [],
    trigger: triggerByName.get(row.name) ?? null,
  }));
}

/** The 0.4 APP listing row: behaviour fields answer for the DEPLOYED
 * version (the board must never choreograph against a draft); the display
 * half comes from the newest version when nothing is deployed. */
export interface AutomationAppListing {
  name: string;
  latest: number;
  projectIds: string[];
  deployedVersion?: number;
  taskContract?: unknown;
  settings?: unknown;
  presentation?: unknown;
}

export async function listAutomationsForApp(
  sql: Sql,
  organizationId: string,
  options: { projectId?: string; includeProjectBound?: boolean } = {},
): Promise<AutomationAppListing[]> {
  const rows = await sql<
    {
      name: string;
      latest: number;
      deployedVersion: number | null;
      taskContract: unknown;
      settings: unknown;
      presentation: unknown;
    }[]
  >`
    SELECT a.name, max(a.version) AS latest, d.version AS "deployedVersion",
           (array_agg(a.task_contract ORDER BY a.version = d.version DESC NULLS LAST, a.version DESC))[1]
             AS "taskContract",
           (array_agg(a.settings ORDER BY a.version = d.version DESC NULLS LAST, a.version DESC))[1]
             AS settings,
           (array_agg(a.presentation ORDER BY a.version = d.version DESC NULLS LAST, a.version DESC)
              FILTER (WHERE a.presentation IS NOT NULL
                        AND jsonb_typeof(a.presentation) <> 'null'))[1]
             AS presentation
    FROM app.automations a
    LEFT JOIN app.automation_deployments d
      ON d.org_id = a.org_id AND d.name = a.name
    WHERE a.org_id = ${organizationId}
    GROUP BY a.name, d.version
    ORDER BY a.name
  `;
  const bindings = await sql<{ automationName: string; projectId: string }[]>`
    SELECT automation_name AS "automationName", project_id AS "projectId"
    FROM app.automation_project_bindings
    WHERE org_id = ${organizationId}
  `;
  const byName = new Map<string, string[]>();
  for (const binding of bindings) {
    const list = byName.get(binding.automationName) ?? [];
    list.push(binding.projectId);
    byName.set(binding.automationName, list);
  }
  return rows.flatMap((row) => {
    const projectIds = byName.get(row.name) ?? [];
    // Scope: a project's automations / org-level only / everything.
    if (options.projectId !== undefined) {
      if (!projectIds.includes(options.projectId)) return [];
    } else if (options.includeProjectBound !== true && projectIds.length > 0) {
      return [];
    }
    const deployed = row.deployedVersion !== null;
    return [
      {
        name: row.name,
        latest: row.latest,
        projectIds,
        ...(deployed && row.deployedVersion !== null
          ? { deployedVersion: row.deployedVersion }
          : {}),
        // Behaviour fields only answer once DEPLOYED (the 0.4 rule); the
        // aggregate already prefers the deployed version's row.
        ...(deployed && row.taskContract !== null
          ? { taskContract: row.taskContract }
          : {}),
        ...(deployed && row.settings !== null
          ? { settings: row.settings }
          : {}),
        ...(row.presentation !== null
          ? { presentation: row.presentation }
          : {}),
      },
    ];
  });
}

/** One entry of a version history, without its document. */
export interface VersionListing {
  version: number;
  message: string | null;
  testsPassed: boolean | null;
  testsCheckedAt: number | null;
  createdBy: string;
  createdAt: number;
  /** The door it was saved through (0181) — null before it was recorded. */
  createdVia: AutomationWriteVia | null;
  /** The name the saving agent's client gave itself. */
  clientName: string | null;
}

export async function listVersions(
  sql: Sql,
  organizationId: string,
  name: string,
): Promise<VersionListing[]> {
  return sql<VersionListing[]>`
    SELECT version, message, tests_passed AS "testsPassed",
           tests_checked_at_ms::float8 AS "testsCheckedAt",
           created_by AS "createdBy", created_at_ms::float8 AS "createdAt",
           created_via AS "createdVia", client_name AS "clientName"
    FROM app.automations
    WHERE org_id = ${organizationId} AND name = ${name}
    ORDER BY version DESC
  `;
}

// ---------------------------------------------------------------- bindings

export async function setAutomationProjects(
  sql: Sql,
  args: {
    organizationId: string;
    name: string;
    projectIds: string[];
    actor: string;
    /** The projects the saving person can read. The editor only ever sees
     * those bindings, so the save replaces that part of the set and keeps
     * every binding to a project outside it; a project they cannot read
     * answers like a missing one unless it is already bound. Omitted, the
     * save replaces the whole set. */
    visibleProjectIds?: string[];
  },
): Promise<void> {
  await sql.begin(async (tx) => {
    // The name first, as every definition writer takes it (`audit.ts`).
    await lockAutomationName(tx, args.organizationId, args.name);
    let projectIds = args.projectIds;
    if (args.visibleProjectIds !== undefined) {
      const visible = new Set(args.visibleProjectIds);
      const hidden = projectIds.filter((id) => !visible.has(id));
      if (hidden.length > 0) {
        const bound = new Set(
          await bindingProjectIds(tx, args.organizationId, args.name),
        );
        if (hidden.some((id) => !bound.has(id))) {
          throw new AutomationError(
            'AUTOMATION_PROJECT_UNKNOWN',
            'One of the projects does not exist in this organization.',
            404,
          );
        }
        projectIds = projectIds.filter((id) => visible.has(id));
      }
    }
    const owned = await tx<{ id: string; archivedAt: number | null }[]>`
      SELECT id, archived_at_ms::float8 AS "archivedAt" FROM app.projects
      WHERE org_id = ${args.organizationId}
        AND id = ANY(${projectIds})
    `;
    if (owned.length !== new Set(projectIds).size) {
      throw new AutomationError(
        'AUTOMATION_PROJECT_UNKNOWN',
        'One of the projects does not exist in this organization.',
        404,
      );
    }
    // Binding is a write on the project: an archived one is read-only and
    // answers the code every other write on it does.
    if (owned.some((project) => (project.archivedAt ?? null) !== null)) {
      throw new AutomationError(
        'PROJECT_ARCHIVED',
        'One of the projects is archived — restore it before binding an automation to it.',
        403,
      );
    }
    // Lock every existing/requested claim key before the first binding write.
    await lockWakeClaimKeys(tx, args.organizationId, args.name, projectIds);
    const unbound = await tx<{ projectId: string }[]>`
      DELETE FROM app.automation_project_bindings
      WHERE org_id = ${args.organizationId}
        AND automation_name = ${args.name}
        AND NOT (project_id = ANY(${projectIds}))
        ${
          args.visibleProjectIds === undefined
            ? tx``
            : tx`AND project_id = ANY(${args.visibleProjectIds})`
        }
      RETURNING project_id AS "projectId"
    `;
    for (const { projectId } of unbound) {
      await auditProjectBinding(tx, args, projectId, 'unbound');
    }
    // Ordered, deduplicated inserts retain upstream no-op audit semantics.
    for (const projectId of [...new Set(projectIds)].sort()) {
      const bound = await claimingWake(
        () => tx`
          INSERT INTO app.automation_project_bindings (
            org_id, automation_name, project_id, bound_at_ms, bound_by
          ) VALUES (
            ${args.organizationId}, ${args.name}, ${projectId}, ${Date.now()},
            ${args.actor}
          )
          ON CONFLICT (org_id, automation_name, project_id) DO NOTHING
        `,
      );
      if (bound.count > 0) {
        await auditProjectBinding(tx, args, projectId, 'bound');
      }
    }
    await emitDefinitionHint(tx, args.organizationId, args.name);
  });
}

/** The audit row of one installation added to or removed from a project. */
function auditProjectBinding(
  tx: TransactionSql,
  args: { organizationId: string; name: string; actor: string },
  projectId: string,
  change: 'bound' | 'unbound',
): Promise<void> {
  return auditDefinitionWrite(tx, {
    organizationId: args.organizationId,
    actor: args.actor,
    action:
      change === 'bound'
        ? 'automation.project.bound'
        : 'automation.project.unbound',
    name: args.name,
    ...(change === 'bound'
      ? { newState: { projectId } }
      : { previousState: { projectId } }),
  });
}

/** Idempotent add of ONE project binding (the 0.4 `storeBindProject`). */
export async function bindProject(
  sql: Sql,
  args: {
    organizationId: string;
    name: string;
    projectId: string;
    actor: string;
  },
): Promise<{ bound: boolean }> {
  return sql.begin((tx) => bindProjectInTx(tx, args));
}

/** Add a binding inside the caller's project-authorization transaction. */
export async function bindProjectInTx(
  tx: TransactionSql,
  args: {
    organizationId: string;
    name: string;
    projectId: string;
    actor: string;
  },
): Promise<{ bound: boolean }> {
  await lockAutomationProjectBindingsInTx(tx, args, [args.projectId]);
  const owned = await tx<{ id: string }[]>`
    SELECT id FROM app.projects
    WHERE org_id = ${args.organizationId} AND id = ${args.projectId}
  `;
  if (owned.length === 0) {
    throw new AutomationError(
      'AUTOMATION_PROJECT_UNKNOWN',
      'The project does not exist in this organization.',
      404,
    );
  }
  // The binding trigger retains the SERIALIZABLE snapshot fence.
  const inserted = await claimingWake(
    () => tx`
      INSERT INTO app.automation_project_bindings (
        org_id, automation_name, project_id, bound_at_ms, bound_by
      ) VALUES (
        ${args.organizationId}, ${args.name}, ${args.projectId}, ${Date.now()},
        ${args.actor}
      )
      ON CONFLICT (org_id, automation_name, project_id) DO NOTHING
    `,
  );
  const bound = inserted.count > 0;
  // An idempotent re-add changed nothing — no screen needs a refetch, and
  // nothing is audited.
  if (bound) {
    await auditProjectBinding(tx, args, args.projectId, 'bound');
    await emitDefinitionHint(tx, args.organizationId, args.name);
  }
  return { bound };
}

/** Remove one project installation — the inverse of `bindProjectInTx`:
 * `unbound` says whether a binding was there to remove, so a door can tell
 * an uninstall from a no-op. Versions, triggers and run history stay. */
export async function unbindProjectInTx(
  tx: TransactionSql,
  args: {
    organizationId: string;
    name: string;
    projectId: string;
    /** Who removes it — the audit row's actor. */
    actor: string;
  },
): Promise<{ unbound: boolean }> {
  await lockAutomationProjectBindingsInTx(tx, args, [args.projectId]);
  const removed = await tx`
    DELETE FROM app.automation_project_bindings
    WHERE org_id = ${args.organizationId}
      AND automation_name = ${args.name} AND project_id = ${args.projectId}
  `;
  const unbound = removed.count > 0;
  if (unbound) {
    await auditProjectBinding(tx, args, args.projectId, 'unbound');
    await emitDefinitionHint(tx, args.organizationId, args.name);
  }
  return { unbound };
}

export async function bindingProjectIds(
  sql: Sql | TransactionSql,
  organizationId: string,
  name: string,
): Promise<string[]> {
  const rows = await sql<{ projectId: string }[]>`
    SELECT project_id AS "projectId" FROM app.automation_project_bindings
    WHERE org_id = ${organizationId} AND automation_name = ${name}
  `;
  return rows.map((row) => row.projectId);
}

// ---------------------------------------------------------------- triggers

/** A trigger as a caller writes it — the shared write schema's input. The
 * store parses it again, so a caller without a schema (MCP, managed
 * configuration, a pack) meets the same rules as the doors. */
export type TriggerInput = TriggerWrite & {
  /** A schedule only: fire early when an agent of its project frees its
   * slot (#4540, `automations/wakes.ts`). Only the managed door sets it; a
   * save that omits it keeps it, and a kind change clears it. It is not part
   * of the shared contract: the doors that parse that contract never send
   * it. */
  wakeOnSlotFreed?: boolean;
};

/** A schedule's stored rule: the repeat rule and the day it starts on. */
export interface StoredScheduleRule {
  repeat: ScheduleRule;
  startDate: string;
}

/** A trigger after its checks — what `setTrigger` stores. */
export interface CheckedTrigger {
  kind: TriggerKind;
  enabled: boolean;
  /** Trimmed; null unless a schedule was given one. */
  cron: string | null;
  /** In `Intl`'s spelling; null for a cron read in UTC and for other kinds. */
  timezone: string | null;
  scheduleRule: StoredScheduleRule | null;
  /** Stored only when it is `skip`: NULL reads as `latest`, which keeps the
   * managed configuration hash of a schedule that never chose one. */
  catchUp: 'skip' | null;
  event: string | null;
  rotateToken: boolean;
  /** When a schedule starts; null for webhook and event triggers. */
  schedule: Schedule | null;
  /** The fixed input every run it starts receives, or null. */
  input: Record<string, unknown> | null;
}

/** The most problems one refusal lists. */
const MAX_TRIGGER_ISSUES = 20;

function triggerRefusal(issues: readonly TriggerIssue[]): AutomationError {
  return new AutomationError(
    'AUTOMATION_TRIGGER_INVALID',
    issues[0]?.message ?? 'The trigger cannot be saved.',
    400,
    { issues: issues.slice(0, MAX_TRIGGER_ISSUES) },
  );
}

/**
 * How a door answers a trigger body its schema refused: a rule of the
 * trigger (no repeat rule or cron, a time not written HH:MM, a blank zone,
 * a fixed input that names a trigger field) is the store's own refusal,
 * `AUTOMATION_TRIGGER_INVALID` with each problem coded, so the app words
 * it per field and an API caller meets one code for every trigger rule;
 * null when the body's shape is wrong (an unknown key, a key of another
 * kind, a missing kind, a wrong type), which the door answers as the body
 * refusal it gives every route.
 */
export function triggerBodyRefusal(
  error: z.ZodError,
  value: unknown,
): AutomationError | null {
  const issues = triggerIssues(error, value);
  const ruled = issues.every(
    (issue) =>
      issue.code !== 'trigger.key_other_kind' &&
      TRIGGER_ISSUE_CODES.some((code) => code === issue.code),
  );
  return ruled ? triggerRefusal(issues) : null;
}

function checkSchedule(
  trigger: Extract<ParsedTriggerWrite, { kind: 'schedule' }>,
  now: number,
): Pick<
  CheckedTrigger,
  'cron' | 'timezone' | 'scheduleRule' | 'catchUp' | 'schedule'
> {
  const cron = trigger.cron?.trim() ?? '';
  if (cron !== '') {
    try {
      parseCron(cron);
    } catch (error) {
      throw triggerRefusal([
        {
          path: 'cron',
          code:
            error instanceof CronImpossibleDateError
              ? 'schedule.cron_impossible_date'
              : 'schedule.cron_unreadable',
          message: `That cron expression will never fire: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    }
  }
  const timezone = trigger.timezone ?? null;
  // The schema refuses a rule without a zone; the start date defaults to
  // the day of the save in that zone.
  const scheduleRule: StoredScheduleRule | null =
    trigger.repeat === undefined || timezone === null
      ? null
      : {
          repeat: normalizeScheduleRule(trigger.repeat),
          startDate:
            trigger.startDate ?? formatIsoDate(localDateIn(now, timezone)),
        };
  const read = scheduleOfTrigger({
    cron: cron === '' ? null : cron,
    timezone,
    scheduleRule,
  });
  if ('issue' in read) {
    throw triggerRefusal([
      { path: 'repeat', code: 'schedule.cron_or_repeat', message: read.issue },
    ]);
  }
  // Nothing the schema admits is this, but a rule or an expression that
  // never comes due must not save green and wait forever.
  if (nextOccurrence(read.schedule, now) === null) {
    throw triggerRefusal([
      cron === ''
        ? {
            path: 'repeat',
            code: 'schedule.window_never_fires',
            message: 'This schedule never comes due.',
          }
        : {
            path: 'cron',
            code: 'schedule.cron_impossible_date',
            message: 'That cron expression will never fire.',
          },
    ]);
  }
  return {
    cron: cron === '' ? null : cron,
    timezone,
    scheduleRule,
    catchUp: trigger.catchUp === 'skip' ? 'skip' : null,
    schedule: read.schedule,
  };
}

/**
 * The single validation door for a trigger. Every entry point — the app
 * route, the REST door, MCP's `set_trigger`, managed configuration and the
 * pack seed — reaches `setTrigger`, so checking here is what makes them
 * converge: a schedule whose expression cannot be read, whose zone does not
 * exist or is blank, or which names neither a rule nor a cron is refused at
 * SAVE with an actionable error, instead of saving green and never firing.
 * Throws an {@link AutomationError} (`AUTOMATION_TRIGGER_INVALID`, its
 * problems coded under `data.issues`) the surfaces map to a 400.
 */
export function checkTrigger(trigger: unknown, now: number): CheckedTrigger {
  const parsed = triggerWriteSchema.safeParse(trigger);
  if (!parsed.success) {
    throw triggerRefusal(triggerIssues(parsed.error, trigger));
  }
  const value = parsed.data;
  const common = {
    kind: value.kind,
    enabled: value.enabled ?? true,
    cron: null,
    timezone: null,
    scheduleRule: null,
    catchUp: null,
    event: null,
    rotateToken: false,
    schedule: null,
    input: value.input ?? null,
  } satisfies CheckedTrigger;
  switch (value.kind) {
    case 'schedule':
      return { ...common, ...checkSchedule(value, now) };
    case 'webhook':
      return { ...common, rotateToken: value.rotateToken === true };
    case 'event': {
      const event = value.event?.trim() ?? '';
      if (event === '') {
        throw triggerRefusal([
          {
            path: 'event',
            code: 'event.required',
            message: `An event trigger needs an event name — one of ${EMITTED_EVENT_TYPES.join(', ')}.`,
          },
        ]);
      }
      // Only an event the platform RAISES may be bound: a name it does not
      // (a typo, or one of the reserved names no producer fires yet) used
      // to save green, read as enabled and never fire.
      if (!isEmittedEventType(event)) {
        throw triggerRefusal([
          {
            path: 'event',
            code: 'event.unknown',
            message: `"${event}" is not an event the platform raises — one of ${EMITTED_EVENT_TYPES.join(', ')}.`,
          },
        ]);
      }
      return { ...common, event };
    }
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

/** {@link checkTrigger}, for a caller that only needs the refusal. */
export function assertTriggerValid(trigger: unknown): void {
  checkTrigger(takeWakeOptIn(trigger).write, Date.now());
}

/**
 * The slot-wake opt-in a managed schedule sends beside the shared contract
 * (#4540): read and taken off, so the rest is held to the contract every
 * door speaks. On another kind it is refused by name, as any key of another
 * kind is.
 */
function takeWakeOptIn(trigger: unknown): {
  write: unknown;
  wakeOnSlotFreed: boolean | undefined;
} {
  if (
    typeof trigger !== 'object' ||
    trigger === null ||
    !('wakeOnSlotFreed' in trigger)
  ) {
    return { write: trigger, wakeOnSlotFreed: undefined };
  }
  const { wakeOnSlotFreed, ...write } = trigger;
  const kind =
    'kind' in write && typeof write.kind === 'string' ? write.kind : 'this';
  if (kind !== 'schedule') {
    throw triggerRefusal([
      {
        path: 'wakeOnSlotFreed',
        code: 'trigger.key_other_kind',
        message: `"wakeOnSlotFreed" belongs to schedule triggers — a ${kind} trigger does not take it.`,
      },
    ]);
  }
  if (wakeOnSlotFreed !== undefined && typeof wakeOnSlotFreed !== 'boolean') {
    throw triggerRefusal([
      {
        path: 'wakeOnSlotFreed',
        code: 'invalid_type',
        message: 'must be true or false',
      },
    ]);
  }
  return { write, wakeOnSlotFreed };
}

/** Whether two stored rules say the same, however each was spelled; a
 * stored value that no longer reads as a rule says nothing the same. */
function sameStoredRule(
  stored: unknown,
  next: StoredScheduleRule | null,
): boolean {
  if (stored === null || stored === undefined) return next === null;
  if (next === null) return false;
  const parsed = storedScheduleRuleSchema.safeParse(stored);
  return (
    parsed.success &&
    parsed.data.startDate === next.startDate &&
    JSON.stringify(normalizeScheduleRule(parsed.data.repeat)) ===
      JSON.stringify(next.repeat)
  );
}

/**
 * One trigger per name — a rule the schema enforces (UNIQUE (org_id, name),
 * migration 0068), so binding is ONE upsert: N racing writers (two tabs, a
 * retried request, MCP set_trigger against the editor) converge on one row
 * and the last commit wins, exactly as sequential saves would. The former
 * SELECT-then-INSERT in a transaction had no lock to stop two of them from
 * both seeing "no row" and both inserting.
 *
 * A webhook mints its token here and returns the plaintext exactly once.
 * Re-binding keeps the previous token unless asked to rotate — decided in the
 * database (the CASE on the existing row), read back from RETURNING: the
 * plaintext is handed out only when the hash minted here is the one that
 * landed. A re-bind that CHANGES the kind is a new trigger in the same row:
 * its fire ledger (`lastFiredAt`, `lastRunId`, the claim cursor, the skip
 * stamp, the last failure) is cleared, so a fresh event trigger never claims
 * the firing history of the webhook it replaced (the schedule scanner also
 * reads a cleared cursor as "nothing due before this bind") — and when the
 * row it replaces held a LIVE webhook token, the answer says so (`revoked`):
 * the URL a partner posts to died with this bind, silently until now.
 *
 * Every save starts a fresh failure streak (`trigger-failures.ts`): a person
 * looked at the binding, so runs started before it no longer count. A save
 * over a schedule paused by its failures also clears the pause's skip stamp
 * — whether it turns the schedule back on or keeps it off, someone has
 * decided — and marks the owners' and admins' unread notices of it read.
 */
export async function setTrigger(
  sql: Sql,
  args: {
    organizationId: string;
    name: string;
    trigger: TriggerInput;
    actor: string;
    managed?: {
      projectId: string;
      expectedHash: string | null;
      definitionSha256: string;
    };
  },
): Promise<SetTriggerResult> {
  const now = Date.now();
  // Managed configuration alone sends the slot-wake opt-in, beside the
  // shared contract.
  const { write, wakeOnSlotFreed } = takeWakeOptIn(args.trigger);
  const checked = checkTrigger(write, now);
  // A managed declaration keeps its zone's spelling (`utc` stays `utc`, any
  // spelling `Intl` resolves to the same zone), so its readback hashes like
  // the declaration and an apply converges; a native save stores the
  // canonical spelling.
  const declaredZone =
    args.managed !== undefined && isRecord(write) ? write.timezone : undefined;
  const trigger =
    typeof declaredZone === 'string' &&
    checked.timezone !== null &&
    declaredZone.trim() === declaredZone
      ? { ...checked, timezone: declaredZone }
      : checked;
  const minted = trigger.kind === 'webhook' ? mintWebhookToken() : undefined;
  const mintedHash =
    minted !== undefined ? await hashWebhookToken(minted) : null;
  const { rows, revoked, nextRunAt } = await sql.begin(async (tx) => {
    // The name precedes the trigger row for every writer.
    await lockAutomationName(tx, args.organizationId, args.name);
    if (args.managed) {
      await assertManagedProject(
        tx,
        args.organizationId,
        args.name,
        args.managed.projectId,
        true,
      );
      const selected = await deployedVersion(
        tx,
        args.organizationId,
        args.name,
      );
      const definition =
        selected === undefined
          ? null
          : await versionRow(tx, args.organizationId, args.name, selected);
      if (
        managedConfigurationHash(
          managedDefinitionValue(args.managed.projectId, args.name, definition),
        ) !== args.managed.definitionSha256
      )
        throw new AutomationError(
          'AUTOMATION_VERSION_STALE',
          'The managed schedule requires its declared deployed definition.',
          409,
        );
    }
    // The row this bind replaces, locked for the rest of the transaction:
    // what it held decides whether a webhook URL dies here and whether the
    // schedule's next-due instant survives the save, and two binds racing on
    // one name settle their order on this lock before the upsert (a first
    // bind finds nothing, and the upsert's ON CONFLICT settles that race by
    // itself).
    const existing = await tx<
      {
        id: string;
        kind: string;
        tokenHash: string | null;
        lastSkipReason: string | null;
        cron: string | null;
        timezone: string | null;
        scheduleRule: unknown;
        catchUp: 'latest' | 'skip' | null;
        input: Record<string, unknown> | null;
        event: string | null;
        enabled: boolean;
        nextDueAt: number | null;
        wakeOnSlotFreed: boolean;
      }[]
    >`
      SELECT id, kind, token_hash AS "tokenHash", cron, timezone, event,
             enabled, schedule_rule AS "scheduleRule", catch_up AS "catchUp",
             run_input AS "input",
             next_due_at_ms::float8 AS "nextDueAt",
             last_skip_reason AS "lastSkipReason",
             wake_on_slot_freed AS "wakeOnSlotFreed"
      FROM app.automation_triggers
      WHERE org_id = ${args.organizationId} AND name = ${args.name}
      FOR UPDATE
    `;
    const before = existing[0];
    // When the schedule is next due. A save that leaves what the schedule
    // IS unchanged, on a schedule that was and stays on, keeps the instant
    // the scan has not reached yet: an input-only or no-op save must not
    // drop an occurrence. Anything else starts after the save — a save never
    // fires a past occurrence, and switching a schedule back on never makes
    // up the time it was off.
    const unchanged =
      before !== undefined &&
      before.kind === trigger.kind &&
      (before.cron?.trim() || null) === trigger.cron &&
      before.timezone === trigger.timezone &&
      sameStoredRule(before.scheduleRule, trigger.scheduleRule);
    const nextDue =
      trigger.schedule === null || !trigger.enabled
        ? null
        : unchanged && before.enabled && before.nextDueAt !== null
          ? before.nextDueAt
          : nextOccurrence(trigger.schedule, now);
    if (args.managed) {
      if (before && before.kind !== 'schedule')
        throw new AutomationError(
          'AUTOMATION_TRIGGER_INVALID',
          'Managed schedules cannot replace another trigger kind.',
          409,
        );
      const stored =
        before === undefined
          ? null
          : storedScheduleRuleSchema.safeParse(before.scheduleRule);
      const current = managedScheduleValue(
        args.managed.projectId,
        args.name,
        before === undefined
          ? null
          : {
              ...before,
              repeat: stored?.success === true ? stored.data.repeat : null,
              startDate:
                stored?.success === true ? stored.data.startDate : null,
            },
      );
      const desired = managedScheduleValue(args.managed.projectId, args.name, {
        kind: trigger.kind,
        cron: trigger.cron,
        timezone: trigger.timezone,
        enabled: trigger.enabled,
        repeat: trigger.scheduleRule?.repeat ?? null,
        startDate: trigger.scheduleRule?.startDate ?? null,
        catchUp: trigger.catchUp,
        input: trigger.input,
        wakeOnSlotFreed: wakeOnSlotFreed === true,
      });
      assertManagedHash(
        managedConfigurationHash(current),
        args.managed.expectedHash,
      );
      if (
        managedConfigurationHash(current) === managedConfigurationHash(desired)
      )
        return {
          rows: [],
          revoked: false,
          nextRunAt: before?.enabled ? (before.nextDueAt ?? null) : null,
        };
      if (
        (before !== undefined && !before.enabled && trigger.enabled) ||
        before?.lastSkipReason === 'paused_after_failures'
      )
        throw new AutomationError(
          'AUTOMATION_TRIGGER_INVALID',
          'An operationally paused schedule requires explicit recovery before configuration can change it.',
          409,
        );
    }
    // The opt-in this save leaves: what it says, else what the schedule
    // already had — a kind change clears it.
    const prior = existing[0];
    const wakes =
      trigger.kind === 'schedule' &&
      (wakeOnSlotFreed ??
        // oxlint-disable-next-line typescript/no-unnecessary-boolean-literal-compare -- preserve only an explicit database opt-in
        (prior?.kind === 'schedule' && prior.wakeOnSlotFreed === true));
    // The schedule's claim on its projects' wake before and after this save
    // (`app.automation_wake_claims`, migration 0168): a pause by failures
    // keeps it; a save ends any pause, so after it the claim is the opt-in of
    // an enabled schedule. Only the friendly pre-check reads it here.
    const claimedBefore =
      prior !== undefined &&
      prior.kind === 'schedule' &&
      // oxlint-disable-next-line typescript/no-unnecessary-boolean-literal-compare -- claiming requires an explicit database opt-in
      prior.wakeOnSlotFreed === true &&
      (prior.enabled || prior.lastSkipReason === 'paused_after_failures');
    const claims = wakes && trigger.enabled;
    if (claims && !claimedBefore) {
      await assertSingleWakeTarget(tx, args.organizationId, args.name);
    }
    // The database rewrites the bindings' claim when the schedule's changes
    // (migration 0168's trigger), and refuses a second claim on a project.
    const upserted = await claimingWake(
      () => tx<{ tokenHash: string | null }[]>`
      INSERT INTO app.automation_triggers AS t (
        org_id, name, kind, cron, timezone, event, token_hash, enabled,
        created_by, created_at_ms, updated_at_ms,
        schedule_rule, catch_up, next_due_at_ms, run_input, wake_on_slot_freed
      ) VALUES (
        ${args.organizationId}, ${args.name}, ${trigger.kind},
        ${trigger.cron}, ${trigger.timezone},
        ${trigger.event}, ${mintedHash}, ${trigger.enabled},
        ${args.actor}, ${now}, ${now},
        ${jsonParam(tx, trigger.scheduleRule)}, ${trigger.catchUp}, ${nextDue},
        ${jsonParam(tx, trigger.input)}, ${wakes}
      )
      ON CONFLICT (org_id, name) DO UPDATE SET
        kind = EXCLUDED.kind,
        cron = EXCLUDED.cron,
        timezone = EXCLUDED.timezone,
        schedule_rule = EXCLUDED.schedule_rule,
        catch_up = EXCLUDED.catch_up,
        next_due_at_ms = EXCLUDED.next_due_at_ms,
        run_input = EXCLUDED.run_input,
        event = EXCLUDED.event,
        token_hash = CASE
          WHEN EXCLUDED.kind <> 'webhook' THEN NULL
          WHEN ${trigger.rotateToken}::boolean OR t.token_hash IS NULL THEN EXCLUDED.token_hash
          ELSE t.token_hash
        END,
        last_fired_at_ms = CASE
          WHEN t.kind = EXCLUDED.kind THEN t.last_fired_at_ms
          ELSE NULL
        END,
        last_due_at_ms = CASE
          -- A managed apply keeps the row's updated_at (below), which the
          -- scan's floor would otherwise read: when 0170's trigger drops a
          -- next-due the apply left unchanged, the scan would count from the
          -- last native save and fire an occurrence of the new definition
          -- from before the apply. The claim cursor carries the apply's
          -- instant instead, so nothing before it is fired or counted.
          WHEN ${args.managed !== undefined}::boolean AND EXCLUDED.kind = 'schedule'
            THEN GREATEST(
              CASE WHEN t.kind = EXCLUDED.kind THEN COALESCE(t.last_due_at_ms, 0) ELSE 0 END,
              ${now}::bigint
            )
          WHEN t.kind = EXCLUDED.kind THEN t.last_due_at_ms
          ELSE NULL
        END,
        last_run_id = CASE
          WHEN t.kind = EXCLUDED.kind THEN t.last_run_id
          ELSE NULL
        END,
        last_skipped_at_ms = CASE
          WHEN t.last_skip_reason = 'paused_after_failures' THEN NULL
          WHEN t.kind = EXCLUDED.kind THEN t.last_skipped_at_ms
          ELSE NULL
        END,
        last_skip_reason = CASE
          WHEN t.last_skip_reason = 'paused_after_failures' THEN NULL
          WHEN t.kind = EXCLUDED.kind THEN t.last_skip_reason
          ELSE NULL
        END,
        last_skip_detail = CASE
          WHEN t.last_skip_reason = 'paused_after_failures' THEN NULL
          WHEN t.kind = EXCLUDED.kind THEN t.last_skip_detail
          ELSE NULL
        END,
        consecutive_failures = CASE WHEN ${args.managed !== undefined} THEN t.consecutive_failures ELSE 0 END,
        last_failed_at_ms = CASE
          WHEN t.kind = EXCLUDED.kind THEN t.last_failed_at_ms
          ELSE NULL
        END,
        last_failure_code = CASE
          WHEN t.kind = EXCLUDED.kind THEN t.last_failure_code
          ELSE NULL
        END,
        last_failed_run_id = CASE
          WHEN t.kind = EXCLUDED.kind THEN t.last_failed_run_id
          ELSE NULL
        END,
        enabled = EXCLUDED.enabled,
        wake_on_slot_freed = CASE
          WHEN EXCLUDED.kind <> 'schedule' THEN false
          WHEN ${wakeOnSlotFreed ?? null}::boolean IS NULL
            THEN t.kind = 'schedule' AND t.wake_on_slot_freed
          ELSE ${wakeOnSlotFreed ?? null}::boolean
        END,
        updated_at_ms = CASE WHEN ${args.managed !== undefined} THEN t.updated_at_ms ELSE EXCLUDED.updated_at_ms END
      WHERE ${args.managed?.expectedHash !== null}
      RETURNING token_hash AS "tokenHash"
    `,
    );
    if (args.managed && upserted.length !== 1)
      throw new AutomationError(
        'AUTOMATION_VERSION_STALE',
        'The managed trigger changed during creation.',
        409,
      );
    if (before?.lastSkipReason === 'paused_after_failures') {
      await dismissTriggerPausedNotifications(tx, {
        organizationId: args.organizationId,
        triggerId: before.id,
      });
    }
    const revokedWebhook =
      before !== undefined &&
      before.kind === 'webhook' &&
      before.tokenHash !== null &&
      trigger.kind !== 'webhook';
    // What the binding was and is — never its token or the token's hash.
    await auditDefinitionWrite(tx, {
      organizationId: args.organizationId,
      actor: args.actor,
      action: 'automation.trigger.set',
      name: args.name,
      ...(before === undefined
        ? {}
        : { previousState: triggerAuditState(before) }),
      newState: triggerAuditState({ ...trigger, wakeOnSlotFreed: wakes }),
      metadata: {
        ...(trigger.rotateToken && trigger.kind === 'webhook'
          ? { rotated: true }
          : {}),
        ...(revokedWebhook ? { revoked: 'webhook' } : {}),
      },
    });
    await emitDefinitionHint(tx, args.organizationId, args.name);
    return { rows: upserted, revoked: revokedWebhook, nextRunAt: nextDue };
  });
  const landed = rows[0]?.tokenHash ?? null;
  // Saved either way: a warning says what every run this trigger starts
  // would meet in the version that runs, and the person decides.
  const warnings = await triggerWarnings(
    sql,
    args.organizationId,
    args.name,
    trigger,
  );
  return {
    ...(minted !== undefined && landed !== null && landed === mintedHash
      ? { token: minted }
      : {}),
    ...(revoked ? { revoked: 'webhook' as const } : {}),
    ...(trigger.kind === 'schedule' ? { nextRunAt } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/** What a bind answers besides the stored trigger. */
export interface SetTriggerResult {
  /** A webhook's plaintext token, minted by this bind and shown once. */
  token?: string;
  /** The live webhook address this bind replaced with another kind. */
  revoked?: 'webhook';
  /** A schedule's next start; null while it is switched off. */
  nextRunAt?: number | null;
  /** What the deployed version would make of what this trigger sends
   * (`TRIGGER_INPUT_MISMATCH`, `TRIGGER_INPUT_NOT_TEMPLATED`); absent when
   * nothing is wrong. */
  warnings?: Issue[];
}

/**
 * What a trigger would meet in the version that runs: the input it would
 * send checked against that version's inputs schema (none deployed, or none
 * declared, checks nothing), and its fixed input checked for a template.
 * The validator asks the same through the store's `triggerInput` seam.
 */
async function triggerWarnings(
  sql: Sql | TransactionSql,
  organizationId: string,
  name: string,
  trigger: {
    kind: string;
    event: string | null;
    input: Readonly<Record<string, unknown>> | null;
  },
): Promise<Issue[]> {
  const sample = triggerInputSample(trigger, Date.now());
  if (sample === null) return [];
  let check: InputsCheck | null = null;
  const deployed = await deployedVersion(sql, organizationId, name);
  if (deployed !== undefined) {
    const row = await versionRow(sql, organizationId, name, deployed);
    if (
      row !== null &&
      isRecord(row.document) &&
      isRecord(row.document.inputs)
    ) {
      try {
        check = compileSchemaCached(
          `${organizationId}/${name}@${deployed}:${row.createdAt}`,
          row.document.inputs,
        );
      } catch (error) {
        // The version's own check reports a schema that does not compile.
        console.warn(
          `[automations] ${organizationId}/${name}@${deployed}: the trigger input is not checked, the inputs schema does not compile`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }
  return triggerInputWarnings(check, sample);
}

/** A binding as its audit row records it: what starts the automation, how
 * a schedule catches up and whether it is on — never its token or the
 * token's hash, and of a fixed input only that one is set (its values are
 * run data, not configuration). */
function triggerAuditState(trigger: {
  kind: string;
  cron: string | null;
  timezone: string | null;
  event: string | null;
  enabled: boolean;
  scheduleRule?: unknown;
  catchUp?: string | null;
  input?: Record<string, unknown> | null;
  wakeOnSlotFreed?: boolean;
}): Record<string, unknown> {
  return {
    kind: trigger.kind,
    ...(trigger.cron === null ? {} : { cron: trigger.cron }),
    ...(trigger.scheduleRule === null || trigger.scheduleRule === undefined
      ? {}
      : { repeat: trigger.scheduleRule }),
    ...(trigger.timezone === null ? {} : { timezone: trigger.timezone }),
    ...(trigger.catchUp === null || trigger.catchUp === undefined
      ? {}
      : { catchUp: trigger.catchUp }),
    ...(trigger.event === null ? {} : { event: trigger.event }),
    ...(trigger.input === null || trigger.input === undefined
      ? {}
      : { fixedInput: true }),
    enabled: trigger.enabled,
    ...(trigger.kind === 'schedule' && trigger.wakeOnSlotFreed !== undefined
      ? { wakeOnSlotFreed: trigger.wakeOnSlotFreed }
      : {}),
  };
}

/** The partial unique index that keeps one wake target per project
 * (migration 0168, AUTO-R29). */
const ONE_WAKE_INDEX = 'automation_project_bindings_one_wake';

/** A write that may claim a project's wake: a second claim, refused by the
 * one-wake index — also when two saves race past every check — answers 409
 * and the whole transaction rolls back. */
async function claimingWake<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505' &&
      'constraint_name' in error &&
      error.constraint_name === ONE_WAKE_INDEX
    ) {
      throw new AutomationError(
        'AUTOMATION_TRIGGER_INVALID',
        'Another schedule already wakes this project when an agent frees its slot — turn its wakeOnSlotFreed off first.',
        409,
      );
    }
    throw error;
  }
}

/**
 * Take every claim key a binding change can touch before it touches any
 * (R4-F3), in one database call (`app.lock_automation_wake_keys`, migration
 * 0168): the automation's fence, then — only when its schedule claims, read
 * under that fence — each project it is bound to now or is asked for, in
 * the order the database's own claim writes use. Two claiming saves that
 * swap projects queue behind each other instead of deadlocking on each
 * other's deletions; a save whose schedule does not claim takes no project
 * key, so it never waits on another writer's (R5-F1).
 */
async function lockWakeClaimKeys(
  tx: TransactionSql,
  organizationId: string,
  name: string,
  projectIds: readonly string[],
): Promise<void> {
  await tx`
    SELECT app.lock_automation_wake_keys(
      ${organizationId}, ${name}, ${[...projectIds]}::text[]
    )
  `;
}

/** Preclaim a complete binding edit before its first write. A batch caller
 * supplies every added/removed project after authorization; individual doors
 * re-enter these transaction locks without changing their order. */
export async function lockAutomationProjectBindingsInTx(
  tx: TransactionSql,
  args: { organizationId: string; name: string },
  projectIds: readonly string[],
): Promise<void> {
  await lockAutomationName(tx, args.organizationId, args.name);
  await lockWakeClaimKeys(tx, args.organizationId, args.name, projectIds);
}

/**
 * The friendly half of AUTO-R29: before a schedule starts claiming, name the
 * schedule that already wakes one of its projects. The one-wake index is the
 * rule itself (`claimingWake`); this only words the common refusal.
 */
async function assertSingleWakeTarget(
  tx: TransactionSql,
  organizationId: string,
  name: string,
): Promise<void> {
  const others = await tx<{ name: string }[]>`
    SELECT theirs.automation_name AS name
    FROM app.automation_project_bindings theirs
    JOIN app.automation_project_bindings ours
      ON ours.org_id = theirs.org_id AND ours.project_id = theirs.project_id
     AND ours.automation_name = ${name}
    WHERE theirs.org_id = ${organizationId}
      AND theirs.automation_name <> ${name} AND theirs.wakes
    ORDER BY theirs.automation_name
    LIMIT 1
  `;
  const other = others[0];
  if (other !== undefined) {
    throw new AutomationError(
      'AUTOMATION_TRIGGER_INVALID',
      `"${other.name}" already wakes this project when an agent frees its slot — turn its wakeOnSlotFreed off first.`,
      409,
    );
  }
}

/** Whether the named trigger is a schedule opted in to slot wakes — the
 * managed readback's half of `wakeOnSlotFreed` (the trigger listing itself
 * does not carry it). */
export async function triggerWakesOnSlotFreed(
  sql: Sql | TransactionSql,
  organizationId: string,
  name: string,
): Promise<boolean> {
  const rows = await sql<{ wakes: boolean }[]>`
    SELECT kind = 'schedule' AND wake_on_slot_freed AS wakes
    FROM app.automation_triggers
    WHERE org_id = ${organizationId} AND name = ${name}
  `;
  // oxlint-disable-next-line typescript/no-unnecessary-boolean-literal-compare -- absence or a malformed projection never opts in
  return rows[0]?.wakes === true;
}

export async function deleteTrigger(
  sql: Sql,
  organizationId: string,
  name: string,
  /** Who removes it — the audit row's actor. */
  actor: string,
): Promise<boolean> {
  return sql.begin(async (tx) => {
    // The name before the trigger row (`trigger-failures.ts`).
    await lockAutomationName(tx, organizationId, name);
    const rows = await tx<
      {
        id: string;
        lastSkipReason: string | null;
        kind: string;
        cron: string | null;
        timezone: string | null;
        event: string | null;
        enabled: boolean;
        wakeOnSlotFreed: boolean;
      }[]
    >`
      DELETE FROM app.automation_triggers
      WHERE org_id = ${organizationId} AND name = ${name}
      RETURNING id, last_skip_reason AS "lastSkipReason", kind, cron,
                timezone, event, enabled, wake_on_slot_freed AS "wakeOnSlotFreed"
    `;
    const removed = rows[0];
    if (removed === undefined) return false;
    await auditDefinitionWrite(tx, {
      organizationId,
      actor,
      action: 'automation.trigger.deleted',
      name,
      previousState: triggerAuditState(removed),
    });
    // A paused schedule removed is a pause someone dealt with.
    if (removed.lastSkipReason === 'paused_after_failures') {
      await dismissTriggerPausedNotifications(tx, {
        organizationId,
        triggerId: removed.id,
      });
    }
    await emitDefinitionHint(tx, organizationId, name);
    return true;
  });
}

/** A trigger binding as a reader sees it — never the secret that verifies
 * it — exactly the published read shape (`triggerViewSchema`). The fire
 * ledger (0096) is the binding's health: `lastFiredAt` and `lastRunId` name
 * the last run it started (a schedule's `lastFiredAt` is the occurrence it
 * started for), `lastSkippedAt`, `lastSkipReason` and `lastSkipDetail` the
 * last time it came due and started nothing (or when a schedule paused
 * itself). The failure streak (0124) counts the permanent failures in a row
 * among the runs it started since its last save; `lastFailedAt`,
 * `lastFailureCode` and `lastFailedRunId` name the last of them. */
export type TriggerListing = TriggerView;

interface TriggerListingRow extends Omit<
  TriggerListing,
  'repeat' | 'startDate' | 'nextRunAt' | 'lastSkipDetail'
> {
  scheduleRule: unknown;
  nextDueAt: number | null;
  lastSkipDetail: unknown;
}

/** What a stored row reads as: its rule only when the rule is what runs (a
 * non-empty cron wins), its next start computed when the scan has not yet,
 * and a skip detail only when it explains the reason the row carries — a
 * previous image stamps a reason without one. */
function toTriggerListing(row: TriggerListingRow, now: number): TriggerListing {
  const { scheduleRule, nextDueAt, lastSkipDetail, ...rest } = row;
  const isSchedule = row.kind === 'schedule';
  const hasCron = (row.cron ?? '').trim() !== '';
  const stored = storedScheduleRuleSchema.safeParse(scheduleRule);
  const rule = isSchedule && !hasCron && stored.success ? stored.data : null;
  let nextRunAt: number | null = null;
  if (isSchedule && row.enabled) {
    if (typeof nextDueAt === 'number') {
      nextRunAt = nextDueAt;
    } else {
      const read = scheduleOfTrigger({
        cron: row.cron,
        timezone: row.timezone,
        scheduleRule,
      });
      nextRunAt = 'issue' in read ? null : nextOccurrence(read.schedule, now);
    }
  }
  const detail = triggerSkipDetailSchema.safeParse(lastSkipDetail);
  return {
    ...rest,
    repeat: rule === null ? null : normalizeScheduleRule(rule.repeat),
    startDate: rule?.startDate ?? null,
    catchUp: isSchedule ? (row.catchUp ?? 'latest') : null,
    nextRunAt,
    lastSkipDetail:
      detail.success && detail.data.reason === row.lastSkipReason
        ? detail.data
        : null,
  };
}

export async function listTriggers(
  sql: Sql,
  organizationId: string,
  name?: string,
): Promise<TriggerListing[]> {
  const rows = await sql<TriggerListingRow[]>`
    SELECT id, name, kind, cron, timezone, event,
           schedule_rule AS "scheduleRule",
           catch_up AS "catchUp",
           next_due_at_ms::float8 AS "nextDueAt",
           run_input AS "input",
           (token_hash IS NOT NULL AND token_hash <> '') AS "hasToken",
           enabled,
           last_fired_at_ms::float8 AS "lastFiredAt",
           last_run_id AS "lastRunId",
           last_skipped_at_ms::float8 AS "lastSkippedAt",
           last_skip_reason AS "lastSkipReason",
           last_skip_detail AS "lastSkipDetail",
           consecutive_failures AS "consecutiveFailures",
           last_failed_at_ms::float8 AS "lastFailedAt",
           last_failure_code AS "lastFailureCode",
           last_failed_run_id AS "lastFailedRunId"
    FROM app.automation_triggers
    WHERE org_id = ${organizationId}
      AND (${name ?? null}::text IS NULL OR name = ${name ?? null})
    ORDER BY name
  `;
  const now = Date.now();
  return rows.map((row) => toTriggerListing(row, now));
}

/** How many runs the trigger's recent-runs read answers at most. */
export const TRIGGER_RUNS_MAX = 50;

/** One run a trigger started, newest first — what the trigger panel lists
 * under a webhook's recent deliveries. */
export interface TriggerRunListing {
  runId: string;
  startedAt: number;
  status: string;
  /** How the webhook door recognised the delivery that started the run:
   * by a delivery-id header or by the body's bytes. Null for a schedule or
   * an event, and once the delivery's ledger row is gone (a header
   * identity lives 24 hours, a body identity two minutes, and an expired
   * one is dropped on the trigger's next delivery). */
  deliverySource: 'header' | 'body' | null;
  /** The delivery-id header, with `deliverySource: 'header'`. */
  header: string | null;
}

/** A ledger row's lane, `header:<name>` or `body`, as the read answers it. */
function deliveryLane(
  source: string | null,
): Pick<TriggerRunListing, 'deliverySource' | 'header'> {
  if (source === 'body') return { deliverySource: 'body', header: null };
  if (source?.startsWith('header:') === true) {
    return { deliverySource: 'header', header: source.slice('header:'.length) };
  }
  return { deliverySource: null, header: null };
}

/**
 * The runs the automation's bound trigger started (`started_by =
 * 'trigger:<id>'`), newest first — whatever kind it had when it started
 * them — each with the webhook delivery lane that started it while that
 * delivery's ledger row lives. Empty when no trigger is bound. A run in a
 * project outside `visibleProjectIds` is left out, as every run read does.
 *
 * The runs come off `automation_runs_org_name` (the automation's runs,
 * newest first, filtered to the trigger's); each run's ledger row off
 * `automation_webhook_deliveries_expiry`, bounded by the run's own start —
 * the identity's window outlasts the transaction that claims it and starts
 * the run.
 */
export async function listTriggerRuns(
  sql: Sql,
  organizationId: string,
  args: { name: string; limit?: number; visibleProjectIds?: string[] },
): Promise<TriggerRunListing[]> {
  const limit = Math.min(
    Math.max(Math.trunc(args.limit ?? 10), 1),
    TRIGGER_RUNS_MAX,
  );
  const rows = await sql<
    {
      runId: string;
      startedAt: number;
      status: string;
      source: string | null;
    }[]
  >`
    WITH started AS (
      SELECT r.id, r.started_at_ms, r.status, t.id AS trigger_id
      FROM app.automation_triggers t
      JOIN app.automation_runs r
        ON r.org_id = t.org_id
       AND r.name = t.name
       AND r.started_by = 'trigger:' || t.id
      WHERE t.org_id = ${organizationId} AND t.name = ${args.name}
        AND (${args.visibleProjectIds === undefined}
             OR r.project_id IS NULL
             OR r.project_id = ANY(${args.visibleProjectIds ?? []}::text[]))
      ORDER BY r.started_at_ms DESC, r.id DESC
      LIMIT ${limit}
    )
    SELECT s.id AS "runId", s.started_at_ms::float8 AS "startedAt", s.status,
           (SELECT d.source FROM app.automation_webhook_deliveries d
            WHERE d.trigger_id = s.trigger_id
              AND d.expires_at_ms >= s.started_at_ms
              AND d.run_id = s.id
            ORDER BY d.received_at_ms DESC
            LIMIT 1) AS source
    FROM started s
    ORDER BY s.started_at_ms DESC, s.id DESC
  `;
  return rows.map(toTriggerRunListing);
}

function toTriggerRunListing(row: {
  runId: string;
  startedAt: number;
  status: string;
  source: string | null;
}): TriggerRunListing {
  const lane = deliveryLane(row.source);
  return {
    runId: row.runId,
    startedAt: row.startedAt,
    status: row.status,
    deliverySource: lane.deliverySource,
    header: lane.header,
  };
}

// ------------------------------------------------------------------- runs

export interface RunRow {
  id: string;
  organizationId: string;
  name: string;
  version: number;
  projectId: string | null;
  status: string;
  mode: 'mock' | 'live';
  startedBy: string;
  input: unknown;
  output: unknown;
  checkpoints: unknown;
  trace: unknown;
  effects: unknown;
  detail: string | null;
  /** The stable cause of a `failed` run (`Run.failureCode`); null for any
   * other status, and for a failure recorded before the code existed. */
  failureCode: string | null;
  claimEpoch: number;
  legacyQuarantine?: unknown;
  chainSeq: number;
  startedAt: number;
  finishedAt: number | null;
  /** Whether a question of this run is waiting on a person — what tells an
   * `agent:<node>` park that is an ask apart from one that is an agent turn
   * still running (`waitingFor`). Read with the row, never answered raw. */
  askPending: boolean;
  /** How often another server took the run over after its own stopped
   * responding, or a stopping server handed it on. */
  resumeCount: number;
  /** Why the run was last handed on; null while it never was. Answered as
   * `lastResume`, never raw. */
  lastResumeReason: 'shutdown' | 'lease_expired' | null;
  /** When the run was last handed on; null while it never was. */
  lastResumedAt: number | null;
  /** A running run nobody is stepping right now: its server stopped
   * responding, or a stopping server handed it on and no other has taken
   * it yet. */
  stalled: boolean;
  /** The run this one replays — null once that run was deleted, while
   * `replayKind` still says it was a replay. Answered as `replayOf`; every
   * read of the row selects them. */
  replayOfRunId?: string | null;
  replayKind?: RunReplayKind | null;
  replayFromNode?: string | null;
}

/** How a replay ran its source again: with the same input, with an input a
 * person edited, or from one of its steps. */
export type RunReplayKind = 'again' | 'edited' | 'from';

/** The run a replay ran again, as a read answers it. */
export interface RunReplayOf {
  /** Null once the run it replays was deleted. */
  runId: string | null;
  kind: RunReplayKind;
  fromNode?: string;
}

/** A run's replay lineage, from its row; undefined for a run nobody
 * replayed into being. */
function runReplayOf(
  row: Pick<RunRow, 'replayOfRunId' | 'replayKind' | 'replayFromNode'>,
): RunReplayOf | undefined {
  if (row.replayKind === null || row.replayKind === undefined) return undefined;
  return {
    runId: row.replayOfRunId ?? null,
    kind: row.replayKind,
    ...(row.replayFromNode !== null &&
      row.replayFromNode !== undefined && { fromNode: row.replayFromNode }),
  };
}

/** Why and when a run was last handed to another server. */
export interface RunLastResume {
  reason: 'shutdown' | 'lease_expired';
  at: number;
}

/**
 * A running run nobody is stepping right now, read off its lease: the lease
 * lapsed (its server stopped responding), or a stopping server released it
 * and stamped the hand-off after the claim it held, and no server has
 * claimed it since. Two things are NOT stalled: a budget hand-off, which
 * releases the lease without a stamp, so a busy queue never reads
 * "Interrupted"; and a row an image without leases claimed last
 * (`lease_epoch` <> `claim_epoch`). The hand-off stamp must be strictly
 * after the claim: a takeover stamps both with the same instant, and a later
 * budget hand-off of that claim is not an interruption.
 */
const RUN_STALLED_SQL = `coalesce(
    status = 'running' AND lease_epoch = claim_epoch AND (
      (lease_expires_at_ms IS NOT NULL
       AND lease_expires_at_ms < (extract(epoch FROM now()) * 1000)::bigint)
      OR (lease_expires_at_ms IS NULL AND last_resumed_at_ms IS NOT NULL
          AND last_resumed_at_ms > coalesce(claimed_at_ms, 0))
    ),
    false
  )`;

const RUN_COLUMNS = `
  id, org_id AS "organizationId", name, version, project_id AS "projectId",
  status, mode, started_by AS "startedBy", input, output, checkpoints, trace,
  effects, detail, failure_code AS "failureCode",
  claim_epoch AS "claimEpoch", legacy_quarantine AS "legacyQuarantine", chain_seq AS "chainSeq",
  started_at_ms::float8 AS "startedAt", finished_at_ms::float8 AS "finishedAt",
  EXISTS (
    SELECT 1 FROM app.automation_human_asks a
    WHERE a.run_id = app.automation_runs.id AND a.status = 'pending'
      AND a.expires_at_ms > (extract(epoch FROM now()) * 1000)::bigint
  ) AS "askPending",
  resume_count AS "resumeCount",
  last_resume_reason AS "lastResumeReason",
  last_resumed_at_ms::float8 AS "lastResumedAt",
  ${RUN_STALLED_SQL} AS "stalled",
  replay_of_run_id AS "replayOfRunId", replay_kind AS "replayKind",
  replay_from_node AS "replayFromNode"
`;

async function runRow(
  sql: Sql | TransactionSql,
  organizationId: string,
  runId: string,
): Promise<RunRow | null> {
  const rows = await sql<RunRow[]>`
    SELECT ${sql.unsafe(RUN_COLUMNS)} FROM app.automation_runs
    WHERE id = ${runId} AND org_id = ${organizationId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * A run's state changed — nudge the SSE hint bridge so open run views refetch
 * without a manual reload. The frontend keys every run query under the
 * `automation_run` entity (`app/lib/backend/automations.ts`), so this one hint
 * invalidates the run detail, the run list, and the pending-ask card. Emitted
 * INSIDE the state-change transaction, exactly like every other domain's
 * entity hint — so a started run visibly progresses and its terminal status
 * and ask cards appear promptly.
 */
export async function emitRunHint(
  tx: TransactionSql | Sql,
  organizationId: string,
  runId: string,
): Promise<void> {
  await emitHintInTx(tx, {
    orgId: organizationId,
    entity: 'automation_run',
    entityId: runId,
  });
}

/**
 * Free the run's sandbox sessions — the per-execution AGENT sessions a run's
 * agent/script nodes hold. Called on EVERY terminal door (finish AND cancel),
 * so a run that ends any way releases the org slot capacity it held instead of
 * leaving agents working until a late settle or the turn deadline. Pinned
 * sessions are left alone (a human is using them).
 */
async function stopRunSandboxSessions(
  tx: TransactionSql | Sql,
  organizationId: string,
  runId: string,
): Promise<void> {
  await stopWorkflowSessionSlotsInTx(tx, {
    organizationId,
    executionId: runId,
  });
}

/**
 * Close the run's open connector-operation approvals — the cards the gate
 * minted for its live writes (`metadata.runId` names the run). Once the run
 * is terminal nothing consumes them: a decision only pokes a WAITING run, so
 * an approval given afterwards parked the row at `executing` forever and a
 * pending one kept an actionable card in the inbox for a write that will
 * never happen. Withdrawn the way the review lane withdraws a request nobody
 * can answer any more (`rejected` + `withdrawn`), never deleted — the ledger
 * keeps every row it minted. Called on every terminal door.
 */
async function closeRunApprovals(
  tx: TransactionSql | Sql,
  organizationId: string,
  runId: string,
): Promise<number> {
  const closed = await tx<{ id: string }[]>`
    UPDATE app.approvals SET
      status = 'rejected', reviewed_at_ms = ${Date.now()},
      metadata = coalesce(metadata, '{}'::jsonb)
        || ${tx.json(toJson({ withdrawn: true, withdrawnBy: 'run_terminal' }))}
    WHERE org_id = ${organizationId}
      AND resource_type = 'connector_operation'
      AND status IN ('pending', 'executing')
      AND metadata->>'runId' = ${runId}
    RETURNING id
  `;
  for (const approval of closed) {
    await emitHintInTx(tx, {
      orgId: organizationId,
      entity: 'approval',
      entityId: approval.id,
    });
  }
  return closed.length;
}

/**
 * A run that ends ANY way — cancel, finish, fail — leaves no question
 * soliciting an answer: its pending asks close as `cancelled` and every
 * recipient's unread `agent_escalation` bell is marked read (the same
 * dismissal the answer and the host's `closeAsk` perform). Without this a
 * cancel during an ask park left the ask `pending` forever — still
 * answerable, enqueueing a resume for a dead run — with its bells unread:
 * an ask park ends its exec on purpose, so no drive window re-enters to
 * reach `closeAsk`, the poll chain exits on the terminal status, and no
 * sweep exists. Called on every terminal door, like the session stop.
 */
async function closePendingAsksForRun(
  tx: TransactionSql,
  organizationId: string,
  runId: string,
  /** Why the run ended, for the retraction on the task timeline. */
  reason: string,
): Promise<number> {
  const closed = await tx<{ id: string; taskId: string | null }[]>`
    UPDATE app.automation_human_asks SET status = 'cancelled'
    WHERE run_id = ${runId} AND org_id = ${organizationId}
      AND status = 'pending'
    RETURNING id, task_id AS "taskId"
  `;
  for (const ask of closed) {
    await dismissAgentQuestionNotifications(tx, {
      organizationId,
      askId: ask.id,
    });
    if (typeof ask.taskId === 'string') {
      await retractAskOnTask(tx, {
        organizationId,
        taskId: ask.taskId,
        reason,
      });
    }
  }
  return closed.length;
}

export async function getRun(
  sql: Sql | TransactionSql,
  organizationId: string,
  runId: string,
): Promise<RunRow | null> {
  return runRow(sql, organizationId, runId);
}

/**
 * One run as a LISTING reports it — identity, scope, status and timing,
 * never the input, output, trace or checkpoints (a window of ten runs with
 * large inputs weighed megabytes). The one shape the REST run listings and
 * the MCP `list_runs` tool share; the full row is the single read's.
 */
export function toRunSummary(
  row: Pick<
    RunRow,
    | 'id'
    | 'name'
    | 'version'
    | 'projectId'
    | 'status'
    | 'mode'
    | 'startedBy'
    | 'input'
    | 'detail'
    | 'failureCode'
    | 'startedAt'
    | 'finishedAt'
    | 'askPending'
    | 'resumeCount'
    | 'lastResumeReason'
    | 'lastResumedAt'
    | 'stalled'
  > &
    Partial<Pick<RunRow, 'legacyQuarantine' | 'claimEpoch'>>,
): RunSummary {
  const waitingFor = runWaitingFor(row);
  const startedVia = runStartedVia(row);
  const lastResume = runLastResume(row);
  return {
    // One value under both names: the listing rows said `runId` and the
    // single read `id`, so a client mapping rows by `id` read undefined.
    id: row.id,
    runId: row.id,
    name: row.name,
    version: row.version,
    // The scope a REST read of the same run needs: a project run answers
    // only at `/api/v1/projects/{projectId}/runs/{runId}`, and MCP used to
    // hand out run handles without saying which project they belong to.
    projectId: row.projectId,
    status: row.status,
    ...legacyRunReadFields(row),
    mode: row.mode,
    startedBy: row.startedBy,
    ...(startedVia !== undefined ? { startedVia } : {}),
    ...(row.detail !== null ? { detail: row.detail } : {}),
    ...(row.failureCode !== null ? { failureCode: row.failureCode } : {}),
    ...(waitingFor !== undefined ? { waitingFor } : {}),
    // Present only once something happened: a run that was never handed on
    // reads exactly as it did before these fields existed.
    ...(row.resumeCount > 0 ? { resumeCount: row.resumeCount } : {}),
    ...(lastResume !== undefined ? { lastResume } : {}),
    ...(row.stalled ? { stalled: true } : {}),
    startedAt: row.startedAt,
    ...(row.finishedAt !== null ? { finishedAt: row.finishedAt } : {}),
  };
}

/** Why and when the run was last handed to another server — both stamps
 * or nothing. */
export function runLastResume(
  row: Pick<RunRow, 'lastResumeReason' | 'lastResumedAt'>,
): RunLastResume | undefined {
  const { lastResumeReason: reason, lastResumedAt: at } = row;
  if (reason !== 'shutdown' && reason !== 'lease_expired') return undefined;
  if (typeof at !== 'number') return undefined;
  return { reason, at };
}

/** The run row stores `input` as a JSON-encoded string (the stepper's
 * contract); the engine-facing detail hands back the decoded value. */
export function decodeRunInput(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

/**
 * Which KIND of trigger started a run — derived from the run's input, where
 * every trigger door writes `{trigger: 'schedule' | 'webhook' | 'event'}`
 * beside its payload. `startedBy` names only the binding's id, and a binding
 * keeps its id when its kind changes, so mapping the id through the current
 * trigger row would misreport old runs; the input is the record of what
 * fired. Present only on trigger-started runs whose input names a kind.
 */
export function runStartedVia(
  row: Pick<RunRow, 'startedBy' | 'input'>,
): RunSummary['startedVia'] {
  // A row without a starter is a fixture, never a stored run (the column is
  // NOT NULL) — answer nothing rather than throw on it.
  if (typeof row.startedBy !== 'string') return undefined;
  if (parseRunStarter(row.startedBy).kind !== 'trigger') return undefined;
  const input = decodeRunInput(row.input);
  if (input === null || typeof input !== 'object') return undefined;
  const kind = (input as { trigger?: unknown }).trigger;
  return kind === 'schedule' || kind === 'webhook' || kind === 'event'
    ? kind
    : undefined;
}

/**
 * What a `waiting` run is parked on, read off the park's `detail` — the
 * stepper writes `approval:<approvalId>`, `agent:<nodeId>`, `room:<nodeId>`
 * (an agent turn whose start waits for sandbox room), `repeat:<nodeId>` and
 * `in_doubt:<nodeId>` (a write that may already have happened when the run
 * was interrupted, waiting for a person) — with the one distinction the
 * detail cannot carry: an agent park whose question is pending is an `ask`,
 * waiting on a person, where the same park without one is an agent turn
 * still running. A client used to have to filter on the undocumented prefix
 * to tell "needs a human" from "polling"; `status=waiting` alone filled an
 * alert with healthy runs.
 */
export function runWaitingFor(
  row: Pick<RunRow, 'status' | 'detail' | 'askPending'>,
): RunSummary['waitingFor'] {
  if (row.status !== 'waiting' || row.detail === null) return undefined;
  if (row.detail.startsWith('approval:')) return 'approval';
  if (row.detail.startsWith('repeat:')) return 'repeat';
  if (row.detail.startsWith('agent:')) return row.askPending ? 'ask' : 'agent';
  if (row.detail.startsWith('room:')) return 'room';
  if (row.detail.startsWith('in_doubt:')) return 'in_doubt';
  return undefined;
}

/** The full row as the single read answers it: every column, `waitingFor`
 * beside `detail` while the run is parked, `startedVia` on a trigger's run,
 * `lastResume` once it was handed on, and never the raw ask fact or the raw
 * resume stamps. */
export function toRunDetail(row: RunRow): Omit<
  RunRow,
  | 'askPending'
  | 'lastResumeReason'
  | 'lastResumedAt'
  | 'legacyQuarantine'
  | 'replayOfRunId'
  | 'replayKind'
  | 'replayFromNode'
> & {
  legacyQuarantine?: LegacyRunQuarantine;
  waitingFor?: RunSummary['waitingFor'];
  startedVia?: RunSummary['startedVia'];
  lastResume?: RunLastResume;
  replayOf?: RunReplayOf;
} {
  const {
    askPending: _askPending,
    legacyQuarantine: _legacyQuarantine,
    lastResumeReason: _lastResumeReason,
    lastResumedAt: _lastResumedAt,
    replayOfRunId: _replayOfRunId,
    replayKind: _replayKind,
    replayFromNode: _replayFromNode,
    ...rest
  } = row;
  const waitingFor = runWaitingFor(row);
  const startedVia = runStartedVia(row);
  const lastResume = runLastResume(row);
  const replayOf = runReplayOf(row);
  return {
    ...rest,
    ...legacyRunReadFields(row),
    ...(startedVia !== undefined ? { startedVia } : {}),
    ...(waitingFor !== undefined ? { waitingFor } : {}),
    ...(lastResume !== undefined ? { lastResume } : {}),
    ...(replayOf !== undefined ? { replayOf } : {}),
  };
}

function legacyRunReadFields(row: {
  legacyQuarantine?: unknown;
  claimEpoch?: number;
}): {
  legacyQuarantine?: LegacyRunQuarantine;
} {
  const hold = describeLegacyQuarantine(
    row.legacyQuarantine,
    row.claimEpoch ?? Number.NaN,
  );
  return hold === undefined ? {} : { legacyQuarantine: hold };
}

export interface ListRunsOptions {
  name?: string;
  /** Undefined preserves the internal cross-project listing; null is org-only. */
  projectId?: string | null;
  /** An actor's readable projects; org runs remain visible. */
  visibleProjectIds?: string[];
  /** Only runs in these statuses (any of them). */
  statuses?: string[];
  /** Only live runs, or only mock runs. */
  mode?: 'mock' | 'live';
  /** Keyset position: only runs strictly older than this `(startedAt, id)`
   * pair — the previous page's last row. */
  before?: { at: number; id: string };
}

/** Newest first, ordered on `(started_at_ms DESC, id DESC)` — the total
 * order the keyset cursor walks. */
async function runRows(
  sql: Sql,
  organizationId: string,
  options: ListRunsOptions,
  limit: number,
): Promise<RunRow[]> {
  return sql<RunRow[]>`
    SELECT ${sql.unsafe(RUN_COLUMNS)} FROM app.automation_runs
    WHERE org_id = ${organizationId}
      AND (${options.name ?? null}::text IS NULL
           OR name = ${options.name ?? null})
      AND (${options.projectId === undefined}
           OR project_id IS NOT DISTINCT FROM ${options.projectId ?? null}::text)
      AND (${options.visibleProjectIds === undefined}
           OR project_id IS NULL
           OR project_id = ANY(${options.visibleProjectIds ?? []}::text[]))
      AND (${options.statuses === undefined}
           OR status = ANY(${options.statuses ?? []}::text[]))
      AND (${options.mode ?? null}::text IS NULL
           OR mode = ${options.mode ?? null})
      AND (${options.before === undefined}
           OR (started_at_ms, id)
              < (${options.before?.at ?? 0}::bigint, ${options.before?.id ?? ''}::text))
    ORDER BY started_at_ms DESC, id DESC
    LIMIT ${limit}
  `;
}

export async function listRuns(
  sql: Sql,
  organizationId: string,
  options: ListRunsOptions & { limit?: number } = {},
): Promise<RunRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  return runRows(sql, organizationId, options, limit);
}

/**
 * One page of a run listing: `limit` rows newest first, plus whether older
 * ones exist and where they start — the `(startedAt, id)` of the last row,
 * which the door signs into the `continueCursor` it answers. Reads one row
 * past the page so `isDone` is a fact, never a guess from a full page.
 */
export async function listRunsPage(
  sql: Sql,
  organizationId: string,
  options: ListRunsOptions & { limit: number },
): Promise<{
  runs: RunRow[];
  isDone: boolean;
  next: { at: number; id: string } | null;
}> {
  const limit = Math.max(options.limit, 1);
  const rows = await runRows(sql, organizationId, options, limit + 1);
  const runs = rows.slice(0, limit);
  const last = runs.at(-1);
  const isDone = rows.length <= limit;
  return {
    runs,
    isDone,
    next:
      isDone || last === undefined ? null : { at: last.startedAt, id: last.id },
  };
}

/** Enqueue the stepper turn for a run, optionally delayed. */
async function enqueueStep(
  tx: TransactionSql,
  organizationId: string,
  runId: string,
  delayMs: number,
): Promise<void> {
  await addJobInTx(
    tx,
    'automation.step',
    { organizationId, runId },
    delayMs > 0 ? { startAfter: new Date(Date.now() + delayMs) } : {},
  );
}

async function enqueuePoll(
  tx: TransactionSql,
  args: { organizationId: string; runId: string; seq: number; pollMs: number },
): Promise<void> {
  await addJobInTx(tx, 'automation.poll', args, {
    startAfter: new Date(Date.now() + args.pollMs),
  });
}

export interface BeginRunArgs {
  organizationId: string;
  name: string;
  input: unknown;
  mode: 'mock' | 'live';
  startedBy: string;
  /** The API key that authenticated a keyed start (an `api-key:<userId>`
   * starter) — the run's spend is booked to it beside the starter's own
   * usage, so the key's budget caps see it. Absent for every other door. */
  apiKeyId?: string;
  version?: number;
  projectId?: string;
  /** Machine org routes must never infer a project from installation bindings. */
  requireOrgScope?: boolean;
  /** A token authorizes installed projects, not arbitrary same-org projects. */
  requireProjectBinding?: boolean;
  /** The app member's readable projects. Check the resolved binding inside
   * admission too: omitting projectId must not infer a hidden project, nor
   * start an organization run able to operate in hidden bound projects. */
  visibleProjectIds?: string[];
  /** A replay: the run it runs again and how. A replay from a step is born
   * with the steps it takes from that run already finished — each entry
   * marked `reused` — and runs the rest. */
  replay?: {
    of: string;
    kind: RunReplayKind;
    fromNode?: string;
    reused?: Record<string, NodeCheckpoint>;
  };
}

/** The same project admission for durable and in-process run artifacts.
 * Trusted trigger callers may infer their sole installation; machine callers
 * require org scope or supply the project they already authorized. */
export async function resolveRunProject(
  sql: Sql | TransactionSql,
  args: Pick<
    BeginRunArgs,
    | 'organizationId'
    | 'name'
    | 'projectId'
    | 'requireOrgScope'
    | 'requireProjectBinding'
    | 'visibleProjectIds'
  >,
): Promise<string | null> {
  const bindings = await bindingProjectIds(sql, args.organizationId, args.name);
  if (args.visibleProjectIds !== undefined) {
    const visible = new Set(args.visibleProjectIds);
    const selected = args.projectId === undefined ? bindings : [args.projectId];
    if (selected.some((id) => !visible.has(id))) {
      throw new AutomationError('PROJECT_NOT_FOUND', 'Project not found.', 404);
    }
  }
  if (
    args.requireOrgScope === true &&
    (args.projectId !== undefined || bindings.length > 0)
  ) {
    throw new AutomationError(
      'AUTOMATION_PROJECT_SCOPE_REQUIRED',
      'A project-bound automation requires an explicit project scope.',
      409,
    );
  }
  const inferred = bindings.length === 1 ? bindings[0] : undefined;
  // A person's app start holds an inferred sole binding to the same checks
  // as a named project. A schedule keeps its inferred scope unchecked
  // (whether it may start in an archived project is undecided); an event
  // dispatch names the project it starts in, so it meets these checks, in
  // a savepoint of its own per trigger.
  const projectId =
    args.projectId ??
    (args.visibleProjectIds !== undefined ? inferred : undefined);
  if (projectId !== undefined) {
    const owned = await sql<{ id: string; archivedAt: number | null }[]>`
      SELECT id, archived_at_ms::float8 AS "archivedAt" FROM app.projects
      WHERE org_id = ${args.organizationId} AND id = ${projectId}
      LIMIT 1
    `;
    const project = owned[0];
    if (project === undefined) {
      throw new AutomationError(
        'AUTOMATION_PROJECT_UNKNOWN',
        'The project does not exist in this organization.',
        404,
      );
    }
    // A run scoped to an archived project is a write on it — the MCP and
    // REST doors refuse it before reaching here; the app's start (and any
    // other caller naming a project) answers the same code.
    if ((project.archivedAt ?? null) !== null) {
      throw new AutomationError(
        'PROJECT_ARCHIVED',
        'The project is archived — restore it before starting a run in it.',
        403,
      );
    }
    if (
      (args.requireProjectBinding === true || bindings.length > 0) &&
      !bindings.includes(projectId)
    ) {
      // Static, like every refusal a task door relays: the name is what the
      // caller sent (a task start's `workflowSlug`) or what a run carries,
      // and the sentence travels to the app, REST and a workflow's trace.
      throw new AutomationError(
        'AUTOMATION_PROJECT_FORBIDDEN',
        AUTOMATION_NOT_BOUND_SENTENCE,
        403,
      );
    }
  }
  return projectId ?? inferred ?? null;
}

export async function beginRun(
  sql: Sql,
  args: BeginRunArgs,
): Promise<{ runId: string; version: number } | null> {
  return sql.begin((tx) => beginRunInTx(tx, args));
}

/** The run insert + first-step enqueue INSIDE a caller's transaction — how
 * an event emitted by a producing write starts runs atomically with it. */
export async function beginRunInTx(
  tx: TransactionSql,
  args: BeginRunArgs,
): Promise<{ runId: string; version: number } | null> {
  await markAutomationWriterInTx(tx);
  {
    const deployed =
      args.mode === 'live' || args.version === undefined
        ? await deployedVersion(tx, args.organizationId, args.name)
        : undefined;
    if (
      args.mode === 'live' &&
      args.version !== undefined &&
      args.version !== deployed
    ) {
      throw new AutomationError(
        'AUTOMATION_VERSION_NOT_DEPLOYED',
        'Live runs must use the deployed version. Deploy this version or use mock mode.',
        409,
      );
    }
    const version = args.version ?? deployed;
    if (version === undefined) return null;
    const row = await versionRow(tx, args.organizationId, args.name, version);
    if (!row) return null;
    if (isRecord(row.document) && isRecord(row.document.inputs)) {
      // A saved version is immutable, so its compiled schema is cached by
      // identity — `createdAt` included, because a deleted and recreated
      // automation counts its versions from 1 again.
      const check = compileSchemaCached(
        `${args.organizationId}/${args.name}@${version}:${row.createdAt}`,
        row.document.inputs,
      );
      if (!check(args.input)) {
        // The refusal names what is wrong, the way a refused request body
        // does: every problem under `data.issues`, the first in the sentence.
        const issues = describeSchemaErrors(check.errors);
        const first = issues[0];
        const named =
          first === undefined
            ? ''
            : first.path === ''
              ? `: ${first.message}`
              : `: "${first.path}" ${first.message}`;
        throw new AutomationError(
          'AUTOMATION_INPUT_INVALID',
          `Run input does not match the automation inputs schema${named}`,
          400,
          // The version that refused it: a trigger's skip notice names it.
          { issues, version },
        );
      }
    }
    const projectId = await resolveRunProject(tx, args);
    const now = Date.now();
    // The record begins with what the run was given.
    const start = startNodeRun(args.input, now);
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO app.automation_runs (
        org_id, name, version, project_id, status, mode, started_by,
        api_key_id, input, checkpoints, wake_at_ms, claim_epoch, started_at_ms,
        record_bytes, replay_of_run_id, replay_kind, replay_from_node,
        replay_lineage_started_by
      ) VALUES (
        ${args.organizationId}, ${args.name}, ${version},
        ${projectId}, 'queued', ${args.mode}, ${args.startedBy},
        ${args.apiKeyId ?? null},
        ${tx.json(toJson(JSON.stringify(args.input)))},
        ${tx.json(toJson({ nodes: args.replay?.reused ?? {}, executions: 0 }))},
        ${now + RUN_CLAIM_PROMISE_MS}, 0, ${now}, ${start.bytes},
        ${args.replay?.of ?? null}, ${args.replay?.kind ?? null},
        ${args.replay?.fromNode ?? null},
        -- Whose runs this one carries (0192): its source's starter and the
        -- starters the source carried in turn, so an erasure of any of them
        -- finds it after the source itself is gone.
        (SELECT array_append(
                  coalesce(s.replay_lineage_started_by, '{}'::text[]),
                  s.started_by)
           FROM app.automation_runs s
          WHERE s.id = ${args.replay?.of ?? null}
            AND s.org_id = ${args.organizationId})
      )
      RETURNING id
    `;
    // Born with the claim promise, not overdue: the step job below is its
    // continuation, and an overdue row would also be re-poked by the sweep.
    const runId = inserted[0]?.id;
    if (!runId) throw new Error('run insert failed');
    await writeNodeRunsInTx(tx, {
      organizationId: args.organizationId,
      runId,
      epoch: 0,
      rows: [start],
    });
    await enqueueStep(tx, args.organizationId, runId, 0);
    await emitRunHint(tx, args.organizationId, runId);
    return { runId, version };
  }
}

/**
 * The transactional body of {@link cancelRun} — for callers already INSIDE a
 * transaction (the task cancel door flips the task's status in the same
 * serializable tx, so a refused flip rolls the run cancel back with it). A
 * transaction-scoped postgres.js handle carries no `begin` at runtime (only
 * the root instance does), so passing a tx into the wrapper below would
 * throw — this is the seam those callers use.
 */
export async function cancelRunInTx(
  tx: TransactionSql,
  organizationId: string,
  runId: string,
  /** The user who asked for the stop — the audit row names them. Absent
   * only on a system-driven stop (a retired task's live run), which the
   * row attributes to the run's starter as `system`. */
  actor?: string,
): Promise<{ cancelled: boolean; status?: string }> {
  await markAutomationWriterInTx(tx);
  {
    const now = Date.now();
    const rows = await tx<
      { name: string; version: number; mode: string; startedBy: string }[]
    >`
      UPDATE app.automation_runs SET
        status = 'cancelled', finished_at_ms = ${now}, wake_at_ms = NULL,
        -- The park string (repeat:poll, approval:<id>) described a wait the
        -- run is no longer in; detail is documented as "the failure or wait
        -- reason; null while the run has none" (2026-09-14 eval, g5-8).
        detail = NULL,
        lease_owner = NULL, lease_expires_at_ms = NULL
      WHERE id = ${runId} AND org_id = ${organizationId}
        AND status IN ('queued', 'running', 'waiting')
      RETURNING name, version, mode, started_by AS "startedBy"
    `;
    const row = rows[0];
    if (!row) {
      // Nothing live to stop: name the terminal state that made this a
      // no-op, so a client needs no second read to learn whether the run
      // finished on its own, was already cancelled, or is not there.
      const current = await runRow(tx, organizationId, runId);
      if (current?.status === 'quarantined') {
        throw new AutomationError(
          'RUN_QUARANTINED',
          'This run is on hold with unknown external effects; use the explicit stop request.',
          409,
        );
      }
      return current === null
        ? { cancelled: false }
        : { cancelled: false, status: current.status };
    }
    // cancelRun is a TERMINAL door — it honors the same contract finishRun
    // does: the provenance audit row (live runs) that must never be missing,
    // and freeing the run's sandbox sessions so cancelled agents stop holding
    // org slot capacity until a late settle or the turn deadline.
    const approvalsWithdrawn = await closeRunApprovals(
      tx,
      organizationId,
      runId,
    );
    if (row.mode === 'live') {
      // The person who stopped the run is the actor; the starter is not
      // (they may be someone else entirely). A stop nobody asked for — a
      // retired task taking its live run with it — stays `system`.
      await createAuditLog(tx, {
        organizationId,
        ...(actor === undefined
          ? { actorId: row.startedBy, actorType: 'system' }
          : { actorId: actor, actorType: 'user' }),
        action: 'automation.run.cancelled',
        category: 'ai',
        resourceType: 'automation_run',
        resourceId: runId,
        resourceName: `${row.name}@${row.version}`,
        status: 'failure',
        metadata: { approvalsWithdrawn },
      });
    }
    await stopRunSandboxSessions(tx, organizationId, runId);
    await closePendingAsksForRun(
      tx,
      organizationId,
      runId,
      'The run was cancelled',
    );
    await emitRunHint(tx, organizationId, runId);
    return { cancelled: true, status: 'cancelled' };
  }
}

export async function cancelRun(
  sql: Sql,
  organizationId: string,
  runId: string,
  actor?: string,
): Promise<{ cancelled: boolean; status?: string }> {
  return sql.begin((tx) => cancelRunInTx(tx, organizationId, runId, actor));
}

/** Records an explicit stop request without asserting termination, clearing
 * the hold, changing task state, or rewriting historical asks/checkpoints. */
export async function requestLegacyRunStopInTx(
  tx: TransactionSql,
  args: {
    organizationId: string;
    runId: string;
    actor: string;
    request: unknown;
  },
): Promise<{
  requested: true;
  status: 'quarantined';
  legacyQuarantine: LegacyRunQuarantine;
}> {
  const request = legacyRunStopSchema.parse(args.request);
  await markAutomationWriterInTx(tx);
  const [row] = await tx<
    { status: string; claimEpoch: number; hold: unknown }[]
  >`
    SELECT status, claim_epoch AS "claimEpoch", legacy_quarantine AS hold
    FROM app.automation_runs WHERE org_id = ${args.organizationId} AND id = ${args.runId}
    FOR UPDATE
  `;
  const hold =
    row === undefined
      ? undefined
      : describeLegacyQuarantine(row.hold, row.claimEpoch);
  if (
    row?.status !== 'quarantined' ||
    hold === undefined ||
    hold.claimEpoch !== request.expectedClaimEpoch ||
    hold.observedAt !== request.expectedObservedAt
  ) {
    throw new AutomationError(
      'RUN_QUARANTINE_CHANGED',
      'The held run changed; read it again before requesting a stop.',
      409,
    );
  }
  // An identical retry answers the already recorded decision; it never
  // substitutes another actor or emits duplicate cleanup/audit work.
  if (hold.resolution !== null)
    return { requested: true, status: 'quarantined', legacyQuarantine: hold };
  const decision = {
    action: 'stop' as const,
    actor: args.actor,
    at: Date.now(),
  };
  await tx`SELECT set_config('tale.automation_legacy_stop_run', ${args.runId}, true)`;
  await tx`UPDATE app.automation_runs SET legacy_quarantine =
    jsonb_set(legacy_quarantine, '{resolution}', ${tx.json(toJson(decision))}::jsonb)
    WHERE org_id = ${args.organizationId} AND id = ${args.runId}`;
  // Reuse owned session cancellation. It is a request, not evidence that a
  // sandbox or an already-sent external operation has actually terminated.
  await stopRunSandboxSessions(tx, args.organizationId, args.runId);
  await createAuditLog(tx, {
    organizationId: args.organizationId,
    actorId: args.actor,
    actorType: 'user',
    action: 'automation.run.legacy_stop_requested',
    category: 'ai',
    resourceType: 'automation_run',
    resourceId: args.runId,
    status: 'success',
    metadata: {
      expectedClaimEpoch: hold.claimEpoch,
      observedAt: hold.observedAt,
      unknownExternalEffectsAcknowledged: true,
    },
  });
  await recordRunEventInTx(tx, {
    organizationId: args.organizationId,
    runId: args.runId,
    kind: 'legacy_stop_requested',
    detail: { actor: args.actor, at: decision.at },
  });
  await emitRunHint(tx, args.organizationId, args.runId);
  return {
    requested: true,
    status: 'quarantined',
    legacyQuarantine: { ...hold, resolution: decision },
  };
}

// ---------------------------------------------------- idempotent starts

/** How long a start's `Idempotency-Key` is remembered — the day the webhook
 * door keeps an explicit delivery id, one constant for both doors. */
export const RUN_IDEMPOTENCY_WINDOW_MS = HEADER_LANE_WINDOW_MS;

export interface IdempotentStart {
  runId: string;
  version: number;
  /** True when the key had already started this run: nothing new ran. */
  duplicate: boolean;
}

/**
 * {@link beginRunInTx} behind an `Idempotency-Key`: claim the key's ledger
 * row and start the run in ONE transaction (the webhook door's claim idiom
 * over `app.automation_run_idempotency`). The claim goes first, so a
 * concurrent repeat blocks on the row lock until this commit and then reads
 * the run started here; a repeat inside the key's window answers with that
 * run (`duplicate: true`); a repeat that carries a DIFFERENT request under
 * the same key is refused (409 `IDEMPOTENCY_KEY_REUSED`); an expired key is
 * taken over and starts again as the new request it is. A refusal thrown
 * from the start rolls the claim back with it, and a start that finds no
 * deployed version forgets its claim before answering null — a 4xx is never
 * remembered.
 */
export async function beginRunIdempotentInTx(
  tx: TransactionSql,
  args: BeginRunArgs,
  idempotency: { key: string },
): Promise<IdempotentStart | null> {
  const scopeKey = await runIdempotencyScopeKey({
    projectId: args.projectId,
    name: args.name,
    key: idempotency.key,
  });
  const requestHash = await runIdempotencyRequestHash({
    input: args.input,
    mode: args.mode,
  });
  const now = Date.now();
  const claimed = await tx<{ scopeKey: string }[]>`
    INSERT INTO app.automation_run_idempotency AS i (
      org_id, scope_key, request_hash, run_id, received_at_ms, expires_at_ms
    ) VALUES (
      ${args.organizationId}, ${scopeKey}, ${requestHash}, NULL,
      ${now}, ${now + RUN_IDEMPOTENCY_WINDOW_MS}
    )
    ON CONFLICT (org_id, scope_key) DO UPDATE SET
      request_hash = EXCLUDED.request_hash,
      run_id = NULL,
      received_at_ms = EXCLUDED.received_at_ms,
      expires_at_ms = EXCLUDED.expires_at_ms
    WHERE i.expires_at_ms <= EXCLUDED.received_at_ms
    RETURNING scope_key AS "scopeKey"
  `;
  if (claimed.length === 0) {
    // A live key: the first attempt's run is the answer — for the same
    // request. The row is committed (the claim and the run commit
    // together), so a missing run id is a ledger writer's bug, named.
    const remembered = await tx<
      { requestHash: string; runId: string | null }[]
    >`
      SELECT request_hash AS "requestHash", run_id AS "runId"
      FROM app.automation_run_idempotency
      WHERE org_id = ${args.organizationId} AND scope_key = ${scopeKey}
    `;
    const row = remembered[0];
    if (row === undefined || row.runId === null) {
      throw new Error(
        `run idempotency ledger row ${scopeKey} in ${args.organizationId} carries no run`,
      );
    }
    if (row.requestHash !== requestHash) {
      throw new AutomationError(
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used for a different request — send a new key, or repeat the original request unchanged.',
        409,
      );
    }
    const run = await runRow(tx, args.organizationId, row.runId);
    if (run === null) {
      // Deleting a run forgets its keys, so a committed row always names a
      // run that exists; a later ledger writer must not hide behind this.
      throw new Error(
        `run idempotency ledger row ${scopeKey} in ${args.organizationId} names a run that is gone`,
      );
    }
    // The version is judged against the run, not hashed: a door that
    // resolves "the deployed version" to its number and a caller who left it
    // out asked for the same start. Only a pin the run does not satisfy is
    // another request.
    if (args.version !== undefined && run.version !== args.version) {
      throw new AutomationError(
        'IDEMPOTENCY_KEY_REUSED',
        `This Idempotency-Key already started version ${run.version} — send a new key, or repeat the original request unchanged.`,
        409,
      );
    }
    return { runId: run.id, version: run.version, duplicate: true };
  }
  const started = await beginRunInTx(tx, args);
  if (started === null) {
    // Nothing deployed: forget the claim, so the same key runs once a
    // deployment exists — the caller's 409 is not an answer to remember.
    await tx`
      DELETE FROM app.automation_run_idempotency
      WHERE org_id = ${args.organizationId} AND scope_key = ${scopeKey}
    `;
    return null;
  }
  await tx`
    UPDATE app.automation_run_idempotency SET run_id = ${started.runId}
    WHERE org_id = ${args.organizationId} AND scope_key = ${scopeKey}
  `;
  // Lazy housekeeping on the accepted path: the organization's expired keys
  // go with the start that outlived them (no sweeper job).
  await tx`
    DELETE FROM app.automation_run_idempotency
    WHERE org_id = ${args.organizationId} AND expires_at_ms <= ${now}
  `;
  return { ...started, duplicate: false };
}

export async function beginRunIdempotent(
  sql: Sql,
  args: BeginRunArgs,
  idempotency: { key: string },
): Promise<IdempotentStart | null> {
  return sql.begin((tx) => beginRunIdempotentInTx(tx, args, idempotency));
}

// -------------------------------------------------------------- run delete

const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set([
  'success',
  'failed',
  'cancelled',
]);

/**
 * Remove one FINISHED run — its row, the questions it asked (cascade), the
 * webhook delivery and idempotency ledger entries that would otherwise
 * answer a redelivery with a run that no longer exists — and audit the
 * removal. A run still in flight is refused (409 `RUN_ACTIVE`): cancel it
 * first, so the stepper never loses the row under its feet. `deleted` is
 * false when there was no such run in the organization.
 */
export async function deleteRunInTx(
  tx: TransactionSql,
  args: { organizationId: string; runId: string; actor: string },
): Promise<{ deleted: boolean }> {
  await markAutomationWriterInTx(tx);
  const rows = await tx<
    { name: string; version: number; mode: string; status: string }[]
  >`
    SELECT name, version, mode, status FROM app.automation_runs
    WHERE id = ${args.runId} AND org_id = ${args.organizationId}
    FOR UPDATE
  `;
  const row = rows[0];
  if (row === undefined) return { deleted: false };
  if (row.status === 'quarantined') {
    throw new AutomationError(
      'RUN_QUARANTINED',
      'The run is on hold because its external outcome is unknown. A stop request does not authorize deletion.',
      409,
    );
  }
  if (!TERMINAL_RUN_STATUSES.has(row.status)) {
    throw new AutomationError(
      'RUN_ACTIVE',
      `The run is still ${row.status} — cancel it (or let it finish) before deleting it.`,
      409,
    );
  }
  // The delete clears the run from the trigger that names it (`last_run_id`
  // and `last_failed_run_id` are `ON DELETE SET NULL`), a write of that
  // trigger row after the run's own row — the order a landing run takes
  // them in (`trigger-failures.ts`).
  await tx`
    DELETE FROM app.automation_webhook_deliveries WHERE run_id = ${args.runId}
  `;
  await tx`
    DELETE FROM app.automation_run_idempotency
    WHERE org_id = ${args.organizationId} AND run_id = ${args.runId}
  `;
  await tx`
    DELETE FROM app.automation_runs
    WHERE id = ${args.runId} AND org_id = ${args.organizationId}
  `;
  await createAuditLog(tx, {
    organizationId: args.organizationId,
    actorId: args.actor,
    actorType: 'user',
    action: 'automation.run.deleted',
    category: 'ai',
    resourceType: 'automation_run',
    resourceId: args.runId,
    resourceName: `${row.name}@${row.version}`,
    status: 'success',
    metadata: { mode: row.mode, runStatus: row.status },
  });
  await emitRunHint(tx, args.organizationId, args.runId);
  return { deleted: true };
}

// ----------------------------------------------- the stepper's run contract

/** The statuses a run can still move out of — the fence of every run-state
 * write. */
const LIVE_RUN_STATUSES: ReadonlySet<string> = new Set([
  'queued',
  'running',
  'waiting',
]);

/** What a claim reads off the locked run row before it decides. */
interface ClaimPrior {
  status: string;
  claimEpoch: number;
  leaseEpoch: number | null;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  wakeAt: number | null;
  claimedAt: number | null;
  engineProtocol: number;
  engineVersion: string | null;
}

type ClaimDecision =
  | { kind: 'claim'; tookOver: boolean }
  | { kind: 'terminal' }
  | { kind: 'leased' }
  | { kind: 'deferred' };

/**
 * Whether a step job may walk the run now. A queued or parked run is free. A
 * running run is free only once nobody steps it: its lease was released (a
 * hand-off) or lapsed (its walker died) — or, for a run an image without
 * leases claimed last (`lease_epoch` <> `claim_epoch`), once that image's
 * `wake_at_ms` promise lapsed, which its own heartbeat keeps renewing (the
 * sweep that finds it lapsed turns it into a lapsed lease first, so the
 * claim its poke queues takes the run over). A live
 * lease is refused whoever holds it, this process included: a worker runs
 * several walkers, so "it is mine" would let two of them step one run.
 */
function decideClaim(prior: ClaimPrior, now: number): ClaimDecision {
  if (!LIVE_RUN_STATUSES.has(prior.status)) return { kind: 'terminal' };
  const leased = prior.leaseEpoch === prior.claimEpoch;
  const free =
    prior.status !== 'running' ||
    (leased
      ? prior.leaseExpiresAt === null || prior.leaseExpiresAt <= now
      : prior.wakeAt === null || prior.wakeAt <= now);
  if (!free) return { kind: 'leased' };
  // A newer engine wrote progress this one may misread: never step it.
  if (prior.engineProtocol > ENGINE_PROTOCOL) return { kind: 'deferred' };
  return {
    kind: 'claim',
    tookOver:
      prior.status === 'running' && leased && prior.leaseExpiresAt !== null,
  };
}

/**
 * Claim a run for one walker: lock the row, decide, and take the lease in the
 * same transaction. Two concurrent claims serialize on the row lock — the
 * later one reads the first one's live lease and is refused (`leased`), so a
 * duplicate step job or a sweep re-poke never starts a second walker. A
 * claim that takes a running run whose lease lapsed counts as a takeover:
 * the run's resume count grows and the takeover is recorded. Every claim
 * bumps the epoch, so a walker that lost its run is refused at its next
 * write.
 */
export async function claimRun(
  sql: Sql,
  organizationId: string,
  runId: string,
): Promise<{ claimed: boolean; status: string; epoch: number }> {
  return sql.begin(async (tx) => {
    await markAutomationWriterInTx(tx);
    const now = Date.now();
    const rows = await tx<ClaimPrior[]>`
      SELECT status, claim_epoch AS "claimEpoch", lease_epoch AS "leaseEpoch",
             lease_owner AS "leaseOwner",
             lease_expires_at_ms::float8 AS "leaseExpiresAt",
             wake_at_ms::float8 AS "wakeAt",
             claimed_at_ms::float8 AS "claimedAt",
             engine_protocol AS "engineProtocol",
             engine_version AS "engineVersion"
      FROM app.automation_runs
      WHERE id = ${runId} AND org_id = ${organizationId}
      FOR UPDATE
    `;
    const prior = rows[0];
    if (!prior) return { claimed: false, status: 'missing', epoch: 0 };
    const decision = decideClaim(prior, now);
    if (decision.kind === 'terminal') {
      return { claimed: false, status: prior.status, epoch: prior.claimEpoch };
    }
    if (decision.kind === 'leased') {
      return { claimed: false, status: 'leased', epoch: prior.claimEpoch };
    }
    if (decision.kind === 'deferred') {
      await deferToNewerEngine(tx, { organizationId, runId, prior, now });
      return { claimed: false, status: 'deferred', epoch: prior.claimEpoch };
    }
    const { tookOver } = decision;
    // `lease_epoch` reads the OLD `claim_epoch`, like every right-hand side
    // of one SET: it lands equal to the new epoch.
    const claimed = await tx<{ claimEpoch: number }[]>`
      UPDATE app.automation_runs SET
        status = 'running',
        claim_epoch = claim_epoch + 1,
        lease_epoch = claim_epoch + 1,
        claimed_at_ms = ${now},
        lease_owner = ${instanceId()},
        lease_expires_at_ms = ${now + RUN_LEASE_MS},
        wake_at_ms = ${now + RUN_LEASE_MS},
        engine_protocol = GREATEST(engine_protocol, ${ENGINE_PROTOCOL}::int),
        engine_version = ${engineVersion()},
        resume_count = resume_count + ${tookOver ? 1 : 0}::int,
        last_resume_reason = CASE WHEN ${tookOver}::boolean
          THEN 'lease_expired' ELSE last_resume_reason END,
        last_resumed_at_ms = CASE WHEN ${tookOver}::boolean
          THEN ${now}::bigint ELSE last_resumed_at_ms END
      WHERE id = ${runId} AND org_id = ${organizationId}
      RETURNING claim_epoch AS "claimEpoch"
    `;
    const epoch = claimed[0]?.claimEpoch;
    if (epoch === undefined) throw new Error('run claim found no row');
    if (tookOver) {
      await recordRunEventInTx(tx, {
        organizationId,
        runId,
        kind: 'taken_over',
        detail: {
          previousOwner: prior.leaseOwner,
          previousEngine: prior.engineVersion,
        },
      });
    }
    await emitRunHint(tx, organizationId, runId);
    return { claimed: true, status: 'running', epoch };
  });
}

/**
 * A run a newer engine stepped is not this engine's to read. While a roll is
 * in progress — a newer engine claimed it recently — its step goes back to
 * the queue a few seconds out, for a worker of the newer release to take.
 * Past that window (a rollback after the newer release stepped it), it is
 * left to the sweep: one claim attempt per promise, never a hot loop.
 */
async function deferToNewerEngine(
  tx: TransactionSql,
  args: {
    organizationId: string;
    runId: string;
    prior: ClaimPrior;
    now: number;
  },
): Promise<void> {
  const { organizationId, runId, prior, now } = args;
  console.warn(
    `[automations] run ${runId} needs engine protocol ${prior.engineProtocol}; this engine is ${ENGINE_PROTOCOL} — deferred`,
  );
  await recordRunEventInTx(tx, {
    organizationId,
    runId,
    kind: 'engine_deferred',
    detail: {
      requiredProtocol: prior.engineProtocol,
      engineProtocol: ENGINE_PROTOCOL,
    },
    oncePerEngine: true,
  });
  if (
    prior.claimedAt === null ||
    prior.claimedAt < now - ENGINE_DEFER_WINDOW_MS
  ) {
    return;
  }
  await tx`
    UPDATE app.automation_runs SET
      wake_at_ms = ${now + ENGINE_DEFER_MS + RUN_CLAIM_PROMISE_MS}
    WHERE id = ${runId} AND org_id = ${organizationId}
  `;
  await enqueueStep(tx, organizationId, runId, ENGINE_DEFER_MS);
}

/**
 * Renew a live walker's lease (and the promise that mirrors it). Only the
 * lease of THIS claim: a walker that lost the run, or one that already
 * released its lease by parking or handing off, renews nothing — a late tick
 * must not bring a released lease back.
 */
export async function heartbeatRun(
  sql: Sql,
  organizationId: string,
  runId: string,
  epoch: number,
): Promise<{ alive: boolean }> {
  return sql.begin(async (tx) => {
    await markAutomationWriterInTx(tx);
    const now = Date.now();
    const rows = await tx<{ id: string }[]>`
    UPDATE app.automation_runs SET
      lease_expires_at_ms = ${now + RUN_LEASE_MS},
      wake_at_ms = ${now + RUN_LEASE_MS}
    WHERE id = ${runId} AND org_id = ${organizationId}
      AND status = 'running' AND claim_epoch = ${epoch}
      AND lease_epoch = ${epoch} AND lease_expires_at_ms IS NOT NULL
    RETURNING id
  `;
    return { alive: rows.length > 0 };
  });
}

/**
 * Why a fenced write changed nothing: the run is gone (`missing`), it ended
 * (its terminal status), or another walker holds a newer claim (`stale`).
 * Read only after a write matched no row — the fast path never reads.
 */
async function whyNotWritten(
  tx: TransactionSql,
  organizationId: string,
  runId: string,
  epoch: number,
): Promise<string> {
  const rows = await tx<{ status: string; claimEpoch: number }[]>`
    SELECT status, claim_epoch AS "claimEpoch" FROM app.automation_runs
    WHERE id = ${runId} AND org_id = ${organizationId}
  `;
  const row = rows[0];
  if (!row) return 'missing';
  if (!LIVE_RUN_STATUSES.has(row.status)) return row.status;
  if (row.claimEpoch !== epoch) return 'stale';
  return row.status;
}

interface CheckpointsShape {
  nodes: Record<string, unknown>;
  cursor?: unknown;
  executions: number;
}

function readCheckpoints(raw: unknown): CheckpointsShape {
  if (raw !== null && typeof raw === 'object' && 'nodes' in raw) {
    const record = raw as {
      nodes?: unknown;
      cursor?: unknown;
      executions?: unknown;
    };
    return {
      nodes:
        record.nodes !== null && typeof record.nodes === 'object'
          ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stepper owns this JSON shape
            (record.nodes as Record<string, unknown>)
          : {},
      ...(record.cursor !== undefined ? { cursor: record.cursor } : {}),
      executions: typeof record.executions === 'number' ? record.executions : 0,
    };
  }
  return { nodes: {}, executions: 0 };
}

/**
 * Bound a checkpoint's descriptive trace as it FIRST enters the row — never
 * the already-stored `nodes` it is merged into (the bound is not idempotent:
 * a second pass re-cuts its own marker and under-reports the loss). The
 * checkpoint's `output` and `effects` pass through whole: one is the
 * executor's scope for every later node, the other the side-effect audit
 * trail. Anything not shaped like a checkpoint is stored as it came.
 */
function boundIncomingCheckpoint(checkpoint: unknown): unknown {
  if (
    checkpoint === null ||
    typeof checkpoint !== 'object' ||
    Array.isArray(checkpoint) ||
    !('trace' in checkpoint) ||
    checkpoint.trace === null ||
    typeof checkpoint.trace !== 'object'
  ) {
    return checkpoint;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stepper owns this JSON shape; narrowed above
  return boundCheckpointTrace(checkpoint as NodeCheckpoint);
}

/**
 * Record a walker's progress: one node's checkpoint merged into the stored
 * `nodes` (server-side, so two commits of one claim never drop each other's
 * node), the forEach cursor replaced or dropped, and the lease renewed. ONE
 * statement fenced by the walker's epoch and a live status; top-level keys
 * this engine does not know survive the write.
 */
export async function recordProgress(
  sql: Sql,
  args: {
    organizationId: string;
    runId: string;
    epoch: number;
    nodeId?: string;
    checkpoint?: unknown;
    cursor?: unknown;
    executions: number;
    /** The run-record rows the walker changed since its last write: written
     * with this progress, in its transaction, once the fence matched. */
    nodeRuns?: NodeRunWrite[];
  },
): Promise<{ status: string }> {
  return sql.begin(async (tx) => {
    await markAutomationWriterInTx(tx);
    const now = Date.now();
    const nodeKey =
      args.nodeId !== undefined && args.checkpoint !== undefined
        ? args.nodeId
        : null;
    const checkpoint =
      nodeKey === null
        ? null
        : jsonParam(tx, boundIncomingCheckpoint(args.checkpoint));
    const cursor = jsonParam(tx, args.cursor);
    const rows = await tx<{ status: string }[]>`
      UPDATE app.automation_runs SET
        checkpoints =
          (CASE WHEN jsonb_typeof(checkpoints) = 'object'
                THEN checkpoints - 'cursor' ELSE '{}'::jsonb END)
          || jsonb_build_object(
               'nodes',
               (CASE WHEN jsonb_typeof(checkpoints -> 'nodes') = 'object'
                     THEN checkpoints -> 'nodes' ELSE '{}'::jsonb END)
               || (CASE WHEN ${nodeKey}::text IS NULL THEN '{}'::jsonb
                        ELSE jsonb_build_object(${nodeKey}::text, ${checkpoint}::jsonb)
                   END),
               'executions', ${args.executions}::int)
          || (CASE WHEN ${cursor}::jsonb IS NULL THEN '{}'::jsonb
                   ELSE jsonb_build_object('cursor', ${cursor}::jsonb) END),
        lease_expires_at_ms = CASE WHEN lease_expires_at_ms IS NULL THEN NULL
                                   ELSE ${now + RUN_LEASE_MS}::bigint END,
        wake_at_ms = ${now + RUN_LEASE_MS},
        record_bytes = record_bytes + ${nodeRunBytes(args.nodeRuns)}::int
      WHERE id = ${args.runId} AND org_id = ${args.organizationId}
        AND claim_epoch = ${args.epoch}
        AND status IN ('queued', 'running', 'waiting')
      RETURNING status
    `;
    const written = rows[0];
    if (!written) {
      return {
        status: await whyNotWritten(
          tx,
          args.organizationId,
          args.runId,
          args.epoch,
        ),
      };
    }
    await writeNodeRunsInTx(tx, { ...args, rows: args.nodeRuns ?? [] });
    await emitRunHint(tx, args.organizationId, args.runId);
    return { status: written.status };
  });
}

/**
 * Park a run: `waiting` with the park string, its cursor and a poll chain
 * that comes back after `resumeInMs`. The walker's lease is released — a
 * parked run has no walker — and the chain sequence moves on, so a poll of
 * an earlier park finds nothing to do. `event` records why the park happened
 * when the run's history should say more than its park string. A park on
 * something that happened while the walker was on its way here wakes the
 * run at once instead.
 *
 * The cursor an agent node parks with is the one its walker loaded, and the
 * stored one may have moved on since: the turn settled, or a person's answer
 * moved the turn to a new exec or a later deadline. The step job each of them
 * queued found the run still held by this walker and did nothing, so the
 * park keeps what they wrote (`mergeParkedAgentCursor`) — dropping a result
 * would leave the run waiting for one that already came, until its deadline
 * failed it.
 */
export async function suspendRun(
  sql: Sql,
  args: {
    organizationId: string;
    runId: string;
    epoch: number;
    detail: string;
    cursor?: unknown;
    executions: number;
    resumeInMs: number;
    event?: { kind: RunEventKind; detail?: Record<string, unknown> };
    /** The run-record rows the walker changed since its last write: written
     * with this progress, in its transaction, once the fence matched. */
    nodeRuns?: NodeRunWrite[];
  },
): Promise<{ suspended: boolean }> {
  return sql.begin(async (tx) => {
    await markAutomationWriterInTx(tx);
    const now = Date.now();
    // An agent node's park merges what the stored cursor gained while its
    // walker was on its way here; the row is locked first, so a settle or a
    // retarget either landed already or waits for the park.
    let parkCursor = args.cursor;
    if (parksAgentTurn(args.cursor)) {
      const stored = await tx<{ cursor: unknown }[]>`
        SELECT checkpoints -> 'cursor' AS cursor FROM app.automation_runs
        WHERE id = ${args.runId} AND org_id = ${args.organizationId}
          AND claim_epoch = ${args.epoch}
        FOR UPDATE
      `;
      if (stored[0] !== undefined) {
        parkCursor = mergeParkedAgentCursor(stored[0].cursor, args.cursor);
      }
    }
    const cursor = jsonParam(tx, parkCursor);
    const rows = await tx<{ seq: number }[]>`
      UPDATE app.automation_runs SET
        status = 'waiting', detail = ${truncateRunDetail(args.detail)},
        checkpoints =
          (CASE WHEN jsonb_typeof(checkpoints) = 'object'
                THEN checkpoints - 'cursor' ELSE '{}'::jsonb END)
          || jsonb_build_object(
               'nodes',
               CASE WHEN jsonb_typeof(checkpoints -> 'nodes') = 'object'
                    THEN checkpoints -> 'nodes' ELSE '{}'::jsonb END,
               'executions', ${args.executions}::int)
          || (CASE WHEN ${cursor}::jsonb IS NULL THEN '{}'::jsonb
                   ELSE jsonb_build_object('cursor', ${cursor}::jsonb) END),
        wake_at_ms = ${now + args.resumeInMs},
        chain_seq = chain_seq + 1,
        lease_owner = NULL, lease_expires_at_ms = NULL,
        record_bytes = record_bytes + ${nodeRunBytes(args.nodeRuns)}::int
      WHERE id = ${args.runId} AND org_id = ${args.organizationId}
        AND claim_epoch = ${args.epoch}
        AND status IN ('queued', 'running', 'waiting')
      RETURNING chain_seq AS seq
    `;
    const parked = rows[0];
    if (!parked) return { suspended: false };
    await writeNodeRunsInTx(tx, { ...args, rows: args.nodeRuns ?? [] });
    if (
      parkedAgentSettled(parkCursor) ||
      (await approvalDecided(tx, args.organizationId, args.detail)) ||
      (args.detail.startsWith('in_doubt:') &&
        (await inDoubtSettled(tx, args.organizationId, args.runId)))
    ) {
      // What the park waits on happened while the walker was on its way
      // here — a person decided the approval, the agent's turn settled, or
      // the write in doubt was finished by the walker that was making it.
      // Its own wake found the run still walking and did nothing, so the
      // park wakes the run itself instead of waiting for its poll.
      await tx`
        UPDATE app.automation_runs SET
          wake_at_ms = ${Date.now() + RUN_CLAIM_PROMISE_MS}
        WHERE id = ${args.runId} AND org_id = ${args.organizationId}
      `;
      await enqueueStep(tx, args.organizationId, args.runId, 0);
    } else {
      await enqueuePoll(tx, {
        organizationId: args.organizationId,
        runId: args.runId,
        seq: parked.seq,
        pollMs: args.resumeInMs,
      });
    }
    if (args.event !== undefined) {
      await recordRunEventInTx(tx, {
        organizationId: args.organizationId,
        runId: args.runId,
        kind: args.event.kind,
        ...(args.event.detail !== undefined && { detail: args.event.detail }),
      });
    }
    await emitRunHint(tx, args.organizationId, args.runId);
    return { suspended: true };
  });
}

/**
 * Whether the approval a park waits on (`approval:<id>`) was decided already.
 * Read after the park's own write, which holds the run's row: a decision
 * locks that row before it writes (`lockRunInTx`), so it either committed
 * before this read — and is seen here — or it waits for the park and then
 * finds the run parked and wakes it. Its read is a statement of its own:
 * one inside the park's write would read the approvals as they were before
 * the write waited for the row.
 */
async function approvalDecided(
  tx: TransactionSql,
  organizationId: string,
  detail: string,
): Promise<boolean> {
  if (!detail.startsWith('approval:')) return false;
  const approvalId = detail.slice('approval:'.length);
  const rows = await tx<{ decided: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM app.approvals
      WHERE id = ${approvalId} AND org_id = ${organizationId}
        AND status <> 'pending'
    ) AS decided
  `;
  return rows[0]?.decided ?? false;
}

/**
 * Whether a park on a write that may already have happened is due: a person
 * decided about it, or no write of the run is open any more. The second
 * happens when the walker that was making the write outlived its lease and
 * recorded how the call ended after another walker had parked the run on it:
 * the next walker then reads that end instead of anyone being asked.
 */
async function inDoubtSettled(
  tx: TransactionSql,
  organizationId: string,
  runId: string,
): Promise<boolean> {
  const rows = await tx<{ settled: boolean }[]>`
    SELECT (
      EXISTS (
        SELECT 1 FROM app.automation_node_attempts
        WHERE run_id = ${runId} AND org_id = ${organizationId}
          AND status = 'started' AND resolution IS NOT NULL
      )
      OR NOT EXISTS (
        SELECT 1 FROM app.automation_node_attempts
        WHERE run_id = ${runId} AND org_id = ${organizationId}
          AND kind = 'connector' AND status = 'started'
          AND resolution IS NULL
      )
    ) AS settled
  `;
  return rows[0]?.settled ?? false;
}

/** One hop of a parked run's poll chain (the pg-boss `automation.poll`
 * handler): fenced by chainSeq, cheap row-facts decision, re-arms itself or
 * wakes the stepper. */
export async function pollParkedRun(
  sql: Sql,
  args: { organizationId: string; runId: string; seq: number; pollMs: number },
): Promise<{ due: boolean; rearmed: boolean }> {
  return sql.begin(async (tx) => {
    await markAutomationWriterInTx(tx);
    const row = await runRow(tx, args.organizationId, args.runId);
    if (!row || row.status !== 'waiting' || row.chainSeq !== args.seq) {
      return { due: false, rearmed: false };
    }
    const checkpoints = readCheckpoints(row.checkpoints);
    const cursor =
      checkpoints.cursor !== null && typeof checkpoints.cursor === 'object'
        ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stepper owns the cursor shape
          (checkpoints.cursor as {
            agent?: { result?: unknown; deadlineAt?: number };
          })
        : undefined;
    const agent = cursor?.agent;
    // A write that may already have happened waits for a person: due once
    // they decided, or once nothing is in doubt any more (their decision and
    // a late finish of the write each wake the run themselves; this hop is
    // the backstop). An agent park is quiet until its settle lands or its
    // deadline passes; anything else counts as due — the stepper is the
    // arbiter, this hop only a filter. (The approval-park branch returns
    // with the approvals domain.)
    const inDoubt = row.detail?.startsWith('in_doubt:') === true;
    const due = inDoubt
      ? await inDoubtSettled(tx, args.organizationId, args.runId)
      : agent !== undefined
        ? agent.result !== undefined || Date.now() > (agent.deadlineAt ?? 0)
        : true;
    // Both writes below are fenced by the park this hop belongs to: the row
    // was read without a lock, and a decision may have woken it and a walker
    // claimed it since — its lease's promise is not this hop's to move.
    if (due) {
      // The step job below is the continuation; the promise gives its claim
      // time to happen before the sweep pokes again.
      const woken = await tx<{ id: string }[]>`
        UPDATE app.automation_runs SET
          wake_at_ms = ${Date.now() + RUN_CLAIM_PROMISE_MS}
        WHERE id = ${args.runId} AND org_id = ${args.organizationId}
          AND status = 'waiting' AND chain_seq = ${args.seq}
        RETURNING id
      `;
      if (!woken[0]) return { due: false, rearmed: false };
      await enqueueStep(tx, args.organizationId, args.runId, 0);
      return { due: true, rearmed: false };
    }
    // A person may take hours to decide, and the decision wakes the run
    // itself: an in-doubt park re-arms only at the backstop interval.
    const next = inDoubt ? { ...args, pollMs: IN_DOUBT_POLL_MS } : args;
    const rearmed = await tx<{ id: string }[]>`
      UPDATE app.automation_runs SET
        wake_at_ms = ${Date.now() + next.pollMs}
      WHERE id = ${args.runId} AND org_id = ${args.organizationId}
        AND status = 'waiting' AND chain_seq = ${args.seq}
      RETURNING id
    `;
    if (!rearmed[0]) return { due: false, rearmed: false };
    await enqueuePoll(tx, next);
    return { due: false, rearmed: true };
  });
}

/** Why a walker handed its run on before it was done: its server is
 * stopping. A budget hand-off (the turn ran out of time) carries none. */
export interface RunHandoff {
  reason: 'shutdown';
  /** The node the walker was in, and its forEach item. */
  nodeId?: string;
  itemIndex?: number;
  /** The node's body was cut off mid-call rather than finished. */
  interrupted?: boolean;
}

/**
 * Hand a run on to the next turn: release the walker's lease and queue the
 * step that continues it after `resumeInMs`. The promise covers the delay
 * plus the time the claim may take. A hand-off because the server is
 * stopping is counted on the run and recorded, so its page can say it was
 * resumed after a restart; a budget hand-off changes nothing a person sees.
 */
export async function continueRun(
  sql: Sql,
  args: {
    organizationId: string;
    runId: string;
    epoch: number;
    resumeInMs: number;
    handoff?: RunHandoff;
    /** The run-record rows the walker changed since its last write: written
     * with this progress, in its transaction, once the fence matched. */
    nodeRuns?: NodeRunWrite[];
  },
): Promise<{ scheduled: boolean }> {
  return sql.begin(async (tx) => {
    await markAutomationWriterInTx(tx);
    const now = Date.now();
    const handedOff = args.handoff !== undefined;
    const rows = await tx<{ id: string }[]>`
      UPDATE app.automation_runs SET
        wake_at_ms = ${now + args.resumeInMs + RUN_CLAIM_PROMISE_MS},
        lease_owner = NULL, lease_expires_at_ms = NULL,
        resume_count = resume_count + ${handedOff ? 1 : 0}::int,
        last_resume_reason = CASE WHEN ${handedOff}::boolean
          THEN 'shutdown' ELSE last_resume_reason END,
        last_resumed_at_ms = CASE WHEN ${handedOff}::boolean
          THEN ${now}::bigint ELSE last_resumed_at_ms END,
        record_bytes = record_bytes + ${nodeRunBytes(args.nodeRuns)}::int
      WHERE id = ${args.runId} AND org_id = ${args.organizationId}
        AND claim_epoch = ${args.epoch}
        AND status IN ('queued', 'running', 'waiting')
      RETURNING id
    `;
    if (!rows[0]) return { scheduled: false };
    await writeNodeRunsInTx(tx, { ...args, rows: args.nodeRuns ?? [] });
    await enqueueStep(tx, args.organizationId, args.runId, args.resumeInMs);
    const handoff = args.handoff;
    if (handoff !== undefined) {
      const where = {
        ...(handoff.nodeId !== undefined && { nodeId: handoff.nodeId }),
        ...(handoff.itemIndex !== undefined && {
          itemIndex: handoff.itemIndex,
        }),
      };
      await recordRunEventInTx(tx, {
        organizationId: args.organizationId,
        runId: args.runId,
        kind: 'handed_off',
        detail: { reason: handoff.reason, ...where },
      });
      if (handoff.interrupted === true) {
        await recordRunEventInTx(tx, {
          organizationId: args.organizationId,
          runId: args.runId,
          kind: 'node_interrupted',
          detail: where,
        });
      }
      await emitRunHint(tx, args.organizationId, args.runId);
    }
    return { scheduled: true };
  });
}

/**
 * The terminal door: land the run on `success` or `failed` in ONE statement
 * fenced by the walker's epoch and a live status, then — only when it landed
 * — write its audit row, keep its trigger's streak, and free what it held. A
 * stop that committed first wins: this write then matches nothing, and
 * nothing else happens (no audit row, no trigger outcome, no second close).
 */
export async function finishRun(
  sql: Sql,
  args: {
    organizationId: string;
    runId: string;
    epoch: number;
    status: 'success' | 'failed';
    output?: unknown;
    /** Stored as given: the stepper assembles it from checkpoint traces
     * `recordProgress` already bounded plus the failing node's entry, which
     * it bounds itself — re-bounding here would re-cut the stored markers. */
    trace: unknown;
    effects: unknown;
    detail?: string;
    /** The stable cause of a `failed` run (`Run.failureCode`); null or
     * absent for a success, and for a failure no site could classify. */
    failureCode?: string | null;
    executions: number;
    /** The run-record rows the walker changed since its last write: written
     * with this progress, in its transaction, once the fence matched. */
    nodeRuns?: NodeRunWrite[];
  },
): Promise<{ status: string }> {
  return sql.begin(async (tx) => {
    await markAutomationWriterInTx(tx);
    const now = Date.now();
    const rows = await tx<
      {
        name: string;
        version: number;
        mode: string;
        startedBy: string;
        startedAt: number;
      }[]
    >`
      UPDATE app.automation_runs SET
        status = ${args.status},
        output = coalesce(${args.output === undefined ? null : tx.json(toJson(JSON.stringify(args.output)))}, output),
        trace = ${tx.json(toJson(args.trace ?? []))},
        effects = ${tx.json(toJson(args.effects ?? []))},
        detail = ${truncateRunDetail(args.detail) ?? null},
        failure_code = ${args.status === 'failed' ? (args.failureCode ?? null) : null},
        checkpoints = jsonb_build_object(
          'nodes',
          CASE WHEN jsonb_typeof(checkpoints -> 'nodes') = 'object'
               THEN checkpoints -> 'nodes' ELSE '{}'::jsonb END,
          'executions', ${args.executions}::int),
        wake_at_ms = NULL, finished_at_ms = ${now},
        lease_owner = NULL, lease_expires_at_ms = NULL,
        record_bytes = record_bytes + ${nodeRunBytes(args.nodeRuns)}::int
      WHERE id = ${args.runId} AND org_id = ${args.organizationId}
        AND claim_epoch = ${args.epoch}
        AND status IN ('queued', 'running', 'waiting')
      RETURNING name, version, mode, started_by AS "startedBy",
                started_at_ms::float8 AS "startedAt"
    `;
    const row = rows[0];
    if (!row) {
      return {
        status: await whyNotWritten(
          tx,
          args.organizationId,
          args.runId,
          args.epoch,
        ),
      };
    }
    await writeNodeRunsInTx(tx, { ...args, rows: args.nodeRuns ?? [] });
    // The provenance record, atomic with the finish (LIVE runs only). The
    // full fold (approvals + connector effects) grows with those domains;
    // the terminal audit row is the contract that must never be missing.
    if (row.mode === 'live') {
      await createAuditLog(tx, {
        organizationId: args.organizationId,
        actorId: row.startedBy,
        actorType: 'system',
        action: `automation.run.${args.status}`,
        category: 'ai',
        resourceType: 'automation_run',
        resourceId: args.runId,
        resourceName: `${row.name}@${row.version}`,
        status: args.status === 'success' ? 'success' : 'failure',
        ...(args.detail !== undefined ? { errorMessage: args.detail } : {}),
        metadata: {
          effectsCount: Array.isArray(args.effects) ? args.effects.length : 0,
          executions: args.executions,
        },
      });
      // A trigger's run keeps the trigger's failure streak — and the
      // schedule it pauses, when its runs keep failing the same way. The
      // trigger row comes after the run's own, here as in a run removal
      // (the lock order in `trigger-failures.ts`).
      const trigger = await recordTriggerRunOutcome(tx, {
        organizationId: args.organizationId,
        runId: args.runId,
        startedBy: row.startedBy,
        startedAt: row.startedAt,
        status: args.status,
        failureCode:
          args.status === 'failed' ? (args.failureCode ?? null) : null,
        now,
      });
      if (trigger !== null) {
        await emitDefinitionHint(tx, args.organizationId, trigger.name);
      }
    }
    // The run's sandbox sessions are per-execution — free their slots now,
    // and withdraw the approval cards no node will ever consume and close
    // any question nobody can answer any more (the terminal contract,
    // shared with cancelRun).
    await stopRunSandboxSessions(tx, args.organizationId, args.runId);
    await closeRunApprovals(tx, args.organizationId, args.runId);
    await closePendingAsksForRun(
      tx,
      args.organizationId,
      args.runId,
      `The run ended (${args.status})`,
    );
    await emitRunHint(tx, args.organizationId, args.runId);
    return { status: args.status };
  });
}

// ---------------------------------------------------------------- liveness

/**
 * The sweep: overdue non-terminal runs get a fresh stepper poke. Each poke
 * re-checks the promise in its own write, so two sweeps that overlap poke a
 * run once. A running run whose lease lapsed — its walker died — is recorded
 * as such and its open views told, so its page can say it is being resumed.
 *
 * A running run an image without leases claimed last (`lease_epoch` <>
 * `claim_epoch`) has only that image's promise, and once the promise lapsed
 * its walker is gone too. The poke turns the lapsed promise into a lapsed
 * lease of the claim it names: the step it queues then takes the run over.
 * Left as it was, that step would read the fresh promise the poke itself
 * wrote and refuse the run as held — every sweep, for good.
 */
export async function sweepOverdueRuns(
  sql: Sql,
  limit = LIVENESS_SWEEP_LIMIT,
): Promise<number> {
  const now = Date.now();
  const rows = await sql<
    { id: string; orgId: string; owner: string | null; leaseExpired: boolean }[]
  >`
    SELECT id, org_id AS "orgId", lease_owner AS "owner",
           (status = 'running' AND (
              lease_epoch IS DISTINCT FROM claim_epoch
              OR (lease_expires_at_ms IS NOT NULL
                  AND lease_expires_at_ms < ${now}))) AS "leaseExpired"
    FROM app.automation_runs
    WHERE status IN ('queued', 'running', 'waiting')
      AND wake_at_ms IS NOT NULL AND wake_at_ms < ${now}
    ORDER BY wake_at_ms
    LIMIT ${limit}
  `;
  let poked = 0;
  for (const row of rows) {
    const won = await sql.begin(async (tx) => {
      await markAutomationWriterInTx(tx);
      const at = Date.now();
      // Every right-hand side reads the row as it was before this write.
      const updated = await tx<{ id: string }[]>`
        UPDATE app.automation_runs SET
          wake_at_ms = ${at + RUN_CLAIM_PROMISE_MS},
          lease_epoch = CASE
            WHEN status = 'running' AND lease_epoch IS DISTINCT FROM claim_epoch
            THEN claim_epoch ELSE lease_epoch END,
          lease_expires_at_ms = CASE
            WHEN status = 'running' AND lease_epoch IS DISTINCT FROM claim_epoch
            THEN ${at}::bigint ELSE lease_expires_at_ms END
        WHERE id = ${row.id} AND org_id = ${row.orgId}
          AND status IN ('queued', 'running', 'waiting')
          AND wake_at_ms IS NOT NULL AND wake_at_ms < ${at}
        RETURNING id
      `;
      if (!updated[0]) return false;
      await enqueueStep(tx, row.orgId, row.id, 0);
      if (row.leaseExpired) {
        await recordRunEventInTx(tx, {
          organizationId: row.orgId,
          runId: row.id,
          kind: 'lease_expired',
          detail: { owner: row.owner },
        });
        await emitRunHint(tx, row.orgId, row.id);
      }
      return true;
    });
    if (won) poked++;
  }
  return poked;
}

/**
 * The 0.4 `pokeParkedRun` twin: wake a PARKED run because something it waits
 * on just happened — a human resolving the approval its current node parked
 * behind. A `running` walker is already awake and reads the decision itself;
 * terminal or foreign runs are a silent no-op (a stale approval must not
 * throw the resolution). Same claim-promise + step enqueue as the liveness
 * sweep. It joins the caller's transaction, so the wake commits with the
 * decision that caused it, and a decision whose wake cannot be queued is not
 * recorded either.
 */
export async function pokeParkedRunInTx(
  tx: TransactionSql,
  args: { organizationId: string; runId: string },
): Promise<boolean> {
  await markAutomationWriterInTx(tx);
  const rows = await tx<{ id: string }[]>`
    UPDATE app.automation_runs SET
      wake_at_ms = ${Date.now() + RUN_CLAIM_PROMISE_MS}
    WHERE id = ${args.runId} AND org_id = ${args.organizationId}
      AND status = 'waiting'
    RETURNING id
  `;
  if (!rows[0]) return false;
  await enqueueStep(tx, args.organizationId, args.runId, 0);
  return true;
}

/**
 * Wake a run parked on a write that may already have happened once nothing
 * is in doubt any more: the walker that was making the write outlived its
 * lease, another walker parked the run on it, and the first one then
 * recorded how the call ended. The next walker reads that end — the output,
 * or the failure — instead of anyone being asked. Its own transaction, after
 * the finish committed: the write locks the run row alone, the order every
 * run write takes. Answers whether the run was woken.
 */
export async function wakeSettledInDoubtPark(
  sql: Sql,
  args: { organizationId: string; runId: string },
): Promise<boolean> {
  return sql.begin(async (tx) => {
    await markAutomationWriterInTx(tx);
    const rows = await tx<{ id: string }[]>`
      UPDATE app.automation_runs SET
        wake_at_ms = ${Date.now() + RUN_CLAIM_PROMISE_MS}
      WHERE id = ${args.runId} AND org_id = ${args.organizationId}
        AND status = 'waiting' AND detail LIKE 'in_doubt:%'
        AND NOT EXISTS (
          SELECT 1 FROM app.automation_node_attempts
          WHERE run_id = ${args.runId} AND org_id = ${args.organizationId}
            AND kind = 'connector' AND status = 'started'
            AND resolution IS NULL
        )
      RETURNING id
    `;
    if (!rows[0]) return false;
    await enqueueStep(tx, args.organizationId, args.runId, 0);
    await emitRunHint(tx, args.organizationId, args.runId);
    return true;
  });
}

/**
 * Lock a run's row for a decision that will wake it in the same
 * transaction — taken BEFORE the decided row's own lock. A run's terminal
 * doors (finish, cancel, delete) lock the run first and the rows that hang
 * off it after, so a decision taking them the other way round could
 * deadlock against a stop. Holding the run also orders the decision against
 * the walker's park: a park that commits first is woken by the decision's
 * poke, and one that waits for the decision reads it (`suspendRun`). A run
 * that is not there locks nothing.
 */
export async function lockRunInTx(
  tx: TransactionSql,
  args: { organizationId: string; runId: string },
): Promise<void> {
  await tx`
    SELECT 1 FROM app.automation_runs
    WHERE id = ${args.runId} AND org_id = ${args.organizationId}
    FOR UPDATE
  `;
}

/**
 * A stopping process hands on every run it still holds a lease on: the lease
 * is released, the run counted as resumed after a shutdown, and one step job
 * per run queued for whichever process takes it next — one transaction, so
 * nothing is released without its continuation. When that transaction
 * cannot commit (the job queue is already closing), the leases are released
 * alone with an overdue promise, and the next sweep tick of a live process
 * pokes them. Answers how many runs were handed on.
 */
export async function releaseOwnedRunLeases(sql: Sql): Promise<number> {
  const owner = instanceId();
  try {
    return await sql.begin(async (tx) => {
      await markAutomationWriterInTx(tx);
      const now = Date.now();
      const rows = await tx<{ id: string; orgId: string }[]>`
        UPDATE app.automation_runs SET
          lease_owner = NULL, lease_expires_at_ms = NULL,
          wake_at_ms = ${now + RUN_CLAIM_PROMISE_MS},
          resume_count = resume_count + 1,
          last_resume_reason = 'shutdown', last_resumed_at_ms = ${now}
        WHERE status = 'running' AND lease_owner = ${owner}
          AND lease_epoch = claim_epoch AND lease_expires_at_ms IS NOT NULL
        RETURNING id, org_id AS "orgId"
      `;
      for (const row of rows) {
        await enqueueStep(tx, row.orgId, row.id, 0);
        await recordRunEventInTx(tx, {
          organizationId: row.orgId,
          runId: row.id,
          kind: 'handed_off',
          detail: { reason: 'shutdown_release' },
        });
        await emitRunHint(tx, row.orgId, row.id);
      }
      return rows.length;
    });
  } catch (error) {
    console.warn(
      '[automations] could not hand this process’s runs on; releasing their leases for the sweep instead:',
      error,
    );
    return sql.begin(async (tx) => {
      await markAutomationWriterInTx(tx);
      const now = Date.now();
      const rows = await tx<{ id: string }[]>`
      UPDATE app.automation_runs SET
        lease_owner = NULL, lease_expires_at_ms = NULL,
        wake_at_ms = ${now},
        resume_count = resume_count + 1,
        last_resume_reason = 'shutdown', last_resumed_at_ms = ${now}
      WHERE status = 'running' AND lease_owner = ${owner}
        AND lease_epoch = claim_epoch AND lease_expires_at_ms IS NOT NULL
      RETURNING id
    `;
      return rows.length;
    });
  }
}

// ---------------------------------------------------------------- deletion

export async function deleteAutomationCascade(
  sql: Sql,
  args: {
    organizationId: string;
    name: string;
    actor: string;
    /** Compare-and-set on the history: the latest version the caller read.
     * A version saved since refuses the delete with
     * `AUTOMATION_VERSION_STALE` (409, `data.latestVersion`) and removes
     * nothing. Absent, no check (the app's and the REST door's delete). */
    expectedLatestVersion?: number;
  },
): Promise<{ versions: number }> {
  return sql.begin(async (tx) => {
    // The name, then the trigger row: the order every definition writer
    // takes them in (`audit.ts`).
    await lockAutomationName(tx, args.organizationId, args.name);
    if (args.expectedLatestVersion !== undefined) {
      const heads = await tx<{ latest: number | null }[]>`
        SELECT max(version)::int AS latest FROM app.automations
        WHERE org_id = ${args.organizationId} AND name = ${args.name}
      `;
      const latest = heads[0]?.latest ?? null;
      if (latest !== args.expectedLatestVersion) {
        throw new AutomationError(
          'AUTOMATION_VERSION_STALE',
          latest === null
            ? `"${args.name}" has no version any more.`
            : `v${latest} of "${args.name}" was saved after the version the delete expected (v${args.expectedLatestVersion}).`,
          409,
          {
            latestVersion: latest,
            expectedLatestVersion: args.expectedLatestVersion,
          },
        );
      }
    }
    // The active-run guard the core store documents (and this wired path had
    // dropped): deleting mid-run would remove the versions the stepper needs
    // to load, stranding the run non-terminal forever — the liveness sweep
    // re-claims it every ~3min and its sandbox session is never freed. Refuse
    // while any run is live or held. A hold is not released by cancellation.
    const active = await tx<{ status: string }[]>`
      SELECT status FROM app.automation_runs
      WHERE org_id = ${args.organizationId} AND name = ${args.name}
        AND status IN ('queued', 'running', 'waiting', 'quarantined')
      LIMIT 1
    `;
    if (active[0]?.status === 'quarantined') {
      throw new AutomationError(
        'RUN_QUARANTINED',
        'A run of this automation is on hold because its external outcome is unknown. Preserve its definition and evidence.',
        409,
      );
    }
    if (active[0]) {
      throw new AutomationError(
        'AUTOMATION_HAS_ACTIVE_RUNS',
        `A run of "${args.name}" is still ${active[0].status} — cancel it (or let it finish) before deleting the automation.`,
        409,
      );
    }
    const versions = await tx`
      DELETE FROM app.automations
      WHERE org_id = ${args.organizationId} AND name = ${args.name}
    `;
    const deployment = await tx<{ version: number }[]>`
      DELETE FROM app.automation_deployments
      WHERE org_id = ${args.organizationId} AND name = ${args.name}
      RETURNING version
    `;
    const triggers = await tx<{ id: string; lastSkipReason: string | null }[]>`
      DELETE FROM app.automation_triggers
      WHERE org_id = ${args.organizationId} AND name = ${args.name}
      RETURNING id, last_skip_reason AS "lastSkipReason"
    `;
    for (const trigger of triggers) {
      if (trigger.lastSkipReason !== 'paused_after_failures') continue;
      await dismissTriggerPausedNotifications(tx, {
        organizationId: args.organizationId,
        triggerId: trigger.id,
      });
    }
    await tx`
      DELETE FROM app.automation_project_bindings
      WHERE org_id = ${args.organizationId} AND automation_name = ${args.name}
    `;
    await tx`
      INSERT INTO app.automation_tombstones (
        org_id, name, deleted_by, deleted_at_ms
      ) VALUES (
        ${args.organizationId}, ${args.name}, ${args.actor}, ${Date.now()}
      )
      ON CONFLICT (org_id, name) DO UPDATE SET
        deleted_by = EXCLUDED.deleted_by,
        deleted_at_ms = EXCLUDED.deleted_at_ms
    `;
    const removed = versions.count;
    await auditDefinitionWrite(tx, {
      organizationId: args.organizationId,
      actor: args.actor,
      action: 'automation.deleted',
      name: args.name,
      previousState: {
        versions: removed,
        deployedVersion: deployment[0]?.version ?? null,
      },
    });
    await emitDefinitionHint(tx, args.organizationId, args.name);
    return { versions: removed };
  });
}

// --- the human-ask answer surface --------------------------------------------

export interface PendingAsk {
  askId: string;
  runId: string;
  nodeId: string;
  question: string;
  questions?: unknown;
  createdAt: number;
  expiresAt: number;
  taskId?: string;
}

/** The live question of one run, for the run dialog and the task panel.
 * Null when nothing is waiting on a person — a dead run's question is
 * unanswerable, so the card never offers it (the 0.4 gate). */
export async function getPendingAskForRun(
  sql: Sql,
  organizationId: string,
  runId: string,
): Promise<PendingAsk | null> {
  const rows = await sql<
    {
      askId: string;
      runId: string;
      nodeId: string;
      question: string;
      questions: unknown;
      createdAt: number;
      expiresAt: number;
      taskId: string | null;
    }[]
  >`
    SELECT a.id AS "askId", a.run_id AS "runId", a.node_id AS "nodeId",
           a.question, a.questions,
           a.created_at_ms::float8 AS "createdAt",
           a.expires_at_ms::float8 AS "expiresAt", a.task_id AS "taskId"
    FROM app.automation_human_asks a
    JOIN app.automation_runs r ON r.id = a.run_id
    WHERE a.run_id = ${runId} AND a.org_id = ${organizationId}
      AND a.status = 'pending'
      AND a.expires_at_ms > ${Date.now()}
      AND r.status IN ('waiting', 'running', 'queued')
    ORDER BY a.created_at_ms
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    askId: row.askId,
    runId: row.runId,
    nodeId: row.nodeId,
    question: row.question,
    ...(row.questions !== null ? { questions: row.questions } : {}),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    ...(row.taskId !== null ? { taskId: row.taskId } : {}),
  };
}

/**
 * A member answers. Records the answer and enqueues the resume job in the
 * SAME transaction (tighter than 0.4's post-commit scheduler — the answer
 * can never land without its resume). The task-comment mirror of the answer
 * stays the CALLER's job, exactly as in 0.4.
 */
export interface AnsweredAsk {
  runId: string;
  /** The task the asking run works on, when it has one. */
  taskId: string | null;
}

/** The run a question belongs to, or null when the organization has no
 * such question — what a door checks the run's visibility against before
 * it lets anyone answer. */
export async function getAskRunId(
  sql: Sql,
  organizationId: string,
  askId: string,
): Promise<string | null> {
  const rows = await sql<{ runId: string }[]>`
    SELECT run_id AS "runId" FROM app.automation_human_asks
    WHERE id = ${askId} AND org_id = ${organizationId}
    LIMIT 1
  `;
  return rows[0]?.runId ?? null;
}

export async function answerAsk(
  sql: Sql,
  args: {
    organizationId: string;
    askId: string;
    answer: string;
    /** Who answered: a member's user id, or `api-key:<userId>` when a
     * machine caller answered as itself. */
    answeredBy: string;
    /** The run the caller addressed — an ask of another run is then "not
     * found", so ownership rides the same lock as the answer (the REST
     * door names the run in its URL). */
    runId?: string;
  },
): Promise<AnsweredAsk> {
  const answer = args.answer.trim().slice(0, 20_000);
  if (answer === '') {
    throw new AutomationError('EMPTY_ANSWER', 'the answer is empty', 400);
  }
  // postgres.js's begin result conditionally unwraps arrays; hold the
  // answered row outside that conditional return type.
  let answered: AnsweredAsk | null = null;
  await sql.begin(async (tx) => {
    const rows = await tx<
      {
        status: string;
        expiresAt: number;
        runId: string;
        taskId: string | null;
      }[]
    >`
      SELECT status, expires_at_ms::float8 AS "expiresAt",
             run_id AS "runId", task_id AS "taskId"
      FROM app.automation_human_asks
      WHERE id = ${args.askId} AND org_id = ${args.organizationId}
        ${args.runId === undefined ? tx`` : tx`AND run_id = ${args.runId}`}
      FOR UPDATE
    `;
    const ask = rows[0];
    if (!ask) {
      throw new AutomationError(
        'HUMAN_ASK_NOT_FOUND',
        'this question does not exist',
        404,
      );
    }
    if (ask.status !== 'pending') {
      throw new AutomationError(
        'HUMAN_ASK_NOT_PENDING',
        'this question was already answered or closed',
        409,
      );
    }
    if (Date.now() > ask.expiresAt) {
      throw new AutomationError(
        'HUMAN_ASK_EXPIRED',
        'this question expired before it was answered',
        409,
      );
    }
    await tx`
      UPDATE app.automation_human_asks SET
        status = 'answered', answer = ${answer},
        answered_by = ${args.answeredBy}, answered_at_ms = ${Date.now()}
      WHERE id = ${args.askId}
    `;
    // The bells stop ringing the moment the answer lands.
    await dismissAgentQuestionNotifications(tx, {
      organizationId: args.organizationId,
      askId: args.askId,
    });
    await addJobInTx(tx, 'automation.ask_resume', {
      organizationId: args.organizationId,
      askId: args.askId,
    });
    answered = { runId: ask.runId, taskId: ask.taskId };
  });
  if (answered === null) {
    throw new AutomationError(
      'HUMAN_ASK_NOT_FOUND',
      'this question does not exist',
      404,
    );
  }
  return answered;
}
