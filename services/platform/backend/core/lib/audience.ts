/**
 * The audience of a team-scoped resource — ONE rule for documents, folders,
 * projects and skills, on both sides of the wire.
 *
 * An audience is an ordered set of team ids. EMPTY means organization-wide:
 * every member sees the resource. Otherwise a member sees it when they belong
 * to at least one of its teams — and an owner or admin sees it regardless,
 * the same way they see every project, every conversation and every shared
 * skill (the product docs say so: a team is never a way to hide work from
 * the administrators).
 *
 * Assignment is the mirror image: a non-admin may only file a resource into
 * teams they belong to, an admin into any team of the organization, and
 * nobody into a team that is not this organization's.
 *
 * Storage keeps the array as the truth (`app.documents.team_tags`,
 * `app.folders.team_tags`, `app.projects.team_ids`) and derives the legacy
 * single/shared columns from it (`audienceMirror`) until the release that
 * drops them. Every SQL door composes the same predicate (`audienceClause`),
 * and every point read the same function (`canSeeAudience`), so the two
 * encodings cannot disagree.
 */

import type { Sql, TransactionSql } from 'postgres';

/** Organization roles that see and administer everything. */
export const ADMIN_ROLES: ReadonlySet<string> = new Set(['owner', 'admin']);

/** True for an owner or admin — the roles the audience rule never restricts. */
export function isAudienceAdmin(role: string | null | undefined): boolean {
  return role != null && ADMIN_ROLES.has(role);
}

/** What a resource says about who may see it. */
export interface Audience {
  /** Team ids; an empty list is organization-wide. */
  readonly teamIds: readonly string[];
}

/** A member asking — their role and every team they belong to. */
export interface AudienceViewer {
  readonly role: string;
  readonly teamIds: readonly string[];
}

/**
 * The viewer, reduced to what the rule needs. Knowledge scopes and shims
 * carry this shape across boundaries where a role string would be a leak.
 */
export interface AudienceGrant {
  readonly isAdmin: boolean;
  readonly teamIds: readonly string[];
}

export function grantOf(viewer: AudienceViewer | AudienceGrant): AudienceGrant {
  if ('isAdmin' in viewer) return viewer;
  return { isAdmin: isAudienceAdmin(viewer.role), teamIds: viewer.teamIds };
}

/** True when `viewer` may see a resource carrying `audience`. */
export function canSeeAudience(
  audience: Audience,
  viewer: AudienceViewer | AudienceGrant,
): boolean {
  const grant = grantOf(viewer);
  if (grant.isAdmin) return true;
  if (audience.teamIds.length === 0) return true;
  if (grant.teamIds.length === 0) return false;
  const mine = new Set(grant.teamIds);
  return audience.teamIds.some((teamId) => mine.has(teamId));
}

/**
 * The stored form of an audience: trimmed, blanks dropped, duplicates
 * collapsed, first-seen order kept (the order is what the mirrors derive
 * from, so it must be stable).
 */
