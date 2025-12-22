/**
 * Unified Integration Action
 *
 * This action combines credential loading + connector execution for integrations.
 * It's the single entry point for executing any integration operation.
 *
 * - Loads credentials from the integrations table by name
 * - Loads connector code from the integration record (or predefined fallback)
 * - Executes the connector operation in sandbox (via Node.js action)
 */

import { v } from 'convex/values';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import { internal } from '../../../_generated/api';
import type { Doc } from '../../../_generated/dataModel';
import type { IntegrationExecutionResult } from '../../../node_only/integration_sandbox/types';
import { getPredefinedIntegration } from '../../../predefined_integrations';
import { buildSecretsFromIntegration } from './helpers/build_secrets_from_integration';
import { executeSqlIntegration } from './helpers/execute_sql_integration';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_INTEGRATIONS', '[Integrations]');

export const integrationAction: ActionDefinition<{
  // The name/type of integration to use (e.g., 'shopify', 'circuly', 'my_erp')
  name: string;
  // The operation to perform
  operation: string;
  // Parameters for the operation
  params?: Record<string, unknown>;
}> = {
  type: 'integration',
  title: 'Integration',
  description:
    'Execute an integration operation (combines credential loading + connector execution). organizationId is automatically read from workflow context variables.',
  parametersValidator: v.object({
    name: v.string(),
    operation: v.string(),
    params: v.optional(v.any()),
  }),

  async execute(ctx, params, variables) {
    const { name, operation, params: opParams = {} } = params;

    // Read organizationId from workflow context variables with proper type validation
    const organizationId = variables.organizationId;
    if (typeof organizationId !== 'string' || !organizationId) {
      throw new Error(
        'integration requires a non-empty string organizationId in workflow context',
      );
    }

    // 1. Load the integration from database by name
    const integration = (await ctx.runQuery!(
      internal.integrations.getByNameInternal,
      { organizationId, name },
    )) as Doc<'integrations'> | null;

    if (!integration) {
      throw new Error(
        `Integration not found for name "${name}" in organization "${organizationId}"`,
      );
    }

    // 2. Check integration type and route accordingly
    const integrationType = (integration as any).type || 'rest_api'; // Default to rest_api for backward compatibility

    // Handle SQL integrations
    if (integrationType === 'sql') {
      return await executeSqlIntegration(ctx, integration, operation, opParams);
    }

    // Handle REST API integrations (existing logic)
    // 3. Get connector config (from integration record or predefined fallback)
    let connectorConfig = integration.connector;

    if (!connectorConfig) {
      // Fallback to predefined integration
      const predefined = getPredefinedIntegration(name);
      if (predefined) {
        connectorConfig = predefined.connector;
      }
    }

    if (!connectorConfig) {
      throw new Error(
        `No connector configuration found for integration "${name}". ` +
          `Please ensure the integration has connector code configured.`,
      );
    }

    // 4. Validate the operation is supported
    const supportedOps = connectorConfig.operations.map((op) => op.name);
    if (!supportedOps.includes(operation)) {
      throw new Error(
        `Operation "${operation}" not supported by integration "${name}". ` +
          `Supported operations: ${supportedOps.join(', ')}`,
      );
    }

    // 5. Build secrets from integration credentials
    const secrets = await buildSecretsFromIntegration(ctx, integration);

    // 6. Execute the connector in sandbox (via Node.js action)
    debugLog(`Executing ${name}.${operation} (v${connectorConfig.version})`);

    const result = (await ctx.runAction!(
      internal.node_only.integration_sandbox.execute_integration_internal
        .executeIntegrationInternal,
      {
        code: connectorConfig.code,
        operation,
        params: opParams,
        variables: {},
        secrets,
        allowedHosts: connectorConfig.allowedHosts ?? [],
        timeoutMs: connectorConfig.timeoutMs ?? 30000,
      },
    )) as IntegrationExecutionResult;

    if (result.logs && result.logs.length > 0) {
      debugLog('Logs:', result.logs);
    }

    if (!result.success) {
      throw new Error(`Integration operation failed: ${result.error}`);
    }

    // Note: execute_action_node wraps this in output: { type: 'action', data: result }
    return {
      name,
      operation,
      result: result.result,
      duration: result.duration,
      version: connectorConfig.version,
    };
  },
};

export default integrationAction;
