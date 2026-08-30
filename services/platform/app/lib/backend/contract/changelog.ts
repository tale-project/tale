/**
 * `changelog` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../changelog.ts` are what
 * actually serve them.
 */

export interface ChangelogContract {
  'changelog/actions:listReleases': {
    kind: 'action';
    args: { from?: string };
    returns: Array<{
      tag: string;
      version: string;
      name: null | string;
      body: null | string;
      htmlUrl: string;
      publishedAt: null | string;
    }>;
  };
}
