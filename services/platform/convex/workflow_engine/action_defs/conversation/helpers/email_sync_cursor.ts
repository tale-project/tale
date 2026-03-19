import type { ActionCtx } from '../../../../_generated/server';

import { internal } from '../../../../_generated/api';

/**
 * Read the email sync cursor from integration metadata.
 * Returns the provider-opaque cursor blob, or null if no cursor exists.
 */
export async function getEmailSyncCursor(
  ctx: ActionCtx,
  params: { organizationId: string; integrationName: string },
) {
  const integration = await ctx.runQuery(
    internal.integrations.internal_queries.getByName,
    {
      organizationId: params.organizationId,
      name: params.integrationName,
    },
  );

  if (!integration) {
    return { cursor: null };
  }

  const metadata =
    integration.metadata &&
    typeof integration.metadata === 'object' &&
    !Array.isArray(integration.metadata)
      ? integration.metadata
      : undefined;
  const cursor = metadata?.emailSyncCursor ?? null;

  return { cursor };
}

/**
 * Write the email sync cursor to integration metadata.
 * Shallow-merges with existing metadata to preserve other fields.
 */
export async function updateEmailSyncCursor(
  ctx: ActionCtx,
  params: {
    organizationId: string;
    integrationName: string;
    cursor: Record<string, unknown>;
  },
) {
  const integration = await ctx.runQuery(
    internal.integrations.internal_queries.getByName,
    {
      organizationId: params.organizationId,
      name: params.integrationName,
    },
  );

  if (!integration) {
    throw new Error(
      `Integration "${params.integrationName}" not found for organization`,
    );
  }

  await ctx.runMutation(
    internal.integrations.internal_mutations.patchIntegrationMetadata,
    {
      integrationId: integration._id,
      metadataPatch: { emailSyncCursor: params.cursor },
    },
  );
}
