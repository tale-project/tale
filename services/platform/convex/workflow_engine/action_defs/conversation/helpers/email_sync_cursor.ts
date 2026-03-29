import type { ActionCtx } from '../../../../_generated/server';

import { internal } from '../../../../_generated/api';

/**
 * Read the email sync cursor from integration credentials metadata.
 * Returns the provider-opaque cursor blob, or null if no cursor exists.
 */
export async function getEmailSyncCursor(
  ctx: ActionCtx,
  params: { organizationId: string; integrationName: string },
) {
  const credential = await ctx.runQuery(
    internal.integrations.credential_queries.getBySlugInternal,
    {
      organizationId: params.organizationId,
      slug: params.integrationName,
    },
  );

  if (!credential) {
    return { cursor: null };
  }

  const metadata =
    credential.metadata &&
    typeof credential.metadata === 'object' &&
    !Array.isArray(credential.metadata)
      ? credential.metadata
      : undefined;
  const cursor = metadata?.emailSyncCursor ?? null;

  return { cursor };
}

/**
 * Write the email sync cursor to integration credentials metadata.
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
  const credential = await ctx.runQuery(
    internal.integrations.credential_queries.getBySlugInternal,
    {
      organizationId: params.organizationId,
      slug: params.integrationName,
    },
  );

  if (!credential) {
    throw new Error(
      `Integration credentials for "${params.integrationName}" not found for organization`,
    );
  }

  const currentMetadata =
    credential.metadata &&
    typeof credential.metadata === 'object' &&
    !Array.isArray(credential.metadata)
      ? credential.metadata
      : {};
  const merged = {
    ...currentMetadata,
    emailSyncCursor: params.cursor,
  };

  await ctx.runMutation(
    internal.integrations.credential_mutations.updateCredentialsInternal,
    {
      credentialId: credential._id,
      metadata: merged,
    },
  );
}
