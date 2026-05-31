import type { ToolCtx } from '@convex-dev/agent';
import { ConvexError } from 'convex/values';

/** Read an arbitrary string field off the (dynamically-shaped) ToolCtx. */
function readStringContextField(ctx: ToolCtx, key: string): string | undefined {
  const value: unknown = Reflect.get(ctx, key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** The organizationId is always present on a chat-bound ToolCtx. */
export function requireOrganizationId(ctx: ToolCtx): string {
  const organizationId = readStringContextField(ctx, 'organizationId');
  if (!organizationId) {
    throw new ConvexError({ code: 'TOOL_NO_ORG_CONTEXT' });
  }
  return organizationId;
}

/**
 * Resolve the acting agent's identity for task-domain attribution. Prefers an
 * explicit agent slug, falls back to the bound user id, then a generic 'agent'
 * sentinel. (Threading a reliable agentSlug through ToolCtx is finalized in the
 * collaboration milestone.)
 */
export function resolveActorId(ctx: ToolCtx): string {
  return (
    readStringContextField(ctx, 'agentSlug') ??
    readStringContextField(ctx, 'agentId') ??
    readStringContextField(ctx, 'userId') ??
    'agent'
  );
}
