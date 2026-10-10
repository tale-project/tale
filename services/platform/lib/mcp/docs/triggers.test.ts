import { describe, expect, test } from 'vitest';
import { z } from 'zod';

import {
  EMITTED_EVENT_TYPES,
  RESERVED_EVENT_TYPES,
} from '../../shared/event-types';
import {
  isServedAddress,
  mentionedAddresses,
  toolLikeWords,
} from '../test-helpers';
import { MCP_TOOLS } from '../tools';
import { triggerArgSchema } from '../trigger-args';
import { type TriggerFacts, triggersReference } from './triggers';

const FACTS: TriggerFacts = {
  defaultTimezone: 'UTC',
  onTimeGraceMs: 10 * 60_000,
  pauseAfterFailures: 5,
  webhookBodyBytes: 256 * 1024,
  deliveryIdHeaders: ['idempotency-key', 'webhook-id'],
  deliveryIdWindowMs: 24 * 60 * 60_000,
  identicalBodyWindowMs: 2 * 60_000,
};

const text = triggersReference(FACTS);

describe('the triggers reference', () => {
  test('names every trigger kind and every field set_trigger takes for it', () => {
    const json = z.toJSONSchema(triggerArgSchema, { io: 'input' });
    const branches = z
      .array(
        z.looseObject({
          properties: z.record(
            z.string(),
            z.looseObject({ const: z.string().optional() }),
          ),
        }),
      )
      .parse(json.oneOf ?? json.anyOf);
    expect(branches.length).toBe(3);
    for (const { properties } of branches) {
      const kind = properties.kind?.const ?? '';
      expect(text).toContain(`### ${kind}`);
      const section =
        text.slice(text.indexOf(`### ${kind}`)).split('\n### ')[0] ?? '';
      for (const field of Object.keys(properties).filter(
        (name) => name !== 'kind',
      )) {
        expect(section, `${kind}.${field}`).toContain(`- ${field} (`);
      }
    }
  });

  test('names every event Tale raises, and none it only reserves', () => {
    for (const event of EMITTED_EVENT_TYPES) {
      expect(text).toContain(`- ${event}: `);
    }
    for (const event of RESERVED_EVENT_TYPES) {
      expect(text).not.toContain(event);
    }
  });

  test('states the delivery rules from the facts it is given', () => {
    expect(text).toContain('a cron without one reads UTC');
    expect(text).toContain('at most 10 minutes late');
    expect(text).toContain('After 5 runs in a row fail');
    expect(text).toContain('at most 256 KiB');
    expect(text).toContain(
      'within 24 hours (read from idempotency-key, webhook-id)',
    );
    expect(text).toContain('within 2 minutes');
  });

  test('names only tools the inventory holds and addresses the server reads', () => {
    const inventory = new Set(MCP_TOOLS.map((tool) => tool.name));
    // Event names carry snake_case words of their own (task.status_changed).
    const prose = EMITTED_EVENT_TYPES.reduce(
      (rest, event) => rest.replaceAll(event, ''),
      text,
    );
    expect(toolLikeWords(prose).filter((word) => !inventory.has(word))).toEqual(
      [],
    );
    expect(
      mentionedAddresses(text).filter((uri) => !isServedAddress(uri)),
    ).toEqual([]);
  });
});
