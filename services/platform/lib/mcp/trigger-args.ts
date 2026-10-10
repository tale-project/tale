import { triggerWriteSchema } from '@tale/shared/schemas/automation-trigger';

/**
 * The trigger `set_trigger` takes: the shared trigger contract
 * (`@tale/shared/schemas/automation-trigger`), the same shape the REST bind
 * and the editor send — one strict shape per kind, so a key of another kind
 * (`event` on a schedule) is refused by name, and a schedule names a repeat
 * rule or a cron expression, its time zone, what it does with missed
 * occurrences and a fixed input. The store judges what needs the
 * organization: the cron's occurrences, the event's name.
 *
 * Its own module so the MCP inventory names one place for it: the triggers
 * reference walks this schema for each kind's fields.
 */
export const triggerArgSchema = triggerWriteSchema.describe(
  'The trigger — {kind: "schedule" | "webhook" | "event", …}, one shape per kind (a key of another kind is refused by name); get_docs with topic "triggers" describes each kind. A schedule takes a repeat rule (repeat, startDate, timezone) or a cron expression; any kind may carry a fixed input. A webhook trigger answers its token ONCE, in this call — list_triggers never returns it; rotateToken: true mints a new one.',
);
