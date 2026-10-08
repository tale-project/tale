import { z } from 'zod';

import { canonicalTimeZone } from '../time-zone';
import {
  SCHEDULE_ISSUE_CODES,
  scheduleIssueCode,
  scheduleRuleSchema,
} from './schedule-rule';

/**
 * What starts an automation — the one zod source of a trigger's shape. The
 * app's trigger editor, REST, MCP, automation packs and managed
 * configuration all write it, and the store parses it again for the callers
 * that reach it without a schema.
 *
 * The schema is structural. What needs the platform — reading a cron
 * expression, the events the platform raises, whether a rule ever comes due
 * — the store checks, and both answer `AUTOMATION_TRIGGER_INVALID` with the
 * same coded issues (`TRIGGER_ISSUE_CODES`), which the editor turns into one
 * sentence per field.
 *
 * Imports only `zod` and its siblings: the browser and the server both load
 * it.
 */

export type TriggerKind = 'schedule' | 'webhook' | 'event';

/** The refusals a trigger can earn, in the dotted form the doors answer
 * under `data.issues[].code`. A problem of shape the editor never sends (a
 * wrong type, an unknown key) keeps zod's own code. */
export const TRIGGER_ISSUE_CODES = [
  'trigger.key_other_kind',
  'schedule.cron_or_repeat',
  'schedule.cron_unreadable',
  'schedule.cron_impossible_date',
  ...SCHEDULE_ISSUE_CODES,
  'schedule.start_date',
  'timezone.blank',
  'timezone.unknown',
  'timezone.required',
  'input.not_object',
  'input.reserved_key',
  'input.too_large',
  'event.required',
  'event.unknown',
] as const;

export type TriggerIssueCode = (typeof TRIGGER_ISSUE_CODES)[number];

/** One refusal of a trigger: the dotted field path (`repeat.times`), its
 * code, and a sentence for a reader without the editor. */
export interface TriggerIssue {
  path: string;
  code: TriggerIssueCode | (string & {});
  message: string;
}

function isTriggerIssueCode(value: unknown): value is TriggerIssueCode {
  return (TRIGGER_ISSUE_CODES as readonly unknown[]).includes(value);
}

function addIssue(
  ctx: z.RefinementCtx,
  code: TriggerIssueCode,
  message: string,
  path: (string | number)[],
): void {
  ctx.addIssue({ code: 'custom', message, path, params: { code } });
}

/** Which kind each optional key belongs to. A key of another kind is
 * refused by name: a webhook trigger used to store a `cron` and read back as
 * one that also ran on a schedule. */
const KEY_KINDS: Readonly<Record<string, TriggerKind>> = {
  cron: 'schedule',
  repeat: 'schedule',
  startDate: 'schedule',
  timezone: 'schedule',
  catchUp: 'schedule',
  event: 'event',
  rotateToken: 'webhook',
};

/** The kind `key` belongs to, or null when it is no kind's own key. */
export function triggerKeyKind(key: string): TriggerKind | null {
  return Object.hasOwn(KEY_KINDS, key) ? (KEY_KINDS[key] ?? null) : null;
}

/**
 * A time zone: an IANA name, in any case, or a fixed offset such as
 * `+05:30`, trimmed and stored in `Intl`'s spelling (`europe/zurich` →
 * `Europe/Zurich`). A blank zone is refused: it used to save, read as
 * enabled and never fire.
 */
export const timeZoneSchema = z
  .string()
  .max(100)
  .transform((value, ctx) => {
    if (value.trim() === '') {
      addIssue(
        ctx,
        'timezone.blank',
        'A time zone cannot be blank; name one, such as "Europe/Zurich" or "UTC".',
        [],
      );
      return z.NEVER;
    }
    const zone = canonicalTimeZone(value);
    if (zone === null) {
      addIssue(
        ctx,
        'timezone.unknown',
        `"${value.trim()}" is not a valid IANA time zone (e.g. "Europe/Zurich" or "UTC").`,
        [],
      );
      return z.NEVER;
    }
    return zone;
  })
  .meta({
    description:
      'An IANA time zone such as "Europe/Zurich", or a fixed offset such as "+05:30". Stored in its canonical spelling.',
  });

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether `text` is a `YYYY-MM-DD` day a calendar has, from 2000 to 2999. */
function isRealDate(text: string): boolean {
  const match = ISO_DATE.exec(text);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2999) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** A calendar day, `YYYY-MM-DD`, from 2000-01-01 to 2999-12-31. */
