import {
  staticInputSchema,
  TRIGGER_WRAPPER_KEYS,
  type TriggerIssueCode,
  type TriggerKind,
  type TriggerView,
  type TriggerWrite,
} from '@tale/shared/schemas/automation-trigger';
import {
  normalizeScheduleRule,
  sameScheduleRule,
  type ScheduleRule,
  scheduleIssueCode,
  scheduleRuleSchema,
} from '@tale/shared/schemas/schedule-rule';
import { z } from 'zod';

import { parseCron } from '@/lib/automations/cron';
import {
  cronRuleStartDate,
  cronToScheduleRule,
} from '@/lib/automations/schedule/cron-rule';
import { formatIsoDate } from '@/lib/shared/calendar';
import { canonicalTimeZone, localDateIn } from '@/lib/shared/zoned-time';

/**
 * The trigger form's model: what the General tab and the Blank wizard edit,
 * how a stored trigger opens in it, and the body a save sends.
 *
 * Two rules keep a save from changing more than the person changed:
 *
 * - A stored cron expression that a repeat rule says exactly opens as that
 *   rule, and is sent back as the same cron until the schedule itself
 *   changes — a managed or legacy cron never drifts on an unrelated save.
 * - A repeat rule's start date (the day "every 2 weeks" counts from) is
 *   sent back until its frequency or interval changes; then it is left out
 *   and the server anchors the new rule on today. A rule converted from a
 *   cron keeps the cron's months by starting on January 1.
 */

export interface TriggerDraft {
  kind: TriggerKind;
  /** Which of the schedule's two forms the field shows and the save sends. */
  scheduleFormat: 'repeat' | 'cron';
  /** Always set, so switching to Repeat has a rule to show. */
  repeat: ScheduleRule;
  cron: string;
  timezone: string;
  /** The stored rule's anchor; null lets the server anchor on today. */
  startDate: string | null;
  catchUp: 'latest' | 'skip';
  event: string;
  /** The fixed input as JSON text; blank is none. */
  input: string;
  enabled: boolean;
}

/** What a new schedule starts as: every day at 09:00. */
export const DEFAULT_SCHEDULE_RULE: ScheduleRule = {
  frequency: 'daily',
  interval: 1,
  times: ['09:00'],
};

/** A new trigger: a daily 09:00 schedule in the reader's zone, off. */
export function defaultTriggerDraft(viewerZone: string): TriggerDraft {
  return {
    kind: 'schedule',
    scheduleFormat: 'repeat',
    repeat: DEFAULT_SCHEDULE_RULE,
    cron: '',
    timezone: viewerZone,
    startDate: null,
    catchUp: 'latest',
    event: '',
    input: '',
    enabled: false,
  };
}

/** The stored cron, when it is set. */
function storedCron(row: { cron?: string | null } | null): string | null {
  const cron = row?.cron?.trim() ?? '';
  return cron === '' ? null : cron;
}

/**
 * A stored trigger in the form. A cron expression a repeat rule says
 * exactly opens in Repeat; any other opens in Cron. A trigger of another
 * kind keeps the reader's zone for when it becomes a schedule; a cron
 * without a zone reads in UTC, as the scan reads it.
 */
export function draftFromStored(
  row: TriggerView,
  viewerZone: string,
): TriggerDraft {
  // A server a release behind sends none of the newer fields; they read
  // as unset.
  const storedRepeat = row.repeat ?? null;
  const cron = storedCron(row);
  const converted = cron === null ? null : cronToScheduleRule(cron);
  const repeat = storedRepeat ?? converted;
  const isSchedule = row.kind === 'schedule';
  return {
    kind: row.kind,
    scheduleFormat:
      storedRepeat === null && cron !== null && converted === null
        ? 'cron'
        : 'repeat',
    repeat: repeat ?? DEFAULT_SCHEDULE_RULE,
    cron: cron ?? '',
    timezone: row.timezone ?? (isSchedule ? 'UTC' : viewerZone),
    startDate: row.startDate ?? null,
    catchUp: row.catchUp ?? 'latest',
    event: row.event ?? '',
    input: row.input == null ? '' : JSON.stringify(row.input, null, 2),
    enabled: row.enabled,
  };
}

