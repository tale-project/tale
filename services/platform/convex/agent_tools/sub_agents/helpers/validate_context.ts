/**
 * Validates tool context and returns early error response if invalid.
 */

import type { ToolCtx } from '@convex-dev/agent';

import type { SubAgentType } from './types';

import { errorResponse, type ToolResponse } from './tool_response';

interface ValidatedContext {
  organizationId: string;
  threadId: string;
  userId?: string;
}

type ValidationResult =
  | { valid: true; context: ValidatedContext }
  | { valid: false; error: ToolResponse };

export function validateToolContext(
  ctx: ToolCtx,
  toolName: SubAgentType,
  options?: { requireUserId?: boolean },
): ValidationResult {
  const { organizationId, threadId, userId } = ctx;

  if (!organizationId) {
    return { valid: false, error: errorResponse('organizationId is required') };
  }

  if (!threadId) {
    return {
      valid: false,
      error: errorResponse(
        `threadId is required for ${toolName} to create sub-threads`,
      ),
    };
  }

  if (options?.requireUserId && !userId) {
    return {
      valid: false,
      error: errorResponse(
        `Both threadId and userId are required for ${toolName}`,
      ),
    };
  }

  return {
    valid: true,
    context: { organizationId, threadId, userId },
  };
}
