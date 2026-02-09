import { GenericQueryCtx } from 'convex/server';

import type {
  PlatformRole,
  RoleMappingRule,
  ProviderFeatures,
} from '@/lib/shared/schemas/sso_providers';

import { DataModel, Id } from '../_generated/dataModel';

type SsoConfig = {
  _id: Id<'ssoProviders'>;
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
  createdAt: number;
  updatedAt: number;
} | null;

export async function getSsoConfig(
  ctx: GenericQueryCtx<DataModel>,
): Promise<SsoConfig> {
  const provider = await ctx.db.query('ssoProviders').first();

  if (!provider) {
    return null;
  }

  return {
    _id: provider._id,
    organizationId: provider.organizationId,
    providerId: provider.providerId,
    issuer: provider.issuer,
    clientIdEncrypted: provider.clientIdEncrypted,
    clientSecretEncrypted: provider.clientSecretEncrypted,
    scopes: provider.scopes,
    autoProvisionRole: provider.autoProvisionRole ?? false,
    roleMappingRules: provider.roleMappingRules ?? [],
    defaultRole: provider.defaultRole ?? 'member',
    providerFeatures: provider.providerFeatures,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}
