'use node';

/**
 * Graph fingerprint + spec/graph sync status for a workflow's text
 * `specification` (W5b).
 *
 * The fingerprint is a hash of the parts of the config that the specification
 * describes — `steps` and `triggers` — NOT the whole file (name/description/
 * metadata changes shouldn't mark a spec stale). `specificationMeta.sourceHash`
 * records this fingerprint as of the last sync; comparing it against the
 * CURRENT graph's fingerprint is what tells a synced spec from a stale one.
 *
 * Pure — no Convex ctx, no I/O. `'use node'` only because it reuses `sha256`
 * from `lib/file_io.ts` (node:crypto), matching every other consumer of that
 * helper in this codebase.
 */

import type { WorkflowJsonConfig } from '../../lib/shared/schemas/workflows';
import { canonicalizeWorkflowConfig } from '../../lib/shared/utils/canonicalize-config';
import { serializeJson, sha256 } from '../lib/file_io';

/** The slice of a workflow config the specification describes and the graph fingerprint covers. */
export type WorkflowGraphShape = Pick<WorkflowJsonConfig, 'steps' | 'triggers'>;

export type SpecSyncStatus = 'absent' | 'never_synced' | 'synced' | 'stale';

/**
 * Deterministic hash of a workflow's graph (`steps` + `triggers`), canonicalized
 * the same way the on-disk file is (`file_utils.ts::serializeWorkflowJson`) so
 * a reordered-but-equivalent graph never reads as changed.
 */
export function computeGraphFingerprint(config: WorkflowGraphShape): string {
  const canonical = canonicalizeWorkflowConfig({
    steps: config.steps,
    triggers: config.triggers,
  });
  return sha256(serializeJson(canonical));
}

/**
 * Classify the sync state between a workflow's `specification` text and its
 * current step graph:
 * - `absent` — no specification text at all.
 * - `never_synced` — a specification exists but was never round-tripped
 *   through the sync actions (hand-written, or written before this feature).
 * - `synced` — `specificationMeta.sourceHash` matches the graph's current
 *   fingerprint.
 * - `stale` — the graph changed since the specification was last generated
 *   (or vice versa).
 */
export function computeSpecSyncStatus(
  config: WorkflowGraphShape &
    Pick<WorkflowJsonConfig, 'specification' | 'specificationMeta'>,
): SpecSyncStatus {
  if (!config.specification || !config.specification.trim()) return 'absent';
  if (!config.specificationMeta) return 'never_synced';
  return config.specificationMeta.sourceHash === computeGraphFingerprint(config)
    ? 'synced'
    : 'stale';
}
