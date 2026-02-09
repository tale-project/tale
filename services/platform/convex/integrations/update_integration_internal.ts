/**
 * Internal mutation to update integration
 */

import { Id } from '../_generated/dataModel';
import { MutationCtx } from '../_generated/server';
import {
  Status,
  ApiKeyAuthEncrypted,
  BasicAuthEncrypted,
  OAuth2AuthEncrypted,
  ConnectionConfig,
  Capabilities,
} from './types';

export interface UpdateIntegrationInternalArgs {
  integrationId: Id<'integrations'>;
  status?: Status;
  isActive?: boolean;
  apiKeyAuth?: ApiKeyAuthEncrypted;
  basicAuth?: BasicAuthEncrypted;
  oauth2Auth?: OAuth2AuthEncrypted;
  connectionConfig?: ConnectionConfig;
  capabilities?: Capabilities;
  errorMessage?: string;
  metadata?: unknown;
}

export async function updateIntegrationInternal(
  ctx: MutationCtx,
  args: UpdateIntegrationInternalArgs,
): Promise<void> {
  const { integrationId, ...updates } = args;

  const cleanUpdates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      cleanUpdates[key] = value;
    }
  }

  await ctx.db.patch(integrationId, cleanUpdates);
}