/** The stored schedule as a rule — its own, or its cron's — when it is
 * one: what the trigger card and Start's row say in words. */
export function storedRule(
  stored: {
    kind: string;
    repeat?: ScheduleRule | null;
    cron?: string | null;
  } | null,
): { rule: ScheduleRule; fromCron: boolean } | null {
  if (stored === null || stored.kind !== 'schedule') return null;
  if (stored.repeat != null) return { rule: stored.repeat, fromCron: false };
  const cron = storedCron(stored);
  const rule = cron === null ? null : cronToScheduleRule(cron);
  return rule === null ? null : { rule, fromCron: true };
}

/** Whether two rules count their periods the same way. */
function samePhase(a: ScheduleRule, b: ScheduleRule): boolean {
  return a.frequency === b.frequency && a.interval === b.interval;
}

/**
 * The start date a save sends with the draft's repeat rule, or null to let
 * the server anchor it on today: the stored one while the frequency and
 * interval are unchanged; January 1 (in the zone) for a rule converted from
 * a stored cron, whose months only line up counted from January.
 */
export function repeatStartDate(
  draft: TriggerDraft,
  stored: TriggerView | null,
  now: number,
): string | null {
  const baseline = storedRule(stored);
  if (baseline === null || !samePhase(draft.repeat, baseline.rule)) {
    return null;
  }
  if (!baseline.fromCron) return draft.startDate ?? stored?.startDate ?? null;
  const zone = canonicalTimeZone(draft.timezone);
  return zone === null
    ? null
    : formatIsoDate(cronRuleStartDate(localDateIn(now, zone)));
}

/** The stored cron a save sends back for a Repeat draft that still says
 * exactly what it does, or null. */
function unchangedStoredCron(
  draft: TriggerDraft,
  stored: TriggerView | null,
): string | null {
  const baseline = storedRule(stored);
  if (baseline === null || !baseline.fromCron) return null;
  return sameScheduleRule(draft.repeat, baseline.rule)
    ? storedCron(stored)
    : null;
}

/** A JSON object, as a fixed input is one. */
const jsonObjectSchema = z.record(z.string(), z.json());
type JsonObject = z.infer<typeof jsonObjectSchema>;

/** JSON text as its value, or `ok: false` when it does not parse. */
function readJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { ok: false };
  }
}

/** The fixed input text as the object a save sends: `undefined` when it is
 * blank, `null` when it is not a JSON object. */
export function parseFixedInput(text: string): JsonObject | null | undefined {
  if (text.trim() === '') return undefined;
  const read = readJson(text);
  if (!read.ok) return null;
  const object = jsonObjectSchema.safeParse(read.value);
  return object.success ? object.data : null;
}

/**
 * The body a save sends for the draft: a full replace, so every field the
 * kind takes is sent. The fixed input is left out when it is blank (which
 * clears it) or unreadable (the form refuses to save it).
 */
export function toTriggerBody(
  draft: TriggerDraft,
  stored: TriggerView | null,
  now: number = Date.now(),
): TriggerWrite {
  const input = parseFixedInput(draft.input);
  const common = {
    enabled: draft.enabled,
    ...(input !== undefined && input !== null && { input }),
  };
  switch (draft.kind) {
    case 'schedule': {
      const timezone = draft.timezone.trim();
      const tail = { timezone, catchUp: draft.catchUp };
      if (draft.scheduleFormat === 'cron') {
        return {
          kind: 'schedule',
          ...common,
          cron: draft.cron.trim(),
          ...tail,
        };
      }
      const keptCron = unchangedStoredCron(draft, stored);
      if (keptCron !== null) {
        return { kind: 'schedule', ...common, cron: keptCron, ...tail };
      }
      const startDate = repeatStartDate(draft, stored, now);
      return {
        kind: 'schedule',
        ...common,
        repeat: normalizeScheduleRule(draft.repeat),
        ...(startDate !== null && { startDate }),
        ...tail,
      };
    }
    case 'webhook':
      return { kind: 'webhook', ...common };
    case 'event': {
      const event = draft.event.trim();
      return { kind: 'event', ...common, ...(event !== '' && { event }) };
    }
    default: {
      const exhaustive: never = draft.kind;
      return exhaustive;
    }
  }
}

