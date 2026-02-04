import { GenericActionCtx } from 'convex/server';
import { DataModel } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { validateSsoConfig } from './validate_sso_config';

type RoleMappingRule = {
  source: 'jobTitle' | 'appRole';
  pattern: string;
  targetRole: 'admin' | 'developer' | 'editor' | 'member' | 'disabled';
};

type UpsertSsoProviderArgs = {
  organizationId: string;
  providerId: string;
  issuer: string;
  clientId: string;
  clientSecret?: string;
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
};

export async function upsertSsoProvider(
  ctx: GenericActionCtx<DataModel>,
  args: UpsertSsoProviderArgs,
): Promise<string> {
  const authUser: { _id: string; email: string; name: string } | null = await ctx.runQuery(
    internal.sso_providers.internal_queries.getAuthUser,
    {},
  );
  if (!authUser) {
    throw new Error('Unauthenticated');
  }

  const callerRole: string | null = await ctx.runQuery(
    internal.sso_providers.internal_queries.getCallerRole,
    {
      organizationId: args.organizationId,
      userId: authUser._id,
    },
  );

  if (callerRole !== 'admin') {
    throw new Error('Only Admins can configure SSO providers');
  }

  // Get existing provider to check if we need to reuse credentials
  const existingProvider = await ctx.runQuery(
    internal.sso_providers.internal_queries.getByOrganization,
    { organizationId: args.organizationId },
  );

  let clientIdEncrypted: string;
  let clientSecretEncrypted: string;

  if (args.clientSecret) {
    // New secret provided - validate and encrypt
    const validation = await validateSsoConfig({
      issuer: args.issuer,
      clientId: args.clientId,
      clientSecret: args.clientSecret,
    });

    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid SSO configuration');
    }

    clientIdEncrypted = await ctx.runAction(
      internal.lib.crypto.actions.encryptStringInternal,
      { plaintext: args.clientId },
    );

    clientSecretEncrypted = await ctx.runAction(
      internal.lib.crypto.actions.encryptStringInternal,
      { plaintext: args.clientSecret },
    );
  } else if (existingProvider) {
    // No new secret - reuse existing encrypted values
    clientIdEncrypted = existingProvider.clientIdEncrypted;
    clientSecretEncrypted = existingProvider.clientSecretEncrypted;
  } else {
    throw new Error('Client secret is required for new SSO configuration');
  }

  const providerId: string = await ctx.runMutation(
    internal.sso_providers.internal_mutations.upsertProvider,
    {
      organizationId: args.organizationId,
      providerId: args.providerId,
      issuer: args.issuer,
      clientIdEncrypted,
      clientSecretEncrypted,
      scopes: args.scopes,
      autoProvisionTeam: args.autoProvisionTeam,
      excludeGroups: args.excludeGroups,
      autoProvisionRole: args.autoProvisionRole,
      roleMappingRules: args.roleMappingRules,
      defaultRole: args.defaultRole,
      enableOneDriveAccess: args.enableOneDriveAccess,
      actorId: authUser._id,
      actorEmail: authUser.email,
      actorRole: callerRole,
    },
  );

  return providerId;
}
