import { formatModelRef, parseModelRef } from './model-ref';

/**
 * Expands a list of model refs into per-quantization variants.
 *
 * For each ref:
 * - If the ref already pins a quantization (e.g. `openrouter:z-ai/glm-5.1@fp8`),
 *   it's kept as-is.
 * - If the bare model has a non-empty `quantizations` array (looked up via
 *   `getQuantizations(bareId)`), the ref is replaced by one variant ref per
 *   quantization in declared order. The unsplit base entry is dropped — the
 *   UX rule is "force an explicit variant pick when quantizations exist".
 * - Otherwise, the ref is kept as-is.
 *
 * Output is deduplicated while preserving first-occurrence order.
 */
export function expandModelVariants(
  refs: readonly string[],
  getQuantizations: (bareModelId: string) => readonly string[] | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (ref: string): void => {
    if (seen.has(ref)) return;
    seen.add(ref);
    out.push(ref);
  };

  for (const ref of refs) {
    const parsed = parseModelRef(ref);
    if (parsed.quantization) {
      push(ref);
      continue;
    }
    const variants = getQuantizations(parsed.modelId);
    if (variants && variants.length > 0) {
      for (const q of variants) {
        push(formatModelRef({ ...parsed, quantization: q }));
      }
    } else {
      push(ref);
    }
  }
  return out;
}

/** Render a quantization token as a UI badge label, e.g. `'fp8'` → `'FP8'`. */
export function getVariantBadgeLabel(quantization: string): string {
  return quantization.toUpperCase();
}
