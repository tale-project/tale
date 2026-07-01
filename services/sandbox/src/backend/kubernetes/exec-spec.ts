// Deterministic per-execution Secret name. Retained from the retired one-shot
// K8s exec path because the orphan sweep still deletes any leaked `*-spec`
// Secret by name (see `k8s-backend.sweepOrphans`).

import { createHash } from 'node:crypto';

/**
 * Deterministic, DNS-1123-safe Secret name derived from the execution id. Kept
 * so the orphan sweep can delete a leaked per-exec Secret by name without a
 * label lookup.
 */
export function secretNameFor(executionId: string): string {
  const h = createHash('sha1').update(executionId).digest('hex').slice(0, 16);
  return `tale-sbx-${h}-spec`;
}
