/**
 * `login_attempts` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../login_attempts.ts` are what
 * actually serve them.
 */

export interface LoginAttemptsContract {
  'login_attempts/queries:listBlockCounters': {
    kind: 'query';
    args: { limit?: number; organizationId: string };
    returns: Array<{
      _id: string;
      email: string;
      windowStart: number;
      lockoutCount: number;
      ipLimitCount: number;
      lastIp?: string;
      updatedAt: number;
    }>;
  };
}
