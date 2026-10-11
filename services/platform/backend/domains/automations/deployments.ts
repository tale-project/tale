import type { Sql, TransactionSql } from 'postgres';

import { runStarterUserId } from '../../../lib/shared/run-starter.ts';
import {
  parseWriteVia,
  type WriteOrigin,
  type WriteVia,
} from '../../lib/write-origin.ts';

/**
 * When each version of an automation went live — its deployment history,
 * kept in `app.automation_deployment_events` (0199) for as long as the
 * automation, beside the one-row pointer (`app.automation_deployments`)
 * that says which version is live now.
 *
 * A deploy appends one event in its own transaction, under the name lock
 * (`recordDeploymentInTx`): `deploy` when it puts a newer version live (or
 * the first one), `rollback` when it puts an older one back. Putting the
 * live version live again moves nothing and records nothing.
 *
 * A version can be live without an event saying how: the pointer as 0199
 * found it, or one the previous image moved while a new one rolled out
 * (that image writes no events). The newest event says the pointer when it
 * names the same version, at or after the pointer's time; otherwise the
 * pointer is recorded as `recorded` — by the next deploy before its own
 * event, and in a history read as a row built from the pointer
 * (`synthesized`) until then.
 */

export type DeploymentKind = 'deploy' | 'rollback' | 'recorded';

/** One time a version became the live one. */
export interface DeploymentEventRow {
  id: string;
  version: number;
  /** What was live before; null for the first deploy and a `recorded` one. */
  previousVersion: number | null;
  kind: DeploymentKind;
  /** Built from the live pointer for this read rather than stored: the
   * version a previous image put live, not recorded yet. */
  synthesized: boolean;
  /** Who: a user id, `api-key:<userId>` or `system:<what>`. */
  actor: string;
  via: WriteVia | null;
  apiKeyId: string | null;
  clientName: string | null;
  at: number;
}

/** What is live now, since when, by whom, and how many of its runs are
 * still going. */
export interface LiveDeployment {
  version: number;
  since: number;
  actor: string;
  via: WriteVia | null;
  clientName: string | null;
  /** Runs of the live version still queued, running or waiting. */
  activeRuns: number;
}

/** The live pointer of a name, as a deploy reads it under the name lock. */
export interface DeploymentPointer {
  version: number;
  deployedBy: string;
  deployedAtMs: number;
}

/** A history page's default size, and the most one read answers. */
const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

/** How many deploys `list_versions` answers beside the versions — the
 * recent ones a rollback chooses from. */
export const RECENT_DEPLOYMENTS = 20;

/** The door a pointer with no event names: the platform's own writes say
 * so in their actor; any other door is not known. */
function pointerVia(pointer: DeploymentPointer): WriteVia | null {
  return pointer.deployedBy.startsWith('system:') ? 'system' : null;
}

/** The live pointer of `name`, or null when nothing is deployed. */
export async function readDeploymentPointer(
  sql: Sql | TransactionSql,
  organizationId: string,
  name: string,
): Promise<DeploymentPointer | null> {
  const rows = await sql<
    { version: number; deployedBy: string; deployedAtMs: string | number }[]
  >`
    SELECT version, deployed_by AS "deployedBy",
           deployed_at_ms AS "deployedAtMs"
    FROM app.automation_deployments
    WHERE org_id = ${organizationId} AND name = ${name}
    LIMIT 1
  `;
  const row = rows[0];
  return row === undefined
    ? null
    : {
        version: row.version,
        deployedBy: row.deployedBy,
        deployedAtMs: Number(row.deployedAtMs),
      };
}

interface EventRecord {
  id: string;
  version: number;
  previousVersion: number | null;
  kind: string;
  actor: string;
  via: string | null;
  apiKeyId: string | null;
  client: string | null;
  atMs: string | number;
}

