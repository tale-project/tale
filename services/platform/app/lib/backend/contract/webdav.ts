/**
 * `webdav` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../webdav.ts` are what
 * actually serve them.
 */

export interface WebdavContract {
  'webdav/app_password_mutations:createAppPassword': {
    kind: 'mutation';
    args: { organizationId: string; label: string };
    returns: { password: string; prefix: string };
  };
  'webdav/app_password_mutations:revokeAppPassword': {
    kind: 'mutation';
    args: { id: string };
    returns: null;
  };
  'webdav/app_password_queries:listAppPasswords': {
    kind: 'query';
    args: { organizationId: string };
    returns: Array<{
      _id: string;
      label: string;
      prefix: string;
      createdAt: number;
      lastUsedAt: undefined | number;
      revokedAt: undefined | number;
    }>;
  };
}
