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
import { buildSecretsFromIntegration } from './build_secrets_from_integration';

export const integrationAction: ActionDefinition<{
  // The name/type of integration to use (e.g., 'shopify', 'circuly', 'my_erp')
  name: string;
  // Organization ID to look up the integration
  organizationId: string;
  // The operation to perform
  operation: string;
  // Parameters for the operation
  params?: Record<string, unknown>;
}> = {
  type: 'integration',
  title: 'Integration',
  description:
    'Execute an integration operation (combines credential loading + connector execution)',
  parametersValidator: v.object({
    name: v.string(),
    organizationId: v.string(),
    operation: v.string(),
    params: v.optional(v.any()),
  }),

  async execute(ctx, params) {
    const { name, organizationId, operation, params: opParams = {} } = params;

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

    // 2. Get connector config (from integration record or predefined fallback)
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

    // 3. Validate the operation is supported
    const supportedOps = connectorConfig.operations.map((op) => op.name);
    if (!supportedOps.includes(operation)) {
      throw new Error(
        `Operation "${operation}" not supported by integration "${name}". ` +
          `Supported operations: ${supportedOps.join(', ')}`,
      );
    }

    // 4. Build secrets from integration credentials
    const secrets = await buildSecretsFromIntegration(ctx, integration);

    // 5. Execute the connector in sandbox (via Node.js action)
    console.log(
      `[Integration] Executing ${name}.${operation} (v${connectorConfig.version})`,
    );

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
      console.log(`[Integration] Logs:`, result.logs);
    }

    if (!result.success) {
      throw new Error(`Integration operation failed: ${result.error}`);
    }

    return {
      success: true,
      name,
      operation,
      result: result.result,
      duration: result.duration,
      version: connectorConfig.version,
      timestamp: Date.now(),
    };
  },
};

export default integrationAction;
