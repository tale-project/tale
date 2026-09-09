/**
 * The deep-link target stored on an ORG notification (`app.notifications.link`).
 *
 * One declaration, imported by all three surfaces that used to spell it out
 * separately: the producer (`domains/notifications/service.ts`), the wire
 * contract the app consumes (`app/lib/backend/contract/notifications.ts`), and
 * the router that turns a stored link into a route
 * (`app/features/notifications/lib/notification-target.ts`). A producer can no
 * longer invent a `kind` the router has never heard of.
 *
 * A closed union on purpose: the router switches on `kind` with a `never`
 * guard, so adding a member here fails to compile until it has a route.
 */
export type OrgNotificationLink =
  | { kind: 'agent'; agentSlug: string }
  // `logId` deep-links to the specific broken audit row (#1845); optional so a
  // finding without a concrete row (config/checkpoint) still links to the page.
  | { kind: 'audit-logs'; logId?: string }
  | { kind: 'dsar' }
  | { kind: 'security-monitoring' };
