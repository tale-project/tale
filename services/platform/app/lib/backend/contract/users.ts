/**
 * `users` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../users.ts` are what
 * actually serve them.
 */

export interface UsersContract {
  'users/mutations:createMember': {
    kind: 'mutation';
    args: {
      role?: 'member' | 'admin' | 'disabled' | 'owner' | 'editor' | 'developer';
      displayName?: string;
      password?: string;
      organizationId: string;
      email: string;
    };
    returns: { userId: string; memberId: string; isExistingUser: boolean };
  };
  'users/mutations:setMemberPassword': {
    kind: 'mutation';
    args: { memberId: string; newPassword: string };
    returns: null;
  };
  'users/mutations:updateUserName': {
    kind: 'mutation';
    args: { name: string };
    returns: null;
  };
  'users/mutations:updateUserPassword': {
    kind: 'mutation';
    args: {
      trigger?: 'voluntary' | 'forced';
      currentPassword?: string;
      newPassword: string;
    };
    returns: null;
  };
  'users/notification_state:getUserNotificationState': {
    kind: 'query';
    args: Record<string, never>;
    returns: null | {
      userId: string;
      lastSeenChangelogVersion: undefined | string;
      lastToastedVersion: undefined | string;
      updatedAt: number;
    };
  };
  'users/notification_state:markChangelogSeen': {
    kind: 'mutation';
    args: { version: string };
    returns: null;
  };
  'users/notification_state:markToastShown': {
    kind: 'mutation';
    args: { version: string };
    returns: null;
  };
  'users/queries:getPasswordExpiryStatus': {
    kind: 'query';
    args: Record<string, never>;
    returns: {
      expired: boolean;
      reason: null | 'admin_set' | 'rotation';
      hasCredential: boolean;
      daysUntilExpiry: null | number;
      rotationEnabled: boolean;
    };
  };
}
