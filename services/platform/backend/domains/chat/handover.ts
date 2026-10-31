import type { Sql } from 'postgres';

import { HANDOVER_PROJECTS_NAMED } from '../../../lib/chat/handover.ts';
import { findOrganizationMember } from '../../auth/membership.ts';
import { EDITOR_ROLES } from '../../core/projects/access.ts';
import {
  getProjectAuthContext,
  readProjectAgentCoverage,
} from '../projects/service.ts';
import { readStandardAgentAvailability } from '../projects/standard-agent.ts';
import { mentionAutomationEnabled } from '../tasks/run-start.ts';

/**
 * What the chat's hand-over note (`lib/chat/handover.ts`) is built from, for
 * one person: the active projects they can open with an agent (the newest
 * the note names, and how many more), how many have none and whether they
 * may add agents to those, whether the organization lets agents start at
 * all (a broken policy reads as off, as for a mention), and whether its
 * standard agent would take work in a project without agents for this
 * person.
 */
export interface TaskHandoverFacts {
  projectsWithAgents: string[];
  moreProjectsWithAgents: number;
  projectsWithoutAgents: number;
  canAddAgents: boolean;
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
    return {
      projectsWithAgents: [],
      moreProjectsWithAgents: 0,
      projectsWithoutAgents: 0,
      canAddAgents: false,
      automationEnabled: false,
      standardAgent: false,
    };
  }
  const auth = await getProjectAuthContext(sql, {
    organizationId: args.organizationId,
    userId: args.userId,
    role: member.role,
  });
  // The projects are counted where they live: only the names the note
  // shows come back, never the person's whole project list.
  const coverage = await readProjectAgentCoverage(
    sql,
    auth,
    HANDOVER_PROJECTS_NAMED,
  );
  return {
    projectsWithAgents: coverage.named,
    moreProjectsWithAgents: Math.max(
      coverage.withAgents - coverage.named.length,
      0,
    ),
    projectsWithoutAgents: coverage.withoutAgents,
    // An editor role edits every active project it reads (`checkProjectAccess`).
    canAddAgents: coverage.withoutAgents > 0 && EDITOR_ROLES.has(auth.role),
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
