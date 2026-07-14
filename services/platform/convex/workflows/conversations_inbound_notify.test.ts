import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { workflowJsonSchema } from '../../lib/shared/schemas/workflows';

const WORKFLOW_PATH = fileURLToPath(
  new URL(
    '../../../../builtin-configs/automations/conversations/notify-members-on-inbound-messages/automation.json',
    import.meta.url,
  ),
);

describe('notify-members-on-inbound-message automation workflow', () => {
  it('parses as valid workflow JSON and listens for inbound conversation events', () => {
    const manifest = JSON.parse(readFileSync(WORKFLOW_PATH, 'utf-8')) as {
      autoInstall?: boolean;
      hidden?: boolean;
      workflow?: unknown;
    };
    const parsed = workflowJsonSchema.safeParse(manifest.workflow);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.triggers?.events).toEqual([
      { eventType: 'conversation.message_received' },
    ]);
    // Deliberately opt-in: it stays a visible catalog automation an org
    // installs, never a preinstalled pack member.
    expect(manifest.autoInstall).toBeUndefined();
    expect(manifest.hidden).toBeUndefined();

    const openStep = parsed.data.steps.find(
      (step) => step.stepSlug === 'open_only',
    );
    expect(openStep?.stepType).toBe('condition');

    const assigneeGate = parsed.data.steps.find(
      (step) => step.stepSlug === 'has_assignee',
    );
    expect(assigneeGate?.stepType).toBe('condition');

    const notifyAssignee = parsed.data.steps.find(
      (step) => step.stepSlug === 'notify_assignee',
    );
    expect(notifyAssignee?.stepType).toBe('action');
    expect(notifyAssignee?.config).toMatchObject({
      type: 'notification',
      parameters: {
        operation: 'notify_users',
        audience: 'conversation_assignee',
        type: 'conversation_message',
        titleKey: 'conversationInboundMessage',
      },
    });

    const notifyAdmins = parsed.data.steps.find(
      (step) => step.stepSlug === 'notify_admins',
    );
    expect(notifyAdmins?.config).toMatchObject({
      type: 'notification',
      parameters: {
        operation: 'notify_users',
        audience: 'org_admins',
        type: 'conversation_message',
        suppressEmail: true,
      },
    });
  });
});
