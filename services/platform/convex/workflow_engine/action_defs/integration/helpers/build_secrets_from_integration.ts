/**
 * Build secrets object from integration credentials.
 * Delegates to the shared buildIntegrationSecrets helper.
 */

import type { Doc } from '../../../../_generated/dataModel';
import type { ActionCtx } from '../../../../_generated/server';

import { buildIntegrationSecrets } from '../../../../integrations/build_test_secrets';

export async function buildSecretsFromIntegration(
  ctx: ActionCtx,
  integration: Doc<'integrations'>,
): Promise<Record<string, string>> {
  return buildIntegrationSecrets(ctx, integration);
}
