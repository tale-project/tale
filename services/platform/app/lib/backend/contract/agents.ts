/**
 * `agents` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../agents.ts` are what
 * actually serve them.
 */

export interface AgentsContract {
  'agents/actions:getAgent': {
    kind: 'action';
    args: { organizationId: string; slug: string };
    returns: null | {
      instructions?: string;
      tools?: string[];
      skills?: string[];
      i18n?: Record<
        string,
        { displayName?: string; description?: string; instructions?: string }
      >;
      slug: string;
      displayName: string;
      description?: string;
      visibility: 'org' | 'private';
      owner?: string;
      icon?: string;
      labels?: string[];
      knowledge: 'documents' | 'all' | 'none' | 'web';
      canEdit: boolean;
    };
  };
  'agents/actions:listAgentHistory': {
    kind: 'action';
    args: { organizationId: string; slug: string };
    returns: Array<{ entry: string; savedAt: number }>;
  };
  'agents/actions:listAgents': {
    kind: 'action';
    args: { organizationId: string };
    returns: {
      agents: Array<{
        slug: string;
        displayName: string;
        description?: string;
        visibility: 'org' | 'private';
        owner?: string;
        icon?: string;
        labels?: string[];
        knowledge: 'documents' | 'all' | 'none' | 'web';
        canEdit: boolean;
      }>;
      failures: Array<{ slug: string; path: string; message: string }>;
    };
  };
}
