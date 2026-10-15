import type { Sql, TransactionSql } from 'postgres';

import { findActingMember, getUserTeamIds } from '../../auth/membership.ts';
import { PROJECT_TEAM_IDS_SQL } from '../../core/lib/audience.ts';
import { checkProjectAccess } from '../../core/projects/access.ts';

/**
 * Which of the named projects a member of the organization may edit now: a
 * live member with the Editor role or higher and each project's audience. A
 * user id may be an API key that is not a person: it acts with the role it
 * was made with, and the audience it was given (`findActingMember`). A
 * disabled member, someone who left, and a project of another organization
 * edit nothing.
 *
 * The one rule a run's person starter (`run-authority.ts`) and the authority
 * over a dispatch's other boards (`dispatch-reach.ts`) are judged by, read
 * fresh every time it is asked: a lost role or audience stops the next use.
 */
export async function memberEditableProjects(
  sql: Sql | TransactionSql,
  args: { organizationId: string; userId: string; projectIds: string[] },
): Promise<Set<string>> {
  const editable = new Set<string>();
  if (args.projectIds.length === 0) return editable;
  const member = await findActingMember(sql, args.organizationId, args.userId);
  if (member === null) return editable;
  const role = member.role.toLowerCase();
  if (role === 'disabled') return editable;
  const projects = await sql<{ id: string; teamIds: string[] | null }[]>`
    SELECT id, ${sql.unsafe(PROJECT_TEAM_IDS_SQL)} AS "teamIds"
    FROM app.projects
    WHERE id = ANY(${args.projectIds}) AND org_id = ${args.organizationId}
  `;
  if (projects.length === 0) return editable;
  const teamIds = await getUserTeamIds(sql, args.organizationId, args.userId);
  for (const project of projects) {
    if (
      checkProjectAccess({ teamIds: project.teamIds ?? [] }, teamIds, role)
        .canEdit
    ) {
      editable.add(project.id);
    }
  }
  return editable;
}
