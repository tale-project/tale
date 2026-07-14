'use node';

/**
 * Canonical store for a workflow definition — INLINE-ONLY.
 *
 * A workflow has exactly ONE home: the `workflow` field of an automation's
 * org `automation.json` (see `lib/shared/schemas/automations.ts`). A
 * `workflowSlug` IS an automation slug — the workflow for automation
 * `create-github-pr` has slug `create-github-pr` — so these helpers are the
 * ONE seam that maps a workflowSlug to its owning manifest, and every READ
 * (`readWorkflowFile`/`readWorkflowForExecution`, the editor, the run/spec
 * tools, the engine) and every WRITE (the two save actions, restore)
 * serves/persists the manifest's inline copy. There is no standalone-file
 * fallback: a slug that is not an installed automation with an inline
 * `workflow` reads as `not_found` and refuses writes.
 */
import { readFile } from 'node:fs/promises';

import {
  automationManifestSchema,
  isValidAutomationSlug,
} from '../../lib/shared/schemas/automations';
import type { WorkflowJsonConfig } from '../../lib/shared/schemas/workflows';
import { resolveAutomationManifestPath } from '../automations/file_utils';
import { atomicWrite, serializeJson, sha256 } from '../lib/file_io';
import { serializeWorkflowJson } from './file_utils';
import type { WorkflowReadResult } from './file_utils';
import {
  computeSpecSyncStatus,
  reconcileSpecificationMeta,
} from './specification_fingerprint';

export interface InlineWorkflowOwner {
  /** The org `automation.json` that carries the inline workflow. */
  manifestPath: string;
  /** The full manifest object as read, so a write can splice `workflow` back
   *  while preserving every other field verbatim. */
  rawManifest: object;
  /** The parsed inline workflow definition. */
  workflow: WorkflowJsonConfig;
}

/**
 * If `workflowSlug` names an automation whose org `automation.json` carries an
 * inline `workflow`, return the manifest handle + parsed workflow; else `null`
 * (the slug has no workflow — reads report `not_found`, writes refuse).
 * Tolerant by design: a missing/unparsable manifest, or one with no inline
 * workflow, yields `null` rather than throwing, so a read stays a clean
 * not-found even on a corrupt org tree.
 */
export async function resolveInlineWorkflowOwner(
  orgSlug: string,
  workflowSlug: string,
): Promise<InlineWorkflowOwner | null> {
  // A composite/foldered slug (`a/b`) or an invalid one can never name an
  // automation — guarding here also keeps `resolveAutomationManifestPath`
  // from throwing on a slug it would reject.
  if (!isValidAutomationSlug(workflowSlug)) return null;
  let content: string;
  let manifestPath: string;
  try {
    manifestPath = resolveAutomationManifestPath(orgSlug, workflowSlug);
    content = await readFile(manifestPath, 'utf-8');
  } catch {
    return null;
  }
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(content);
  } catch (err) {
    console.warn(
      `[definition_store] ignoring unparsable automation.json for "${workflowSlug}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
  if (typeof rawManifest !== 'object' || rawManifest === null) return null;
  const parsed = automationManifestSchema.safeParse(rawManifest);
  if (!parsed.success || !parsed.data.workflow) return null;
  return {
    manifestPath,
    rawManifest,
    workflow: parsed.data.workflow,
  };
}

/**
 * Read a workflow definition from its owning automation manifest. The single
 * READ seam behind `readWorkflowFile`/`readWorkflowForExecution`. The
 * returned `hash` is over the CANONICAL serialization (so compare-and-swap
 * stays stable across manifest rewrites). A slug with no inline owner returns
 * the same `not_found` shape a missing file used to, so callers/UI keep their
 * existing error handling.
 */
export async function readWorkflowDefinition(
  orgSlug: string,
  workflowSlug: string,
): Promise<WorkflowReadResult> {
  const inline = await resolveInlineWorkflowOwner(orgSlug, workflowSlug);
  if (!inline) {
    return {
      ok: false,
      error: 'not_found',
      message: `Workflow not found: no installed automation "${workflowSlug}" carries an inline workflow`,
    };
  }
  const serialized = serializeWorkflowJson(inline.workflow);
  return {
    ok: true,
    config: inline.workflow,
    hash: sha256(serialized),
    specSyncStatus: computeSpecSyncStatus(inline.workflow),
  };
}

/**
 * The current serialized workflow content for `workflowSlug`, or `null` when
 * no automation manifest carries it. Used by the save actions for
 * compare-and-swap (`expectedHash`) and the history snapshot — the counterpart
 * to {@link writeWorkflowDefinition} so both agree on what "current" is.
 */
export async function readCurrentWorkflowContent(
  orgSlug: string,
  workflowSlug: string,
): Promise<string | null> {
  const inline = await resolveInlineWorkflowOwner(orgSlug, workflowSlug);
  return inline ? serializeWorkflowJson(inline.workflow) : null;
}

/**
 * Persist `config` into its owning automation's `workflow` field — an atomic
 * rewrite of `automation.json` that preserves every OTHER manifest field
 * verbatim. The single WRITE seam behind the save/restore actions — which is
 * why it also reconciles `specificationMeta` against the stored state
 * (`reconcileSpecificationMeta`): no write path can silently un-stale an
 * authored spec/graph pair. `trustPair` skips that (a history restore is a
 * once-consistent pair restored wholesale).
 *
 * Throws when `workflowSlug` has no inline owner: a workflow can only be
 * created by creating an automation (the agent tool / the catalog), never by
 * writing a definition to a bare slug.
 */
export async function writeWorkflowDefinition(
  orgSlug: string,
  workflowSlug: string,
  config: WorkflowJsonConfig,
  options?: { trustPair?: boolean },
): Promise<void> {
  const inline = await resolveInlineWorkflowOwner(orgSlug, workflowSlug);
  if (!inline) {
    throw new Error(
      `Cannot save workflow "${workflowSlug}": no installed automation of that slug carries an inline workflow. Create an automation to create its workflow.`,
    );
  }
  const next = options?.trustPair
    ? config
    : reconcileSpecificationMeta(inline.workflow, config, Date.now());
  const nextManifest = { ...inline.rawManifest, workflow: next };
  await atomicWrite(inline.manifestPath, serializeJson(nextManifest));
}
