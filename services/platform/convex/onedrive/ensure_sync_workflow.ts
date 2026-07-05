'use node';

/**
 * Ensure the org-wide OneDrive sync engine workflow is on disk, installed,
 * and scheduled. Sync import writes `onedriveSyncConfigs` rows but ongoing
 * sync is driven by the builtin `autoInstall` workflow — which only lands
 * on org-create / catalog sync / fleet provision today. Call this when a
 * member chooses "Sync import" so older orgs pick up the engine on first use.
 */

import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { v } from 'convex/values';

import type { WorkflowJsonConfig } from '../../lib/shared/schemas/workflows';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { atomicWrite, readJsonFile } from '../lib/file_io';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import {
  MAX_FILE_SIZE_BYTES,
  parseWorkflowJson,
  resolveWorkflowFilePath,
  validateWorkflowSlug,
} from '../workflows/file_utils';
import { ONEDRIVE_SYNC_WORKFLOW_SLUG } from './ensure_sync_workflow_constants';

export { ONEDRIVE_SYNC_WORKFLOW_SLUG } from './ensure_sync_workflow_constants';

function resolveBuiltinWorkflowPath(workflowSlug: string): string {
  const catalogRoot = process.env.TALE_CONFIG_BUILTIN_DIR;
  if (!catalogRoot || !path.isAbsolute(catalogRoot)) {
    throw new Error(
      'TALE_CONFIG_BUILTIN_DIR is unset or not absolute; the builtin catalog is unavailable',
    );
  }
  if (!validateWorkflowSlug(workflowSlug)) {
    throw new Error(`Invalid workflow slug: ${workflowSlug}`);
  }
  return path.join(catalogRoot, 'workflows', `${workflowSlug}.json`);
}

async function readOrgWorkflow(orgSlug: string, workflowSlug: string) {
  const filePath = resolveWorkflowFilePath(orgSlug, workflowSlug);
  return readJsonFile<WorkflowJsonConfig>(
    filePath,
    MAX_FILE_SIZE_BYTES,
    parseWorkflowJson,
  );
}

async function copyWorkflowFromBuiltinIfMissing(
  orgSlug: string,
  workflowSlug: string,
): Promise<{ copied: boolean }> {
  const existing = await readOrgWorkflow(orgSlug, workflowSlug);
  if (existing.ok) return { copied: false };

  const builtinPath = resolveBuiltinWorkflowPath(workflowSlug);
  const content = await readFile(builtinPath, 'utf-8');
  const targetPath = resolveWorkflowFilePath(orgSlug, workflowSlug);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await atomicWrite(targetPath, content);
  return { copied: true };
}

export const ensureSyncWorkflowEngine = internalAction({
  args: {
    organizationId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    installed: v.boolean(),
    scheduleEnsured: v.boolean(),
    workflowCopied: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    success: boolean;
    installed: boolean;
    scheduleEnsured: boolean;
    workflowCopied: boolean;
    error?: string;
  }> => {
    try {
      const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
      const workflowSlug = ONEDRIVE_SYNC_WORKFLOW_SLUG;

      const { copied: workflowCopied } = await copyWorkflowFromBuiltinIfMissing(
        orgSlug,
        workflowSlug,
      );

      const read = await readOrgWorkflow(orgSlug, workflowSlug);
      if (!read.ok) {
        return {
          success: false,
          installed: false,
          scheduleEnsured: false,
          workflowCopied,
          error: read.message,
        };
      }

      const workflow = read.data;
      const declaredSchedules = workflow.triggers?.schedules ?? [];

      const provision = await ctx.runMutation(
        internal.onedrive.ensure_sync_workflow_provision
          .ensureSyncWorkflowEngineProvision,
        {
          organizationId: args.organizationId,
          workflowSlug,
          contentHash: read.hash,
          events: workflow.triggers?.events,
          schedules: declaredSchedules,
        },
      );

      const scheduleEnsured =
        declaredSchedules.length === 0 ||
        provision.schedulesActive >= provision.schedulesRequired;

      if (!provision.complete) {
        return {
          success: false,
          installed: provision.installationCreated,
          scheduleEnsured: false,
          workflowCopied,
          error: 'Sync workflow installed but schedule trigger is missing',
        };
      }

      return {
        success: true,
        installed: provision.installationCreated,
        scheduleEnsured,
        workflowCopied,
      };
    } catch (error) {
      return {
        success: false,
        installed: false,
        scheduleEnsured: false,
        workflowCopied: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
