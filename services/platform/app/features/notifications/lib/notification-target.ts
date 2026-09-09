import type { OrgNotificationLink } from '@/backend/core/notifications/org_notification_link';
import { automationSlugToParam } from '@/lib/automations/slug';
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
  // Controlled-document review rows: a project file opens inside its
  // project's Files tab, an org/team document in the knowledge library —
  // `doc` opens the preview so the reviewer reads the frozen artifact
  // immediately.
  | {
      to: '/dashboard/$id/projects/$projectId/files';
      params: { id: string; projectId: string };
      search: { doc: string; folderId?: string };
    }
  | {
      to: '/dashboard/$id/documents';
      params: { id: string };
      search: { doc: string };
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
  // A DSAR alert names one request and the row carries its id, so open it.
  | {
      to: '/dashboard/$id/settings/governance/data-subject-requests/$requestId';
      params: { id: string; requestId: string };
    }
  // The budget editor — where an admin grants the credits a member asked for.
  | {
      to: '/dashboard/$id/settings/governance/policies-limits';
      params: { id: string };
    }
  // The websites list, filtered to the status the alert is about.
  | {
      to: '/dashboard/$id/websites';
      params: { id: string };
      search?: { status?: string };
    }
  // An automation run — the landing for an escalation with no task and no
  // project, whose row carries the run id and its automation's name.
  | {
      to: '/dashboard/$id/automations/$automationSlug/runs/$runId';
      params: { id: string; automationSlug: string; runId: string };
    }
  | {
      to: '/dashboard/$id/settings/governance/security-monitoring';
      params: { id: string };
    }
  // --- Fallbacks (#2377): every notification navigates somewhere sensible so
  // no row is a silently dead, cursor-default line. ---
  // Project Tasks — a personal row that names a project but no specific task.
  | {
      to: '/dashboard/$id/projects/$projectId/tasks';
      params: { id: string; projectId: string };
    }
  // Automations — landing for a generic system/automation org alert with
  // no more specific link (the standalone automations list was removed;
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
 * The org-alert `link` shape. Declared once in `backend/core` and re-exported
 * here so the producer, the wire contract and this router cannot drift.
 */
export type { OrgNotificationLink };

/**
 * Deep-link target for a PERSONAL notification (`userNotifications`). Task-bound
 * types route to the task inside its project; chat mentions route to their
 * thread; a row that names a project but no task opens the project (including
 * legacy discussion-mention rows — their route is gone); anything else falls
 * back to the org home. Always returns a target — a personal row is never a
 * dead, unclickable line (#2377).
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

  // Document-review rows (document_review_requested/resolved) carry the
  // document id; project files land in their Files tab, library documents in
  // the org-wide list — both with the preview opened.
  const documentId =
    typeof params?.documentId === 'string' ? params.documentId : undefined;
  if (documentId && projectId) {
    const folderId =
      typeof params?.folderId === 'string' ? params.folderId : undefined;
    return {
      to: '/dashboard/$id/projects/$projectId/files',
      params: { id, projectId },
      search: { doc: documentId, ...(folderId ? { folderId } : {}) },
    };
  }
  if (documentId) {
    return {
      to: '/dashboard/$id/documents',
      params: { id },
      search: { doc: documentId },
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
      to: '/dashboard/$id/projects/$projectId/tasks',
      params: { id, projectId },
    };
  }

  // An agent escalation on an org-scoped run has no task and no project, but
  // it does name the run. Needs BOTH keys — neither appears in any other
  // personal row's params, so this cannot swallow another type's row.
  const runId = typeof params?.runId === 'string' ? params.runId : undefined;
  const automationName =
    typeof params?.name === 'string' ? params.name : undefined;
  if (runId && automationName) {
    return {
      to: '/dashboard/$id/automations/$automationSlug/runs/$runId',
      params: {
        id,
        automationSlug: automationSlugToParam(automationName),
        runId,
      },
    };
  }

  return { to: '/dashboard/$id', params: { id } };
}

/**
 * Deep-link target for an ORG notification. A stored `link` routes to its
 * specific page; a linkless row (legacy or generic automation/system alert) falls
 * back by `category` — security alerts land on Governance, everything else on
 * Automations. Always returns a target, so an org row is never a dead,
 * unclickable line (#2377).
 */
function categoryLanding(
  id: string,
  category: 'security' | 'system',
): NotificationTarget {
  return category === 'security'
    ? { to: '/dashboard/$id/settings/governance', params: { id } }
    : { to: '/dashboard/$id/automations', params: { id } };
}

export function orgNotificationTarget(
  organizationId: string,
  link: OrgNotificationLink | undefined,
  category: 'security' | 'system',
): NotificationTarget {
  const id = organizationId;
  if (!link) return categoryLanding(id, category);
  switch (link.kind) {
    case 'budgets':
      return {
        to: '/dashboard/$id/settings/governance/policies-limits',
        params: { id },
      };
    case 'websites':
      return {
        to: '/dashboard/$id/websites',
        params: { id },
        search: { status: 'error' },
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
      return link.requestId
        ? {
            to: '/dashboard/$id/settings/governance/data-subject-requests/$requestId',
            params: { id, requestId: link.requestId },
          }
        : {
            to: '/dashboard/$id/settings/governance/data-subject-requests',
            params: { id },
          };
    case 'security-monitoring':
      return {
        to: '/dashboard/$id/settings/governance/security-monitoring',
        params: { id },
      };
    default: {
      // Exhaustiveness guard — a new `kind` must extend this switch. At
      // RUNTIME this arm is reached only by a stored row from a retired
      // producer, so it lands on the category page. Returning `_exhaustive`
      // handed the link OBJECT back as a target, and a `<Link>` spread with
      // no `to` navigates nowhere.
      const _exhaustive: never = link;
      void _exhaustive;
      return categoryLanding(id, category);
    }
  }
}
