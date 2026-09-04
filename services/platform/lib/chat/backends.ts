/**
 * The real backends behind two capability kinds — the ones that MUST NOT get a
 * second path.
 *
 * A connector action reaches a vendor through `executeConnectorAction`
 * and nothing else: that is where input-schema enforcement, the mediated live
 * host, approval gating, and the audit trail live, so a chat tool that called
 * a connector directly would bypass all four. The caller mode is `user`,
 * because a person asked — which is what makes a `write` action gate behind
 * the org's approvals policy.
 *
 * An automation runs through the engine's own dispatch over the org-scoped
 * automations store, so a chat-triggered run is the same act as any other run:
 * same deployed version, same execution, same run record.
 *
 * Kept out of `capabilities.ts` so that module stays pure and importable from
 * anywhere; these adapters pull the node-side dispatcher and engine.
 */

import { executeConnectorAction } from '../connectors/dispatcher';
import type { ConnectorDispatchContext } from '../connectors/dispatcher';
import { ConnectorError } from '../connectors/errors';
import { dispatch, type DispatchStore } from '../engine/api/dispatch';
import type {
  AutomationInvocation,
  BackendResult,
  ConnectorInvocation,
} from './capabilities';

export interface ConnectorBackendOptions {
  /** Everything the dispatcher needs except the organization, which arrives
   * with each invocation. */
  readonly ctx: Omit<ConnectorDispatchContext, 'organizationId'>;
  /** Swappable for tests only; production always uses the one dispatcher. */
  readonly execute?: typeof executeConnectorAction;
}

export function createConnectorBackend(
  options: ConnectorBackendOptions,
): (request: ConnectorInvocation) => Promise<BackendResult> {
  const execute = options.execute ?? executeConnectorAction;
  return async (request) => {
    try {
      const result = await execute({
        connector: request.connector,
        action: request.action,
        input: request.input,
        credentialRef: request.credentialRef,
        caller: { kind: 'user', userId: request.userId },
        ctx: { ...options.ctx, organizationId: request.organizationId },
      });
      if (result.status === 'approval-required') {
        return {
          status: 'refused',
          reason: result.message,
          hint: 'The organization requires a human to approve this action. Tell the user it is waiting for approval.',
        };
      }
      return { status: 'ok', output: result.output };
    } catch (error) {
      if (error instanceof ConnectorError) {
        return { status: 'refused', reason: error.message, hint: error.hint };
      }
      throw error;
    }
  };
}

export interface AutomationsBackendOptions {
  /** The org-scoped automations store — the same one the automations host
   * uses, so a chat-started run is indistinguishable from any other. */
  readonly store: DispatchStore;
  /** Live connector calls. A chat-triggered run is a real run, so hosts
   * pass true; a test loop does not. */
  readonly allowLive?: boolean;
}

export function createAutomationsBackend(
  options: AutomationsBackendOptions,
): (request: AutomationInvocation) => Promise<BackendResult> {
  return async (request) => {
    const result = await dispatch(
      'run_deployed',
      { name: request.automation, input: request.input },
      { store: options.store, allowLive: options.allowLive },
    );
    if (
      result !== null &&
      typeof result === 'object' &&
      'error' in result &&
      typeof result.error === 'string'
    ) {
      const hint =
        'hint' in result && typeof result.hint === 'string'
          ? result.hint
          : undefined;
      return { status: 'refused', reason: result.error, hint };
    }
    return { status: 'ok', output: result };
  };
}
