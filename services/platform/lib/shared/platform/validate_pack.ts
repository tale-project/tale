/**
 * Publish-time pack consistency check (pure — no I/O). Enforces the two pack
 * invariants the per-step validator can't see across the whole bundle:
 *
 *  1. Every step `ui.render` is a known render-kind.
 *  2. Every Tier-2 label key referenced by the pack's workflows
 *     (`ui.labelKey`, `ui.params.fields[].labelKey`) exists in the pack's
 *     message catalog for ALL base locales — the cross-locale completeness gate
 *     (a missing `de`/`fr` key fails the publish).
 *
 * Per-step config validity (run target, ports, etc.) is covered by
 * validateWorkflowDefinition; this is the pack-level overlay.
 */
import { isRenderKind } from './render_kinds';

export interface PackValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface PackValidationInput {
  /** The pack's annotated workflows (steps are free-form records). */
  workflows: Array<{ name?: string; steps?: unknown }>;
  /** locale -> flat { labelKey: string } catalog for the pack's namespace. */
  catalogs: Record<string, Record<string, string>>;
  /** Locales every label must be present in (e.g. ['en', 'de', 'fr']). */
  baseLocales: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectLabelKeys(ui: Record<string, unknown>): string[] {
  const keys: string[] = [];
  if (typeof ui.labelKey === 'string') keys.push(ui.labelKey);
  const params = isRecord(ui.params) ? ui.params : undefined;
  if (params && Array.isArray(params.fields)) {
    for (const field of params.fields) {
      if (isRecord(field) && typeof field.labelKey === 'string') {
        keys.push(field.labelKey);
      }
    }
  }
  return keys;
}

export function validatePack(input: PackValidationInput): PackValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const referencedLabelKeys = new Set<string>();

  for (const workflow of input.workflows) {
    const label = workflow.name ?? '<unnamed>';
    const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
    for (const step of steps) {
      if (!isRecord(step)) continue;
      const ui = isRecord(step.ui) ? step.ui : undefined;
      if (!ui) continue;

      const render = ui.render;
      if (typeof render === 'string' && !isRenderKind(render)) {
        errors.push(`[${label}] unknown render-kind "${render}"`);
      }
      for (const key of collectLabelKeys(ui)) referencedLabelKeys.add(key);
    }
  }

  for (const key of referencedLabelKeys) {
    for (const locale of input.baseLocales) {
      const value = input.catalogs[locale]?.[key];
      if (typeof value !== 'string' || value.length === 0) {
        errors.push(`label key "${key}" missing in locale "${locale}"`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
