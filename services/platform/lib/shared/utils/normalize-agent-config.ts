import type {
  AgentI18nOverrides,
  AgentJsonConfig,
} from '../../../convex/agents/file_utils';
import { defaultLocale as appDefaultLocale } from '../../i18n/config';
import { isEffectivelyEmpty } from './is-effectively-empty';

const TRANSLATABLE_FIELDS = [
  'displayName',
  'description',
  'conversationStarters',
  'systemInstructions',
] as const satisfies readonly (keyof AgentI18nOverrides)[];

type TranslatableField = (typeof TRANSLATABLE_FIELDS)[number];

/**
 * Strip effectively-empty values from a single locale's overrides:
 *   - empty/whitespace strings → undefined
 *   - empty arrays / all-whitespace arrays → undefined
 *   - array string entries that are whitespace-only are filtered out;
 *     if nothing remains, the field is dropped entirely
 *
 * Returns `undefined` when every field in the locale ends up empty so the
 * caller can drop the whole locale node.
 */
function cleanLocaleOverrides(
  raw: AgentI18nOverrides | undefined,
): AgentI18nOverrides | undefined {
  if (!raw) return undefined;

  const cleaned: AgentI18nOverrides = {};

  for (const field of TRANSLATABLE_FIELDS) {
    const value = raw[field];

    if (field === 'conversationStarters') {
      if (!Array.isArray(value)) continue;
      const filtered = value.filter(
        (s) => typeof s === 'string' && s.trim().length > 0,
      );
      if (filtered.length > 0) cleaned.conversationStarters = filtered;
      continue;
    }

    if (typeof value === 'string' && !isEffectivelyEmpty(value)) {
      cleaned[field] = value;
    }
  }

  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

/**
 * Normalize an agent config for disk persistence.
 *
 * Invariants enforced:
 *  - **I-1 Non-empty mutual exclusion.** If `i18n[defaultLocale].F` is
 *    non-empty, then top-level `F` is removed. Decided per-field so partial
 *    migrations stay coherent.
 *  - **I-2 No empty placeholders.** Any `""`, whitespace-only string, `[]`,
 *    or all-whitespace array in `i18n` is stripped. Empty locale nodes are
 *    removed. An empty `i18n` object is removed entirely.
 *  - **I-3 Idempotent.** `normalize(normalize(x))` deep-equals `normalize(x)`.
 *  - **I-4 Conservative.** For a legacy-only config (no `i18n`, or no entry
 *    for `defaultLocale`), top-level fields are preserved — the resolver's
 *    fallback chain handles them.
 *
 * The `defaultLocale` argument is the organization's configured output locale
 * (from `getOrganizationDefaultLocale`). Pass it explicitly; we deliberately
 * don't read `config.defaultLocale` because the agent schema has no such field.
 *
 * **Does not mutate the input.** Returns a new config object.
 *
 * `top-level` fields of types not in `TRANSLATABLE_FIELDS` (tools, models,
 * etc.) are passed through unchanged.
 */
export function normalizeAgentConfig(
  config: AgentJsonConfig,
  defaultLocale: string = appDefaultLocale,
): AgentJsonConfig {
  // Clone so we never mutate the input. Top-level structure is shallow; we
  // rebuild `i18n` below, so a single spread is sufficient.
  const next: AgentJsonConfig = { ...config };

  // --- I-2: clean each locale entry in i18n ---
  if (next.i18n) {
    const cleanedLocales: Record<string, AgentI18nOverrides> = {};
    for (const [locale, overrides] of Object.entries(next.i18n)) {
      const cleaned = cleanLocaleOverrides(overrides);
      if (cleaned) cleanedLocales[locale] = cleaned;
    }
    if (Object.keys(cleanedLocales).length > 0) {
      next.i18n = cleanedLocales;
    } else {
      delete next.i18n;
    }
  }

  // --- I-1: retire top-level fields whose canonical value now lives in
  // i18n[defaultLocale]. Per-field: a field at i18n[default] being present
  // claims that field's top-level slot, nothing else's.
  const defaultOverrides = next.i18n?.[defaultLocale];
  if (defaultOverrides) {
    for (const field of TRANSLATABLE_FIELDS) {
      if (!isEffectivelyEmpty(defaultOverrides[field])) {
        // oxlint-disable-next-line no-dynamic-delete -- static field set
        delete (next as unknown as Record<string, unknown>)[field];
      }
    }
  }

  // --- I-2 also: strip effectively-empty top-level string/array fields so
  // they don't round-trip as `""`/`[]` placeholders. This is independent of
  // I-1 and applies even in legacy-only configs.
  for (const field of TRANSLATABLE_FIELDS) {
    if (field === 'conversationStarters') {
      const arr = next.conversationStarters;
      if (Array.isArray(arr)) {
        const filtered = arr.filter(
          (s) => typeof s === 'string' && s.trim().length > 0,
        );
        if (filtered.length === 0) {
          delete next.conversationStarters;
        } else if (filtered.length !== arr.length) {
          next.conversationStarters = filtered;
        }
      }
      continue;
    }
    const value = next[field] as string | undefined;
    if (typeof value === 'string' && isEffectivelyEmpty(value)) {
      // oxlint-disable-next-line no-dynamic-delete -- static field set
      delete (next as unknown as Record<string, unknown>)[field];
    }
  }

  return next;
}

/**
 * Predicate that mirrors the invariants enforced by `normalizeAgentConfig`.
 * Used by tests and by the dev-time `console.assert` in write actions.
 */
export function isNormalized(
  config: AgentJsonConfig,
  defaultLocale: string = appDefaultLocale,
): boolean {
  if (config.i18n) {
    if (Object.keys(config.i18n).length === 0) return false;
    for (const overrides of Object.values(config.i18n)) {
      const keys = Object.keys(overrides);
      if (keys.length === 0) return false;
      for (const field of TRANSLATABLE_FIELDS) {
        const value = overrides[field];
        if (value === undefined) continue;
        if (isEffectivelyEmpty(value)) return false;
      }
    }
  }

  // I-1: for each translatable field, not both top-level and i18n[default].
  const defaultOverrides = config.i18n?.[defaultLocale];
  if (defaultOverrides) {
    for (const field of TRANSLATABLE_FIELDS) {
      if (
        !isEffectivelyEmpty(defaultOverrides[field]) &&
        !isEffectivelyEmpty(
          (config as unknown as Record<string, unknown>)[field],
        )
      ) {
        return false;
      }
    }
  }

  // Top-level translatables must not be effectively-empty placeholders.
  for (const field of TRANSLATABLE_FIELDS) {
    const value = (config as unknown as Record<string, unknown>)[field];
    if (value === undefined) continue;
    if (isEffectivelyEmpty(value)) return false;
  }

  return true;
}

/** Exposed for the delegation-scaffold lookup. */
export { TRANSLATABLE_FIELDS };
export type { TranslatableField };
