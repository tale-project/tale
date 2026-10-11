import type { Sql, TransactionSql } from 'postgres';

import type { ChangeSummary } from '../../../lib/engine/core/diff/changes.ts';
import {
  inferVia,
  parseWriteVia,
  type WriteOrigin,
  type WriteVia,
} from '../../lib/write-origin.ts';
import { readDeploymentPointer } from './deployments.ts';
import { AutomationError, saveVersion, versionRow } from './store.ts';

/**
 * An automation's versions as a history reads them — who saved each,
 * through which door and client, what it was based on or restored from,
 * what it changed, how its tests went, whether it is live and when it last
 * went live — and the two writes and reads built on them: restoring an
 * older version, and the versions a retention sweep must keep.
 *
 * Versions are kept until the automation is deleted; a history is read a
 * page at a time, so a long history written by agents never weighs on one
 * answer.
 */

/** One version, as a history lists it. */
export interface VersionHistoryRow {
  version: number;
  message: string | null;
  /** Who saved it: a user id, `api-key:<userId>` or `system:<what>`. */
  createdBy: string;
  createdAt: number;
  via: WriteVia;
  /** `via` was read from `createdBy`: the version is older than the
   * record of doors (0181). */
  viaInferred: boolean;
  apiKeyId: string | null;
  clientName: string | null;
  basedOnVersion: number | null;
  restoredFromVersion: number | null;
  /** Null for a version saved before change summaries were kept (0198). */
  changes: ChangeSummary | null;
  testsPassed: boolean | null;
  testsCheckedAt: number | null;
  /** The version live triggers and live runs use now. */
  live: boolean;
  /** When it last went live, or null when it never did. */
  lastDeployedAt: number | null;
}

/** A history page's default size, and the most one read answers. */
const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

interface HistoryRecord {
  version: number;
  message: string | null;
  createdBy: string;
  createdAt: string | number;
  createdVia: string | null;
  apiKeyId: string | null;
  clientName: string | null;
  basedOnVersion: number | null;
  restoredFromVersion: number | null;
  changes: unknown;
  testsPassed: boolean | null;
  testsCheckedAt: string | number | null;
  lastDeployedAt: string | number | null;
}

/** A stored change summary as the history answers it: an object with its
 * node counts, else not kept. */
