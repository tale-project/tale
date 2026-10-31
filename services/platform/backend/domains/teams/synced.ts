import type { Sql, TransactionSql } from 'postgres';

/**
 * Whether the team `t` of the statement is one an identity provider
 * provisions — SSO group sync created it (`app.sso_synced_teams`) or SCIM
 * links it as a Group — so the provider owns its membership. The Teams
 * page's `synced` flag, and why the competence register refuses to grant to
 * such a team. A fragment, nestable in any statement that names the team `t`.
 */
export function teamIsSyncedSql(sql: Sql | TransactionSql) {
  return sql`(
    EXISTS (
      SELECT 1 FROM app.sso_synced_teams s
      WHERE s.org_id = t."organizationId" AND s.team_id = t."id"
    ) OR EXISTS (
      SELECT 1 FROM app.sso_provisioning_links l
      WHERE l.org_id = t."organizationId" AND l.internal_id = t."id"
        AND l.resource_type = 'Group'
    )
  )`;
}
