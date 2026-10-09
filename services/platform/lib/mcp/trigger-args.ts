import { z } from 'zod';

/**
 * The trigger `set_trigger` takes: one shape per kind, each strict, so a key
 * of another kind (`event` on a schedule) is refused by name. Only the
 * envelope is held here; the store judges the cron, the zone and the event.
 *
 * Its own module on purpose: the trigger contract is about to become one
 * shared schema for every door (the REST bind, the editor, the MCP tool).
 * When it does, this module re-exports that schema and nothing else in the
 * MCP inventory moves.
 */

const enabled = z
  .boolean()
  .describe(
    'Whether the trigger starts runs; false keeps it bound but paused.',
  );

export const triggerArgSchema = z
  .discriminatedUnion(
    'kind',
    [
      z.strictObject({
        kind: z.literal('schedule'),
        enabled: enabled.optional(),
        cron: z
          .string()
          .max(200)
          .optional()
          .describe(
            'Five fields — minute hour day-of-month month day-of-week — e.g. "0 9 * * 1" for 09:00 every Monday; required. An expression that can never fire (a 30 February) is refused.',
          ),
        timezone: z
          .string()
          .max(100)
          .optional()
          .describe(
            'The IANA time zone the cron reads its clock in, e.g. "Europe/Zurich"; UTC when omitted.',
          ),
      }),
      z.strictObject({
        kind: z.literal('webhook'),
        enabled: enabled.optional(),
        rotateToken: z
          .boolean()
          .optional()
          .describe(
            'true mints a new token, answered once in this call, and the URL of the old one stops working; re-binding the webhook without it keeps its token.',
          ),
      }),
      z.strictObject({
        kind: z.literal('event'),
        enabled: enabled.optional(),
        event: z
          .string()
          .max(200)
          .optional()
          .describe(
            'The event that starts a run — one list_events names; required.',
          ),
      }),
    ],
    { error: 'must name its kind: "schedule", "webhook" or "event"' },
  )
  .describe(
    'The trigger — {kind: "schedule" | "webhook" | "event", …}, one shape per kind (a key of another kind is refused by name); get_docs with topic "triggers" describes each kind. A webhook trigger answers its token ONCE, in this call — list_triggers never returns it; rotateToken: true mints a new one.',
  );
