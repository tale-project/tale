import { z } from 'zod';

import { EVENT_DESCRIPTIONS } from '../../shared/event-types';
import { triggerArgSchema } from '../trigger-args';

/**
 * The triggers reference (`get_docs {topic: "triggers"}`,
 * `tale://docs/triggers`): what starts an automation, as an agent needs it
 * to call `set_trigger` right the first time. Built from the sources that
 * decide it, so it cannot drift from them: each kind's fields and their
 * descriptions from the schema `set_trigger` checks its argument against
 * (walked in its JSON Schema, so the shared trigger contract can replace
 * that schema without touching this file), the events from the platform's
 * own vocabulary, and the delivery facts from the backend's constants —
 * passed in, because this module also runs where the backend cannot be
 * imported.
 */

/** The backend's trigger delivery rules, as numbers the reference states. */
export interface TriggerFacts {
  /** The zone a schedule reads its clock in when it names none. */
  readonly defaultTimezone: string;
  /** How late a schedule may start an occurrence it may only start on
   *  time (`catchUp: "skip"`). */
  readonly onTimeGraceMs: number;
  /** Runs in a row that fail for good before a schedule pauses itself. */
  readonly pauseAfterFailures: number;
  /** The largest webhook body a delivery may carry. */
  readonly webhookBodyBytes: number;
  /** The headers a sender's delivery id is read from, in order. */
  readonly deliveryIdHeaders: readonly string[];
  /** How long a delivery id is remembered. */
  readonly deliveryIdWindowMs: number;
  /** How long a byte-identical body reads as a retry. */
  readonly identicalBodyWindowMs: number;
}

const kindBranch = z.looseObject({
  properties: z.record(z.string(), z.looseObject({})),
});

const fieldSchema = z.looseObject({
  description: z.string().optional(),
  type: z.string().optional(),
  const: z.string().optional(),
});

/** Each trigger kind with its fields (name, type, description), in the
 * schema's order; `kind` itself is the branch's name. */
function kindFields(): Array<{
  kind: string;
  fields: Array<{ name: string; type: string; description: string }>;
}> {
  const json = z.toJSONSchema(triggerArgSchema, { io: 'input' });
  const branches = [
    ...(Array.isArray(json.oneOf) ? json.oneOf : []),
    ...(Array.isArray(json.anyOf) ? json.anyOf : []),
  ];
  return branches.flatMap((branch) => {
    const parsed = kindBranch.safeParse(branch);
    if (!parsed.success) return [];
    const { properties } = parsed.data;
    const kind = fieldSchema.safeParse(properties.kind);
    if (!kind.success || kind.data.const === undefined) return [];
    return [
      {
        kind: kind.data.const,
        fields: Object.entries(properties)
          .filter(([name]) => name !== 'kind')
          .map(([name, schema]) => {
            const field = fieldSchema.safeParse(schema);
            return {
              name,
              type: field.success ? (field.data.type ?? 'any') : 'any',
              description: field.success ? (field.data.description ?? '') : '',
            };
          }),
      },
    ];
  });
}

