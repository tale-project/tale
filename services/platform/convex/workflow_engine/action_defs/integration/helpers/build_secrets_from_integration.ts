/**
 * Build secrets object from integration credentials.
 * Delegates to the shared buildIntegrationSecrets helper.
 */

import type { ActionCtx } from '../../../../_generated/server';
import { buildIntegrationSecrets } from '../../../../integrations/build_test_secrets';
import type { LoadedIntegration } from '../../../../integrations/load_integration';

export async function buildSecretsFromIntegration(
  ctx: ActionCtx,
  integration: LoadedIntegration,
): Promise<Record<string, string>> {
  return buildIntegrationSecrets(
    ctx,
    { ...integration, secretBindings: integration.connector?.secretBindings },
    integration._id,
  );
}
