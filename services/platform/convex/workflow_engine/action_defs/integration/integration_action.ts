/**
 * Unified Integration Action
 *
 * This action combines credential loading + connector execution for integrations.
 * It's the single entry point for executing any integration operation.
 *
 * - Loads credentials from the integrations table by name
 * - Loads connector code from the integration record
 * - Executes the connector operation in sandbox (via Node.js action)
 */

import { ConvexError, v } from 'convex/values';

import { internal } from '../../../_generated/api';
import {
  isImapSmtpIntegration,
  isSqlIntegration,
} from '../../../integrations/helpers';
import { createDebugLog } from '../../../lib/debug_log';
import { toConvexJsonRecord } from '../../../lib/type_cast_helpers';
import { jsonRecordValidator } from '../../../lib/validators/json';
import { resolveOrgSlug } from '../../../organizations/resolve_org_slug';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import { buildSecretsFromIntegration } from './helpers/build_secrets_from_integration';
import {
  requiresApproval,
  getOperationType,
} from './helpers/detect_write_operation';
import { executeImapSmtpIntegration } from './helpers/execute_imap_smtp_integration';
import { executeSqlIntegration } from './helpers/execute_sql_integration';
import { redactSecrets } from './helpers/redact_secrets';
import { validateOperationScopes } from './helpers/validate_operation_scopes';
import { validateRequiredParameters } from './helpers/validate_required_parameters';

const debugLog = createDebugLog('DEBUG_INTEGRATIONS', '[Integrations]');