function changesOf(raw: unknown): ChangeSummary | null {
  if (raw === null || typeof raw !== 'object' || !('nodes' in raw)) {
    return null;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written by changeSummaryOf (0198); only its node counts are checked here
  return raw as ChangeSummary;
}

/**
 * The versions of `name`, newest first, a page at a time (`before`: the
 * oldest version the last page answered), with which version is live and
 * which is the latest. `limit` defaults to 50 and is at most 200.
 */
export async function listVersionHistory(
  sql: Sql,
  organizationId: string,
  name: string,
  page: { limit?: number; before?: number } = {},
): Promise<{
  versions: VersionHistoryRow[];
  nextBefore: number | null;
  latestVersion: number | null;
  deployedVersion: number | null;
}> {
  const limit = Math.min(
    Math.max(Math.trunc(page.limit ?? DEFAULT_PAGE), 1),
    MAX_PAGE,
  );
  const pointer = await readDeploymentPointer(sql, organizationId, name);
  const records = await sql<HistoryRecord[]>`
    SELECT a.version, a.message, a.created_by AS "createdBy",
           a.created_at_ms AS "createdAt", a.created_via AS "createdVia",
           a.api_key_id AS "apiKeyId", a.client_name AS "clientName",
           a.based_on_version AS "basedOnVersion",
           a.restored_from_version AS "restoredFromVersion",
           a.change_summary AS changes, a.tests_passed AS "testsPassed",
           a.tests_checked_at_ms AS "testsCheckedAt",
           (
             SELECT max(e.at_ms) FROM app.automation_deployment_events e
             WHERE e.org_id = a.org_id AND e.name = a.name
               AND e.version = a.version
           ) AS "lastDeployedAt"
    FROM app.automations a
    WHERE a.org_id = ${organizationId} AND a.name = ${name}
      ${page.before === undefined ? sql`` : sql`AND a.version < ${page.before}`}
    ORDER BY a.version DESC
    LIMIT ${limit + 1}
  `;
  const latest = await sql<{ latest: number | null }[]>`
    SELECT max(version)::int AS latest FROM app.automations
    WHERE org_id = ${organizationId} AND name = ${name}
  `;
  const versions = records.slice(0, limit).map((record): VersionHistoryRow => {
    const live = pointer?.version === record.version;
    const recorded =
      record.lastDeployedAt === null ? null : Number(record.lastDeployedAt);
    // The live version went live when its pointer says, even before an
    // event recorded it.
    const lastDeployedAt =
      live && pointer !== null
        ? Math.max(recorded ?? 0, pointer.deployedAtMs)
        : recorded;
    return {
      version: record.version,
      message: record.message,
      createdBy: record.createdBy,
      createdAt: Number(record.createdAt),
      via: parseWriteVia(record.createdVia) ?? inferVia(record.createdBy),
      viaInferred: parseWriteVia(record.createdVia) === null,
      apiKeyId: record.apiKeyId,
      clientName: record.clientName,
      basedOnVersion: record.basedOnVersion,
      restoredFromVersion: record.restoredFromVersion,
      changes: changesOf(record.changes),
      testsPassed: record.testsPassed,
      testsCheckedAt:
        record.testsCheckedAt === null ? null : Number(record.testsCheckedAt),
      live,
      lastDeployedAt,
    };
  });
  const last = versions.at(-1);
  return {
    versions,
    nextBefore:
      records.length > limit && last !== undefined ? last.version : null,
    latestVersion: latest[0]?.latest ?? null,
    deployedVersion: pointer?.version ?? null,
  };
}

/**
 * Bring an older version back: save its content — the document and the
 * package data — as the newest version, restored from and based on it. A
 * version whose content is already the latest's saves nothing and answers
 * that version `unchanged`. Without a message the version reads
 * "Restore v{N}". `baseVersion` refuses the restore, as it does a save,
 * when someone saved since the caller read the history.
 */
export async function restoreVersion(
  sql: Sql,
  args: {
    organizationId: string;
    name: string;
    version: number;
    origin: WriteOrigin;
    message?: string;
    baseVersion?: number;
    testsPassed?: boolean;
  },
): Promise<{
  name: string;
  version: number;
  restoredFrom: number;
  unchanged?: true;
}> {
  // A saved version never changes, so it is read outside the save's lock.
  const source = await versionRow(
    sql,
    args.organizationId,
    args.name,
    args.version,
  );
  if (source === null) {
    throw new AutomationError(
      'AUTOMATION_VERSION_UNKNOWN',
      `"${args.name}" has no version ${String(args.version)} to restore.`,
      404,
    );
  }
  const saved = await saveVersion(sql, {
    organizationId: args.organizationId,
    name: args.name,
    document: source.document,
    origin: args.origin,
    message: args.message ?? `Restore v${String(args.version)}`,
    taskContract: source.taskContract,
    settings: source.settings,
    presentation: source.presentation,
    basedOnVersion: args.version,
    restoredFromVersion: args.version,
    unlessIdentical: true,
    ...(args.baseVersion === undefined
      ? {}
      : { baseVersion: args.baseVersion }),
    ...(args.testsPassed === undefined
      ? {}
      : { testsPassed: args.testsPassed }),
  });
  return {
    name: saved.name,
    version: saved.version,
    restoredFrom: args.version,
    ...(saved.unchanged === true && { unchanged: true as const }),
  };
}

/** How many of the newest versions, and of the latest deploys, are kept
 * whatever their age. */
const KEEP_NEWEST = 20;
const KEEP_DEPLOYED = 10;

/**
 * The versions of `name` a retention sweep must keep, whatever their age:
 * the live one; the versions of its last ten deploys (what a rollback
 * offers); every version a run of it ran (a run's record reads its
 * version); the newest twenty (so a version number is never reused); and
 * the versions any of those was based on or restored from, so a kept
 * version's lineage reads.
 */
export async function protectedVersions(
  sql: Sql | TransactionSql,
  organizationId: string,
  name: string,
): Promise<Set<number>> {
  const rows = await sql<{ version: number }[]>`
    WITH kept AS (
      SELECT version FROM app.automation_deployments
      WHERE org_id = ${organizationId} AND name = ${name}
      UNION
      SELECT version FROM (
        SELECT version FROM app.automation_deployment_events
        WHERE org_id = ${organizationId} AND name = ${name}
        ORDER BY at_ms DESC, id DESC
        LIMIT ${KEEP_DEPLOYED}
      ) deployed
      UNION
      SELECT DISTINCT version FROM app.automation_runs
      WHERE org_id = ${organizationId} AND name = ${name}
      UNION
      SELECT version FROM (
        SELECT version FROM app.automations
        WHERE org_id = ${organizationId} AND name = ${name}
        ORDER BY version DESC
        LIMIT ${KEEP_NEWEST}
      ) newest
    )
    SELECT version FROM kept
    UNION
    SELECT a.based_on_version FROM app.automations a
    JOIN kept ON kept.version = a.version
    WHERE a.org_id = ${organizationId} AND a.name = ${name}
      AND a.based_on_version IS NOT NULL
    UNION
    SELECT a.restored_from_version FROM app.automations a
    JOIN kept ON kept.version = a.version
    WHERE a.org_id = ${organizationId} AND a.name = ${name}
      AND a.restored_from_version IS NOT NULL
  `;
  return new Set(rows.map((row) => row.version));
}
