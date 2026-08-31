/**
 * `cloud_import` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../cloud_import.ts` are what
 * actually serve them.
 */

export interface CloudImportContract {
  'cloud_import/mutations:revokeAuthorization': {
    kind: 'mutation';
    args: { organizationId: string; provider: 'onedrive' | 'google-drive' };
    returns: null;
  };
  'cloud_import/queries:getOauthAppStatus': {
    kind: 'query';
    args: { organizationId: string; provider: 'onedrive' | 'google-drive' };
    returns: { configured: boolean; source: 'org' | 'env' | null };
  };
  'cloud_import/queries:getAuthorizationStatus': {
    kind: 'query';
    args: { organizationId: string; provider: 'onedrive' | 'google-drive' };
    returns: null | {
      scopes: string[];
      accountLabel?: string;
      status: 'active' | 'needs-reauth' | 'revoked';
    };
  };
}