export const integrationAction: ActionDefinition<{
  // The name/type of integration to use (e.g., 'shopify', 'stripe', 'my_erp')
  name: string;
  // The operation to perform
  operation: string;
  // Parameters for the operation
  params?: Record<string, unknown>;
  // Skip approval check (used when executing already approved operations)
  skipApprovalCheck?: boolean;
  // Thread ID for linking approvals to chat
  threadId?: string;
  // Message ID for linking approvals to the specific assistant message
  messageId?: string;
}> = {
  type: 'integration',
  title: 'Integration',
  description:
    'Execute an integration operation (combines credential loading + connector execution). organizationId is automatically read from workflow context variables.',
  parametersValidator: v.object({
    name: v.string(),
    operation: v.string(),
    params: v.optional(jsonRecordValidator),
    skipApprovalCheck: v.optional(v.boolean()),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
  }),

  async execute(ctx, params, variables) {
    const {
      name,
      operation,
      params: opParams = {},
      skipApprovalCheck = false,
      threadId,
      messageId,
    } = params;

    // Read organizationId from workflow context variables with proper type validation
    const organizationId = variables.organizationId;
    if (typeof organizationId !== 'string' || !organizationId) {
      throw new Error(
        'integration requires a non-empty string organizationId in workflow context',
      );
    }

    // 1. Load integration config (file) + credentials (DB) via unified loader
    const orgSlug = await resolveOrgSlug(ctx, organizationId);
    const integration = await ctx.runAction(
      internal.integrations.load_integration.loadIntegration,
      { orgSlug, organizationId, slug: name },
    );

    if (!integration) {
      // Typed so callers can branch (the app's ExternalList renders a friendly
      // "not connected" state) instead of surfacing a raw server error, and so
      // the org id never rides along in a client-visible message.
      throw new ConvexError({
        code: 'INTEGRATION_NOT_CONNECTED',
        integration: name,
        message: `The "${name}" integration is not connected for this organization.`,
      });
    }

    // 2. Check integration type and route accordingly
    // Handle SQL integrations
    if (isSqlIntegration(integration)) {
      return await executeSqlIntegration(
        ctx,
        integration,
        operation,
        opParams,
        skipApprovalCheck,
        threadId,
        messageId,
      );
    }

    // Handle IMAP/SMTP mailbox integrations (raw-TCP Node action, like SQL)
    if (isImapSmtpIntegration(integration)) {
      return await executeImapSmtpIntegration(
        ctx,
        integration,
        operation,
        opParams,
      );
    }

    // Handle REST API integrations
    // 3. Get connector config from integration record
    const connectorConfig = integration.connector;

    if (!connectorConfig) {
      throw new Error(
        `No connector configuration found for integration "${name}". ` +
          `Please ensure the integration has connector code configured.`,
      );
    }

    // 4. Validate the operation is supported and get operation config
    const operationConfig = connectorConfig.operations.find(
      (op: { name: string }) => op.name === operation,
    );
    if (!operationConfig) {
      const supportedOps = connectorConfig.operations.map(
        (op: { name: string }) => op.name,
      );
      throw new Error(
        `Operation "${operation}" not supported by integration "${name}". ` +
          `Supported operations: ${supportedOps.join(', ')}`,
      );
    }

    // 5. Validate required parameters before creating approval or executing
    validateRequiredParameters(operationConfig, opParams, operation);

    // 5b. Validate operation scopes against integration's configured scopes
    validateOperationScopes(operationConfig, integration, operation);

    // 6. Check if this operation requires approval
    if (!skipApprovalCheck && requiresApproval(operationConfig)) {
      const operationType = getOperationType(operationConfig);
      debugLog(
        `REST operation ${operation} requires approval (type: ${operationType})`,
      );

      // Create approval and return approval result instead of executing
      const approvalId = await ctx.runMutation(
        internal.agent_tools.integrations.internal_mutations
          .createIntegrationApproval,
        {
          organizationId,
          integrationId: integration._id,
          integrationName: name,
          integrationType: 'rest_api',
          operationName: operation,
          operationTitle: operationConfig.title || operation,
          operationType,
          parameters: toConvexJsonRecord(opParams),
          threadId,
          messageId,
          estimatedImpact: `This ${operationType} operation will modify data via ${name} API`,
        },
      );

      // Return approval required result
      return {
        requiresApproval: true,
        approvalId,
        integrationName: name,
        operationName: operation,
        operationTitle: operationConfig.title || operation,
        operationType,
        parameters: opParams,
      };
    }

    // 7. Build secrets from integration credentials
    let secrets = await buildSecretsFromIntegration(ctx, integration);

    // 8. Execute the connector in sandbox (via Node.js action)
    debugLog(`Executing ${name}.${operation} (v${connectorConfig.version})`);

    let result = await ctx.runAction(
      internal.node_only.integration_sandbox.internal_actions
        .executeIntegration,
      {
        code: connectorConfig.code,
        operation,
        params: toConvexJsonRecord(opParams),
        variables: {},
        secrets,
        allowedHosts: connectorConfig.allowedHosts ?? [],
        timeoutMs: connectorConfig.timeoutMs ?? 30000,
        organizationId,
      },
    );

    // OAuth2 force-refresh + one retry on 401. The connector marks
    // unauthorized failures with the [401_UNAUTHORIZED] sentinel; that
    // path fires when the access token expired or was revoked between
    // buildIntegrationSecrets and the actual upstream request. Forcing
    // a refresh and retrying once recovers cleanly without surfacing
    // the failure to the workflow.
    if (
      !result.success &&
      integration.authMethod === 'oauth2' &&
      typeof result.error === 'string' &&
      result.error.includes('[401_UNAUTHORIZED]')
    ) {
      debugLog(
        `[integration] 401 from ${name}.${operation}; force-refreshing OAuth2 token and retrying once`,
      );
      secrets = await buildSecretsFromIntegration(ctx, integration, {
        forceRefresh: true,
      });
      result = await ctx.runAction(
        internal.node_only.integration_sandbox.internal_actions
          .executeIntegration,
        {
          code: connectorConfig.code,
          operation,
          params: toConvexJsonRecord(opParams),
          variables: {},
          secrets,
          allowedHosts: connectorConfig.allowedHosts ?? [],
          timeoutMs: connectorConfig.timeoutMs ?? 30000,
          organizationId,
        },
      );
    }

    if (result.logs && result.logs.length > 0) {
      debugLog('Logs:', result.logs);
    }

    if (!result.success) {
      throw new Error(
        `Integration operation failed: ${redactSecrets(result.error ?? '', secrets)}`,
      );
    }

    // Note: execute_action_node wraps this in output: { type: 'action', data: result }
    return {
      name,
      operation,
      result: result.result,
      duration: result.duration,
      version: connectorConfig.version,
      ...(result.fileReferences
        ? { fileReferences: result.fileReferences }
        : {}),
    };
  },
};
