import { v } from 'convex/values';

import { internalMutation } from '../../_generated/server';
import * as AuditLogHelpers from '../../audit_logs/helpers';

/**
 * V8 audit-log writes for the file-backed SSO config.
 *
 * The connection config itself lives in per-org JSON files (written by the
 * `'use node'` `config/file_actions.ts`); only the security audit trail is a DB
 * row, so the node write actions call this after persisting the files.
 */

const ssoAuditActionValidator = v.union(
  v.literal('sso_configure'),
  v.literal('sso_enabled'),
  v.literal('sso_disabled'),
  v.literal('sso_removed'),
);

export const logSsoConfigAudit = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    actorEmail: v.optional(v.string()),
    actorRole: v.optional(v.string()),
    action: ssoAuditActionValidator,
    newState: v.optional(v.record(v.string(), v.any())),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await AuditLogHelpers.logSuccess(ctx, {
      auditCtx: {
        organizationId: args.organizationId,
        actor: {
          id: args.actorId,
          email: args.actorEmail,
          role: args.actorRole,
          type: 'user' as const,
        },
      },
      action: args.action,
      category: 'security',
      resourceType: 'sso',
      resourceId: args.organizationId,
      newState: args.newState,
    });
    return null;
  },
});