/** JSON with its keys sorted, so two bodies compare by what they say. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    typeof inner === 'object' && inner !== null && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner).toSorted(([a], [b]) => a.localeCompare(b)),
        )
      : inner,
  );
}

/**
 * Whether saving the draft would send what the stored trigger already is.
 * The bodies are compared, not the fields: a stored cron opened in Repeat
 * is unchanged, and so is flipping back to Cron with the same expression.
 * Nothing stored means anything drafted is new.
 */
export function sameAsStored(
  draft: TriggerDraft,
  stored: TriggerView | null,
  now: number = Date.now(),
): boolean {
  if (stored === null) return false;
  // Text that is no object cannot be the stored input.
  if (parseFixedInput(draft.input) === null) return false;
  const loaded = draftFromStored(stored, draft.timezone);
  return (
    canonicalJson(toTriggerBody(draft, stored, now)) ===
    canonicalJson(toTriggerBody(loaded, stored, now))
  );
}

/** What keeps the draft from saving, in the codes the doors answer with,
 * plus the two the form finds before any door: a cron the parser refuses
 * and a fixed input that is not JSON. */
export type TriggerDraftIssue =
  | TriggerIssueCode
  | 'cron_invalid'
  | 'input_not_json';

/** The first problem of the fixed input text, or null. */
export function fixedInputIssue(text: string): TriggerDraftIssue | null {
  if (text.trim() === '') return null;
  const read = readJson(text);
  if (!read.ok) return 'input_not_json';
  const checked = staticInputSchema.safeParse(read.value);
  if (checked.success) return null;
  for (const issue of checked.error.issues) {
    const code: unknown = 'params' in issue ? issue.params?.code : undefined;
    if (
      code === 'input.reserved_key' ||
      code === 'input.too_large' ||
      code === 'input.unstorable_text'
    ) {
      return code;
    }
  }
  return 'input.not_object';
}

/** The trigger's own fields a fixed input text names, which it may not. */
export function reservedInputKeys(text: string): string[] {
  const input = parseFixedInput(text);
  if (input === undefined || input === null) return [];
  return TRIGGER_WRAPPER_KEYS.filter((key) => Object.hasOwn(input, key));
}

/** The first problem of the draft's schedule, or null. */
function scheduleIssue(draft: TriggerDraft): TriggerDraftIssue | null {
  if (draft.scheduleFormat === 'cron') {
    if (draft.cron.trim() === '') return 'schedule.cron_or_repeat';
    try {
      parseCron(draft.cron.trim());
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return 'cron_invalid';
    }
  } else {
    const checked = scheduleRuleSchema.safeParse(draft.repeat);
    if (!checked.success) {
      const [first] = checked.error.issues;
      return (
        (first === undefined ? null : scheduleIssueCode(first)) ??
        'schedule.interval_unsupported'
      );
    }
  }
  if (draft.timezone.trim() === '') return 'timezone.blank';
  if (canonicalTimeZone(draft.timezone) === null) return 'timezone.unknown';
  return null;
}

/** The first thing that keeps the draft from saving, or null when it can. */
export function triggerDraftIssue(
  draft: TriggerDraft,
): TriggerDraftIssue | null {
  const kindIssue =
    draft.kind === 'schedule'
      ? scheduleIssue(draft)
      : draft.kind === 'event' && draft.event.trim() === ''
        ? 'event.required'
        : null;
  return kindIssue ?? fixedInputIssue(draft.input);
}

/** The reason a cron expression does not parse, in the parser's words. */
export function cronParseError(cron: string): string | null {
  try {
    parseCron(cron.trim());
    return null;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return error.message === '' ? null : error.message;
  }
}
