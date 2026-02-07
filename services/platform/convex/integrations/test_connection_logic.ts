/**
 * Business logic for testing an integration connection
 */

import { ActionCtx } from '../_generated/server';
import { Id } from '../_generated/dataModel';
import { api, internal } from '../_generated/api';
import { TestConnectionResult } from './types';
import { testShopifyConnection } from './test_shopify_connection';
import { testCirculyConnection } from './test_circuly_connection';

import { createDebugLog } from '../lib/debug_log';

const debugLog = createDebugLog('DEBUG_INTEGRATIONS', '[Integrations]');

export interface TestConnectionLogicArgs {
  integrationId: Id<'integrations'>;
}

/**
 * Main logic for testing an integration connection
 */
export async function testConnectionLogic(
  ctx: ActionCtx,
  args: TestConnectionLogicArgs,
): Promise<TestConnectionResult> {
  const integration = await ctx.runQuery(api.integrations.queries.get, {
    integrationId: args.integrationId,
  });

  if (!integration) {
    return {
      success: false,
      message: 'Integration not found',
    };
  }

  try {
    debugLog(`Test Connection Testing ${integration.name} integration...`);

    if (integration.apiKeyAuth) {
      const key = await ctx.runAction(internal.lib.crypto.internal_actions.decryptString, {
        jwe: integration.apiKeyAuth.keyEncrypted,
      });

      // Test Shopify connection
      if (integration.name === 'shopify') {
        const shopifyDomain = integration.connectionConfig?.domain;
        if (!shopifyDomain || !key) {
          throw new Error('Missing Shopify credentials');
        }
        await testShopifyConnection(shopifyDomain, key);
      } else {
        throw new Error(`API key auth not supported for ${integration.name}`);
      }
    } else if (integration.basicAuth) {
      const password = await ctx.runAction(
        internal.lib.crypto.internal_actions.decryptString,
        {
          jwe: integration.basicAuth.passwordEncrypted,
        },
      );

      // Test Circuly connection
      if (integration.name === 'circuly') {
        if (!integration.basicAuth.username || !password) {
          throw new Error('Missing Circuly credentials');
        }
        await testCirculyConnection(integration.basicAuth.username, password);
      } else {
        throw new Error(`Basic auth not supported for ${integration.name}`);
      }
    } else {
      throw new Error(`Testing not implemented for ${integration.name}`);
    }

    await ctx.runMutation(internal.integrations.internal_mutations.updateIntegration, {
      integrationId: args.integrationId,
      status: 'active',
      isActive: true,
      errorMessage: undefined,
    });

    debugLog(
      `Test Connection Successfully tested ${integration.name} integration`,
    );

    return {
      success: true,
      message: 'Connection successful',
    };
  } catch (error) {
    console.error(
      `[Test Connection] Failed to test ${integration.name} integration:`,
      error,
    );

    await ctx.runMutation(internal.integrations.internal_mutations.updateIntegration, {
      integrationId: args.integrationId,
      status: 'error',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      success: false,
      message: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}
