import { GenericQueryCtx } from 'convex/server';
import { DataModel, Id } from '../_generated/dataModel';
import { authComponent } from '../auth';

type RoleMappingRule = {
  source: 'jobTitle' | 'appRole';
  pattern: string;
  targetRole: 'admin' | 'developer' | 'editor' | 'member' | 'disabled';
};

type GetResult = {
  _id: Id<'ssoProviders'>;
  organizationId: string;
  providerId: string;
  issuer: string;
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

export async function get(ctx: GenericQueryCtx<DataModel>): Promise<GetResult> {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    return null;
  }

  const provider = await ctx.db.query('ssoProviders').first();

  if (!provider) {
    return null;
  }

  return {
    _id: provider._id,
    organizationId: provider.organizationId,
    providerId: provider.providerId,
    issuer: provider.issuer,
    scopes: provider.scopes,
    autoProvisionTeam: provider.autoProvisionTeam ?? false,
    excludeGroups: provider.excludeGroups ?? [],
    autoProvisionRole: provider.autoProvisionRole ?? false,
    roleMappingRules: provider.roleMappingRules ?? [],
    defaultRole: provider.defaultRole ?? 'member',
    enableOneDriveAccess: provider.enableOneDriveAccess ?? false,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}
