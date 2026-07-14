/**
 * Structural guard for the IMAP mail-sync workflow — the inline `workflow` of
 * the `imap-smtp/sync-emails` automation.
 *
 * The task-pack loop-safety suite only covers the `folder: "tasks"` pack, so
 * the mail sync has no other structural coverage. This validates it parses
 * against the canonical schema, declares its schedule (installing the
 * automation is what makes mail flow), and has no dangling step references.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { workflowJsonSchema } from '../../lib/shared/schemas/workflows';

const WORKFLOW_PATH = fileURLToPath(
  new URL(
    '../../../../builtin-configs/automations/imap-smtp/sync-emails/automation.json',
    import.meta.url,
  ),
);

// 'noop' is the reserved terminal sink — a nextSteps target with no step body.
const TERMINAL_TARGETS = new Set(['noop']);

describe('imap_smtp sync workflow', () => {
  const manifest = JSON.parse(readFileSync(WORKFLOW_PATH, 'utf-8')) as {
    workflow?: unknown;
  };
  const parsed = workflowJsonSchema.safeParse(manifest.workflow);

  it('parses against workflowJsonSchema', () => {
    if (!parsed.success) {
      throw new Error(`workflow fails schema: ${parsed.error}`);
    }
    expect(parsed.success).toBe(true);
  });

  it('declares a schedule trigger so it auto-schedules on install', () => {
    if (!parsed.success) throw new Error('workflow did not parse');
    const schedules = parsed.data.triggers?.schedules ?? [];
    expect(schedules.length).toBeGreaterThanOrEqual(1);
    expect(schedules[0].cron).toBeTruthy();
  });

  it('targets the imap_smtp integration and conversation creation', () => {
    if (!parsed.success) throw new Error('workflow did not parse');
    const json = JSON.stringify(parsed.data);
    expect(json).toContain('"integrationName":"imap_smtp"');
    expect(json).toContain('"operation":"create_from_email"');
    expect(json).toContain('"operation":"create_from_sent_email"');
    expect(json).toContain(
      '"operation":"query_latest_outbound_message_for_sync"',
    );
    expect(json).toContain('"operation":"list_messages"');
    expect(json).toContain('"mailbox":"sent"');
  });

  it('has no dangling nextSteps references', () => {
    if (!parsed.success) throw new Error('workflow did not parse');
    const slugs = new Set(parsed.data.steps.map((s) => s.stepSlug));
    for (const step of parsed.data.steps) {
      for (const target of Object.values(step.nextSteps ?? {})) {
        const ok = slugs.has(target) || TERMINAL_TARGETS.has(target);
        expect(ok, `step "${step.stepSlug}" → unknown target "${target}"`).toBe(
          true,
        );
      }
    }
  });
});
