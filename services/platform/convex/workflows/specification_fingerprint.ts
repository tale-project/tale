'use node';

/**
 * Graph fingerprint + spec/graph sync status for a workflow's text
 * `specification` (W5b).
 *
 * The fingerprint is a hash of the parts of the config that the specification
 * describes — `steps` and `triggers` — NOT the whole file (metadata changes
 * shouldn't mark a spec stale). `specificationMeta` records the last
 * KNOWN-CONSISTENT pair: the graph fingerprint (`sourceHash`) and the spec
 * text hash (`specHash`) as of the last sync. Comparing each against the
 * CURRENT config tells which side moved. NO meta means the pair is
 * author-shipped and trusted as consistent — a fresh install reads as synced.
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

export type SpecSyncStatus = 'absent' | 'synced' | 'spec_stale' | 'graph_stale';

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

/** Deterministic hash of the spec text (trimmed, so whitespace-only edits never mark the graph stale). */
export function computeSpecHash(specification: string): string {
  return sha256(specification.trim());
}

/**
 * Classify the sync state between a workflow's `specification` text and its
 * current step graph:
 * - `absent` — no specification text at all.
 * - `synced` — no meta (an author-shipped pair, trusted as consistent), or
 *   both recorded hashes match the current config.
 * - `graph_stale` — the specification changed since the last sync; the graph
 *   should be regenerated from it. Wins over `spec_stale` when both sides
 *   moved: an edited spec is an explicit statement of intent.
 * - `spec_stale` — the graph changed since the last sync; the specification
 *   should be updated from it.
 */
export function computeSpecSyncStatus(
  config: WorkflowGraphShape &
    Pick<WorkflowJsonConfig, 'specification' | 'specificationMeta'>,
): SpecSyncStatus {
  const spec = config.specification;
  if (!spec || !spec.trim()) return 'absent';
  const meta = config.specificationMeta;
  if (!meta) return 'synced';
  if (meta.specHash !== undefined && meta.specHash !== computeSpecHash(spec)) {
    return 'graph_stale';
  }
  return meta.sourceHash === computeGraphFingerprint(config)
    ? 'synced'
    : 'spec_stale';
}

/**
 * Keep `specificationMeta` honest across ANY definition write (the single
 * invariant every write path shares — UI saves, agent tools, restores go
 * through `definition_store.writeWorkflowDefinition`, which calls this):
 *
 * - No spec on the incoming config → no meta (it means nothing without one).
 * - Incoming carries its own meta → that save IS a sync (a regeneration
 *   apply / an explicit stamp) — trust it verbatim.
 * - Stored has meta, incoming doesn't → carry the stored record forward; a
 *   plain edit must never erase the last-known-consistent pair.
 * - NEITHER side has meta (an author-shipped pair) and the save moves the
 *   spec or the graph → stamp the baseline from the PRE-SAVE stored state,
 *   so the side that moved reads stale instead of silently "synced".
 */
export function reconcileSpecificationMeta(
  stored: WorkflowJsonConfig | undefined,
  incoming: WorkflowJsonConfig,
  now: number,
): WorkflowJsonConfig {
  if (!incoming.specification?.trim()) {
    if (!incoming.specificationMeta) return incoming;
    const { specificationMeta: _dropped, ...rest } = incoming;
    return rest;
  }
  if (incoming.specificationMeta) return incoming;
  if (stored?.specificationMeta) {
    return { ...incoming, specificationMeta: stored.specificationMeta };
  }
  if (stored?.specification?.trim()) {
    const specChanged =
      computeSpecHash(stored.specification) !==
      computeSpecHash(incoming.specification);
    const graphChanged =
      computeGraphFingerprint(stored) !== computeGraphFingerprint(incoming);
    if (specChanged || graphChanged) {
      return {
        ...incoming,
        specificationMeta: {
          sourceHash: computeGraphFingerprint(stored),
          specHash: computeSpecHash(stored.specification),
          generatedAt: now,
          direction: 'authored',
        },
      };
    }
  }
  return incoming;
}
