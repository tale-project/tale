/**
 * Role-based access control for restricted sub-agent tools.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { getGetMemberRoleInternalRef } from '../../../lib/function_refs';
import { errorResponse, type ToolResponse } from './tool_response';

const PRIVILEGED_ROLES = ['admin', 'developer'] as const;
type PrivilegedRole = (typeof PRIVILEGED_ROLES)[number];

function isPrivilegedRole(role: string): role is PrivilegedRole {
  return PRIVILEGED_ROLES.includes(role.toLowerCase() as PrivilegedRole);
}

interface RoleCheckResult {
  allowed: boolean;
  role: string;
  error?: ToolResponse;
}

export async function checkRoleAccess(
  ctx: ToolCtx,
  userId: string,
  organizationId: string,
  toolName: string,
): Promise<RoleCheckResult> {
  const userRole = await ctx.runQuery(getGetMemberRoleInternalRef(), {
    userId,
    organizationId,
  });

  const normalizedRole = (userRole ?? 'member').toLowerCase();

  if (!isPrivilegedRole(normalizedRole)) {
    console.log(`[${toolName}] Access denied for role:`, normalizedRole);
    return {
      allowed: false,
      role: normalizedRole,
      error: errorResponse(
        `Access denied: The ${toolName.replace(/_/g, ' ')} is only available to users with admin or developer roles. Your current role is "${normalizedRole}".`,
      ),
    };
  }

  return { allowed: true, role: normalizedRole };
}
