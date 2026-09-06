/**
 * The real backend behind the automation capability kind — the one that MUST
 * NOT get a second path.
 *
 * An automation runs through the engine's own dispatch over the org-scoped
 * automations store, so a chat-triggered run is the same act as any other run:
 * same deployed version, same execution, same run record.
 *
 * Kept out of `capabilities.ts` so that module stays pure and importable from
 * anywhere; this adapter pulls the node-side engine.
 */

import { dispatch, type DispatchStore } from '../engine/api/dispatch';
import type { AutomationInvocation, BackendResult } from './capabilities';

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