export const isoDateSchema = z
  .string()
  .superRefine((value, ctx) => {
    if (!isRealDate(value)) {
      addIssue(
        ctx,
        'schedule.start_date',
        'The start date must be a calendar day written YYYY-MM-DD, between 2000 and 2999.',
        [],
      );
    }
  })
  .meta({
    description: 'A calendar day, "YYYY-MM-DD", in the trigger\'s time zone.',
  });

/** What a schedule does with occurrences it missed while the platform was
 * not running: `latest` starts the most recent one once, however late;
 * `skip` starts it only when it is at most ten minutes late. */
export const catchUpSchema = z.enum(['latest', 'skip']).meta({
  description:
    'Missed occurrences: "latest" (the default) starts the most recent one once, however late; "skip" starts it only when it is at most 10 minutes late. Either way the others are counted, not run.',
});

export type CatchUp = z.infer<typeof catchUpSchema>;

/** The fields a trigger sets on every run's input itself; a fixed input
 * may not name them. */
export const TRIGGER_WRAPPER_KEYS = [
  'trigger',
  'firedAt',
  'event',
  'payload',
] as const;

/** The most a fixed input may weigh, as JSON. */
export const STATIC_INPUT_MAX_BYTES = 16 * 1024;

const encoder = new TextEncoder();

/**
 * Values a trigger adds to every run's input: a JSON object, at most 16 KiB.
 * The trigger's own fields are set over it, so it may not name them. Plain
 * data: a template in it is never evaluated.
 */
export const staticInputSchema = z
  .record(z.string(), z.json(), {
    error: 'The fixed input must be a JSON object.',
  })
  .superRefine((input, ctx) => {
    const reserved = TRIGGER_WRAPPER_KEYS.filter((key) =>
      Object.hasOwn(input, key),
    );
    if (reserved.length > 0) {
      addIssue(
        ctx,
        'input.reserved_key',
        `Remove ${reserved.map((key) => `"${key}"`).join(', ')}: the trigger sets these fields itself.`,
        [],
      );
    }
    if (encoder.encode(JSON.stringify(input)).length > STATIC_INPUT_MAX_BYTES) {
      addIssue(
        ctx,
        'input.too_large',
        'The fixed input is larger than 16 KiB.',
        [],
      );
    }
  })
  .meta({
    description:
      "Values the trigger adds to every run's input, as a JSON object of at most 16 KiB. The trigger's own fields (trigger, firedAt, event, payload) are set over it, so it cannot name them; a template in it is plain text, never evaluated. Omit it to clear it: saving a trigger replaces it whole.",
  });

const enabledSchema = z.boolean().meta({
  description: 'Whether it starts runs. Omitted reads as true.',
});

const scheduleWriteSchema = z
  .strictObject({
    kind: z.literal('schedule'),
    enabled: enabledSchema.optional(),
    input: staticInputSchema.optional(),
    cron: z.string().max(200).optional().meta({
      description:
        'A five-field cron expression — the advanced form; give it or `repeat`, not both.',
    }),
    repeat: scheduleRuleSchema.optional(),
    startDate: isoDateSchema.optional().meta({
      description:
        'The day a repeat rule starts on, in its time zone: no start comes before it, and "every 2 weeks" counts from it. Omitted means today. Send back the one you read to keep the rule in step.',
    }),
    timezone: timeZoneSchema.optional().meta({
      description:
        'The time zone the schedule reads in. Required with `repeat`; a cron expression without one reads in UTC.',
    }),
    catchUp: catchUpSchema.optional(),
  })
  .superRefine((trigger, ctx) => {
    const hasCron = (trigger.cron ?? '').trim() !== '';
    const hasRepeat = trigger.repeat !== undefined;
    if (!hasCron && !hasRepeat) {
      addIssue(
        ctx,
        'schedule.cron_or_repeat',
        'A schedule trigger needs a repeat rule or a cron expression (e.g. "0 9 * * 1" for 09:00 every Monday).',
        ['repeat'],
      );
    }
    if (hasCron && hasRepeat) {
      addIssue(
        ctx,
        'schedule.cron_or_repeat',
        'Give the schedule either a repeat rule or a cron expression, not both.',
        ['repeat'],
      );
    }
    if (trigger.startDate !== undefined && hasCron && !hasRepeat) {
      addIssue(
        ctx,
        'schedule.start_date',
        'A start date goes with a repeat rule; a cron expression has none.',
        ['startDate'],
      );
    }
    if (hasRepeat && trigger.timezone === undefined) {
      addIssue(
        ctx,
        'timezone.required',
        'A repeat rule needs a time zone, such as "Europe/Zurich" or "UTC".',
        ['timezone'],
      );
    }
  });

