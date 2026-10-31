/**
 * The projects a caller may read, in SQL: the relation a reader joins in
 * the statement that reads its rows, and the check of a few named projects.
 *
 * Its own module rather than functions in `./service.ts`, because the
 * automation store joins the relation too (#5201): the projects service
 * imports the task retirement, which imports the automation store, so the
 * store importing the service would close an import cycle. The service
 * re-exports both for its other readers.
 */

import type { Sql, TransactionSql } from 'postgres';

import { audienceClause } from '../../core/lib/audience.ts';
import type { ProjectAuthContext } from './service.ts';

/** The audience rule (`audienceClause`) over the project's teams — the
 * array, with the legacy-pair fallback for a row the previous image wrote
 * during a rollout (`PROJECT_TEAM_IDS_SQL`). Admins see every project. */
export function visibilityClause(
  sql: Sql | TransactionSql,
  auth: ProjectAuthContext,
) {
  if (auth.projectScope !== undefined) {
    return sql`(id = ${auth.projectScope} AND ${audienceClause(sql, 'project_team_ids', auth)})`;
  }
  return audienceClause(sql, 'project_team_ids', auth);
}

/**
 * The projects the caller may read, as a relation the reader joins in the
 * statement that reads their rows: `project_id`, `project_key` and
 * `project_archived_at_ms`, named so they shadow no column of the table
 * they join (`JOIN ${readableProjectsSql(sql, auth)} rp USING
 * (project_id)`). Every "all my projects" read filters through it, in one
 * statement, instead of reading the id list first and sending it back as
 * `ANY(<ids>)` (#5156). The rule is {@link visibilityClause}'s, and a
 * disabled seat reads nothing, as {@link readableProjectsAmong} answers.
 * Archived projects stay out unless `includeArchived`.
 */
export function readableProjectsSql(
  sql: Sql | TransactionSql,
  auth: ProjectAuthContext,
  options: { includeArchived?: boolean } = {},
) {
  return sql`(
    SELECT id AS project_id, key AS project_key,
           archived_at_ms AS project_archived_at_ms
    FROM app.projects
    WHERE org_id = ${auth.organizationId}
      AND ${auth.role !== 'disabled'}
      AND (${options.includeArchived === true} OR archived_at_ms IS NULL)
      AND ${visibilityClause(sql, auth)}
  )`;
}

/** Which of the named projects the caller may read, archived ones
 * included: the many-project form of the service's `assertReadable`, for a
 * read that names other projects only to who may read them. */
export async function readableProjectsAmong(
  sql: Sql | TransactionSql,
  auth: ProjectAuthContext,
  projectIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0 || auth.role === 'disabled') return new Set();
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM app.projects
    WHERE org_id = ${auth.organizationId} AND id = ANY(${ids})
      AND ${visibilityClause(sql, auth)}
  `;
  return new Set(rows.map((row) => row.id));
}
