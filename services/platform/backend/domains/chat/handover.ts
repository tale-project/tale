import type { Sql } from 'postgres';

import { findOrganizationMember } from '../../auth/membership.ts';
import { getProjectAuthContext, listProjects } from '../projects/service.ts';
import { mentionAutomationEnabled } from '../tasks/run-start.ts';

/**
 * What the chat's hand-over note (`lib/chat/handover.ts`) is built from, for
 * one person: the active projects they can open, each with its agent count
 * and whether they may add agents to it, and whether the organization lets
 * agents start at all (a broken policy reads as off, as for a mention).
 */
export interface TaskHandoverFacts {
  projects: { name: string; agentCount: number; canEdit: boolean }[];
  automationEnabled: boolean;
}

export async function readTaskHandoverFacts(
  sql: Sql,
  args: { organizationId: string; userId: string },
): Promise<TaskHandoverFacts> {
  const member = await findOrganizationMember(
    sql,
    args.organizationId,
    args.userId,
  );
  if (member === null || member.role === 'disabled') {
    return { projects: [], automationEnabled: false };
  }
  const auth = await getProjectAuthContext(sql, {
    organizationId: args.organizationId,
    userId: args.userId,
    role: member.role,
  });
  const projects = await listProjects(sql, auth);
  return {
    projects: projects.map((project) => ({
      name: project.name,
      agentCount: project.projectAgentCount,
      canEdit: project.canEdit,
    })),
    automationEnabled: await mentionAutomationEnabled(sql, args.organizationId),
  };
}
