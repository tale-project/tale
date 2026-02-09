import { GenericMutationCtx } from 'convex/server';

import type {
  PlatformRole,
  ProviderFeatures,
  RoleMappingRule,
} from '@/lib/shared/schemas/sso_providers';

import { DataModel } from '../_generated/dataModel';
import * as AuditLogHelpers from '../audit_logs/helpers';

type UpsertProviderArgs = {
  organizationId: string;
  providerId: string;
  issuer: string;
  clientIdEncrypted: string;
  clientSecretEncrypted: string;
  scopes: string[];
  autoProvisionRole: boolean;
  roleMappingRules: RoleMappingRule[];
  defaultRole: PlatformRole;
  providerFeatures?: ProviderFeatures;
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
    .withIndex('organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
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
      autoProvisionRole: args.autoProvisionRole,
      roleMappingRules: args.roleMappingRules,
      defaultRole: args.defaultRole,
      providerFeatures: args.providerFeatures,
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
      autoProvisionRole: args.autoProvisionRole,
      roleMappingRules: args.roleMappingRules,
      defaultRole: args.defaultRole,
      providerFeatures: args.providerFeatures,
      createdAt: now,
      updatedAt: now,
    });
  }

  const entraFeatures = args.providerFeatures?.entraId;

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
      autoProvisionTeam: entraFeatures?.autoProvisionTeam,
      autoProvisionRole: args.autoProvisionRole,
    },
  );

  return providerId;
}
