import { isRecord } from '@/lib/utils/type-utils';

/**
 * A typed TanStack-Router navigate descriptor for a notification's in-app deep
 * link. `to` is constrained to the routes we actually emit, so each member is
 * validated against the real router wherever the value is spread into `<Link>`
 * or passed to `navigate()`. Returning `null` means "no destination" — the row
 * body is not a navigation link.
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
      to: '/dashboard/$id/agents/$agentId';
      params: { id: string; agentId: string };
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
 * types route to the task inside its project; discussion mentions route to the
 * thread inside its project. Returns `null` when the row lacks the context to
 * build a link — legacy rows written before `projectId` was stored in `params`,
 * or non-task resources we don't deep-link yet.
 */
export function personalNotificationTarget(args: {
  organizationId: string;
  taskId: string | undefined;
  params: unknown;
}): NotificationTarget | null {
  const params = isRecord(args.params) ? args.params : undefined;
  const projectId = params?.projectId;
  const threadId = params?.threadId;
  if (params?.chat === true && typeof threadId === 'string') {
    return {
      to: '/dashboard/$id/chat/$threadId',
      params: { id: args.organizationId, threadId },
    };
  }
  if (
    typeof threadId === 'string' &&
    typeof projectId === 'string' &&
    !args.taskId
  ) {
    return {
      to: '/dashboard/$id/projects/$projectId/discussions',
      params: { id: args.organizationId, projectId },
      search: { thread: threadId },
    };
  }
  if (args.taskId && typeof projectId === 'string') {
    return {
      to: '/dashboard/$id/projects/$projectId/tasks',
      params: { id: args.organizationId, projectId },
      search: { task: args.taskId },
    };
  }
  return null;
}

/**
 * Deep-link target for an ORG notification's stored `link`. Returns `null` when
 * the notification carries no link (legacy rows, or generic workflow alerts).
 */
export function orgNotificationTarget(
  organizationId: string,
  link: OrgNotificationLink | undefined,
): NotificationTarget | null {
  if (!link) return null;
  const id = organizationId;
  switch (link.kind) {
    case 'agent':
      return {
        to: '/dashboard/$id/agents/$agentId',
        params: { id, agentId: link.agentSlug },
      };
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