function toRow(record: EventRecord): DeploymentEventRow {
  const kind: DeploymentKind =
    record.kind === 'rollback' || record.kind === 'recorded'
      ? record.kind
      : 'deploy';
  return {
    id: record.id,
    version: record.version,
    previousVersion: record.previousVersion,
    kind,
    synthesized: false,
    actor: record.actor,
    via: parseWriteVia(record.via),
    apiKeyId: record.apiKeyId,
    clientName: record.client,
    at: Number(record.atMs),
  };
}

/** Whether `newest` already says `pointer`: the same version, recorded at
 * or after the pointer's time. */
function covers(
  newest: { version: number; at: number } | undefined,
  pointer: DeploymentPointer,
): boolean {
  return (
    newest !== undefined &&
    newest.version === pointer.version &&
    newest.at >= pointer.deployedAtMs
  );
}

/** The pointer as a history row, for a read of a pointer no event says. */
function synthesizedRow(pointer: DeploymentPointer): DeploymentEventRow {
  return {
    id: `pointer:${String(pointer.version)}:${String(pointer.deployedAtMs)}`,
    version: pointer.version,
    previousVersion: null,
    kind: 'recorded',
    synthesized: true,
    actor: pointer.deployedBy,
    via: pointerVia(pointer),
    apiKeyId: null,
    clientName: null,
    at: pointer.deployedAtMs,
  };
}

async function newestEvent(
  sql: Sql | TransactionSql,
  organizationId: string,
  name: string,
): Promise<DeploymentEventRow | undefined> {
  const rows = await sql<EventRecord[]>`
    SELECT id, version, previous_version AS "previousVersion", kind, actor,
           via, api_key_id AS "apiKeyId", client, at_ms AS "atMs"
    FROM app.automation_deployment_events
    WHERE org_id = ${organizationId} AND name = ${name}
    ORDER BY at_ms DESC, id DESC
    LIMIT 1
  `;
  const row = rows[0];
  return row === undefined ? undefined : toRow(row);
}

/** The door and client that put the live `pointer` live, when the newest
 * event says it; for a pointer no event says, only the platform's own door
 * is known. */
export async function liveDeploymentDoor(
  sql: Sql | TransactionSql,
  organizationId: string,
  name: string,
  pointer: DeploymentPointer,
): Promise<{ via: WriteVia | null; clientName: string | null }> {
  const newest = await newestEvent(sql, organizationId, name);
  return newest !== undefined && covers(newest, pointer)
    ? { via: newest.via, clientName: newest.clientName }
    : { via: pointerVia(pointer), clientName: null };
}

/**
 * Record `version` going live, in the deploy's transaction and under its
 * name lock, `pointer` being what was live before. A pointer no event says
 * is recorded first, at its own time, so the history keeps every version
 * that was live. Answers the new event's id and kind.
 */
