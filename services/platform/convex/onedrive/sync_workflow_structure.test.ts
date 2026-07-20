/**
 * Structural assertions over the OneDrive sync workflow — the inline
 * `workflow` of the `sync-onedrive-files` automation. The sync loop is
 * driven by the workflow engine (durable, per-config retry/observability), so
 * the shape — list → guard → loop → per-config action → terminal — is the
 * contract. Any edit to the manifest re-proves these from the file alone.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { workflowJsonSchema } from '../../lib/shared/schemas/workflows';

const MANIFEST_PATH = fileURLToPath(
  new URL(
    '../../../../builtin-configs/automations/onedrive/sync-files/automation.json',
    import.meta.url,
  ),
);

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as {
  hidden?: unknown;
  autoInstall?: unknown;
  workflow?: unknown;
};
const parsed = workflowJsonSchema.safeParse(manifest.workflow);
if (!parsed.success) {
  throw new Error(
    `sync-onedrive-files inline workflow invalid: ${parsed.error}`,
  );
}
const doc = parsed.data;
const bySlug = new Map(doc.steps.map((s) => [s.stepSlug, s]));

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function params(slug: string): Record<string, unknown> {
  const cfg = bySlug.get(slug)?.config ?? {};
  const p = (cfg as { parameters?: unknown }).parameters;
  return typeof p === 'object' && p !== null
    ? (p as Record<string, unknown>)
    : {};
}

describe('onedrive sync workflow: structure', () => {
  it('parses and every nextSteps target exists', () => {
    for (const step of doc.steps) {
      for (const [port, target] of Object.entries(step.nextSteps)) {
        expect(
          bySlug.has(target),
          `${step.stepSlug}.${port} -> ${target} (missing)`,
        ).toBe(true);
      }
    }
  });

  it('has a start and an output terminal', () => {
    expect(bySlug.get('start')?.stepType).toBe('start');
    expect(doc.steps.some((s) => s.stepType === 'output')).toBe(true);
  });

  it('iterates active configs at the workflow level (one loop over the config list)', () => {
    const loop = doc.steps.find((s) => s.stepType === 'loop');
    expect(loop, 'a loop step must drive per-config processing').toBeDefined();
    expect(asString(loop?.config.items)).toBe(
      '{{steps.list_active_configs.output.data.configs}}',
    );
    // Loop body runs one config, then returns to the loop head.
    expect(loop?.nextSteps.loop).toBe('sync_one_config');
    expect(bySlug.get('sync_one_config')?.nextSteps.success).toBe(
      loop?.stepSlug,
    );
  });

  it('guards the loop against an empty config list', () => {
    const loop = doc.steps.find((s) => s.stepType === 'loop');
    const root = asString(loop?.config.items)
      .replace(/^\{\{\s*/, '')
      .replace(/\s*\}\}$/, '');
    const guarded = doc.steps.some(
      (s) =>
        s.stepType === 'condition' &&
        asString(s.config.expression).includes(`(${root} | length) > 0`),
    );
    expect(guarded, 'loop over configs must have an empty-array guard').toBe(
      true,
    );
  });

  it('passes each config field from the loop item into sync_one_config', () => {
    const p = params('sync_one_config');
    expect(p.operation).toBe('sync_one_config');
    expect(p.configId).toBe('{{loop.item.configId}}');
    expect(p.userId).toBe('{{loop.item.userId}}');
    expect(p.itemType).toBe('{{loop.item.itemType}}');
    expect(p.itemId).toBe('{{loop.item.itemId}}');
    expect(p.itemName).toBe('{{loop.item.itemName}}');
  });

  it('declares EXACTLY ONE schedule that drives the sync loop', () => {
    // One engine, one cron: the install pipeline materializes a wfSchedules
    // row per declared trigger, so a second entry here would double-run every
    // org's sync.
    const schedules = doc.triggers?.schedules ?? [];
    expect(schedules).toHaveLength(1);
    expect(schedules[0].cron).toBeTruthy();
  });

  it('no longer depends on processing-records or a backoff knob', () => {
    const raw = readFileSync(MANIFEST_PATH, 'utf-8');
    expect(raw).not.toContain('workflow_processing_records');
    expect(raw).not.toContain('backoffHours');
  });
});

describe('onedrive sync engine: install posture', () => {
  it('is hidden — an engine, never a catalog card', () => {
    expect(manifest.hidden).toBe(true);
  });

  it('is NOT autoInstall — the engine lands when a member sets up a sync import, not at org creation', () => {
    // `importFiles` (actions.ts) schedules the targeted idempotent install on
    // the first sync import; preinstalling would run a no-op cron in every
    // org that never touches OneDrive.
    expect(manifest.autoInstall).toBeUndefined();
  });
});
