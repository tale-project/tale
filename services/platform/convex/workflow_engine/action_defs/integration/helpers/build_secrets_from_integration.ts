/**
 * Build secrets object from integration credentials.
 * Delegates to the shared buildIntegrationSecrets helper.
 */

import type { ActionCtx } from '../../../../_generated/server';
import type { LoadedIntegration } from '../../../../integrations/load_integration';

import { buildIntegrationSecrets } from '../../../../integrations/build_test_secrets';

export async function buildSecretsFromIntegration(
  ctx: ActionCtx,
  integration: LoadedIntegration,
): Promise<Record<string, string>> {
  return buildIntegrationSecrets(ctx, integration, integration._id);
}
