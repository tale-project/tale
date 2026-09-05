/**
 * `collab` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../collab.ts` are what
 * actually serve them.
 */

export interface CollabContract {
  'collab/notifications:listMyNotifications': {
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
      page: Array<{
        _id: string;
        _creationTime: number;
        taskId?: string;
        actorId?: string;
        params?: unknown;
        readAt?: number;
        coalesceKey?: string;
        emailJobId?: string;
        read: boolean;
        organizationId: string;
        createdAt: number;
        type:
          | 'mention'
          | 'task_assigned'
          | 'task_unassigned'
          | 'task_status_changed'
          | 'task_commented'
          | 'task_deadline'
          | 'task_review_requested'
          | 'task_review_resolved'
          | 'task_reviewer_assigned'
          | 'document_review_requested'
          | 'document_review_resolved'
          | 'agent_escalation'
          | 'workforce_digest'
          | 'conversation_message'
          | 'conversation_assigned';
        userId: string;
        resourceType:
          | 'document'
          | 'task_review'
          | 'thread'
          | 'comment'
          | 'conversation'
          | 'task'
          | 'wf_execution'
          | 'runtime'
          | 'dashboard'
          | 'document_review';
        resourceId: string;
        actorType: 'user' | 'system' | 'agent';
        titleKey: string;
        bodyKey: string;
      }>;
      isDone: boolean;
      continueCursor: string;
    };
  };
  'collab/notifications:markAllNotificationsRead': {
    kind: 'mutation';
    args: { organizationId: string };
    returns: number;
  };
  'collab/notifications:markNotificationRead': {
    kind: 'mutation';
    args: { notificationId: string };
    returns: null;
  };
  'collab/notifications:myUnreadCount': {
    kind: 'query';
    args: { organizationId: string };
    returns: number;
  };
  'collab/preferences:getNotificationPreferences': {
    kind: 'query';
    args: { organizationId: string };
    returns: {
      taskAssigned: undefined | boolean;
      taskStatusChanged: undefined | boolean;
      taskCommented: undefined | boolean;
      mention: undefined | boolean;
      taskDeadlines: undefined | boolean;
      taskReview: undefined | boolean;
      escalation: undefined | boolean;
      digest: undefined | boolean;
      conversationMessages: undefined | boolean;
      actionableEmail: undefined | boolean;
    };
  };
  'collab/preferences:setNotificationPreferences': {
    kind: 'mutation';
    args: {
      conversationMessages?: boolean;
      mention?: boolean;
      taskAssigned?: boolean;
      taskStatusChanged?: boolean;
      taskCommented?: boolean;
      taskDeadlines?: boolean;
      taskReview?: boolean;
      escalation?: boolean;
      digest?: boolean;
      actionableEmail?: boolean;
      organizationId: string;
    };
    returns: null;
  };
  'collab/subscriptions:isSubscribedToTask': {
    kind: 'query';
    args: { taskId: string };
    returns: { subscribed: boolean; muted: boolean };
  };
  'collab/subscriptions:setTaskMuted': {
    kind: 'mutation';
    args: { taskId: string; muted: boolean };
    returns: null;
  };
  'collab/subscriptions:subscribeToTask': {
    kind: 'mutation';
    args: { taskId: string };
    returns: null;
  };
  'collab/subscriptions:unsubscribeFromTask': {
    kind: 'mutation';
    args: { taskId: string };
    returns: null;
  };
}
