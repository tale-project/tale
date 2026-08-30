/**
 * `agent_secrets` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../agent_secrets.ts` are what
 * actually serve them.
 */

export interface AgentSecretsContract {
  'agent_secrets/actions:upsertAgentSecret': {
    kind: 'action';
    args: {
      description?: string;
      organizationId: string;
      name: string;
      value: string;
    };
    returns: { created: boolean };
  };
  'agent_secrets/mutations:deleteAgentSecret': {
    kind: 'mutation';
    args: { organizationId: string; name: string };
    returns: null;
  };
  'agent_secrets/queries:listAgentSecrets': {
    kind: 'query';
    args: { organizationId: string };
    returns: Array<{
      name: string;
      description: null | string;
      maskedPreview: null | string;
      updatedAt: number;
      updatedBy: string;
    }>;
  };
}
