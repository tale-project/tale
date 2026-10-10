// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { MCP_DOC_TOPICS } from '../../../lib/mcp/docs/topics.ts';
import { PERMANENT_FAILURES_BEFORE_PAUSE } from '../../core/automations/failure.ts';
import { MAX_WEBHOOK_BODY_BYTES } from '../../core/automations/webhook_delivery.ts';
import { mcpDocs } from './docs.ts';

describe('the references get_docs serves beside the authoring one', () => {
  it('serves every topic but authoring, which the engine answers, and nothing else', () => {
    for (const topic of MCP_DOC_TOPICS) {
      if (topic === 'authoring') {
        expect(mcpDocs(topic)).toBeUndefined();
      } else {
        expect(mcpDocs(topic)?.length ?? 0, topic).toBeGreaterThan(0);
      }
    }
    expect(mcpDocs('billing')).toBeUndefined();
  });

  it('states the trigger delivery rules the backend enforces', () => {
    const text = mcpDocs('triggers') ?? '';
    expect(text).toContain(
      `After ${PERMANENT_FAILURES_BEFORE_PAUSE} runs in a row fail`,
    );
    expect(text).toContain(
      `at most ${Math.round(MAX_WEBHOOK_BODY_BYTES / 1024)} KiB`,
    );
    expect(text).toContain('a cron without one reads UTC');
  });
});
