/**
 * `two_factor` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../two_factor.ts` are what
 * actually serve them.
 */

export interface TwoFactorContract {
  'two_factor/mutations:resetForUser': {
    kind: 'mutation';
    args: { memberId: string };
    returns: null;
  };
  'two_factor/mutations:revokePasskeyForMember': {
    kind: 'mutation';
    args: { memberId: string; passkeyId: string };
    returns: null;
  };
  'two_factor/queries:getStatus': {
    kind: 'query';
    args: Record<string, never>;
    returns:
      | { authenticated: false }
      | {
          decision: 'blocked' | 'ok' | 'grace';
          twoFactorEnabled: boolean;
          enforced: boolean;
          exemptSsoUsers: boolean;
          authenticated: true;
          hasPasskey: boolean;
          graceUntil: null | number;
          hasCredential: boolean;
          backupCodesRemaining: null | number;
        };
  };
  'two_factor/queries:listPasskeysForMember': {
    kind: 'query';
    args: { memberId: string };
    returns: Array<{
      id: string;
      name: null | string;
      deviceType: string;
      backedUp: boolean;
      createdAt: null | number;
    }>;
  };
}
