/**
 * The references `get_docs {topic}` serves beside the engine's own
 * authoring reference, and so the resources `tale://docs/<topic>` — bound
 * here to the backend's own trigger delivery rules, which the pure builders
 * in `lib/mcp/docs/` cannot import.
 */

import { settingsReference } from '../../../lib/mcp/docs/settings.ts';
import { triggersReference } from '../../../lib/mcp/docs/triggers.ts';
import { validationReference } from '../../../lib/mcp/docs/validation.ts';
import { buildTaleSkill } from '../../../lib/mcp/skill.ts';
import { MAX_CATCHUP_MS } from '../../core/automations/cron.ts';
import { PERMANENT_FAILURES_BEFORE_PAUSE } from '../../core/automations/failure.ts';
import {
  BODY_LANE_WINDOW_MS,
  DELIVERY_ID_HEADERS,
  HEADER_LANE_WINDOW_MS,
  MAX_WEBHOOK_BODY_BYTES,
} from '../../core/automations/webhook_delivery.ts';
import { DEFAULT_TIMEZONE } from '../automations/triggers.ts';

/** The numbers the triggers reference states, from where they are decided. */
const TRIGGER_FACTS = {
  defaultTimezone: DEFAULT_TIMEZONE,
  catchUpMs: MAX_CATCHUP_MS,
  pauseAfterFailures: PERMANENT_FAILURES_BEFORE_PAUSE,
  webhookBodyBytes: MAX_WEBHOOK_BODY_BYTES,
  deliveryIdHeaders: DELIVERY_ID_HEADERS,
  deliveryIdWindowMs: HEADER_LANE_WINDOW_MS,
  identicalBodyWindowMs: BODY_LANE_WINDOW_MS,
} as const;

/** The text of a topic other than `authoring`, or undefined for one this
 * endpoint does not serve. */
export function mcpDocs(topic: string): string | undefined {
  switch (topic) {
    case 'triggers':
      return triggersReference(TRIGGER_FACTS);
    case 'validation':
      return validationReference();
    case 'settings':
      return settingsReference();
    case 'skill':
      return buildTaleSkill();
    default:
      return undefined;
  }
}
