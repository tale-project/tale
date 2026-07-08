'use node';

/**
 * Canonical store for a workflow definition — INLINE-FIRST.
 *
 * A non-bundle automation owns its single workflow INLINE in its
 * `automation.json` under `workflow` (see `lib/shared/schemas/automations.ts`);
 * every standalone/global workflow lives in an `org/workflows/*.json` file.
 * These helpers are the ONE seam that knows which home a `workflowSlug` has, so
 * every READ (`readWorkflowFile`/`readWorkflowForExecution`, the editor, the
 * run/spec tools, the engine) and every WRITE (the two save actions, restore)
 * serves/persists the right one without caring.
 *
 * Identity: a `workflowSlug` is inline-owned iff it is a valid automation slug
 * (a single kebab segment — never `a/b`) whose org `automation.json` carries an
 * inline `workflow`. Otherwise it is a file. The automation slug and its inline
 * workflow's slug are the SAME string (the workflow for automation
 * `create-github-pr` has slug `create-github-pr`).
 */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  automationManifestSchema,
  isValidAutomationSlug,
} from '../../lib/shared/schemas/automations';
import type { WorkflowJsonConfig } from '../../lib/shared/schemas/workflows';
import { resolveAutomationManifestPath } from '../automations/file_utils';
import {
  atomicWrite,
  readFileSafe,
  readJsonFile,
  serializeJson,
  sha256,
} from '../lib/file_io';
import {
  MAX_FILE_SIZE_BYTES,
  parseWorkflowJson,
  resolveWorkflowFilePath,
  serializeWorkflowJson,
  type WorkflowReadResult,
} from './file_utils';
import { computeSpecSyncStatus } from './specification_fingerprint';

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
 * (the slug is a standalone/global workflow FILE). Tolerant by design: a
 * missing/unparsable manifest, or one with no inline workflow, yields `null` so
 * the caller falls back to the file path.
 */
export async function resolveInlineWorkflowOwner(
  orgSlug: string,
  workflowSlug: string,
): Promise<InlineWorkflowOwner | null> {
  // A composite/foldered slug (`a/b`) or an invalid one is never inline-owned —
  // guarding here also keeps `resolveAutomationManifestPath` from throwing on a
  // slug it would reject.
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
 * Read a workflow definition inline-first, falling back to the standalone file.
 * The single READ seam behind `readWorkflowFile`/`readWorkflowForExecution`.
 * The returned `hash` is over the CANONICAL serialization for both homes (so
 * compare-and-swap stays stable across edits regardless of where it lives).
 */
export async function readWorkflowDefinition(
  orgSlug: string,
  workflowSlug: string,
): Promise<WorkflowReadResult> {
  const inline = await resolveInlineWorkflowOwner(orgSlug, workflowSlug);
  if (inline) {
    const serialized = serializeWorkflowJson(inline.workflow);
    return {
      ok: true,
      config: inline.workflow,
      hash: sha256(serialized),
      specSyncStatus: computeSpecSyncStatus(inline.workflow),
    };
  }
  const filePath = resolveWorkflowFilePath(orgSlug, workflowSlug);
  const result = await readJsonFile<WorkflowJsonConfig>(
    filePath,
    MAX_FILE_SIZE_BYTES,
    parseWorkflowJson,
  );
  if (result.ok) {
    return {
      ok: true,
      config: result.data,
      hash: result.hash,
      specSyncStatus: computeSpecSyncStatus(result.data),
    };
  }
  return result;
}

/**
 * The current serialized workflow content for `workflowSlug` (inline or file),
 * or `null` when it has no definition yet. Used by the save actions for
 * compare-and-swap (`expectedHash`) and the history snapshot — the counterpart
 * to {@link writeWorkflowDefinition} so both agree on what "current" is.
 */
export async function readCurrentWorkflowContent(
  orgSlug: string,
  workflowSlug: string,
): Promise<string | null> {
  const inline = await resolveInlineWorkflowOwner(orgSlug, workflowSlug);
  if (inline) return serializeWorkflowJson(inline.workflow);
  return readFileSafe(resolveWorkflowFilePath(orgSlug, workflowSlug));
}

/**
 * Persist `config` to its home: the automation's inline `workflow` field when
 * `workflowSlug` is inline-owned (an atomic rewrite of `automation.json` that
 * preserves every OTHER manifest field), else the standalone workflow FILE.
 * The single WRITE seam behind the save/restore actions.
 */
export async function writeWorkflowDefinition(
  orgSlug: string,
  workflowSlug: string,
  config: WorkflowJsonConfig,
): Promise<void> {
  const inline = await resolveInlineWorkflowOwner(orgSlug, workflowSlug);
  if (inline) {
    const nextManifest = { ...inline.rawManifest, workflow: config };
    await atomicWrite(inline.manifestPath, serializeJson(nextManifest));
    return;
  }
  const filePath = resolveWorkflowFilePath(orgSlug, workflowSlug);
  await mkdir(path.dirname(filePath), { recursive: true });
  await atomicWrite(filePath, serializeWorkflowJson(config));
}
