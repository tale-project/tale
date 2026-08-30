/**
 * `notifications` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../notifications.ts` are what
 * actually serve them.
 */

export interface NotificationsContract {
  'notifications/mutations:markAllRead': {
    kind: 'mutation';
    args: { organizationId: string };
    returns: null;
  };
  'notifications/mutations:markRead': {
    kind: 'mutation';
    args: { notificationId: string };
    returns: null;
  };
  'notifications/queries:list': {
    kind: 'query';
    args: {
      organizationId: string;
      paginationOpts: {
        id?: number;
        endCursor?: null | string;
        maximumRowsRead?: number;
        maximumBytesRead?: number;
        numItems: number;
        cursor: null | string;
      };
    };
    returns: {
      isDone: boolean;
      continueCursor: string;
      page: Array<{
        _id: string;
        _creationTime: number;
        organizationId: string;
        category: 'system' | 'security';
        severity: 'info' | 'warning' | 'critical';
        titleKey: string;
        bodyKey: string;
        params: unknown;
        link:
          | undefined
          | { kind: 'agent'; agentSlug: string }
          | { logId?: string; kind: 'audit-logs' }
          | { kind: 'dsar' }
          | { kind: 'security-monitoring' };
        createdAt: number;
        readBy: string[];
        read: boolean;
      }>;
    };
  };
  'notifications/queries:unreadCount': {
    kind: 'query';
    args: { organizationId: string };
    returns: number;
  };
}
