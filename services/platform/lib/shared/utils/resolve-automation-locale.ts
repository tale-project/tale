import { defaultLocale as appDefaultLocale } from '../../i18n/config';
import type { AutomationConfigField } from '../schemas/automation_views';
import type { AutomationManifestI18n } from '../schemas/automations';
import { narrowBcp47 } from './narrow-bcp47';
import { pickField } from './pick-field';

/**
 * Locale resolution for an automation's SELF-TRANSLATED display strings — the
 * manifest's inline `i18n` block (`apps.ts#automationManifestI18nSchema`), mirroring
 * `resolve-agent-locale.ts`. Precedence per field:
 *   1. `i18n[requestedLocale]`
 *   2. `i18n[baseLanguage]` — e.g. `de-CH` narrows to `de`
 *   3. `i18n[appDefault='en']`
 *   4. the manifest's top-level literal (authored in English)
 * The retired per-bundle `messages/` label catalog is not consulted — the
 * manifest is the single source of its own copy.
 */

interface LocalizableAutomation {
  name: string;
  description?: string;
  i18n?: AutomationManifestI18n;
}

/** The three i18n layers for `locale`, most specific first. */
function localeLayers(
  i18n: AutomationManifestI18n | undefined,
  locale: string,
): (AutomationManifestI18n[string] | undefined)[] {
  const base = narrowBcp47(locale);
  return [
    i18n?.[locale],
    base ? i18n?.[base] : undefined,
    locale !== appDefaultLocale && base !== appDefaultLocale
      ? i18n?.[appDefaultLocale]
      : undefined,
  ];
}

/** An automation's localized `name`/`description` (hub card, page headers…). */
export function resolveAutomationLocale(
  automation: LocalizableAutomation,
  locale: string,
): { name: string; description: string } {
  const layers = localeLayers(automation.i18n, locale);
  return {
    name:
      pickField([...layers.map((l) => l?.name), automation.name]) ??
      automation.name,
    description:
      pickField([
        ...layers.map((l) => l?.description),
        automation.description,
      ]) ?? '',
  };
}

/**
 * Humanize a config field's `key` — the fallback when a field carries neither
 * an i18n override nor a literal `label`: the last segment, start-cased.
 * Local start-case (no lodash): `testCommand` → "Test Command".
 */
export function humanizeFieldKey(key: string): string {
  const last = key.split('.').pop() || key;
  const spaced = last
    .replaceAll(/[_-]+/g, ' ')
    .replaceAll(/([a-z\d])([A-Z])/g, '$1 $2')
    .trim();
  return spaced.replaceAll(/(^|\s)\S/g, (c) => c.toUpperCase());
}

/**
 * One config field's localized display strings: i18n override
 * (`i18n.<locale>.config.<key>`) → the field's literal `label`/`placeholder`/
 * `help` → the humanized field `key` (label only; placeholder/help stay
 * absent rather than echoing noise).
 */
export function resolveConfigFieldLocale(
  field: Pick<AutomationConfigField, 'key' | 'label' | 'placeholder' | 'help'>,
  i18n: AutomationManifestI18n | undefined,
  locale: string,
): { label: string; placeholder?: string; help?: string } {
  const layers = localeLayers(i18n, locale).map((l) => l?.config?.[field.key]);
  return {
    label:
      pickField([...layers.map((l) => l?.label), field.label]) ??
      humanizeFieldKey(field.key),
    placeholder: pickField([
      ...layers.map((l) => l?.placeholder),
      field.placeholder,
    ]),
    help: pickField([...layers.map((l) => l?.help), field.help]),
  };
}