export async function recordDeploymentInTx(
  tx: TransactionSql,
  args: {
    organizationId: string;
    name: string;
    version: number;
    pointer: DeploymentPointer | null;
    origin: WriteOrigin;
    atMs: number;
  },
): Promise<{ id: string; kind: 'deploy' | 'rollback' }> {
  const { organizationId, name, pointer } = args;
  if (pointer !== null) {
    const newest = await newestEvent(tx, organizationId, name);
    if (!covers(newest, pointer)) {
      await tx`
        INSERT INTO app.automation_deployment_events (
          org_id, name, version, previous_version, kind, actor, via, at_ms
        ) VALUES (
          ${organizationId}, ${name}, ${pointer.version}, NULL, 'recorded',
          ${pointer.deployedBy}, ${pointerVia(pointer)}, ${pointer.deployedAtMs}
        )
      `;
    }
  }
  const previous = pointer?.version ?? null;
  const kind =
    previous !== null && args.version < previous ? 'rollback' : 'deploy';
  const rows = await tx<{ id: string }[]>`
    INSERT INTO app.automation_deployment_events (
      org_id, name, version, previous_version, kind, actor, via,
      api_key_id, client, at_ms
    ) VALUES (
      ${organizationId}, ${name}, ${args.version}, ${previous}, ${kind},
      ${args.origin.actor}, ${args.origin.via},
      ${args.origin.apiKeyId ?? null}, ${args.origin.clientName ?? null},
      ${args.atMs}
    )
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('the deployment event was not written');
  return { id, kind };
}

/**
 * The deployment history of `name`, newest first, a page at a time: what is
 * live now (with its runs still going), its events, and where the next page
 * starts (`null` on the last). A pointer no event says yet leads the first
 * page as a `synthesized` row, beyond the page's size. `limit` defaults to
 * 50 and is at most 200.
 */
export async function listDeploymentEvents(
  sql: Sql,
  organizationId: string,
  name: string,
  page: { limit?: number; before?: { at: number; id: string } } = {},
): Promise<{
  live: LiveDeployment | null;
  events: DeploymentEventRow[];
  nextBefore: { at: number; id: string } | null;
}> {
  const limit = Math.min(
    Math.max(Math.trunc(page.limit ?? DEFAULT_PAGE), 1),
    MAX_PAGE,
  );
  const pointer = await readDeploymentPointer(sql, organizationId, name);
  const records = await sql<EventRecord[]>`
    SELECT id, version, previous_version AS "previousVersion", kind, actor,
           via, api_key_id AS "apiKeyId", client, at_ms AS "atMs"
    FROM app.automation_deployment_events
    WHERE org_id = ${organizationId} AND name = ${name}
      ${
        page.before === undefined
          ? sql``
          : sql`AND (at_ms, id) < (${page.before.at}::bigint, ${page.before.id}::text)`
      }
    ORDER BY at_ms DESC, id DESC
    LIMIT ${limit + 1}
  `;
  const rows = records.slice(0, limit).map(toRow);
  const last = rows.at(-1);
  const nextBefore =
    records.length > limit && last !== undefined
      ? { at: last.at, id: last.id }
      : null;

  let newest: DeploymentEventRow | undefined;
  if (page.before === undefined) newest = rows[0];
  else if (pointer !== null) {
    newest = await newestEvent(sql, organizationId, name);
  }
  const pending =
    pointer !== null && !covers(newest, pointer)
      ? synthesizedRow(pointer)
      : null;
  const events =
    pending !== null && page.before === undefined ? [pending, ...rows] : rows;

  let live: LiveDeployment | null = null;
  if (pointer !== null) {
    const said = pending === null ? newest : undefined;
    const [running] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM app.automation_runs
      WHERE org_id = ${organizationId} AND name = ${name}
        AND version = ${pointer.version}
        AND status IN ('queued', 'running', 'waiting')
    `;
    live = {
      version: pointer.version,
      since: pointer.deployedAtMs,
      actor: pointer.deployedBy,
      via: said?.via ?? pointerVia(pointer),
      clientName: said?.clientName ?? null,
      activeRuns: running?.count ?? 0,
    };
  }
  return { live, events, nextBefore };
}

/** One deploy as `list_versions` answers it beside the versions. */
export interface RecentDeployment {
  version: number;
  previousVersion: number | null;
  deployedAt: number;
  /** The person, by user id; the platform's own deploys by their actor. */
  deployedBy: string;
  via: WriteVia | null;
}

/** The recent deploys of `name`, newest first — the history a rollback
 * (deploy_automation of an older version) reads. */
export async function recentDeployments(
  sql: Sql,
  organizationId: string,
  name: string,
): Promise<RecentDeployment[]> {
  const { events } = await listDeploymentEvents(sql, organizationId, name, {
    limit: RECENT_DEPLOYMENTS,
  });
  return events.slice(0, RECENT_DEPLOYMENTS).map((event) => ({
    version: event.version,
    previousVersion: event.previousVersion,
    deployedAt: event.at,
    deployedBy: runStarterUserId(event.actor) ?? event.actor,
    via: event.via,
  }));
}
