import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { workflowJsonSchema } from '../../lib/shared/schemas/workflows';

const WORKFLOW_PATH = fileURLToPath(
  new URL(
    '../../../../builtin-configs/workflows/conversations/notify-members-on-inbound-message.json',
    import.meta.url,
  ),
);

describe('notify-members-on-inbound-message workflow template', () => {
  it('parses as valid workflow JSON and listens for inbound conversation events', () => {
    const raw = JSON.parse(readFileSync(WORKFLOW_PATH, 'utf-8'));
    const parsed = workflowJsonSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.triggers?.events).toEqual([
      { eventType: 'conversation.message_received' },
    ]);
    expect(parsed.data.metadata?.autoInstall).toBeUndefined();

    const openStep = parsed.data.steps.find(
      (step) => step.stepSlug === 'open_only',
    );
    expect(openStep?.stepType).toBe('condition');

    const notifyStep = parsed.data.steps.find(
      (step) => step.stepSlug === 'notify_members',
    );
    expect(notifyStep?.stepType).toBe('action');
    expect(notifyStep?.config).toMatchObject({
      type: 'notification',
      parameters: {
        operation: 'notify_users',
        audience: 'org_members',
        type: 'conversation_message',
        titleKey: 'conversationInboundMessage',
      },
    });
  });
});
