/**
 * Helper to run integration-specific health checks.
 * Avoids try/catch; let errors propagate to fail creation when checks fail.
 */

import { testShopifyConnection } from './test_shopify_connection';
import { testCirculyConnection } from './test_circuly_connection';
import type { CreateIntegrationLogicArgs } from './create_integration_logic';

import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_INTEGRATIONS', '[Integrations]');

export async function runHealthCheck(
  args: CreateIntegrationLogicArgs,
): Promise<void> {
  debugLog(`Integration Create Running health check for ${args.name}...`);

  if (args.name === 'shopify') {
    if (!args.connectionConfig?.domain || !args.apiKeyAuth?.key) {
      throw new Error('Shopify integration requires domain and access token');
    }
    await testShopifyConnection(
      args.connectionConfig.domain,
      args.apiKeyAuth.key,
    );
  } else if (args.name === 'circuly') {
    if (!args.basicAuth?.username || !args.basicAuth?.password) {
      throw new Error('Circuly integration requires username and password');
    }
    await testCirculyConnection(
      args.basicAuth.username,
      args.basicAuth.password,
    );
  }

  debugLog(`Integration Create Health check passed for ${args.name}`);
}