export function normalizeTeamIds(teamIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of teamIds) {
    const id = raw.trim();
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** True when two audiences name the same teams, whatever the order. */
export function sameAudience(
  a: readonly string[],
  b: readonly string[],
): boolean {
  const left = normalizeTeamIds(a);
  const right = new Set(normalizeTeamIds(b));
  return left.length === right.size && left.every((id) => right.has(id));
}

/**
 * The legacy columns, derived from the array — what the previous image
 * still reads while a release rolls out. `teamId` is the first team,
 * `sharedWithTeamIds` the rest (projects); documents and folders use only
 * `teamId`.
 */
export function audienceMirror(teamIds: readonly string[]): {
  teamId: string | null;
  sharedWithTeamIds: string[];
} {
  return {
    teamId: teamIds[0] ?? null,
    sharedWithTeamIds: teamIds.slice(1),
  };
}

/**
 * The project audience as SQL, for the release that introduces `team_ids`:
 * a project the PREVIOUS image writes during the rollout carries only the
 * legacy pair (`team_ids` stays `'{}'`), and reading the array alone would
 * make it organization-wide — a widening. The fallback closes that window;
 * it goes with the mirror columns. The string form is for column lists
 * assembled as text (`PROJECT_COLUMNS`); {@link projectTeamIdsSql} is the
 * same expression as a fragment for a tagged statement.
 */
export const PROJECT_TEAM_IDS_SQL =
  'CASE WHEN cardinality(team_ids) > 0 THEN team_ids ELSE array_remove(ARRAY[team_id] || shared_with_team_ids, NULL) END';

/** {@link PROJECT_TEAM_IDS_SQL} as a fragment, nestable in any statement. */
export function projectTeamIdsSql(sql: Sql | TransactionSql) {
  return sql`CASE WHEN cardinality(team_ids) > 0 THEN team_ids ELSE array_remove(ARRAY[team_id] || shared_with_team_ids, NULL) END`;
}

/**
 * The array columns the clause may name — a closed list, spelled out per
 * column below so the identifier never travels as a parameter and the
 * fragment needs nothing beyond the tag (a test's fake tag included).
 */
export type AudienceColumn =
  | 'team_tags'
  | 'd.team_tags'
  | 'f.team_tags'
  | 'team_ids'
  | 'p.team_ids'
  | 'project_team_ids';

/**
 * SQL twin of {@link canSeeAudience}: `(admin OR organization-wide OR any
 * team in common)`. One fragment every list and search statement
 * interpolates, so no door can drift from the point read. The
 * `project_team_ids` column is {@link projectTeamIdsSql} — the project
 * audience with its rollout fallback.
 */
export function audienceClause(
  sql: Sql | TransactionSql,
  column: AudienceColumn,
  viewer: AudienceViewer | AudienceGrant,
) {
  const grant = grantOf(viewer);
  const isAdmin = grant.isAdmin;
  const teamIds = [...grant.teamIds];
  switch (column) {
    case 'team_tags':
      return sql`(${isAdmin} OR cardinality(team_tags) = 0 OR team_tags && ${teamIds}::text[])`;
    case 'd.team_tags':
      return sql`(${isAdmin} OR cardinality(d.team_tags) = 0 OR d.team_tags && ${teamIds}::text[])`;
    case 'f.team_tags':
      return sql`(${isAdmin} OR cardinality(f.team_tags) = 0 OR f.team_tags && ${teamIds}::text[])`;
    case 'team_ids':
      return sql`(${isAdmin} OR cardinality(team_ids) = 0 OR team_ids && ${teamIds}::text[])`;
    case 'p.team_ids':
      return sql`(${isAdmin} OR cardinality(p.team_ids) = 0 OR p.team_ids && ${teamIds}::text[])`;
    case 'project_team_ids':
      return sql`(${isAdmin} OR cardinality(${projectTeamIdsSql(sql)}) = 0 OR ${projectTeamIdsSql(sql)} && ${teamIds}::text[])`;
    default: {
      const unreachable: never = column;
      throw new Error(`Unknown audience column: ${String(unreachable)}`);
    }
  }
}

export type TeamAssignmentCode = 'TEAM_NOT_IN_ORG' | 'TEAM_ACCESS_DENIED';

/** A refused assignment — the domain doors re-throw it in their own class. */
export class TeamAssignmentError extends Error {
  readonly code: TeamAssignmentCode;
  readonly status: 400 | 403;
  readonly data: { teamIds: string[] };

  constructor(code: TeamAssignmentCode, message: string, teamIds: string[]) {
    super(message);
    this.name = 'TeamAssignmentError';
    this.code = code;
    this.status = code === 'TEAM_NOT_IN_ORG' ? 400 : 403;
    this.data = { teamIds };
  }
}

/**
 * The one assignment rule, for every door that stamps an audience: every id
 * must be a team of THIS organization (`TEAM_NOT_IN_ORG`, 400), and a
 * non-admin may only name teams they belong to (`TEAM_ACCESS_DENIED`, 403).
 * An empty list is organization-wide and needs no read. Returns the
 * normalized list to store.
 */
export async function assertTeamsAssignable(
  sql: Sql | TransactionSql,
  viewer: AudienceViewer & { organizationId: string },
  teamIds: readonly string[],
): Promise<string[]> {
  const ids = normalizeTeamIds(teamIds);
  if (ids.length === 0) return ids;
  const rows = await sql<{ id: string }[]>`
    SELECT "id" FROM "team"
    WHERE "organizationId" = ${viewer.organizationId} AND "id" = ANY(${ids})
  `;
  const known = new Set(rows.map((row) => row.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new TeamAssignmentError(
      'TEAM_NOT_IN_ORG',
      'A team named here is not one of this organization’s teams',
      unknown,
    );
  }
  if (!isAudienceAdmin(viewer.role)) {
    const mine = new Set(viewer.teamIds);
    const foreign = ids.filter((id) => !mine.has(id));
    if (foreign.length > 0) {
      throw new TeamAssignmentError(
        'TEAM_ACCESS_DENIED',
        'Cannot assign to a team you do not belong to',
        foreign,
      );
    }
  }
  return ids;
}
