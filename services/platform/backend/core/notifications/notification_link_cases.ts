/**
 * Where every notification goes — one row per type, and the compile-time
 * gate that keeps the list complete.
 *
 * A notification that names something the reader cannot reach is the defect
 * this table exists to prevent. The failure was quiet: the link is derived
 * from an optional `params` bag, so an emitter that omitted a key produced a
 * row that still rendered, still clicked, and still landed — on the org home,
 * with the email losing its CTA entirely. No type error, no red test.
 *
 * `Record<NotificationType, …>` is the gate. Add a member to the union in
 * `../collab/types.ts` and this object stops type-checking until the new type
 * either declares where it goes or says, in writing, why it cannot.
 *
 * The suite that drives this table lives beside the in-app builder
 * (`app/features/notifications/lib/notification-target.parity.test.ts`) —
 * app-side, because it exercises BOTH hand-mirrored builders from these rows
 * and only that side can import both.
 */

import type { NotificationType } from '../collab/types';
import type { OrgNotificationLink } from './org_notification_link';

/**
 * Routes that mean "somewhere sensible", not "the thing this is about". A
 * row landing here has told the reader to go and find it by hand.
 */
export const GENERIC_LANDING_ROUTES: readonly string[] = [
  '/dashboard/$id',
  '/dashboard/$id/automations',
  '/dashboard/$id/settings/governance',
];

export function isGenericLanding(to: string): boolean {
  return GENERIC_LANDING_ROUTES.includes(to);
}

export interface NotificationLinkCase {
  /** The row a live emitter of this type writes. */
  readonly row: {
    readonly taskId?: string;
    readonly params?: Record<string, unknown>;
  };
  /** The path BOTH builders must produce for that row, origin-free. */
  readonly path: string;
  /**
   * Set ONLY when this type may land on a generic page. The value is the
   * reason, and it is required — an opt-out cannot be taken silently.
   */
  readonly genericLanding?: string;
}

export interface OrgLinkCase {
  readonly link: OrgNotificationLink;
  readonly path: string;
  readonly genericLanding?: string;
}

const ORG = 'org_case';

/** The task every task-bound row in this table points at. */
const TASK_PATH = `/dashboard/${ORG}/projects/proj_1/tasks?task=task_1`;
const TASK_ROW = {
  taskId: 'task_1',
  params: { title: 'Redesign side-navigation', projectId: 'proj_1' },
} as const;

export const CASE_ORGANIZATION_ID = ORG;

export const PERSONAL_LINK_CASES: Record<
  NotificationType,
  NotificationLinkCase
> = {
  task_assigned: { row: TASK_ROW, path: TASK_PATH },
  task_unassigned: { row: TASK_ROW, path: TASK_PATH },
  task_status_changed: { row: TASK_ROW, path: TASK_PATH },
  task_commented: { row: TASK_ROW, path: TASK_PATH },
  mention: { row: TASK_ROW, path: TASK_PATH },
  task_deadline: { row: TASK_ROW, path: TASK_PATH },
  task_review_requested: {
    row: {
      taskId: 'task_1',
      params: { taskId: 'task_1', projectId: 'proj_1', approvalId: 'ap_1' },
    },
    path: TASK_PATH,
  },
  task_reviewer_assigned: { row: TASK_ROW, path: TASK_PATH },
  document_review_requested: {
    row: {
      params: { documentId: 'doc_1', projectId: 'proj_1', folderId: 'fld_1' },
    },
    path: `/dashboard/${ORG}/projects/proj_1/files?doc=doc_1&folderId=fld_1`,
  },
  document_review_resolved: {
    row: { params: { documentId: 'doc_1' } },
    path: `/dashboard/${ORG}/documents?doc=doc_1`,
  },
  // The org-scoped shape: no task and no project, so the run is what the
  // row names. A task-bound or project-bound ask resolves earlier, on the
  // task and project rows above.
  agent_escalation: {
    row: { params: { name: 'billing/dunning-reminder', runId: 'run_1' } },
    path: `/dashboard/${ORG}/automations/billing__dunning-reminder/runs/run_1`,
  },
  conversation_assigned: {
    row: { params: { conversationId: 'conv_1', conversationStatus: 'open' } },
    path: `/dashboard/${ORG}/conversations/open?conversation=conv_1`,
  },
  // No emitter today — the 0.4 producer never made the port. Pinned rather
  // than opted out, so a revived producer inherits a working link by
  // stamping the same keys `conversation_assigned` uses.
  conversation_message: {
    row: { params: { conversationId: 'conv_1', conversationStatus: 'open' } },
    path: `/dashboard/${ORG}/conversations/open?conversation=conv_1`,
  },
  workforce_digest: {
    row: { params: { title: 'Your week' } },
    path: `/dashboard/${ORG}`,
    genericLanding:
      'A digest summarises many entities and names none, so there is nothing ' +
      'specific to open. Retired besides: no emitter writes this type, and ' +
      'the literal survives only so stored rows keep typing.',
  },
};

export const ORG_LINK_CASES: Record<OrgNotificationLink['kind'], OrgLinkCase> =
  {
    'audit-logs': {
      link: { kind: 'audit-logs', logId: 'log_1' },
      path: `/dashboard/${ORG}/settings/governance/logs?logId=log_1`,
    },
    dsar: {
      link: { kind: 'dsar', requestId: 'req_1' },
      path: `/dashboard/${ORG}/settings/governance/data-subject-requests/req_1`,
    },
    'security-monitoring': {
      link: { kind: 'security-monitoring' },
      path: `/dashboard/${ORG}/settings/governance/security-monitoring`,
    },
    budgets: {
      link: { kind: 'budgets' },
      path: `/dashboard/${ORG}/settings/governance/policies-limits`,
    },
    websites: {
      link: { kind: 'websites' },
      path: `/dashboard/${ORG}/websites?status=error`,
    },
  };

/**
 * Render a router navigate descriptor to the path it navigates to, so the
 * app's typed `NotificationTarget` and the email's absolute URL compare as
 * one string. Structurally typed on purpose: this module never imports the
 * app.
 */
export function notificationTargetPath(target: {
  to: string;
  params: Record<string, string>;
  search?: Record<string, string | undefined>;
}): string {
  const path = target.to.replaceAll(/\$([A-Za-z]+)/g, (whole, name: string) => {
    const value = target.params[name];
    return value === undefined ? whole : encodeURIComponent(value);
  });
  const query = Object.entries(target.search ?? {})
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return query === '' ? path : `${path}?${query}`;
}
