/**
 * Pure helpers for merging and namespacing per-provider/per-model
 * `providerOptions` so they reach the AI SDK in the shape the openai-compatible
 * adapter expects: `providerOptions[<providerName>]` whose contents the SDK
 * spreads as top-level body fields.
 *
 * Authoring convention (see `providerOptionsSchema` in
 * `lib/shared/schemas/providers.ts`): users write the **inner** body shape
 * (e.g. `{ provider: { quantizations: ['fp8'] } }`); the resolver namespaces
 * under the actual provider name at call time via `buildCallProviderOptions`.
 */

import type { SharedV3ProviderOptions } from '@ai-sdk/provider';

import {
  BODY_OVERWRITE_KEYS,
  SDK_RESERVED_KEYS,
} from '../../lib/shared/schemas/providers';

const DENY_LIST = new Set<string>([
  ...SDK_RESERVED_KEYS,
  ...BODY_OVERWRITE_KEYS,
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Depth-2 merge. Top-level keys merge; for sub-objects under a shared
 * top-level key, sub-keys merge with model winning on conflict. Anything
 * deeper, or non-object values, is replaced wholesale. Arrays are never
 * concatenated. `undefined` means "absent" (other side wins); explicit `null`
 * is a real value and replaces.
 *
 * After merging, top-level values that are empty objects are pruned, and the
 * function returns `undefined` if nothing meaningful remains.
 */
export function mergeModelLevel(
  providerLevel: Record<string, unknown> | undefined,
  modelLevel: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!providerLevel && !modelLevel) return undefined;
  const result: Record<string, unknown> = providerLevel
    ? { ...providerLevel }
    : {};
  if (modelLevel) {
    for (const [key, modelValue] of Object.entries(modelLevel)) {
      if (modelValue === undefined) continue;
      const baseValue = result[key];
      if (isPlainObject(baseValue) && isPlainObject(modelValue)) {
        const merged: Record<string, unknown> = { ...baseValue };
        for (const [subKey, subValue] of Object.entries(modelValue)) {
          if (subValue === undefined) continue;
          merged[subKey] = subValue;
        }
        result[key] = merged;
      } else {
        result[key] = modelValue;
      }
    }
  }
  return pruneEmpty(result);
}

function pruneEmpty(
  value: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [key, sub] of Object.entries(value)) {
    if (isPlainObject(sub) && Object.keys(sub).length === 0) continue;
    out[key] = sub;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

/**
 * Defensive belt-and-braces filter that removes any deny-listed key (SDK
 * reserved or body-overwrite) at the top level and one nested level. Logs a
 * `console.warn` per stripped key — this should never fire in practice
 * because the Zod schema rejects them at parse time, so a hit signals a
 * hand-edit that bypassed validation.
 */
export function stripDenyListed(
  options: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!options) return undefined;
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    if (DENY_LIST.has(key)) {
      console.warn(
        `[providerOptions] stripped deny-listed key '${key}' at runtime — should have been rejected at parse time`,
      );
      continue;
    }
    if (isPlainObject(value)) {
      const subCleaned: Record<string, unknown> = {};
      for (const [subKey, subValue] of Object.entries(value)) {
        if (DENY_LIST.has(subKey)) {
          console.warn(
            `[providerOptions] stripped deny-listed key '${key}.${subKey}' at runtime`,
          );
          continue;
        }
        subCleaned[subKey] = subValue;
      }
      cleaned[key] = subCleaned;
    } else {
      cleaned[key] = value;
    }
  }
  return pruneEmpty(cleaned);
}

/**
 * Namespace `modelData.providerOptions` under `modelData.providerName` for the
 * AI SDK and apply the defensive deny-list strip. Returns `undefined` when
 * nothing meaningful is configured so call sites can spread cleanly without
 * emitting an empty options block.
 */
export function buildCallProviderOptions(modelData: {
  providerName: string;
  providerOptions?: Record<string, unknown>;
}): SharedV3ProviderOptions | undefined {
  const stripped = stripDenyListed(modelData.providerOptions);
  if (!stripped) return undefined;
  // Stripped data came from JSON parsing so values are JSON-compatible
  // (string/number/boolean/null/array/object). The AI SDK's
  // `SharedV3ProviderOptions = Record<string, JSONObject>` is structurally
  // satisfied; the cast lets TS see the narrower JSONValue constraint.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON-derived data structurally satisfies JSONObject; TS cannot infer JSON-shape across runtime parse boundaries
  return { [modelData.providerName]: stripped } as SharedV3ProviderOptions;
}
