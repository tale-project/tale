import { GenericActionCtx } from 'convex/server';
import { DataModel, Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { decryptString } from '../lib/crypto/decrypt_string';

type RoleMappingRule = {
  source: 'jobTitle' | 'appRole';
  pattern: string;
  targetRole: 'admin' | 'developer' | 'editor' | 'member' | 'disabled';
};

type GetWithClientIdResult = {
  _id: Id<'ssoProviders'>;
  organizationId: string;
  providerId: string;
  issuer: string;
  clientId: string;
  scopes: string[];
  autoProvisionTeam: boolean;
  excludeGroups: string[];
  autoProvisionRole: boolean;
  roleMappingRules: RoleMappingRule[];
  defaultRole: 'admin' | 'developer' | 'editor' | 'member' | 'disabled';
  enableOneDriveAccess: boolean;
  createdAt: number;
  updatedAt: number;
} | null;

export async function getWithClientId(
  ctx: GenericActionCtx<DataModel>,
): Promise<GetWithClientIdResult> {
  const authUser: { _id: string } | null = await ctx.runQuery(
    internal.sso_providers.internal_queries.getAuthUser,
    {},
  );

  if (!authUser) {
    return null;
  }

  const provider = await ctx.runQuery(
    internal.sso_providers.internal_queries.getSsoConfig,
    {},
  );

  if (!provider) {
    return null;
  }

  const clientId = await decryptString(provider.clientIdEncrypted);

  return {
    _id: provider._id,
    organizationId: provider.organizationId,
    providerId: provider.providerId,
    issuer: provider.issuer,
    clientId,
    scopes: provider.scopes,
    autoProvisionTeam: provider.autoProvisionTeam,
    excludeGroups: provider.excludeGroups,
    autoProvisionRole: provider.autoProvisionRole,
    roleMappingRules: provider.roleMappingRules,
    defaultRole: provider.defaultRole,
    enableOneDriveAccess: provider.enableOneDriveAccess ?? false,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}
