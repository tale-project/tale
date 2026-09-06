import type { Sql, TransactionSql } from 'postgres';

import { parseCron, wallClockIn } from '../../core/automations/cron.ts';
import {
  hashWebhookToken,
  mintWebhookToken,
} from '../../core/automations/webhook_token.ts';
import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { dismissAgentQuestionNotifications } from '../collab/service.ts';

/**
 * The automation store over PG — versions (immutable, contiguous),
 * bindings, deployments, triggers, tombstones, and the durable RUN
 * substrate the reused 0.4 stepper drives: claim with an epoch fence,
 * heartbeat/progress renewing the wakeAt liveness promise, suspend with a
 * chainSeq-fenced poll chain, continue hand-offs, and a single terminal
 * door. Scheduling maps 1:1 from the 0.4 scheduler onto pg-boss
 * (`automation.step` / `automation.poll` jobs with `startAfter`), enqueued
 * IN the same transaction as the state write (the constitution's
 * transactional-enqueue rule) so a scheduled resume can never outrun or
 * miss its row.
 */

export const RUN_CLAIM_PROMISE_MS = 3 * 60_000;

export class AutomationError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409;

  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'AutomationError';
    this.code = code;
    this.status = status;
  }
}

/** Mirror of the 0.4 name rule: '/'-separated slug path. */
export function assertAutomationName(name: string): string {
  const trimmed = name.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 200 ||
    !/^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/.test(trimmed)
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
  testsPassed?: boolean;
  taskContract?: unknown;
  settings?: unknown;
  presentation?: unknown;
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

export async function saveVersion(
  sql: Sql,
  args: SaveVersionArgs,
): Promise<{ name: string; version: number }> {
  const name = assertAutomationName(args.name);
  return sql.begin(async (tx) => {
    await lockAutomationName(tx, args.organizationId, name);
    // The FIRST version is the create: a name the router keeps for itself is
    // refused here, once, before anything is written.
    const existing = await tx<{ version: number }[]>`
      SELECT version FROM app.automations
      WHERE org_id = ${args.organizationId} AND name = ${name}
      LIMIT 1
    `;
    if (existing.length === 0) assertAutomationNameCreatable(name);
    if (args.create === true && existing.length > 0) {
      throw new AutomationError(
        'AUTOMATION_NAME_TAKEN',
        `An automation named "${name}" already exists — pick a different name.`,
        409,
      );
    }
    const rows = await tx<{ version: number }[]>`
      INSERT INTO app.automations (
        org_id, name, version, document, message, tests_passed,
        task_contract, settings, presentation, created_by, created_at_ms
      )
      SELECT ${args.organizationId}, ${name},
             coalesce(max(version), 0) + 1,
             ${tx.json(toJson(args.document))}, ${args.message ?? null},
             ${args.testsPassed ?? null},
             ${args.taskContract === undefined ? null : tx.json(toJson(args.taskContract))},
             ${args.settings === undefined ? null : tx.json(toJson(args.settings))},
             ${args.presentation === undefined ? null : tx.json(toJson(args.presentation))},
             ${args.actor}, ${Date.now()}
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
    if (version === 1 && args.projectId !== undefined) {
      const owned = await tx<{ id: string }[]>`
        SELECT id FROM app.projects
        WHERE org_id = ${args.organizationId} AND id = ${args.projectId}
        LIMIT 1
      `;
      if (owned.length === 0) {
        throw new AutomationError(
          'AUTOMATION_PROJECT_UNKNOWN',
          'One of the projects does not exist in this organization.',
          404,
        );
      }
      await tx`
        INSERT INTO app.automation_project_bindings (
          org_id, automation_name, project_id, bound_at_ms, bound_by
        ) VALUES (
          ${args.organizationId}, ${name}, ${args.projectId}, ${Date.now()},
          ${args.actor}
        )
        ON CONFLICT (org_id, automation_name, project_id) DO NOTHING
      `;
    }
    await emitDefinitionHint(tx, args.organizationId, name);
    return { name, version };
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
  taskContract: unknown;
  settings: unknown;
  presentation: unknown;
  createdBy: string;
  createdAt: number;
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
           task_contract AS "taskContract", settings, presentation,
           created_by AS "createdBy", created_at_ms::float8 AS "createdAt"
    FROM app.automations
    WHERE org_id = ${organizationId} AND name = ${name}
      AND (${version ?? null}::int IS NULL OR version = ${version ?? null})
    ORDER BY version DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
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

export async function deploy(
  sql: Sql,
  args: {
    organizationId: string;
    name: string;
    version: number;
    actor: string;
  },
): Promise<{ name: string; version: number }> {
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
  if (row.testsPassed === false) {
    throw new AutomationError(
      'AUTOMATION_DEPLOY_REJECTED',
      `deploy gate: ${args.name}@${args.version} was saved with failing tests — fix them and save a new version`,
      409,
    );
  }
  await sql.begin(async (tx) => {
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
    await emitDefinitionHint(tx, args.organizationId, args.name);
  });
  return { name: args.name, version: args.version };
}

export interface AutomationListing {
  name: string;
  latestVersion: number;
  deployedVersion: number | null;
  presentation: unknown;
  projectIds: string[];
}

export async function listAutomations(
  sql: Sql,
  organizationId: string,
): Promise<AutomationListing[]> {
  const rows = await sql<
    {
      name: string;
      latestVersion: number;
      deployedVersion: number | null;
      presentation: unknown;
    }[]
  >`
    SELECT a.name, max(a.version) AS "latestVersion",
           d.version AS "deployedVersion",
           (array_agg(a.presentation ORDER BY a.version DESC))[1]
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
  return rows.map((row) =>
    Object.assign({ projectIds: byName.get(row.name) ?? [] }, row),
  );
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
           (array_agg(a.presentation ORDER BY a.version = d.version DESC NULLS LAST, a.version DESC))[1]
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

export async function listVersions(
  sql: Sql,
  organizationId: string,
  name: string,
): Promise<
  Array<{
    version: number;
    message: string | null;
    testsPassed: boolean | null;
    createdBy: string;
    createdAt: number;
  }>
> {
  return sql<
    {
      version: number;
      message: string | null;
      testsPassed: boolean | null;
      createdBy: string;
      createdAt: number;
    }[]
  >`
    SELECT version, message, tests_passed AS "testsPassed",
           created_by AS "createdBy", created_at_ms::float8 AS "createdAt"
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
  },
): Promise<void> {
  await sql.begin(async (tx) => {
    const owned = await tx<{ id: string }[]>`
      SELECT id FROM app.projects
      WHERE org_id = ${args.organizationId}
        AND id = ANY(${args.projectIds})
    `;
    if (owned.length !== new Set(args.projectIds).size) {
      throw new AutomationError(
        'AUTOMATION_PROJECT_UNKNOWN',
        'One of the projects does not exist in this organization.',
        404,
      );
    }
    await tx`
      DELETE FROM app.automation_project_bindings
      WHERE org_id = ${args.organizationId}
        AND automation_name = ${args.name}
        AND NOT (project_id = ANY(${args.projectIds}))
    `;
    for (const projectId of args.projectIds) {
      await tx`
        INSERT INTO app.automation_project_bindings (
          org_id, automation_name, project_id, bound_at_ms, bound_by
        ) VALUES (
          ${args.organizationId}, ${args.name}, ${projectId}, ${Date.now()},
          ${args.actor}
        )
        ON CONFLICT (org_id, automation_name, project_id) DO NOTHING
      `;
    }
    await emitDefinitionHint(tx, args.organizationId, args.name);
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
  const owned = await sql<{ id: string }[]>`
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
  return sql.begin(async (tx) => {
    const inserted = await tx`
      INSERT INTO app.automation_project_bindings (
        org_id, automation_name, project_id, bound_at_ms, bound_by
      ) VALUES (
        ${args.organizationId}, ${args.name}, ${args.projectId}, ${Date.now()},
        ${args.actor}
      )
      ON CONFLICT (org_id, automation_name, project_id) DO NOTHING
    `;
    const bound = inserted.count > 0;
    // An idempotent re-add changed nothing — no screen needs a refetch.
    if (bound) await emitDefinitionHint(tx, args.organizationId, args.name);
    return { bound };
  });
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

export interface TriggerInput {
  kind: 'schedule' | 'webhook' | 'event';
  cron?: string;
  timezone?: string;
  event?: string;
  enabled?: boolean;
  rotateToken?: boolean;
}

/**
 * The single validation door for a trigger's shape. Both entry points — the
 * HTTP door (`routes.ts`) and the engine door (`dispatch-store.ts`) — reach
 * `setTrigger`, so validating here is what makes them CONVERGE: a schedule
 * whose cron cannot parse (or whose timezone is not a real IANA zone) is
 * refused at SAVE with an actionable error, instead of saving green and
 * silently never firing (the scanner only `console.warn`s a bad cron). Throws
 * an {@link AutomationError} the surfaces map to a 400 the author sees.
 */
export function assertTriggerValid(trigger: TriggerInput): void {
  if (trigger.kind === 'schedule') {
    const cron = trigger.cron?.trim() ?? '';
    if (cron === '') {
      throw new AutomationError(
        'AUTOMATION_TRIGGER_INVALID',
        'A schedule trigger needs a cron expression (e.g. "0 9 * * 1" for 09:00 every Monday).',
      );
    }
    try {
      parseCron(cron);
    } catch (error) {
      throw new AutomationError(
        'AUTOMATION_TRIGGER_INVALID',
        `That cron expression will never fire: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const timezone = trigger.timezone?.trim();
    if (timezone !== undefined && timezone !== '') {
      try {
        // The same resolver the scanner uses — an unknown zone throws here
        // rather than silently firing at the wrong hour later.
        wallClockIn(Date.now(), timezone);
      } catch {
        throw new AutomationError(
          'AUTOMATION_TRIGGER_INVALID',
          `"${timezone}" is not a valid IANA time zone (e.g. "Europe/Zurich" or "UTC").`,
        );
      }
    }
  }
  if (trigger.kind === 'event' && (trigger.event?.trim() ?? '') === '') {
    throw new AutomationError(
      'AUTOMATION_TRIGGER_INVALID',
      'An event trigger needs an event name.',
    );
  }
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
 * landed.
 */
export async function setTrigger(
  sql: Sql,
  args: {
    organizationId: string;
    name: string;
    trigger: TriggerInput;
    actor: string;
  },
): Promise<{ token?: string }> {
  assertTriggerValid(args.trigger);
  const now = Date.now();
  const minted =
    args.trigger.kind === 'webhook' ? mintWebhookToken() : undefined;
  const mintedHash =
    minted !== undefined ? await hashWebhookToken(minted) : null;
  const rotate = args.trigger.rotateToken === true;
  const enabled = args.trigger.enabled ?? true;
  const rows = await sql.begin(async (tx) => {
    const upserted = await tx<{ tokenHash: string | null }[]>`
      INSERT INTO app.automation_triggers AS t (
        org_id, name, kind, cron, timezone, event, token_hash, enabled,
        created_by, created_at_ms, updated_at_ms
      ) VALUES (
        ${args.organizationId}, ${args.name}, ${args.trigger.kind},
        ${args.trigger.cron ?? null}, ${args.trigger.timezone ?? null},
        ${args.trigger.event ?? null}, ${mintedHash}, ${enabled},
        ${args.actor}, ${now}, ${now}
      )
      ON CONFLICT (org_id, name) DO UPDATE SET
        kind = EXCLUDED.kind,
        cron = EXCLUDED.cron,
        timezone = EXCLUDED.timezone,
        event = EXCLUDED.event,
        token_hash = CASE
          WHEN EXCLUDED.kind <> 'webhook' THEN NULL
          WHEN ${rotate}::boolean OR t.token_hash IS NULL THEN EXCLUDED.token_hash
          ELSE t.token_hash
        END,
        enabled = EXCLUDED.enabled,
        updated_at_ms = EXCLUDED.updated_at_ms
      RETURNING token_hash AS "tokenHash"
    `;
    await emitDefinitionHint(tx, args.organizationId, args.name);
    return upserted;
  });
  const landed = rows[0]?.tokenHash ?? null;
  return minted !== undefined && landed !== null && landed === mintedHash
    ? { token: minted }
    : {};
}

export async function deleteTrigger(
  sql: Sql,
  organizationId: string,
  name: string,
): Promise<boolean> {
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      DELETE FROM app.automation_triggers
      WHERE org_id = ${organizationId} AND name = ${name}
      RETURNING id
    `;
    const deleted = rows.length > 0;
    if (deleted) await emitDefinitionHint(tx, organizationId, name);
    return deleted;
  });
}

export async function listTriggers(
  sql: Sql,
  organizationId: string,
  name?: string,
): Promise<
  Array<{
    name: string;
    kind: string;
    cron: string | null;
    timezone: string | null;
    event: string | null;
    hasToken: boolean;
    enabled: boolean;
    lastFiredAt: number | null;
  }>
> {
  return sql<
    {
      name: string;
      kind: string;
      cron: string | null;
      timezone: string | null;
      event: string | null;
      hasToken: boolean;
      enabled: boolean;
      lastFiredAt: number | null;
    }[]
  >`
    SELECT name, kind, cron, timezone, event,
           (token_hash IS NOT NULL AND token_hash <> '') AS "hasToken",
           enabled,
           last_fired_at_ms::float8 AS "lastFiredAt"
    FROM app.automation_triggers
    WHERE org_id = ${organizationId}
      AND (${name ?? null}::text IS NULL OR name = ${name ?? null})
    ORDER BY name
  `;
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
  claimEpoch: number;
  chainSeq: number;
  startedAt: number;
  finishedAt: number | null;
}

const RUN_COLUMNS = `
  id, org_id AS "organizationId", name, version, project_id AS "projectId",
  status, mode, started_by AS "startedBy", input, output, checkpoints, trace,
  effects, detail, claim_epoch AS "claimEpoch", chain_seq AS "chainSeq",
  started_at_ms::float8 AS "startedAt", finished_at_ms::float8 AS "finishedAt"
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
  await tx`
    UPDATE app.sandbox_sessions SET status = 'stopped'
    WHERE org_id = ${organizationId}
      AND owner_type = 'workflow_run'
      AND (owner_id = ${runId} OR owner_id LIKE ${runId + ':%'})
      AND status IN ('creating', 'active', 'degraded')
      AND pinned = false
  `;
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
): Promise<number> {
  const closed = await tx<{ id: string }[]>`
    UPDATE app.automation_human_asks SET status = 'cancelled'
    WHERE run_id = ${runId} AND org_id = ${organizationId}
      AND status = 'pending'
    RETURNING id
  `;
  for (const ask of closed) {
    await dismissAgentQuestionNotifications(tx, {
      organizationId,
      askId: ask.id,
    });
  }
  return closed.length;
}

export async function getRun(
  sql: Sql,
  organizationId: string,
  runId: string,
): Promise<RunRow | null> {
  return runRow(sql, organizationId, runId);
}

export async function listRuns(
  sql: Sql,
  organizationId: string,
  options: { name?: string; limit?: number; projectId?: string } = {},
): Promise<RunRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  return sql<RunRow[]>`
    SELECT ${sql.unsafe(RUN_COLUMNS)} FROM app.automation_runs
    WHERE org_id = ${organizationId}
      AND (${options.name ?? null}::text IS NULL
           OR name = ${options.name ?? null})
      AND (${options.projectId ?? null}::text IS NULL
           OR project_id = ${options.projectId ?? null})
    ORDER BY started_at_ms DESC
    LIMIT ${limit}
  `;
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
  version?: number;
  projectId?: string;
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
  {
    const version =
      args.version ??
      (await deployedVersion(tx, args.organizationId, args.name));
    if (version === undefined) return null;
    const row = await versionRow(tx, args.organizationId, args.name, version);
    if (!row) return null;
    // The caller's project wins; otherwise the sole bound project keeps
    // trigger and manual runs attributed as the single-surface model did.
    const bindings = await bindingProjectIds(
      tx,
      args.organizationId,
      args.name,
    );
    if (args.projectId !== undefined) {
      // ALWAYS validate a caller-supplied project — the webhook door
      // (`?projectId=`) and /start pass it straight through, so it must exist
      // in THIS organization before it lands on the run (never a phantom or
      // another org's id). The dispatch-store door validated existence; this
      // is the same gate for the doors that did not.
      const owned = await tx<{ id: string }[]>`
        SELECT id FROM app.projects
        WHERE org_id = ${args.organizationId} AND id = ${args.projectId}
        LIMIT 1
      `;
      if (owned.length === 0) {
        throw new AutomationError(
          'AUTOMATION_PROJECT_UNKNOWN',
          'The project does not exist in this organization.',
          404,
        );
      }
      // A project-bound automation may only run FOR one of its projects.
      if (bindings.length > 0 && !bindings.includes(args.projectId)) {
        throw new AutomationError(
          'AUTOMATION_PROJECT_FORBIDDEN',
          `"${args.name}" is not bound to that project.`,
          403,
        );
      }
    }
    const projectId =
      args.projectId ?? (bindings.length === 1 ? bindings[0] : undefined);
    const now = Date.now();
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO app.automation_runs (
        org_id, name, version, project_id, status, mode, started_by, input,
        checkpoints, wake_at_ms, claim_epoch, started_at_ms
      ) VALUES (
        ${args.organizationId}, ${args.name}, ${version},
        ${projectId ?? null}, 'queued', ${args.mode}, ${args.startedBy},
        ${tx.json(toJson(JSON.stringify(args.input)))},
        ${tx.json(toJson({ nodes: {}, executions: 0 }))},
        ${now}, 0, ${now}
      )
      RETURNING id
    `;
    const runId = inserted[0]?.id;
    if (!runId) throw new Error('run insert failed');
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
): Promise<{ cancelled: boolean }> {
  {
    const now = Date.now();
    const rows = await tx<
      { name: string; version: number; mode: string; startedBy: string }[]
    >`
      UPDATE app.automation_runs SET
        status = 'cancelled', finished_at_ms = ${now}, wake_at_ms = NULL
      WHERE id = ${runId} AND org_id = ${organizationId}
        AND status IN ('queued', 'running', 'waiting')
      RETURNING name, version, mode, started_by AS "startedBy"
    `;
    const row = rows[0];
    if (!row) return { cancelled: false };
    // cancelRun is a TERMINAL door — it honors the same contract finishRun
    // does: the provenance audit row (live runs) that must never be missing,
    // and freeing the run's sandbox sessions so cancelled agents stop holding
    // org slot capacity until a late settle or the turn deadline.
    if (row.mode === 'live') {
      await createAuditLog(tx, {
        organizationId,
        actorId: row.startedBy,
        actorType: 'system',
        action: 'automation.run.cancelled',
        category: 'ai',
        resourceType: 'automation_run',
        resourceId: runId,
        resourceName: `${row.name}@${row.version}`,
        status: 'failure',
        metadata: {},
      });
    }
    await stopRunSandboxSessions(tx, organizationId, runId);
    await closePendingAsksForRun(tx, organizationId, runId);
    await emitRunHint(tx, organizationId, runId);
    return { cancelled: true };
  }
}

export async function cancelRun(
  sql: Sql,
  organizationId: string,
  runId: string,
): Promise<{ cancelled: boolean }> {
  return sql.begin((tx) => cancelRunInTx(tx, organizationId, runId));
}

// ----------------------------------------------- the stepper's run contract

export async function claimRun(
  sql: Sql,
  organizationId: string,
  runId: string,
): Promise<{ claimed: boolean; status: string; epoch: number }> {
  return sql.begin(async (tx) => {
    const now = Date.now();
    // ATOMIC claim: the epoch bump reads and writes the SAME row under the
    // UPDATE's row lock, so two concurrent claims (a liveness re-poke racing
    // the live chain, a pg-boss retry) serialize and get DISTINCT epochs —
    // the later one wins and the earlier walker's writes read back 'stale' at
    // the epoch fence. The old read-then-write under READ COMMITTED was a
    // lost update: both read N, both wrote N+1, and both passed the fence,
    // double-stepping one run.
    const claimed = await tx<{ claimEpoch: number }[]>`
      UPDATE app.automation_runs SET
        status = 'running', claim_epoch = claim_epoch + 1, claimed_at_ms = ${now},
        wake_at_ms = ${now + RUN_CLAIM_PROMISE_MS}
      WHERE id = ${runId} AND org_id = ${organizationId}
        AND status IN ('queued', 'running', 'waiting')
      RETURNING claim_epoch AS "claimEpoch"
    `;
    if (claimed[0]) {
      await emitRunHint(tx, organizationId, runId);
      return { claimed: true, status: 'running', epoch: claimed[0].claimEpoch };
    }
    // Not claimable — report WHY (terminal vs missing) so the stepper's turn
    // exits with the same status it always did.
    const row = await runRow(tx, organizationId, runId);
    if (!row) return { claimed: false, status: 'missing', epoch: 0 };
    return { claimed: false, status: row.status, epoch: row.claimEpoch };
  });
}

export async function heartbeatRun(
  sql: Sql,
  organizationId: string,
  runId: string,
  epoch: number,
): Promise<{ alive: boolean }> {
  const rows = await sql<{ id: string }[]>`
    UPDATE app.automation_runs SET
      wake_at_ms = ${Date.now() + RUN_CLAIM_PROMISE_MS}
    WHERE id = ${runId} AND org_id = ${organizationId}
      AND status = 'running' AND claim_epoch = ${epoch}
    RETURNING id
  `;
  return { alive: rows.length > 0 };
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
  },
): Promise<{ status: string }> {
  return sql.begin(async (tx) => {
    const row = await runRow(tx, args.organizationId, args.runId);
    if (!row) return { status: 'missing' };
    if (
      row.status === 'success' ||
      row.status === 'failed' ||
      row.status === 'cancelled'
    ) {
      return { status: row.status };
    }
    if (row.claimEpoch !== args.epoch) return { status: 'stale' };
    const checkpoints = readCheckpoints(row.checkpoints);
    const nodes =
      args.nodeId !== undefined && args.checkpoint !== undefined
        ? Object.assign({}, checkpoints.nodes, {
            [args.nodeId]: args.checkpoint,
          })
        : checkpoints.nodes;
    await tx`
      UPDATE app.automation_runs SET
        checkpoints = ${tx.json(
          toJson({
            nodes,
            ...(args.cursor !== undefined && args.cursor !== null
              ? { cursor: args.cursor }
              : {}),
            executions: args.executions,
          }),
        )},
        wake_at_ms = ${Date.now() + RUN_CLAIM_PROMISE_MS}
      WHERE id = ${args.runId}
    `;
    await emitRunHint(tx, args.organizationId, args.runId);
    return { status: row.status };
  });
}

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
  },
): Promise<{ suspended: boolean }> {
  return sql.begin(async (tx) => {
    const row = await runRow(tx, args.organizationId, args.runId);
    if (
      !row ||
      row.status === 'cancelled' ||
      row.status === 'success' ||
      row.status === 'failed' ||
      row.claimEpoch !== args.epoch
    ) {
      return { suspended: false };
    }
    const checkpoints = readCheckpoints(row.checkpoints);
    const seq = row.chainSeq + 1;
    await tx`
      UPDATE app.automation_runs SET
        status = 'waiting', detail = ${args.detail.slice(0, 2000)},
        checkpoints = ${tx.json(
          toJson({
            nodes: checkpoints.nodes,
            ...(args.cursor !== undefined && args.cursor !== null
              ? { cursor: args.cursor }
              : {}),
            executions: args.executions,
          }),
        )},
        wake_at_ms = ${Date.now() + args.resumeInMs},
        chain_seq = ${seq}
      WHERE id = ${args.runId}
    `;
    await enqueuePoll(tx, {
      organizationId: args.organizationId,
      runId: args.runId,
      seq,
      pollMs: args.resumeInMs,
    });
    await emitRunHint(tx, args.organizationId, args.runId);
    return { suspended: true };
  });
}

/** One hop of a parked run's poll chain (the pg-boss `automation.poll`
 * handler): fenced by chainSeq, cheap row-facts decision, re-arms itself or
 * wakes the stepper. */
export async function pollParkedRun(
  sql: Sql,
  args: { organizationId: string; runId: string; seq: number; pollMs: number },
): Promise<{ due: boolean; rearmed: boolean }> {
  return sql.begin(async (tx) => {
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
    // An agent park is quiet until its settle lands or its deadline passes;
    // anything else counts as due — the stepper is the arbiter, this hop
    // only a filter. (The approval-park branch returns with the approvals
    // domain.)
    const due =
      agent !== undefined
        ? agent.result !== undefined || Date.now() > (agent.deadlineAt ?? 0)
        : true;
    if (due) {
      await tx`
        UPDATE app.automation_runs SET wake_at_ms = ${Date.now()}
        WHERE id = ${args.runId}
      `;
      await enqueueStep(tx, args.organizationId, args.runId, 0);
      return { due: true, rearmed: false };
    }
    await tx`
      UPDATE app.automation_runs SET
        wake_at_ms = ${Date.now() + args.pollMs}
      WHERE id = ${args.runId}
    `;
    await enqueuePoll(tx, args);
    return { due: false, rearmed: true };
  });
}

export async function continueRun(
  sql: Sql,
  args: {
    organizationId: string;
    runId: string;
    epoch: number;
    resumeInMs: number;
  },
): Promise<{ scheduled: boolean }> {
  return sql.begin(async (tx) => {
    const row = await runRow(tx, args.organizationId, args.runId);
    if (
      !row ||
      row.status === 'cancelled' ||
      row.status === 'success' ||
      row.status === 'failed' ||
      row.claimEpoch !== args.epoch
    ) {
      return { scheduled: false };
    }
    await tx`
      UPDATE app.automation_runs SET
        wake_at_ms = ${Date.now() + args.resumeInMs}
      WHERE id = ${args.runId}
    `;
    await enqueueStep(tx, args.organizationId, args.runId, args.resumeInMs);
    return { scheduled: true };
  });
}

export async function finishRun(
  sql: Sql,
  args: {
    organizationId: string;
    runId: string;
    epoch: number;
    status: 'success' | 'failed';
    output?: unknown;
    trace: unknown;
    effects: unknown;
    detail?: string;
    executions: number;
  },
): Promise<{ status: string }> {
  return sql.begin(async (tx) => {
    const row = await runRow(tx, args.organizationId, args.runId);
    if (
      !row ||
      row.status === 'cancelled' ||
      row.status === 'success' ||
      row.status === 'failed' ||
      row.claimEpoch !== args.epoch
    ) {
      return { status: row?.status ?? 'missing' };
    }
    const checkpoints = readCheckpoints(row.checkpoints);
    const now = Date.now();
    await tx`
      UPDATE app.automation_runs SET
        status = ${args.status},
        output = coalesce(${args.output === undefined ? null : tx.json(toJson(JSON.stringify(args.output)))}, output),
        trace = ${tx.json(toJson(args.trace ?? []))},
        effects = ${tx.json(toJson(args.effects ?? []))},
        detail = ${args.detail !== undefined ? args.detail.slice(0, 2000) : null},
        checkpoints = ${tx.json(
          toJson({ nodes: checkpoints.nodes, executions: args.executions }),
        )},
        wake_at_ms = NULL, finished_at_ms = ${now}
      WHERE id = ${args.runId}
    `;
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
    }
    // The run's sandbox sessions are per-execution — free their slots now,
    // and close any question nobody can answer any more (the terminal
    // contract, shared with cancelRun).
    await stopRunSandboxSessions(tx, args.organizationId, args.runId);
    await closePendingAsksForRun(tx, args.organizationId, args.runId);
    await emitRunHint(tx, args.organizationId, args.runId);
    return { status: args.status };
  });
}

// ---------------------------------------------------------------- liveness

/** The sweep: overdue non-terminal runs get a fresh stepper poke. */
export async function sweepOverdueRuns(sql: Sql, limit = 50): Promise<number> {
  const rows = await sql<{ id: string; orgId: string }[]>`
    SELECT id, org_id AS "orgId" FROM app.automation_runs
    WHERE status IN ('queued', 'running', 'waiting')
      AND wake_at_ms IS NOT NULL AND wake_at_ms < ${Date.now()}
    ORDER BY wake_at_ms
    LIMIT ${limit}
  `;
  for (const row of rows) {
    await sql.begin(async (tx) => {
      await tx`
        UPDATE app.automation_runs SET
          wake_at_ms = ${Date.now() + RUN_CLAIM_PROMISE_MS}
        WHERE id = ${row.id}
      `;
      await enqueueStep(tx, row.orgId, row.id, 0);
    });
  }
  return rows.length;
}

/**
 * The 0.4 `pokeParkedRun` twin: wake a PARKED run because something it waits
 * on just happened — a human resolving the approval its current node parked
 * behind. A `running` walker is already awake and reads the decision itself;
 * terminal or foreign runs are a silent no-op (a stale approval must not
 * throw the resolution). Same claim-promise + step enqueue as the liveness
 * sweep.
 */
export async function pokeParkedRun(
  sql: Sql,
  args: { organizationId: string; runId: string },
): Promise<boolean> {
  return sql.begin(async (tx) => {
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
  });
}

// ---------------------------------------------------------------- deletion

export async function deleteAutomationCascade(
  sql: Sql,
  args: { organizationId: string; name: string; actor: string },
): Promise<void> {
  await sql.begin(async (tx) => {
    // The active-run guard the core store documents (and this wired path had
    // dropped): deleting mid-run would remove the versions the stepper needs
    // to load, stranding the run non-terminal forever — the liveness sweep
    // re-claims it every ~3min and its sandbox session is never freed. Refuse
    // while any run is live; cancel it (which now stops sessions + audits) or
    // let it finish first.
    const active = await tx<{ status: string }[]>`
      SELECT status FROM app.automation_runs
      WHERE org_id = ${args.organizationId} AND name = ${args.name}
        AND status IN ('queued', 'running', 'waiting')
      LIMIT 1
    `;
    if (active[0]) {
      throw new AutomationError(
        'AUTOMATION_HAS_ACTIVE_RUNS',
        `A run of "${args.name}" is still ${active[0].status} — cancel it (or let it finish) before deleting the automation.`,
        409,
      );
    }
    await tx`
      DELETE FROM app.automations
      WHERE org_id = ${args.organizationId} AND name = ${args.name}
    `;
    await tx`
      DELETE FROM app.automation_deployments
      WHERE org_id = ${args.organizationId} AND name = ${args.name}
    `;
    await tx`
      DELETE FROM app.automation_triggers
      WHERE org_id = ${args.organizationId} AND name = ${args.name}
    `;
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
    await emitDefinitionHint(tx, args.organizationId, args.name);
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
export async function answerAsk(
  sql: Sql,
  args: {
    organizationId: string;
    askId: string;
    answer: string;
    answeredBy: string;
  },
): Promise<void> {
  const answer = args.answer.trim().slice(0, 20_000);
  if (answer === '') {
    throw new AutomationError('EMPTY_ANSWER', 'the answer is empty', 400);
  }
  await sql.begin(async (tx) => {
    const rows = await tx<{ status: string; expiresAt: number }[]>`
      SELECT status, expires_at_ms::float8 AS "expiresAt"
      FROM app.automation_human_asks
      WHERE id = ${args.askId} AND org_id = ${args.organizationId}
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
  });
}
