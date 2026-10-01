import type { Sql } from 'postgres';

import { findOrganizationMember } from '../../auth/membership.ts';
import { getProjectAuthContext, listProjects } from '../projects/service.ts';
import { readStandardAgentAvailability } from '../projects/standard-agent.ts';
import { mentionAutomationEnabled } from '../tasks/run-start.ts';

/**
 * What the chat's hand-over note (`lib/chat/handover.ts`) is built from, for
 * one person: the active projects they can open, each with its agent count
 * and whether they may add agents to it, whether the organization lets
 * agents start at all (a broken policy reads as off, as for a mention), and
 * whether its standard agent would take work in a project without agents
 * for this person.
 */
export interface TaskHandoverFacts {
  projects: { name: string; agentCount: number; canEdit: boolean }[];
  automationEnabled: boolean;
  standardAgent: boolean;
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
    return { projects: [], automationEnabled: false, standardAgent: false };
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
    // One fact of several: a failed read says no standard agent rather
    // than costing the person the whole note.
    standardAgent: await readStandardAgentAvailability(sql, args).then(
      (availability) => availability.available,
      (error: unknown) => {
        console.warn(
          `[chat] standard agent availability unread for the hand-over note (organization ${args.organizationId}):`,
          error instanceof Error ? error.message : error,
        );
        return false;
      },
    ),
  };
}
