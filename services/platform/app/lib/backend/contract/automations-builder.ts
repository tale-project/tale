/**
 * `automations_builder` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../automations_builder.ts` are what
 * actually serve them.
 */

export interface AutomationsBuilderContract {
  'automations_builder/actions:startBuilderSession': {
    kind: 'action';
    args: {
      projectId?: string;
      maxTurns?: number;
      organizationId: string;
      model: { providerSlug: string; modelId: string };
      goal: string;
    };
    returns: {
      status: 'cancelled' | 'succeeded' | 'gave-up';
      reason?: string;
      saved?: { name: string; version: number };
      turns: number;
      restarts: number;
      usage: { prompt: number; completion: number };
      steps: Array<{
        turn: number;
        kind: string;
        method?: string;
        note?: string;
        progress?: boolean;
      }>;
    };
  };
}
