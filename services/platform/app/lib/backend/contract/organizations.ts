/**
 * `organizations` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../organizations.ts` are what
 * actually serve them.
 */

export interface OrganizationsContract {
  /** The one deletion door: guards, audit, cascade, Better Auth rows and
   * the config cleanup commit as one transaction, or nothing changes. */
  'organizations/delete:deleteOrganization': {
    kind: 'mutation';
    args: { organizationId: string };
    returns: { orgSlug: string };
  };
}
