'use node';

/**
 * The Convex host for an automation builder session.
 *
 * Everything that decides how a session behaves lives in
 * `lib/automations_builder/` and is pure. This module is the wiring: it
 * installs the engine's seams, binds `dispatch` to the organization's
 * automation store, supplies the real model call, and exposes one internal
 * action.
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

import { ConvexError, v } from 'convex/values';

import { runBuilderSession } from '../../lib/automations_builder/session';
import { dispatch, type DispatchStore } from '../../lib/engine/api/dispatch';
import { hasCodeRunner, setCodeRunner } from '../../lib/engine/core/runner';
import { nodeVmRunner } from '../../lib/engine/runners/node-vm';
import { installConnectorCatalog } from '../../lib/integrations/dispatcher';
import { registerConnector } from '../../lib/integrations/registry';
import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import { loadIntegrationConnectors } from '../integration_credentials/connector_catalog';
import { createBuilderModel, type BuilderModelTarget } from './model_call';

/**
 * The persistence a session needs: the engine's own `DispatchStore`, scoped
 * to one organization and one actor, reachable from a Node action. Stating
 * the contract locally rather than importing an implementation is what lets
 * the builder ship, be tested, and be reviewed on its own — the loop cares
 * that saves are versioned and org-scoped, not who writes the rows.
 */
export type AutomationStoreFactory = (
  ctx: ActionCtx,
  scope: { organizationId: string; actor: string },
) => Promise<DispatchStore>;

/**
 * WIRING SEAM — the one place the builder binds to the automations host.
 * Return the org-scoped store here once the automations domain exposes one to
 * actions: the store's own methods run in a mutation context, so the factory
 * an action can use is the adapter that hops through the domain's internal
 * mutations and queries.
 *
 * Until then a session refuses to start rather than writing anywhere. A
 * builder pointed at a stand-in store would author real work into a place
 * nobody can find it, which is worse than a clear refusal.
 */
function automationStoreFactory(): AutomationStoreFactory | null {
  return null;
}

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
  const connectors = loadIntegrationConnectors();
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

/**
 * Author an automation from a goal, autonomously.
 *
 * The model is a required argument — the builder never picks one — and the
 * organization's default credential for that provider pays for the session.
 */
export const buildAutomation = internalAction({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    goal: v.string(),
    model: v.object({ providerSlug: v.string(), modelId: v.string() }),
    /** Lower the turn budget for a cheap exploratory run. */
    maxTurns: v.optional(v.number()),
  },
  returns: v.object({
    status: v.union(
      v.literal('succeeded'),
      v.literal('gave-up'),
      v.literal('cancelled'),
    ),
    reason: v.optional(v.string()),
    saved: v.optional(v.object({ name: v.string(), version: v.number() })),
    turns: v.number(),
    restarts: v.number(),
    usage: v.object({ prompt: v.number(), completion: v.number() }),
    steps: v.array(
      v.object({
        turn: v.number(),
        kind: v.string(),
        method: v.optional(v.string()),
        note: v.optional(v.string()),
        progress: v.optional(v.boolean()),
      }),
    ),
  }),
  handler: async (ctx, args): Promise<BuilderSessionOutcome> => {
    const createStore = automationStoreFactory();
    if (createStore === null) {
      throw new ConvexError({
        code: 'AUTOMATION_STORE_UNWIRED',
        message:
          'The automation builder has no store to save into yet — wire the automations store factory in convex/automations_builder/run_session.ts.',
      });
    }
    const store = await createStore(ctx, {
      organizationId: args.organizationId,
      actor: args.actorId,
    });
    return await runSessionWithStore(ctx, args, store);
  },
});