const webhookWriteSchema = z.strictObject({
  kind: z.literal('webhook'),
  enabled: enabledSchema.optional(),
  input: staticInputSchema.optional(),
  rotateToken: z.boolean().optional().meta({
    description:
      'Mint a new address; the one it replaces stops working at once.',
  }),
});

const eventWriteSchema = z.strictObject({
  kind: z.literal('event'),
  enabled: enabledSchema.optional(),
  input: staticInputSchema.optional(),
  event: z.string().max(200).optional().meta({
    description: 'The platform event that starts a run.',
  }),
});

/**
 * A trigger as a caller writes it — one strict shape per kind. Saving is a
 * full replace: what is left out is reset (an omitted `catchUp` reads as
 * `latest`, an omitted `startDate` as today).
 */
export const triggerWriteSchema = z
  .discriminatedUnion('kind', [
    scheduleWriteSchema,
    webhookWriteSchema,
    eventWriteSchema,
  ])
  .meta({
    description:
      'What starts the automation: a schedule (a repeat rule or a cron expression in a time zone), a webhook, or a platform event.',
  });

export type TriggerWrite = z.input<typeof triggerWriteSchema>;
export type ParsedTriggerWrite = z.output<typeof triggerWriteSchema>;

/**
 * The refusals of a failed {@link triggerWriteSchema} parse of `value`, one
 * per field and per unknown key. A key of another kind is named as such
 * (`trigger.key_other_kind`); a key no kind takes keeps zod's code.
 */
export function triggerIssues(
  error: z.ZodError,
  value: unknown,
): TriggerIssue[] {
  const kind =
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof value.kind === 'string'
      ? value.kind
      : 'this';
  return error.issues.flatMap((issue): TriggerIssue[] => {
    const path = issue.path.map(String).join('.');
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => {
        const owner = triggerKeyKind(key);
        const at = path === '' ? key : `${path}.${key}`;
        return owner !== null && owner !== kind
          ? {
              path: at,
              code: 'trigger.key_other_kind',
              message: `"${key}" belongs to ${owner} triggers — a ${kind} trigger does not take it.`,
            }
          : {
              path: at,
              code: 'unrecognized_keys',
              message: `is not a field a ${kind} trigger takes`,
            };
      });
    }
    const coded =
      issue.code === 'custom' && isTriggerIssueCode(issue.params?.code)
        ? issue.params.code
        : path === 'input' && issue.code === 'invalid_type'
          ? 'input.not_object'
          : scheduleIssueCode(issue);
    return [{ path, code: coded ?? issue.code, message: issue.message }];
  });
}

/** Missed occurrences, as a skip's detail counts them. */
export const missedSummarySchema = z.strictObject({
  count: z.number().int().min(1),
  /** `count` stopped at its cap; more were missed. */
  capped: z.boolean(),
  firstAt: z.number(),
  lastAt: z.number(),
  policy: catchUpSchema,
});

export type MissedSummary = z.infer<typeof missedSummarySchema>;

/** The most problems a refused start keeps in its skip detail. */
export const SKIP_DETAIL_MAX_ISSUES = 10;
/** The longest sentence a skip detail keeps. */
export const SKIP_DETAIL_MAX_MESSAGE = 500;

/**
 * Why a trigger last started nothing, in the words a reader needs to act:
 * the occurrence or event it was about, a refusal's code and the version
 * that refused it, and the occurrences missed alongside. Its `reason` is the
 * trigger's `lastSkipReason`; a pause after failures has no detail (its
 * facts are the failure fields).
 */
export const triggerSkipDetailSchema = z.discriminatedUnion('reason', [
  z.strictObject({
    reason: z.literal('missed_occurrences'),
    missed: missedSummarySchema,
    /** The latest of them started a run; the rest are the missed. */
    firedLatest: z.boolean(),
  }),
  z.strictObject({
    reason: z.literal('not_deployed'),
    occurrence: z.number(),
    missed: missedSummarySchema.optional(),
  }),
  z.strictObject({
    reason: z.literal('start_refused'),
    occurrence: z.number(),
    code: z.string().max(100),
    version: z.number().int().nullable(),
    message: z.string().max(SKIP_DETAIL_MAX_MESSAGE),
    issues: z
      .array(z.strictObject({ path: z.string(), message: z.string() }))
      .max(SKIP_DETAIL_MAX_ISSUES)
      .optional(),
    missed: missedSummarySchema.optional(),
  }),
  z.strictObject({
    reason: z.literal('unusable_cron'),
    message: z.string().max(SKIP_DETAIL_MAX_MESSAGE),
  }),
]);

export type TriggerSkipDetail = z.infer<typeof triggerSkipDetailSchema>;
