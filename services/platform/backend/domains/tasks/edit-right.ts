import type { Sql, TransactionSql } from 'postgres';

import { findActingMember, getActingAudience } from '../../auth/membership.ts';
import { PROJECT_TEAM_IDS_SQL } from '../../core/lib/audience.ts';
import {
  checkProjectAccess,
  type ProjectAccessResult,
} from '../../core/projects/access.ts';

/**
 * Which of the named projects a member of the organization may edit now: a
 * live member with the Editor role or higher and each project's audience. A
 * user id may be an API key that is not a person: it acts with the role it
 * was made with, and the audience it was given (`findActingMember`) — a
 * project's own key that one project alone. A disabled member, someone who
 * left, and a project of another organization edit nothing.
 *
 * The one rule a run's person starter (`run-authority.ts`) and the authority
 * over a dispatch's other boards (`dispatch-reach.ts`) are judged by, read
 * fresh every time it is asked: a lost role or audience stops the next use.
 */
export async function memberEditableProjects(
  sql: Sql | TransactionSql,
  args: { organizationId: string; userId: string; projectIds: string[] },
): Promise<Set<string>> {
  return memberProjectsWhere(sql, args, (access) => access.canEdit);
}

/**
 * Which of the named projects a member of the organization may read now:
 * {@link memberEditableProjects}'s rule for any role — a member reads the
 * projects of their audience they may not edit. What a person's run of an
 * agent on another project's board reads by (`run-authority.ts`).
 */
export async function memberReadableProjects(
  sql: Sql | TransactionSql,
  args: { organizationId: string; userId: string; projectIds: string[] },
): Promise<Set<string>> {
  return memberProjectsWhere(sql, args, (access) => access.canRead);
}

async function memberProjectsWhere(
  sql: Sql | TransactionSql,
  args: { organizationId: string; userId: string; projectIds: string[] },
  allows: (access: ProjectAccessResult) => boolean,
): Promise<Set<string>> {
  const allowed = new Set<string>();
  if (args.projectIds.length === 0) return allowed;
  const member = await findActingMember(sql, args.organizationId, args.userId);
  if (member === null) return allowed;
  const role = member.role.toLowerCase();
  if (role === 'disabled') return allowed;
  const projects = await sql<{ id: string; teamIds: string[] | null }[]>`
    SELECT id, ${sql.unsafe(PROJECT_TEAM_IDS_SQL)} AS "teamIds"
    FROM app.projects
    WHERE id = ANY(${args.projectIds}) AND org_id = ${args.organizationId}
  `;
  if (projects.length === 0) return allowed;
  const audience = await getActingAudience(
    sql,
    args.organizationId,
    args.userId,
  );
  for (const project of projects) {
    if (
      (audience.projectScope === undefined ||
        audience.projectScope === project.id) &&
      allows(
        checkProjectAccess(
          { teamIds: project.teamIds ?? [] },
          audience.teamIds,
          role,
        ),
      )
    ) {
      allowed.add(project.id);
    }
  }
  return allowed;
}
