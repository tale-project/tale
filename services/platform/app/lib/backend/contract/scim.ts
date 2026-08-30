/**
 * `scim` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../scim.ts` are what
 * actually serve them.
 */

export interface ScimContract {
  'scim/mutations:disable': {
    kind: 'mutation';
    args: { organizationId: string };
    returns: null;
  };
  'scim/mutations:regenerateToken': {
    kind: 'mutation';
    args: { organizationId: string };
    returns: { token: string; tokenPrefix: string };
  };
}
