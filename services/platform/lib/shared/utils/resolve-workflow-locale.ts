import { defaultLocale as appDefaultLocale } from '../../i18n/config';
import type { WorkflowStepI18n } from '../schemas/workflows';
import { narrowBcp47 } from './narrow-bcp47';
import { pickField } from './pick-field';

/**
 * Locale resolution for a workflow STEP's SELF-TRANSLATED display strings —
 * the step's inline `i18n` block (`workflows.ts#workflowStepI18nSchema`),
 * mirroring `resolve-automation-locale.ts` / `resolve-agent-locale.ts`.
 * Precedence per field:
 *   1. `i18n[requestedLocale]`
 *   2. `i18n[baseLanguage]` — e.g. `de-CH` narrows to `de`
 *   3. `i18n[appDefault='en']`
 *   4. the step's own literal `name`/`description` (authored in English)
 *
 * `name` always resolves (the literal is a required field on every step);
 * `description` stays `undefined` when neither the i18n block nor the
 * literal carries one — there is no hard fallback for it.
 *
 * A step MAY also carry a platform `ui.labelKey` (a pack-owned catalog key
 * resolved via `t()` at the render site — see `part-envelope.tsx`). That path
 * is untouched by this resolver; the caller decides precedence between the
 * two (see {@link hasWorkflowStepI18n}). The rule: inline i18n, once
 * authored on a step, wins outright over the `labelKey` catalog lookup — a
 * step keeps the `labelKey` path only when it declares NO inline i18n at all.
 */

interface LocalizableWorkflowStep {
  name: string;
  description?: string;
  i18n?: WorkflowStepI18n;
}

interface ResolvedWorkflowStepText {
  name: string;
  description?: string;
}

export function resolveWorkflowStepText(
  step: LocalizableWorkflowStep,
  locale: string,
): ResolvedWorkflowStepText {
  const base = narrowBcp47(locale);

  const direct = step.i18n?.[locale];
  const baseI18n = base ? step.i18n?.[base] : undefined;
  const fallbackI18n =
    locale !== appDefaultLocale && base !== appDefaultLocale
      ? step.i18n?.[appDefaultLocale]
      : undefined;

  return {
    name:
      pickField([
        direct?.name,
        baseI18n?.name,
        fallbackI18n?.name,
        step.name,
      ]) ?? step.name,
    description: pickField([
      direct?.description,
      baseI18n?.description,
      fallbackI18n?.description,
      step.description,
    ]),
  };
}

/**
 * Whether a step carries any inline i18n overrides at all — the signal a
 * caller joining both display paths (a step's own i18n vs. a platform
 * `ui.labelKey` catalog key) uses to decide precedence: present ⇒ resolve via
 * {@link resolveWorkflowStepText} and ignore `labelKey`; absent ⇒ keep the
 * existing `labelKey`-over-literal-name behavior untouched.
 */
export function hasWorkflowStepI18n(step: {
  i18n?: WorkflowStepI18n;
}): boolean {
  return step.i18n !== undefined && Object.keys(step.i18n).length > 0;
}
