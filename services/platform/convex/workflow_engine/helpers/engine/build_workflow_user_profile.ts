/**
 * Build userProfile string for workflow LLM steps.
 *
 * Fetches user identity data (name, email, role, organization) from the database
 * and formats it as a prompt-ready text block. Reuses the shared buildUserProfile()
 * function from agent response resolution.
 */

import type { ActionCtx } from '../../../_generated/server';

import {
  buildUserProfile,
  fetchMemberRole,
  fetchOrganization,
  fetchUser,
} from '../../../lib/agent_response/resolve_template_variables';

export async function buildWorkflowUserProfile(
  ctx: ActionCtx,
  organizationId: string,
  userId: unknown,
): Promise<string> {
  if (typeof userId !== 'string') return '';

  const [orgResult, userResult, memberRole] = await Promise.all([
    fetchOrganization(ctx, organizationId),
    fetchUser(ctx, userId),
    fetchMemberRole(ctx, organizationId, userId),
  ]);

  return buildUserProfile(
    { organizationId, userId },
    {
      organizationName: orgResult.name,
      userName: userResult.name,
      userEmail: userResult.email,
      userRole: memberRole ?? undefined,
    },
  );
}
