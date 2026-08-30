import { AppError } from '../../lib/shared/errors/app-error';
import type { QueryCtx } from '../_generated/server';

// The org-level agent catalog (install/enable/uninstall, `agentInstallations`)
// was retired with the chat/agents domain; the assignable workers are now
// `projectAgents` rows — the user-created instances on a project's Agents
// tab. This module keeps the one export task CRUD needs: the liveness gate an
// agent assignee passes before an assignment lands. Project membership is the
// separate `assertAgentAssigneeInProject` gate in
// `projects/resolve_project_access.ts`.

/**
 * An AGENT assignee must name an existing project agent of this organization
 * — assigning a task to a missing or foreign agent would look like a normal
 * assignment and then never be picked up. No-op for `null`, human, and
 * automation assignees so the rest of task CRUD passes through untouched.
 */
export async function assertAgentAssigneeLive(
  ctx: QueryCtx,
  organizationId: string,
  assignee: {
    assigneeType: 'user' | 'agent' | 'app';
    assigneeId: string;
  } | null,
): Promise<void> {
  if (!assignee || assignee.assigneeType !== 'agent') return;
  const agentId = ctx.db.normalizeId('projectAgents', assignee.assigneeId);
  const agent = agentId === null ? null : await ctx.db.get(agentId);
  if (agent === null || agent.organizationId !== organizationId) {
    throw new AppError({
      code: 'AGENT_NOT_LIVE',
      message: `No agent "${assignee.assigneeId}" exists in this organization.`,
    });
  }
}
