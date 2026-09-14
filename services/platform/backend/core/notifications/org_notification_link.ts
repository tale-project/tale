import { z } from 'zod';

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
export const orgNotificationLinkSchema = z.discriminatedUnion('kind', [
  // `logId` deep-links to the specific broken audit row (#1845); optional so a
  // finding without a concrete row (config/checkpoint) still links to the page.
  z.object({ kind: z.literal('audit-logs'), logId: z.string().optional() }),
  // `requestId` opens the request itself; optional so a row stored before the
  // id was carried still lands on the list.
  z.object({ kind: z.literal('dsar'), requestId: z.string().optional() }),
  z.object({ kind: z.literal('security-monitoring') }),
  // The budget editor, where an admin grants the credits the alert asks for.
  z.object({ kind: z.literal('budgets') }),
  z.object({ kind: z.literal('websites') }),
]);

export type OrgNotificationLink = z.infer<typeof orgNotificationLinkSchema>;
