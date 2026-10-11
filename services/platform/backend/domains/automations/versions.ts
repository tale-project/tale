import type { Sql, TransactionSql } from 'postgres';

import type { ChangeSummary } from '../../../lib/engine/core/diff/changes.ts';
import {
  type StoredTestReport,
  storedTestReportSchema,
} from '../../../lib/shared/schemas/automation-tests.ts';
import {
  inferVia,
  parseWriteVia,
  type WriteOrigin,
  type WriteVia,
} from '../../lib/write-origin.ts';
import { readDeploymentPointer } from './deployments.ts';
import {
  AutomationError,
  saveVersion,
  versionRow,
  type SaveVersionArgs,
  type VersionRow,
} from './store.ts';

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
  /** The counts of the report its verdict came from, which act made it and
   * who — null while the verdict has no report of its own (0200). */
  tests: TestsSummary | null;
  /** The version live triggers and live runs use now. */
  live: boolean;
  /** When it last went live, or null when it never did. */
  lastDeployedAt: number | null;
}

/** A version's latest test check in counts. */
export interface TestsSummary {
  passed: number;
  failed: number;
  total: number;
  via?: 'save' | 'deploy' | 'manual';
  by?: string;
}

/** Which act checked a version's tests, as stored; else none known. */
function checkVia(raw: string | null): TestsSummary['via'] | undefined {
  return raw === 'save' || raw === 'deploy' || raw === 'manual'
    ? raw
    : undefined;
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
  testsPassedCount: number | null;
  testsFailedCount: number | null;
  testsVia: string | null;
  testsBy: string | null;
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

/** A history record's test counts, while its verdict has a report. */
function testsSummaryOf(record: HistoryRecord): TestsSummary | null {
  if (record.testsPassedCount === null || record.testsFailedCount === null) {
    return null;
  }
  const via = checkVia(record.testsVia);
  return {
    passed: record.testsPassedCount,
    failed: record.testsFailedCount,
    total: record.testsPassedCount + record.testsFailedCount,
    ...(via !== undefined && { via }),
    ...(record.testsBy !== null && { by: record.testsBy }),
  };
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
           -- The report's counts while it is the verdict's own: one written
           -- with an older verdict says nothing about the current one.
           CASE WHEN (a.tests_report->>'checkedAt')::float8
                     = a.tests_checked_at_ms
                THEN (a.tests_report->>'passed')::int END
             AS "testsPassedCount",
           CASE WHEN (a.tests_report->>'checkedAt')::float8
                     = a.tests_checked_at_ms
                THEN (a.tests_report->>'failed')::int END
             AS "testsFailedCount",
           a.tests_checked_via AS "testsVia",
           a.tests_checked_by AS "testsBy",
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
      tests: testsSummaryOf(record),
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
 * A history row as the doors answer it (`versionHistoryRowSchema`): the
 * door as `createdVia`, live as `deployed`. A message, a tests verdict and
 * its time that a version does not have are left out, as the version list
 * has always answered them.
 */
export function versionHistoryWire(row: VersionHistoryRow) {
  return {
    version: row.version,
    ...(row.message === null ? {} : { message: row.message }),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    createdVia: row.via,
    viaInferred: row.viaInferred,
    clientName: row.clientName,
    basedOnVersion: row.basedOnVersion,
    restoredFromVersion: row.restoredFromVersion,
    changes: row.changes,
    ...(row.testsPassed === null ? {} : { testsPassed: row.testsPassed }),
    ...(row.testsCheckedAt === null
      ? {}
      : { testsCheckedAt: row.testsCheckedAt }),
    tests: row.tests,
    deployed: row.live,
    lastDeployedAt: row.lastDeployedAt,
  };
}

/** A version's latest test check: its verdict, when and how it was made
 * and by whom, and the report it came from — null when the verdict has
 * none of its own (made before reports were kept, or by an older image). */
export interface VersionTestReport {
  report: StoredTestReport | null;
  testsPassed: boolean | null;
  testsCheckedAt: number | null;
  via: 'save' | 'deploy' | 'manual' | null;
  by: string | null;
}

/** The latest test check of one saved version; undefined when the version
 * does not exist. A stored report that does not read, or belongs to an
 * earlier verdict, answers as no report. */
export async function readTestReport(
  sql: Sql,
  organizationId: string,
  name: string,
  version: number,
): Promise<VersionTestReport | undefined> {
  const rows = await sql<
    {
      testsPassed: boolean | null;
      testsCheckedAt: string | number | null;
      report: unknown;
      via: string | null;
      by: string | null;
    }[]
  >`
    SELECT tests_passed AS "testsPassed",
           tests_checked_at_ms AS "testsCheckedAt",
           tests_report AS report, tests_checked_via AS via,
           tests_checked_by AS by
    FROM app.automations
    WHERE org_id = ${organizationId} AND name = ${name}
      AND version = ${version}
  `;
  const row = rows[0];
  if (row === undefined) return undefined;
  const checkedAt =
    row.testsCheckedAt === null ? null : Number(row.testsCheckedAt);
  const parsed = storedTestReportSchema.safeParse(row.report);
  if (row.report !== null && !parsed.success) {
    console.warn(
      `[automations] the stored test report of ${name} v${version} does not read`,
      parsed.error.issues.slice(0, 3),
    );
  }
  const report =
    parsed.success && parsed.data.checkedAt === checkedAt ? parsed.data : null;
  return {
    report,
    testsPassed: row.testsPassed,
    testsCheckedAt: checkedAt,
    via: checkVia(row.via) ?? null,
    by: row.by,
  };
}

/** The version a restore brings back, read before the save: a saved version
 * never changes, so it needs no lock. */
export async function readRestoreSource(
  sql: Sql,
  organizationId: string,
  name: string,
  version: number,
): Promise<VersionRow> {
  const source = await versionRow(sql, organizationId, name, version);
  if (source === null) {
    throw new AutomationError(
      'AUTOMATION_VERSION_UNKNOWN',
      `"${name}" has no version ${String(version)} to restore.`,
      404,
    );
  }
  return source;
}

/**
 * What a restore of `source` saves: its content — the document and the
 * package data — as the newest version, restored from and based on it,
 * "Restore v{N}" unless the caller names a message, and nothing when that
 * content is already the latest's (`unlessIdentical`). `baseVersion` refuses
 * the restore, as it does a save, when someone saved since the caller read
 * the history. The app's door hands it to the shared save path, which adds
 * the version's own tests verdict.
 */
export function restoreSaveArgs(
  source: VersionRow,
  request: {
    organizationId: string;
    name: string;
    origin: WriteOrigin;
    message?: string;
    baseVersion?: number;
  },
): SaveVersionArgs {
  return {
    organizationId: request.organizationId,
    name: request.name,
    document: source.document,
    origin: request.origin,
    message: request.message ?? `Restore v${String(source.version)}`,
    taskContract: source.taskContract,
    settings: source.settings,
    presentation: source.presentation,
    basedOnVersion: source.version,
    restoredFromVersion: source.version,
    unlessIdentical: true,
    ...(request.baseVersion === undefined
      ? {}
      : { baseVersion: request.baseVersion }),
  };
}

/** Bring an older version back as the newest, without running its tests
 * (the store's own door; the app's runs them through the save path). */
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
  const source = await readRestoreSource(
    sql,
    args.organizationId,
    args.name,
    args.version,
  );
  const saved = await saveVersion(sql, {
    ...restoreSaveArgs(source, args),
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