/** What each kind starts a run with, and the rules of its delivery. */
function kindNotes(kind: string, facts: TriggerFacts): string[] {
  const minutes = (ms: number) => Math.round(ms / 60_000);
  switch (kind) {
    case 'schedule':
      return [
        `A run starts with the input {"trigger": "schedule", "firedAt": <the occurrence, milliseconds since 1970>}, beside the trigger's fixed input (input); the inputs schema must accept it.`,
        `A repeat rule (repeat, from startDate) or a cron expression reads the wall clock of the trigger's timezone — a repeat rule names one, a cron without one reads ${facts.defaultTimezone}: 09:00 stays 09:00 when daylight saving time begins or ends.`,
        `Occurrences missed while Tale was not running are counted, never all run: with catchUp "latest" (the default) the most recent one starts once, however late; with "skip" it starts only when it is at most ${minutes(facts.onTimeGraceMs)} minutes late.`,
        `After ${facts.pauseAfterFailures} runs in a row fail for a reason a retry cannot fix, the schedule pauses itself (enabled: false) and the organization's owners and admins are told; saving the trigger again starts afresh.`,
      ];
    case 'webhook':
      return [
        "set_trigger answers the token once. It is the credential: whoever has the URL can start runs, so it belongs in the sender's secret store, never in a document, a commit or a chat. list_triggers never returns it (hasToken says one exists); rotateToken: true replaces it.",
        'A delivery is a POST to <your Tale>/api/automations/webhook/<token>, or <your Tale>/api/projects/<projectId>/automations/webhook/<token> for an automation installed in a project. It answers 202 with the runId.',
        `The run starts with the input {"trigger": "webhook", "payload": <the body>}, beside the trigger's fixed input: parsed JSON, or the text when it is not JSON; at most ${Math.round(facts.webhookBodyBytes / 1024)} KiB.`,
        `A redelivery starts nothing new and answers the first run: the same delivery id within ${minutes(facts.deliveryIdWindowMs) / 60} hours (read from ${facts.deliveryIdHeaders.join(', ')}), or a byte-identical body within ${minutes(facts.identicalBodyWindowMs)} minutes.`,
      ];
    case 'event':
      return [
        'The run starts with the input {"trigger": "event", "event": "<name>", "payload": <the event\'s data>}, beside the trigger\'s fixed input.',
        'An event of a project starts the automations installed in that project and those installed in none; an automation installed only in other projects does not react to it.',
        "An event an automation's run raised never starts that same automation, and a run an event started does not start other automations, so automations cannot start themselves or each other in a loop.",
      ];
    default:
      return [];
  }
}

export function triggersReference(facts: TriggerFacts): string {
  const kinds: string[] = [];
  for (const { kind, fields } of kindFields()) {
    kinds.push(`### ${kind}`);
    for (const { name, type, description } of fields) {
      kinds.push(
        `- ${name} (${type})${description === '' ? '' : `: ${description}`}`,
      );
    }
    kinds.push(...kindNotes(kind, facts), '');
  }
  const events = Object.entries(EVENT_DESCRIPTIONS).map(
    ([name, description]) => `- ${name}: ${description}`,
  );
  return [
    '# Triggers reference',
    '',
    'A trigger decides what starts an automation: a schedule, a webhook or a platform event. Without one, an automation runs only when someone starts it (run_deployed, start_run, the app).',
    '',
    '## Rules every trigger follows',
    '- One trigger per automation. set_trigger binds it, and binding again replaces it, kind included; delete_trigger removes it. Versions and run history stay either way.',
    '- A trigger runs the deployed version, live, with real effects. On an automation with no deployed version it is recorded and starts nothing (set_trigger answers deployed: false) until a version is deployed.',
    '- set_trigger and delete_trigger need the owner, admin or developer role, and a client asks the person before set_trigger.',
    '- enabled: false keeps the trigger bound but paused.',
    '',
    '## The kinds',
    'set_trigger takes {name, trigger: {kind, …}}; each kind takes only its own fields, and a field of another kind is refused by name.',
    '',
    ...kinds,
    '## Events',
    'An event trigger waits for one of these (list_events answers the same list):',
    ...events,
    '',
    '## Checking a trigger',
    "- validate_automation warns TRIGGER_INPUT_MISMATCH when the automation's inputs schema does not accept the input its trigger starts runs with, and EVENT_UNKNOWN when an event trigger waits for an event Tale does not raise.",
    '- list_triggers reads each trigger: kind, enabled, cron, timezone, event, hasToken, when it last fired and its run (lastFiredAt, lastRunId), when and why it last skipped (lastSkippedAt, lastSkipReason), and its failures in a row (consecutiveFailures, lastFailedAt, lastFailureCode, lastFailedRunId).',
  ].join('\n');
}
