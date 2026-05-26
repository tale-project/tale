/**
 * Locale registry — single source of truth at test time.
 *
 * Lists every locale that has a config under `locales/<id>/`. A startup
 * assertion compares the test registry against the runtime registry at
 * `packages/ui/src/i18n/locales.ts` and fails the test load if they drift.
 */

import { ALL_LOCALES } from '../../locales';
import { LOCALE_DE } from './de';
import { LOCALE_DE_CH } from './de-CH';
import { LOCALE_EN } from './en';
import { LOCALE_FR } from './fr';
import type { LocaleConfig } from './types';

export const LOCALE_REGISTRY: ReadonlyArray<LocaleConfig> = [
  LOCALE_EN,
  LOCALE_DE,
  LOCALE_DE_CH,
  LOCALE_FR,
];

// Drift assertion: runtime locales and test locales must match.
{
  const runtimeIds = new Set<string>(ALL_LOCALES);
  const testIds = new Set(LOCALE_REGISTRY.map((l) => l.id));
  const missingInTest = [...runtimeIds].filter((id) => !testIds.has(id));
  const missingInRuntime = [...testIds].filter((id) => !runtimeIds.has(id));
  if (missingInTest.length > 0 || missingInRuntime.length > 0) {
    throw new Error(
      `Locale registry drift:\n  runtime: ${[...runtimeIds].sort().join(', ')}\n  test:    ${[...testIds].sort().join(', ')}\n  Add the missing locale folder under locales/<id>/ or update SUPPORTED_LOCALES/REGIONAL_LOCALES in packages/ui/src/i18n/locales.ts.`,
    );
  }
}

export function getLocaleConfig(id: string): LocaleConfig {
  const config = LOCALE_REGISTRY.find((l) => l.id === id);
  if (!config) throw new Error(`Unknown locale: ${id}`);
  return config;
}

export function resolveFallback(id: string): ReadonlyArray<string> {
  return getLocaleConfig(id).fallback;
}

export type { LocaleConfig } from './types';
