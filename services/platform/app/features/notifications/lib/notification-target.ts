import { isRecord } from '@/lib/utils/type-utils';

/**
 * A typed TanStack-Router navigate descriptor for a notification's in-app deep
 * link. `to` is constrained to the routes we actually emit, so each member is
 * validated against the real router wherever the value is spread into `<Link>`
 * or passed to `navigate()`.
 */
export type NotificationTarget =
  | {
      to: '/dashboard/$id/projects/$projectId/tasks';
      params: { id: string; projectId: string };
      search: { task: string };
    }
  | {
      to: '/dashboard/$id/projects/$projectId/discussions';
      params: { id: string; projectId: string };
      search: { thread: string };
    }
  | {
      to: '/dashboard/$id/chat/$threadId';
      params: { id: string; threadId: string };
    }
  | {
      to: '/dashboard/$id/conversations/$status';
      params: { id: string; status: string };
      search: { conversation: string };
    }
  | {
      to: '/dashboard/$id/settings/governance/logs';
      params: { id: string };
      /** Deep-links to a specific broken audit row (#1845); reveals it in-page. */
      search?: { logId?: string };
    }
  | {
      to: '/dashboard/$id/settings/governance/data-subject-requests';
      params: { id: string };
    }
  | {
      to: '/dashboard/$id/settings/governance/security-monitoring';
      params: { id: string };
    }
  // --- Fallbacks (#2377): every notification navigates somewhere sensible so
  // no row is a silently dead, cursor-default line. ---
  // Project overview — a personal row that names a project but no specific task.
  | {
      to: '/dashboard/$id/projects/$projectId';
      params: { id: string; projectId: string };
    }
  // Automations — landing for a generic system/workflow org alert with
  // no more specific link (the standalone workflows list was removed;
  // installed automation lives in Automations).
  | {
      to: '/dashboard/$id/automations';
      params: { id: string };
    }
  // Governance overview — landing for a security org alert with no more
  // specific link (the security/audit/DSAR pages all live under Governance).
  | {
      to: '/dashboard/$id/settings/governance';
      params: { id: string };
    }
  // Org home — last-resort landing for a personal row with no project context
  // (e.g. a digest, or a legacy row written before `projectId` was stored).
  | {
      to: '/dashboard/$id';
      params: { id: string };
    };

/**
 * The org-alert `link` shape. Mirrors `notificationLinkValidator` in
 * `convex/notifications/schema.ts` — keep the two in sync (closed union).
 */
export type OrgNotificationLink =
  | { kind: 'agent'; agentSlug: string }
  // `logId` deep-links to the specific broken audit row (#1845); optional so a
  // finding without a concrete row (config/checkpoint) still links to the page.
  | { kind: 'audit-logs'; logId?: string }
  | { kind: 'dsar' }
  | { kind: 'security-monitoring' };

/**
 * Deep-link target for a PERSONAL notification (`userNotifications`). Task-bound
 * types route to the task inside its project; chat and discussion mentions route
 * to their thread; a row that names a project but no task opens the project;
 * anything else falls back to the org home. Always returns a target — a personal
 * row is never a dead, unclickable line (#2377).
 */
export function personalNotificationTarget(args: {
  organizationId: string;
  taskId: string | undefined;
  params: unknown;
}): NotificationTarget {
  const id = args.organizationId;
  const params = isRecord(args.params) ? args.params : undefined;
  const projectId =
    typeof params?.projectId === 'string' ? params.projectId : undefined;
  const threadId =
    typeof params?.threadId === 'string' ? params.threadId : undefined;
  const conversationId =
    typeof params?.conversationId === 'string'
      ? params.conversationId
      : undefined;

  // A conversation notification (inbound message / assignment) opens the thread
  // in the Inbox. The stamped `conversationStatus` doubles as the `$status` URL
  // segment — the DB status enum matches the route's valid statuses — defaulting
  // to `open`. Mirrors `buildPersonalNotificationUrl` in the email path.
  if (conversationId) {
    const status =
      typeof params?.conversationStatus === 'string' &&
      params.conversationStatus
        ? params.conversationStatus
        : 'open';
    return {
      to: '/dashboard/$id/conversations/$status',
      params: { id, status },
      search: { conversation: conversationId },
    };
  }

  if (params?.chat === true && threadId) {
    return {
      to: '/dashboard/$id/chat/$threadId',
      params: { id, threadId },
    };
  }
  if (threadId && projectId && !args.taskId) {
    return {
      to: '/dashboard/$id/projects/$projectId/discussions',
      params: { id, projectId },
      search: { thread: threadId },
    };
  }
  if (args.taskId && projectId) {
    return {
      to: '/dashboard/$id/projects/$projectId/tasks',
      params: { id, projectId },
      search: { task: args.taskId },
    };
  }
  if (projectId) {
    return {
      to: '/dashboard/$id/projects/$projectId',
      params: { id, projectId },
    };
  }
  return { to: '/dashboard/$id', params: { id } };
}

/**
 * Deep-link target for an ORG notification. A stored `link` routes to its
 * specific page; a linkless row (legacy or generic workflow/system alert) falls
 * back by `category` — security alerts land on Governance, everything else on
 * Automations. Always returns a target, so an org row is never a dead,
 * unclickable line (#2377).
 */
export function orgNotificationTarget(
  organizationId: string,
  link: OrgNotificationLink | undefined,
  category: 'security' | 'system',
): NotificationTarget {
  const id = organizationId;
  if (!link) {
    return category === 'security'
      ? { to: '/dashboard/$id/settings/governance', params: { id } }
      : { to: '/dashboard/$id/automations', params: { id } };
  }
  switch (link.kind) {
    case 'agent':
      // The agents management page was removed; an agent-scoped alert has no
      // dedicated page to open, so it lands on the org home rather than a dead
      // link. (The `agent` link kind is kept — producers still stamp it.)
      return { to: '/dashboard/$id', params: { id } };
    case 'audit-logs':
      return link.logId
        ? {
            to: '/dashboard/$id/settings/governance/logs',
            params: { id },
            search: { logId: link.logId },
          }
        : { to: '/dashboard/$id/settings/governance/logs', params: { id } };
    case 'dsar':
      return {
        to: '/dashboard/$id/settings/governance/data-subject-requests',
        params: { id },
      };
    case 'security-monitoring':
      return {
        to: '/dashboard/$id/settings/governance/security-monitoring',
        params: { id },
      };
    default: {
      // Exhaustiveness guard — a new `kind` must extend this switch.
      const _exhaustive: never = link;
      return _exhaustive;
    }
  }
}
