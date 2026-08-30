/**
 * `node_only` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../node_only.ts` are what
 * actually serve them.
 */

export interface NodeOnlyContract {
  'node_only/sandbox/session_admin_actions:destroySandbox': {
    kind: 'action';
    args: { organizationId: string; sessionId: string };
    returns: { destroyed: boolean };
  };
  'node_only/sandbox/session_admin_actions:reconcileOrgSessions': {
    kind: 'action';
    args: { organizationId: string };
    returns: { stopped: number };
  };
  'node_only/sandbox/session_admin_actions:setSandboxPinned': {
    kind: 'action';
    args: { organizationId: string; sessionId: string; pinned: boolean };
    returns: null;
  };
  'node_only/sandbox/session_admin_actions:stopSandboxTask': {
    kind: 'action';
    args: { organizationId: string; sessionId: string };
    returns: { cancelled: number };
  };
}
