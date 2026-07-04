/**
 * Internal mutation wrapping `AuditLogHelpers.logSuccess` for agent CRUD.
 *
 * Mirrors `convex/skills/audit_mutations.ts`. Agent writes touch
 * capability-bearing fields (tool names, integration bindings, workflow
 * bindings, skill bindings, delegates) — they must be auditable so an
 * operator can reconstruct who widened an agent's grants and when.
 *
 * `file_actions.ts` runs in the Node environment (`'use node'`), so it
 * cannot insert directly into `auditLogs`. This thin V8 mutation accepts
 * a denormalized payload and forwards it to the helper.
 */

import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import * as AuditLogHelpers from '../audit_logs/helpers';

const ALLOWED_ACTIONS = [
  'create_agent',
  'update_agent',
  'duplicate_agent',
  'delete_agent',
  'restore_agent',
] as const;
type AllowedAction = (typeof ALLOWED_ACTIONS)[number];

export const logAgentAuditEvent = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    actorEmail: v.optional(v.string()),
    actorRole: v.optional(v.string()),
    action: v.union(...ALLOWED_ACTIONS.map((a) => v.literal(a))),
    resourceId: v.string(),
    resourceName: v.optional(v.string()),
    previousState: v.optional(v.any()),
    newState: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actorEntry: {
      id: string;
      email?: string;
      role?: string;
      type: 'user';
    } = {
      id: args.actorId,
      type: 'user',
    };
    if (args.actorEmail !== undefined) actorEntry.email = args.actorEmail;
    if (args.actorRole !== undefined) actorEntry.role = args.actorRole;

    await AuditLogHelpers.logSuccess(ctx, {
      auditCtx: {
        organizationId: args.organizationId,
        actor: actorEntry,
      },
      action: args.action satisfies AllowedAction,
      category: 'agent',
      resourceType: 'agent',
      resourceId: args.resourceId,
      ...(args.resourceName !== undefined && {
        resourceName: args.resourceName,
      }),
      previousState: redact(args.previousState),
      newState: redact(args.newState),
    });
    return null;
  },
});

function redact(state: unknown): Record<string, unknown> | undefined {
  if (state === null || state === undefined) return undefined;
  if (typeof state !== 'object' || Array.isArray(state)) return undefined;
  const dict: Record<string, unknown> = {};
  for (const key of Object.keys(state)) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by typeof===object + !Array.isArray check above
    dict[key] = (state as { [k: string]: unknown })[key];
  }
  return AuditLogHelpers.redactSensitiveFields(dict);
}
