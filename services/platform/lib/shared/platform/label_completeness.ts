/**
 * Cross-locale i18n completeness for a bundled workflow's step labels.
 *
 * UI translations are PLATFORM-owned: a workflow step's `ui.labelKey` (plus
 * `ui.params.fields[].labelKey` and `ui.params.verdictLabels.*`) references a
 * key in the platform's `automations` message namespace
 * (`services/platform/messages/<locale>.json`). This guard collects those
 * referenced keys so the builtin-apps gate can report any missing from a base
 * locale — a builtin workflow can't ship a label that resolves in `en` but
 * blanks out in `de`/`fr`. Pure (no I/O); the caller reads and flattens the
 * catalogs.
 *
 * Per-step config validity (render kind, run target, ports) is covered by the
 * workflow definition/annotation validators; this is only the cross-locale
 * overlay those per-step checks can't see.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Every label key a workflow's steps reference — `ui.labelKey`, each
 * `ui.params.fields[].labelKey`, and each `ui.params.verdictLabels` value
 * (the gate-step verdict chips). Steps are free-form records (the annotation
 * is advisory), so this duck-types rather than assuming a parsed shape.
 */
export function collectWorkflowLabelKeys(workflow: {
  steps?: unknown;
}): string[] {
  const keys: string[] = [];
  const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
  for (const step of steps) {
    if (!isRecord(step)) continue;
    const ui = isRecord(step.ui) ? step.ui : undefined;
    if (!ui) continue;
    if (typeof ui.labelKey === 'string') keys.push(ui.labelKey);
    const params = isRecord(ui.params) ? ui.params : undefined;
    if (!params) continue;
    if (Array.isArray(params.fields)) {
      for (const field of params.fields) {
        if (isRecord(field) && typeof field.labelKey === 'string') {
          keys.push(field.labelKey);
        }
      }
    }
    if (isRecord(params.verdictLabels)) {
      for (const value of Object.values(params.verdictLabels)) {
        if (typeof value === 'string') keys.push(value);
      }
    }
  }
  return keys;
}

/**
 * Referenced keys that are absent or empty in any base locale's catalog, as
 * human-readable errors (empty result = every key present in every locale).
 */
export function findMissingLabelKeys(
  referencedKeys: Iterable<string>,
  catalogs: Record<string, Record<string, string>>,
  baseLocales: readonly string[],
): string[] {
  const errors: string[] = [];
  for (const key of new Set(referencedKeys)) {
    for (const locale of baseLocales) {
      const value = catalogs[locale]?.[key];
      if (typeof value !== 'string' || value.length === 0) {
        errors.push(`label key "${key}" missing in locale "${locale}"`);
      }
    }
  }
  return errors;
}
