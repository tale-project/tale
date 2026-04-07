/**
 * Role-based access control for restricted sub-agent tools.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { internal } from '../../../_generated/api';
import { errorResponse, type ToolResponse } from './tool_response';

type PrivilegedRole = 'admin' | 'developer';

const privilegedRoles = new Set<string>(['admin', 'developer']);

function isPrivilegedRole(role: string): role is PrivilegedRole {
  return privilegedRoles.has(role.toLowerCase());
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
  const userRole = await ctx.runQuery(
    internal.members.internal_queries.getMemberRole,
    {
      userId,
      organizationId,
    },
  );

  const normalizedRole = (userRole ?? 'member').toLowerCase();

  if (!isPrivilegedRole(normalizedRole)) {
    console.log(`[${toolName}] Access denied for role:`, normalizedRole);
    return {
      allowed: false,
      role: normalizedRole,
      error: errorResponse(
        `This action requires additional permissions that are not available for your account.\n\nInstructions:\n- Politely inform the user that this action requires administrator permissions\n- Do NOT mention specific role names or technical details\n- Suggest they contact their organization administrator for access`,
      ),
    };
  }

  return { allowed: true, role: normalizedRole };
}
