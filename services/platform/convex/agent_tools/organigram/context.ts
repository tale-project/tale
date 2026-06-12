import type { ToolCtx } from '@convex-dev/agent';

/** Read an optional string field off the tool context (organizationId, userId). */
export function readCtxString(ctx: ToolCtx, key: string): string | undefined {
  const value: unknown = Reflect.get(ctx, key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
