import { internal } from '../../../../_generated/api';
import type { ActionCtx } from '../../../../_generated/server';
import { accountEmailFromIntegration } from '../../../../integrations/resolve_integration_account_email';
import { resolveOrgSlug } from '../../../../organizations/resolve_org_slug';

/**
 * Resolve the account email for sent-mail sync when the workflow omits it.
 * Uses the integration's From address, then the mailbox login.
 */
export async function resolveIntegrationAccountEmail(
  ctx: ActionCtx,
  params: { organizationId: string; integrationName: string },
): Promise<string | undefined> {
  const orgSlug = await resolveOrgSlug(ctx, params.organizationId);
  const integration = await ctx.runAction(
    internal.integrations.load_integration.loadIntegration,
    {
      orgSlug,
      organizationId: params.organizationId,
      slug: params.integrationName,
    },
  );

  if (!integration) {
    return undefined;
  }

  return accountEmailFromIntegration(integration);
}
