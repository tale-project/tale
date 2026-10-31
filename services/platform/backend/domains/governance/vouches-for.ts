import type { Sql, TransactionSql } from 'postgres';

/**
 * Which competence records vouch for `userId`, as a condition on the
 * register row `c` (`app.competence_records c`): the member's own grant, and
 * a grant to a team they belong to through a membership an admin made — the
 * `app.admin_added_team_members` record the admin door writes with the
 * "teamMember" row (0226). A member who joins the team later holds the
 * team's grants, and one who leaves it stops holding them. A membership SCIM
 * or SSO group sync made carries no record, so an identity provider never
 * confers a right through a team grant. Not `getUserTeamIds`: it folds in an
 * API key's own team, and a team's key must not inherit the team's grants.
 *
 * The caller still filters by organization, competence, revocation and
 * expiry; a grant in another organization vouches for nobody here.
 */
export function vouchesForUser(sql: Sql | TransactionSql, userId: string) {
  return sql`(
    c.user_id = ${userId}
    OR (c.team_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM "teamMember" tm
      JOIN app.admin_added_team_members a ON a.team_member_id = tm."id"
      WHERE tm."teamId" = c.team_id AND tm."userId" = ${userId}
        AND a.org_id = c.org_id
    ))
  )`;
}
