/**
 * Action Node Executor - Helper Functions
 */

import type { Id } from '../../../../_generated/dataModel';
import type { ActionCtx } from '../../../../_generated/server';

import { internal } from '../../../../_generated/api';
import { ActionNodeConfig, StepExecutionResult } from '../../../types';
import { getAction } from './get_action';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// Secure wrapper type guard
function isSecureWrapper(val: unknown): val is { __secure: true; jwe: string } {
  return (
    !!val &&
    typeof val === 'object' &&
    (val as Record<string, unknown>)['__secure'] === true &&
    typeof (val as Record<string, unknown>)['jwe'] === 'string'
  );
}

// Recursively resolve secure wrappers to plaintext just-in-time (never persisted)
async function resolveSecretsInParams(
  ctx: ActionCtx,
  value: unknown,
): Promise<unknown> {
  if (isSecureWrapper(value)) {
    const decrypted = (await ctx.runAction!(
      internal.lib.crypto.internal_actions.decryptString,
      {
        jwe: value.jwe,
      },
    )) as string;
    return decrypted;
  }
  if (Array.isArray(value)) {
    const out = [] as unknown[];
    for (const item of value) out.push(await resolveSecretsInParams(ctx, item));
    return out;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = await resolveSecretsInParams(ctx, v);
    }
    return result;
  }
  return value;
}

// Remove variables from output payload to avoid leaking values in step output
function sanitizeActionResultForOutput(result: unknown): unknown {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const { variables: _omitted, ...rest } = result as Record<string, unknown>;
    return rest;
  }
  return result;
}

// =============================================================================
// MAIN HELPER FUNCTION
// =============================================================================

/**
 * Execute action step logic
 */
export async function executeActionNode(
  ctx: ActionCtx,
  config: ActionNodeConfig,
  variables: Record<string, unknown>,
  executionId: string | Id<'wfExecutions'>,
): Promise<StepExecutionResult> {
  const def = getAction(config.type);
  if (!def) throw new Error(`Unknown action type: ${config.type}`);

  // Support both parameter structures for backward compatibility:
  // 1. Standard: config.parameters (preferred)
  // 2. Legacy: parameters directly in config (for database actions)
  const parameters =
    config.parameters ??
    (config.type === 'database'
      ? // For database actions, extract operation-specific params from config
        Object.fromEntries(
          Object.entries(config).filter(
            ([key]) => !['type', 'retryPolicy'].includes(key),
          ),
        )
      : {});

  // Decrypt secure wrappers just-in-time for all actions except set_variables
  const resolvedParameters =
    config.type === 'set_variables'
      ? (parameters as unknown)
      : ((await resolveSecretsInParams(ctx, parameters)) as unknown);

  const result = await def.execute(ctx, resolvedParameters, variables, {
    executionId,
  });

  // Generic handling: if action returns variables, extract them
  // This allows any action to optionally update workflow variables
  // without coupling execute_action_node to specific action types
  const resultObj = result as { variables?: Record<string, unknown> };
  const resultVariables = resultObj?.variables;

  const dataForOutput =
    config.type === 'set_variables'
      ? result
      : sanitizeActionResultForOutput(result);

  return {
    port: 'success',
    ...(resultVariables ? { variables: resultVariables } : {}),
    output: {
      type: 'action',
      data: dataForOutput,
    },
  };
}
