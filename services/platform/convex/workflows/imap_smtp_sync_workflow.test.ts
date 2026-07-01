/**
 * Structural guard for the bundled IMAP sync workflow.
 *
 * The generic task-pack loop-safety suite only scans
 * `builtin-configs/workflows/projects/tasks`, so the imap_smtp sync workflow
 * (installed via the integration's `bundles.workflows`) has no other coverage.
 * This validates it parses against the canonical schema, auto-schedules, and
 * has no dangling step references.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { workflowJsonSchema } from '../../lib/shared/schemas/workflows';

const WORKFLOW_PATH = fileURLToPath(
  new URL(
    '../../../../builtin-configs/workflows/imap_smtp/sync-emails-from-imap_smtp.json',
    import.meta.url,
  ),
);

// 'noop' is the reserved terminal sink — a nextSteps target with no step body.
const TERMINAL_TARGETS = new Set(['noop']);

describe('imap_smtp sync workflow', () => {
  const raw: unknown = JSON.parse(readFileSync(WORKFLOW_PATH, 'utf-8'));
  const parsed = workflowJsonSchema.safeParse(raw);

  it('parses against workflowJsonSchema', () => {
    if (!parsed.success) {
      throw new Error(`workflow fails schema: ${parsed.error}`);
    }
    expect(parsed.success).toBe(true);
  });

  it('declares a schedule trigger so it auto-schedules on connect', () => {
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
    expect(json).toContain('"operation":"list_messages"');
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
