/**
 * Internal mutation wrapping `AuditLogHelpers.logSuccess` for skill CRUD.
 *
 * The skill actions in `file_actions.ts` run in the Node environment
 * (`'use node'`), so they cannot insert directly into the audit_logs
 * table. This thin V8 mutation accepts a denormalized audit payload and
 * forwards it to the helper.
 */

import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import * as AuditLogHelpers from '../audit_logs/helpers';

const ALLOWED_ACTIONS = [
  'create_skill',
  'update_skill',
  'delete_skill',
  'write_skill_asset',
  'delete_skill_asset',
  // `skill_run` invocations from `skills_runtime.ts:createSkillRunTool` —
  // executes arbitrary bundle scripts so every call gets an org-visible
  // audit row regardless of success/failure.
  'execute_skill',
] as const;
type AllowedAction = (typeof ALLOWED_ACTIONS)[number];

export const logSkillAuditEvent = internalMutation({
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
    /**
     * 'failure' routes through `logFailure` instead of `logSuccess` so a
     * sandbox-throwing `execute_skill` doesn't masquerade as a clean run
     * in audit reports. Default 'success' preserves call sites that don't
     * care about status (every CRUD path).
     */
    status: v.optional(v.union(v.literal('success'), v.literal('failure'))),
    errorMessage: v.optional(v.string()),
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

    const auditCtx = {
      organizationId: args.organizationId,
      actor: actorEntry,
    };
    if (args.status === 'failure') {
      await AuditLogHelpers.logFailure(ctx, {
        auditCtx,
        action: args.action satisfies AllowedAction,
        category: 'skill',
        resourceType: 'skill',
        resourceId: args.resourceId,
        ...(args.resourceName !== undefined && {
          resourceName: args.resourceName,
        }),
        // logFailure requires a non-empty errorMessage. Fall back to a
        // generic marker when the caller omits one so the row still lands
        // (better an unspecific failure record than a swallowed audit).
        errorMessage: args.errorMessage ?? 'unspecified failure',
        metadata: redact(args.newState),
      });
    } else {
      await AuditLogHelpers.logSuccess(ctx, {
        auditCtx,
        action: args.action satisfies AllowedAction,
        category: 'skill',
        resourceType: 'skill',
        resourceId: args.resourceId,
        ...(args.resourceName !== undefined && {
          resourceName: args.resourceName,
        }),
        previousState: redact(args.previousState),
        newState: redact(args.newState),
      });
    }
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
