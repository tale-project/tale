import { isEffectivelyEmpty } from './is-effectively-empty';

/**
 * Walks candidate layers in order and returns the first value that is not
 * effectively empty (see `isEffectivelyEmpty` — treats `""`, whitespace-only
 * strings, `[]`, and all-blank arrays as absent). Used by locale resolvers
 * (agents, providers) so that disk-state and runtime-fallback agree on
 * "empty" across both the normalization pipeline and the read path.
 */
export function pickField<T>(layers: (T | undefined)[]): T | undefined {
  for (const layer of layers) {
    if (!isEffectivelyEmpty(layer)) return layer;
  }
  return undefined;
}
