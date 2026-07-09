'use client';

/**
 * Locale-bound wrappers over `resolve-automation-locale.ts` — automations
 * translate THEMSELVES via the manifest's inline `i18n` block, so every
 * surface that renders an automation's name/description (hub grid, page
 * headers, projects section, pre-install details, breadcrumb) or its config
 * field labels (config form, the `Form` block) resolves through
 * these two hooks instead of reading manifest literals directly.
 */
import { useLocale } from '@tale/ui/i18n/locale-provider';

import type { AutomationConfigField } from '@/lib/shared/schemas/automation_views';
import type { AutomationManifestI18n } from '@/lib/shared/schemas/automations';
import {
  humanizeFieldKey,
  resolveAutomationLocale,
  resolveConfigFieldLocale,
} from '@/lib/shared/utils/resolve-automation-locale';

/**
 * Localized name/description for an automation summary — the manifest's
 * `i18n.<locale>` overrides with the top-level literals as fallback.
 */
export function useAutomationDisplay(): (automation: {
  name: string;
  description?: string;
  i18n?: AutomationManifestI18n;
}) => { name: string; description: string } {
  const { locale } = useLocale();
  return (automation) => resolveAutomationLocale(automation, locale);
}

/** Display-text resolvers for declared config/form fields. */
export interface ConfigFieldText {
  label: (field: AutomationConfigField) => string;
  /** `undefined` when the field declares no placeholder anywhere. */
  placeholder: (field: AutomationConfigField) => string | undefined;
  /** `undefined` when the field declares no help text anywhere. */
  help: (field: AutomationConfigField) => string | undefined;
  /** A `select` option's label (literal, or the humanized `value`). */
  option: (option: { value: string; label?: string }) => string;
}

/**
 * Config-field display text: the field's own `i18n.<locale>` (view Form) →
 * the manifest's `i18n.<locale>.config.<key>` → the field's literal
 * `label`/`placeholder`/`help` → the humanized field `key`. Call with the
 * automation's `i18n` block (config form / Overview), or with no argument for
 * view-authored `Form` fields (field-level `i18n` still applies).
 */
export function useConfigFieldText(
  i18n?: AutomationManifestI18n,
): ConfigFieldText {
  const { locale } = useLocale();
  return {
    label: (field) => resolveConfigFieldLocale(field, i18n, locale).label,
    placeholder: (field) =>
      resolveConfigFieldLocale(field, i18n, locale).placeholder,
    help: (field) => resolveConfigFieldLocale(field, i18n, locale).help,
    option: (option) => option.label ?? humanizeFieldKey(option.value),
  };
}
