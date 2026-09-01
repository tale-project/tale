'use node';

/**
 * The server host for an automation builder session.
 *
 * Everything that decides how a session behaves lives in
 * `lib/automations_builder/` and is pure. This module is the wiring: it
 * installs the engine's seams, binds `dispatch` to the organization's
 * automation store (`automationActionStore` — every save, deploy and trigger
 * hops through the same internal mutations as any other caller), supplies the
 * real model call, and exposes internal actions.
 *
 * INTERNAL by contract. A session authors and saves automations on the
 * organization's behalf and spends the organization's model budget, so the
 * surface a user reaches does its own authorization first and then calls in
 * here — there is no client-callable version.
 *
 * Live execution is deliberately NOT enabled: an authoring loop runs
 * everything against the deterministic mocks (`allowLive` stays off), so a
 * draft under construction can never send a real message or write to a real
 * system. Live runs belong to deployment, behind the deploy gate.
 */

import { runBuilderSession } from '../../../lib/automations_builder/session';
import { installConnectorCatalog } from '../../../lib/connectors/dispatcher';
import { registerConnector } from '../../../lib/connectors/registry';
import { dispatch, type DispatchStore } from '../../../lib/engine/api/dispatch';
import { hasCodeRunner, setCodeRunner } from '../../../lib/engine/core/runner';
import { nodeVmRunner } from '../../../lib/engine/runners/node-vm';
import { loadConnectorDefinitions } from '../connector_credentials/connector_catalog';
import type { ActionCtx } from '../lib/ctx';
import { createBuilderModel, type BuilderModelTarget } from './model_call';

/**
 * Install the seams one session needs. Cheap and idempotent — the connector
 * catalog read is memoized behind a stat of each connector file.
 *
 * The CodeRunner is the engine's sandbox seam for untrusted JavaScript; it
 * runs `transform` nodes and the connectors' deterministic mock bodies, which
 * is the entire feedback loop the agent authors against. The connector
 * catalog is registered so `search_catalog` answers with the capabilities
 * this deployment actually has.
 */
function assembleBuilderHost(): void {
  if (!hasCodeRunner()) setCodeRunner(nodeVmRunner());
  const connectors = loadConnectorDefinitions();
  installConnectorCatalog(connectors);
  for (const connector of connectors) registerConnector(connector);
}

export interface BuilderSessionArgs {
  organizationId: string;
  /** Who the saved versions are attributed to. */
  actorId: string;
  goal: string;
  model: BuilderModelTarget;
  maxTurns?: number;
}

/** One compact step for the session timeline a UI replays. */
export interface BuilderSessionStep {
  turn: number;
  kind: string;
  method?: string;
  note?: string;
  progress?: boolean;
}

export interface BuilderSessionOutcome {
  status: 'succeeded' | 'gave-up' | 'cancelled';
  reason?: string;
  saved?: { name: string; version: number };
  turns: number;
  restarts: number;
  usage: { prompt: number; completion: number };
  steps: BuilderSessionStep[];
}

/**
 * Run one session against a store the caller supplies. Separated from the
 * action so the host is exercisable with any `DispatchStore` — the seam above
 * decides which one production uses.
 */
export async function runSessionWithStore(
  ctx: ActionCtx,
  args: BuilderSessionArgs,
  store: DispatchStore,
): Promise<BuilderSessionOutcome> {
  assembleBuilderHost();

  const session = await runBuilderSession({
    goal: args.goal,
    dispatch: (method, params) => dispatch(method, params, { store }),
    model: createBuilderModel(ctx, {
      organizationId: args.organizationId,
      target: args.model,
    }),
    ...(args.maxTurns !== undefined && { policy: { maxTurns: args.maxTurns } }),
  });

  const outcome: BuilderSessionOutcome = {
    status: session.outcome.status,
    ...('reason' in session.outcome && { reason: session.outcome.reason }),
    ...('saved' in session.outcome && { saved: session.outcome.saved }),
    turns: session.turns,
    restarts: session.restarts,
    usage: session.usage,
    steps: session.transcript.map((entry) => {
      const step: BuilderSessionStep = { turn: entry.turn, kind: entry.kind };
      if (entry.method !== undefined) step.method = entry.method;
      if (entry.note !== undefined) step.note = entry.note;
      if (entry.progress !== undefined) step.progress = entry.progress;
      return step;
    }),
  };
  console.info(
    `[automations-builder] session for org ${args.organizationId} ended: ${outcome.status} after ${outcome.turns} turn(s), ${outcome.restarts} restart(s)`,
  );
  return outcome;
}
