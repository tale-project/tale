import { GenericMutationCtx } from 'convex/server';
import { DataModel } from '../_generated/dataModel';
import * as AuditLogHelpers from '../audit_logs/helpers';

type RoleMappingRule = {
  source: 'jobTitle' | 'appRole';
  pattern: string;
  targetRole: 'admin' | 'developer' | 'editor' | 'member' | 'disabled';
};

type UpsertProviderArgs = {
  organizationId: string;
  providerId: string;
  issuer: string;
  clientIdEncrypted: string;
  clientSecretEncrypted: string;
  scopes: string[];
  // Team provisioning
  autoProvisionTeam: boolean;
  excludeGroups: string[];
  // Role provisioning
  autoProvisionRole: boolean;
  roleMappingRules: RoleMappingRule[];
  defaultRole: 'admin' | 'developer' | 'editor' | 'member' | 'disabled';
  // OneDrive
  enableOneDriveAccess?: boolean;
  // Actor
  actorId: string;
  actorEmail: string;
  actorRole: string;
};

export async function upsertProvider(
  ctx: GenericMutationCtx<DataModel>,
  args: UpsertProviderArgs,
): Promise<string> {
  const existing = await ctx.db
    .query('ssoProviders')
    .withIndex('organizationId', (q) => q.eq('organizationId', args.organizationId))
    .first();

  const now = Date.now();
  let providerId: string;
  let isNew = false;

  if (existing) {
    await ctx.db.patch(existing._id, {
      providerId: args.providerId,
      issuer: args.issuer,
      clientIdEncrypted: args.clientIdEncrypted,
      clientSecretEncrypted: args.clientSecretEncrypted,
      scopes: args.scopes,
      autoProvisionTeam: args.autoProvisionTeam,
      excludeGroups: args.excludeGroups,
      autoProvisionRole: args.autoProvisionRole,
      roleMappingRules: args.roleMappingRules,
      defaultRole: args.defaultRole,
      enableOneDriveAccess: args.enableOneDriveAccess ?? false,
      updatedAt: now,
    });
    providerId = existing._id;
  } else {
    isNew = true;
    providerId = await ctx.db.insert('ssoProviders', {
      organizationId: args.organizationId,
      providerId: args.providerId,
      issuer: args.issuer,
      clientIdEncrypted: args.clientIdEncrypted,
      clientSecretEncrypted: args.clientSecretEncrypted,
      scopes: args.scopes,
      autoProvisionTeam: args.autoProvisionTeam,
      excludeGroups: args.excludeGroups,
      autoProvisionRole: args.autoProvisionRole,
      roleMappingRules: args.roleMappingRules,
      defaultRole: args.defaultRole,
      enableOneDriveAccess: args.enableOneDriveAccess ?? false,
      createdAt: now,
      updatedAt: now,
    });
  }

  await AuditLogHelpers.logSuccess(
    ctx,
    {
      organizationId: args.organizationId,
      actor: {
        id: args.actorId,
        email: args.actorEmail,
        role: args.actorRole,
        type: 'user',
      },
    },
    isNew ? 'sso_provider_created' : 'sso_provider_updated',
    'integration',
    'ssoProvider',
    providerId,
    args.providerId,
    undefined,
    {
      providerId: args.providerId,
      autoProvisionTeam: args.autoProvisionTeam,
      autoProvisionRole: args.autoProvisionRole,
    },
  );

  return providerId;
}
