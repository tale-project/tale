import { defaultLocale as appDefaultLocale } from '../../i18n/config';
import { narrowBcp47 } from './narrow-bcp47';
import { pickField } from './pick-field';

interface ProviderModelI18nOverride {
  displayName?: string;
  description?: string;
}

interface ProviderI18nOverride {
  displayName?: string;
  description?: string;
  models?: Record<string, ProviderModelI18nOverride>;
}

type ProviderI18nMap = Record<string, ProviderI18nOverride>;

interface LocalizableProvider {
  displayName?: string;
  description?: string;
  i18n?: ProviderI18nMap;
}

interface LocalizableModel {
  id: string;
  displayName?: string;
  description?: string;
}

interface ResolvedProviderFields {
  displayName: string;
  description?: string;
}

interface ResolvedModelFields {
  displayName: string;
  description?: string;
}

/**
 * Resolves locale-specific provider fields with i18n-first precedence:
 *   1. `i18n[requestedLocale].<field>`
 *   2. `i18n[baseLanguage].<field>` — e.g. `de-CH` narrows to `de`
 *   3. `i18n[appDefault='en'].<field>`
 *   4. top-level `<field>` (legacy fallback for pre-i18n providers)
 *
 * Mirrors `resolveAgentLocale` so provider configs and agent configs share
 * the same fallback semantics. Empty/whitespace overrides are skipped via
 * `pickField` so disk-state and runtime-fallback agree on "empty".
 */
export function resolveProviderLocale(
  provider: LocalizableProvider,
  locale: string,
): ResolvedProviderFields {
  const base = narrowBcp47(locale);

  const direct = provider.i18n?.[locale];
  const baseI18n = base ? provider.i18n?.[base] : undefined;
  const fallbackI18n =
    locale !== appDefaultLocale && base !== appDefaultLocale
      ? provider.i18n?.[appDefaultLocale]
      : undefined;

  return {
    displayName:
      pickField([
        direct?.displayName,
        baseI18n?.displayName,
        fallbackI18n?.displayName,
        provider.displayName,
      ]) ?? '',
    description: pickField([
      direct?.description,
      baseI18n?.description,
      fallbackI18n?.description,
      provider.description,
    ]),
  };
}

/**
 * Resolves locale-specific fields for a single model entry. Walks the same
 * three i18n layers but reads per-model overrides via
 * `providerI18n[locale].models[model.id]`. Falls back to the model's
 * top-level fields. Decoupled from `resolveProviderLocale` so callers that
 * only need provider chrome (e.g. the providers table) don't iterate models.
 */
export function resolveModelLocale(
  model: LocalizableModel,
  providerI18n: ProviderI18nMap | undefined,
  locale: string,
): ResolvedModelFields {
  const base = narrowBcp47(locale);

  const direct = providerI18n?.[locale]?.models?.[model.id];
  const baseI18n = base ? providerI18n?.[base]?.models?.[model.id] : undefined;
  const fallbackI18n =
    locale !== appDefaultLocale && base !== appDefaultLocale
      ? providerI18n?.[appDefaultLocale]?.models?.[model.id]
      : undefined;

  return {
    displayName:
      pickField([
        direct?.displayName,
        baseI18n?.displayName,
        fallbackI18n?.displayName,
        model.displayName,
      ]) ?? '',
    description: pickField([
      direct?.description,
      baseI18n?.description,
      fallbackI18n?.description,
      model.description,
    ]),
  };
}
