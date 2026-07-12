'use node';

/**
 * Workflow file I/O actions.
 *
 * All workflow config reads/writes go through these actions.
 * Uses atomic writes (temp → fsync → rename) for data safety.
 * History snapshots use epoch-ms filenames with 100-entry retention.
 * Supports compare-and-swap via expectedHash to prevent lost updates.
 */

import { mkdir, readdir, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import { ConvexError, v } from 'convex/values';

import type { WorkflowJsonConfig } from '../../lib/shared/schemas/workflows';
import { workflowJsonSchema } from '../../lib/shared/schemas/workflows';
import { internal } from '../_generated/api';
import { action, internalAction } from '../_generated/server';
import {
  type InstalledAutomationDisplay,
  readInstalledAutomationDisplays,
  readInstalledAutomationFolders,
} from '../automations/file_utils';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import {
  atomicWrite,
  errnoCode,
  generateHistoryTimestamp,
  handleDirReadError,
  pruneHistory,
  readFileSafe,
  readdirSafe,
  safeJoinWithinDir,
  sha256,
  verifyPathWithinBase,
} from '../lib/file_io';
import {
  readCurrentWorkflowContent,
  readWorkflowDefinition,
  resolveInlineWorkflowOwner,
  writeWorkflowDefinition,
} from './definition_store';
import type { WorkflowReadResult } from './file_utils';
import {
  MAX_HISTORY_ENTRIES,
  parseWorkflowJson,
  resolveHistoryDir,
  resolveWorkflowFilePath,
  resolveWorkflowsDir,
  serializeWorkflowJson,
  validateWorkflowSlug,
  workflowSlugFromRelativePath,
} from './file_utils';
import { reconcileSpecificationMeta } from './specification_fingerprint';

// History filenames are `${Date.now()}-${randomUUID().slice(0,8)}` — see
// `lib/file_io.ts::generateHistoryTimestamp`. Restrict to that shape so
// `restoreFromHistory` / `readHistoryEntry` reject anything that could probe
// outside the per-workflow history dir even before `safeJoinWithinDir` fires.
const HISTORY_TIMESTAMP_REGEX = /^\d{10,16}-[a-f0-9]{6,16}$/;

/**
 * One-line summary derived from the `specification` (a workflow's only text —
 * it carries no name/description): the first non-heading line, capped at 200
 * chars. What the list summaries and the agent-facing pickers show/read.
 */
function specificationSummary(
  config: Pick<WorkflowJsonConfig, 'specification'>,
): string | undefined {
  const spec = config.specification?.trim();
  if (!spec) return undefined;
  const line = spec
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '' && !l.startsWith('#'));
  if (!line) return undefined;
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

function validateHistoryTimestamp(timestamp: string): boolean {
  return HISTORY_TIMESTAMP_REGEX.test(timestamp);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function readWorkflowFile(
  orgSlug: string,
  workflowSlug: string,
): Promise<WorkflowReadResult> {
  // Inline-first: an automation-owned workflow is served from its
  // `automation.json` `workflow` field, a standalone one from its file — see
  // `definition_store.ts`.
  return readWorkflowDefinition(orgSlug, workflowSlug);
}

/**
 * Best-effort "created at" for a workflow.
 *
 * Saves use atomic temp+rename, so the live file's birthtime resets on every
 * save. The oldest history snapshot's epoch-ms filename is the earliest
 * preserved revision, which is the closest signal to "first save". If no
 * history exists yet, the file itself is the original — fall back to its
 * birthtime (or mtime where birthtime is unavailable).
 */
async function resolveCreatedAtMs(
  orgSlug: string,
  workflowSlug: string,
  filePath: string,
): Promise<number | undefined> {
  const historyDir = resolveHistoryDir(orgSlug, workflowSlug);
  const entries = await readdir(historyDir).catch((err: unknown) => {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return [] as string[];
    }
    console.warn(
      `[listWorkflows] readdir history failed for ${workflowSlug}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [] as string[];
  });
  const earliest = entries
    .filter((e) => e.endsWith('.json'))
    .map((e) => Number(e.replace('.json', '').split('-')[0]))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)[0];
  if (earliest !== undefined) return earliest;

  try {
    const s = await stat(filePath);
    const birth = s.birthtimeMs;
    return birth && birth > 0 ? birth : s.mtimeMs;
  } catch (err) {
    console.warn(
      `[listWorkflows] stat failed for ${workflowSlug}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

/**
 * Best-effort list of integrations a workflow touches, used to render brand
 * icon chips on template cards. Reads `requires.integrations[].name` when
 * present, then falls back to integration-type step parameters and the slug
 * category prefix. Template placeholders like `{{integrationName}}` are
 * skipped — they don't pin to a specific brand.
 */
function extractWorkflowIntegrations(
  slug: string,
  config: WorkflowJsonConfig,
): string[] {
  const found = new Set<string>();

  for (const dep of config.requires?.integrations ?? []) {
    if (typeof dep.name === 'string' && dep.name && !dep.name.includes('{{')) {
      found.add(dep.name);
    }
  }

  for (const step of config.steps) {
    const stepConfig = step.config as Record<string, unknown> | undefined;
    if (!stepConfig || stepConfig.type !== 'integration') continue;
    const params: unknown = stepConfig.parameters;
    if (!params || typeof params !== 'object' || !('name' in params)) continue;
    const name = (params as { name: unknown }).name;
    if (typeof name === 'string' && name && !name.includes('{{')) {
      found.add(name);
    }
  }

  if (found.size === 0) {
    const category = slug.includes('/') ? slug.split('/')[0] : '';
    if (category && category !== 'general') {
      found.add(category);
    } else {
      // Inbuilt / general templates have no third-party integration — surface
      // the Tale brand so the template card still shows an icon chip.
      found.add('tale');
    }
  }

  return [...found];
}

// ---------------------------------------------------------------------------
// Public actions (called from frontend)
// ---------------------------------------------------------------------------

export const readWorkflow = action({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<WorkflowReadResult> => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    return readWorkflowFile(orgSlug, args.workflowSlug);
  },
});

export const listWorkflows = action({
  args: {
    organizationId: v.string(),
    filter: v.optional(
      v.union(v.literal('installed'), v.literal('templates'), v.literal('all')),
    ),
  },
  returns: v.any(),
  // oxlint-disable-next-line typescript/no-explicit-any -- listWorkflows returns heterogeneous shapes; v.any() at API boundary
  handler: async (ctx, args): Promise<any[]> => {
    // An empty org id means the caller's org context has not resolved yet
    // (clients fall back to `''`); there is nothing to list, so return empty
    // instead of surfacing an uncaught ORG_NOT_FOUND on the console (#2668).
    if (!args.organizationId) return [];
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    const filterMode = args.filter ?? 'all';

    const installedRaw: string[] = await ctx.runQuery(
      internal.workflows.installations.listInstalledSlugs,
      { organizationId: args.organizationId },
    );
    const installedSlugs = new Set<string>(installedRaw);

    // Relative paths of *.json workflow files under a base dir (recursive,
    // skipping dotfiles + .history). ENOENT → []; other errors surface.
    const listJsonRelPaths = async (baseDir: string): Promise<string[]> => {
      try {
        const raw = await readdir(baseDir, {
          recursive: true,
          withFileTypes: true,
        });
        return raw
          .filter(
            (e) =>
              !e.isDirectory() &&
              e.name.endsWith('.json') &&
              !e.name.startsWith('.') &&
              !(e.parentPath ?? '').includes('.history'),
          )
          .map((e) =>
            path
              .relative(baseDir, path.join(e.parentPath ?? '', e.name))
              .replace(/\\/g, '/'),
          );
      } catch (err) {
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
          return [];
        }
        throw new Error(
          `Workflows directory inaccessible: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
    };

    // Project one workflow file (by slug) to its list item, applying the filter.
    // `automationSlug` set ⇒ app-owned: the global list groups + marks it (under the
    // app's display `folder`) and — when `automationDisplay` resolved — carries the
    // owning automation's self-translated `automationName`/`automationDescription`/
    // `automationI18n`, so a binding picker can show the AUTOMATION's identity
    // instead of the workflow's own slug-derived name; null ⇒ global/standalone.
    const projectWorkflow = async (
      slug: string,
      automationSlug?: string,
      folder?: string,
      automationDisplay?: InstalledAutomationDisplay,
    ) => {
      if (!validateWorkflowSlug(slug)) return null;
      const ownerTag =
        automationSlug !== undefined
          ? {
              automationSlug,
              folder: folder ?? automationSlug,
              ...(automationDisplay && {
                automationName: automationDisplay.name,
                automationDescription: automationDisplay.description,
                automationI18n: automationDisplay.i18n,
              }),
            }
          : {};
      const result = await readWorkflowFile(orgSlug, slug);
      if (!result.ok) {
        return {
          slug,
          status: result.error,
          message: result.message,
          ...ownerTag,
        };
      }
      const installed = installedSlugs.has(slug);
      if (filterMode === 'installed' && !installed) return null;
      if (filterMode === 'templates' && installed) return null;

      const filePath = resolveWorkflowFilePath(orgSlug, slug);
      const createdAtMs = await resolveCreatedAtMs(orgSlug, slug, filePath);
      const integrations = extractWorkflowIntegrations(slug, result.config);
      return {
        slug,
        name: slug,
        description: specificationSummary(result.config),
        installed,
        version: result.config.version,
        stepCount: result.config.steps.length,
        integrations,
        hash: result.hash,
        createdAtMs,
        ...ownerTag,
      };
    };

    // Global workflows (org/workflows/).
    const globalDir = resolveWorkflowsDir(orgSlug);
    const globalRel = await listJsonRelPaths(globalDir);
    const globalResults = await Promise.all(
      globalRel.map((rel) =>
        projectWorkflow(workflowSlugFromRelativePath(rel)),
      ),
    );

    // Automation-owned workflows — inline in each automation's `automation.json`
    // `workflow` field, invisible to the global scan above. A non-bundle
    // automation owns AT MOST ONE, its slug IS the automation slug; surface it
    // (tagged with the owning automation + its display folder, manifest
    // `folder` falling back to the slug, plus its self-translated display text)
    // so the global workflows list groups + marks it. Automations with no inline
    // workflow (bundles, view-only ones) are skipped.
    // Only INSTALLED automations contribute workflows: uploaded private
    // bundles also live on disk before install (and stay after uninstall), so
    // a disk scan would surface never-installed workflows (#2564 class).
    const automationSlugs: string[] = await ctx.runQuery(
      internal.automations.install_mutations
        .listAutomationInstallationsInternal,
      { organizationId: args.organizationId },
    );
    const appFolders = await readInstalledAutomationFolders(
      orgSlug,
      automationSlugs,
    );
    const appDisplays = await readInstalledAutomationDisplays(
      orgSlug,
      automationSlugs,
    );
    const appResults = (
      await Promise.all(
        automationSlugs.map(async (app) => {
          const owner = await resolveInlineWorkflowOwner(orgSlug, app);
          if (!owner) return [];
          const projected = await projectWorkflow(
            app,
            app,
            appFolders.get(app),
            appDisplays.get(app),
          );
          return projected ? [projected] : [];
        }),
      )
    ).flat();

    return [...globalResults, ...appResults].filter(Boolean);
  },
});

/**
 * Save a workflow with an atomic snapshot-then-write operation.
 *
 * `isNew` makes this a create: it refuses to clobber an existing slug and
 * throws `DUPLICATE_NAME` instead — mirroring `agents/file_actions.ts::saveAgent`
 * so creating a workflow whose name collides is rejected rather than silently
 * overwriting the existing one. Edits (the default) overwrite in place after
 * snapshotting the prior revision to history. Optionally performs
 * compare-and-swap via `expectedHash`.
 */
export const saveWorkflowWithSnapshot = action({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    config: v.any(),
    isNew: v.optional(v.boolean()),
    expectedHash: v.optional(v.string()),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );

    if (!validateWorkflowSlug(args.workflowSlug)) {
      throw new Error(`Invalid workflow slug: ${args.workflowSlug}`);
    }

    const parsed = workflowJsonSchema.parse(args.config);

    // The "current" content and the destination both route through
    // `definition_store` — an automation-owned workflow reads/writes its
    // `automation.json` `workflow` field, a standalone one its file.
    const currentContent = await readCurrentWorkflowContent(
      orgSlug,
      args.workflowSlug,
    );

    // A create must not overwrite an existing workflow. `isNew` and
    // `expectedHash` are mutually exclusive intents (create vs. compare-and-swap
    // an existing file), so check it first.
    if (args.isNew && currentContent) {
      throw new ConvexError({
        code: 'DUPLICATE_NAME',
        message: `Workflow '${args.workflowSlug}' already exists`,
      });
    }

    if (args.expectedHash && currentContent) {
      const currentHash = sha256(currentContent);
      if (currentHash !== args.expectedHash) {
        throw new Error(
          'Conflict: workflow was modified externally. Please refresh and try again.',
        );
      }
    }

    // Reconcile the spec/graph sync record against the stored state HERE (not
    // only inside the write seam) so the returned hash covers exactly what
    // lands on disk — compare-and-swap depends on that.
    const config = reconcileSpecificationMeta(
      currentContent ? parseWorkflowJson(currentContent) : undefined,
      parsed,
      Date.now(),
    );
    const newContent = serializeWorkflowJson(config);

    if (currentContent) {
      const historyDir = resolveHistoryDir(orgSlug, args.workflowSlug);
      await mkdir(historyDir, { recursive: true });
      const timestamp = generateHistoryTimestamp();
      await atomicWrite(
        path.join(historyDir, `${timestamp}.json`),
        currentContent,
      );
      await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);
    }

    await writeWorkflowDefinition(orgSlug, args.workflowSlug, config, {
      trustPair: true,
    });

    return { hash: sha256(newContent) };
  },
});

export const deleteWorkflow = action({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );

    if (!validateWorkflowSlug(args.workflowSlug)) {
      throw new Error(`Invalid workflow slug: ${args.workflowSlug}`);
    }

    // App-owned workflows are not individually deletable from the global surface
    // — removing one would orphan its app. Deletion happens only via app
    // uninstall (which deregisters + removes the bundle). Ownership is the
    // recorded `automationSlug` on the install row.
    const installation = await ctx.runQuery(
      internal.workflows.installations.getInstallationInternal,
      {
        organizationId: args.organizationId,
        workflowSlug: args.workflowSlug,
      },
    );
    if (installation?.automationSlug) {
      throw new ConvexError({
        code: 'app_owned',
        message: `Workflow "${args.workflowSlug}" belongs to app "${installation.automationSlug}". Uninstall the app to remove it.`,
      });
    }

    const filePath = resolveWorkflowFilePath(orgSlug, args.workflowSlug);
    const historyDir = resolveHistoryDir(orgSlug, args.workflowSlug);

    await unlink(filePath).catch((err) => {
      if (err instanceof Error && 'code' in err && err.code !== 'ENOENT') {
        throw err;
      }
    });
    await rm(historyDir, { recursive: true, force: true });

    await ctx.runMutation(internal.workflows.installations.deleteInstallation, {
      organizationId: args.organizationId,
      workflowSlug: args.workflowSlug,
    });

    // Drop the workflow's env/secrets (all scopes) so they never outlive the
    // file — deployment-local config, not part of the workflow definition.
    await ctx.runMutation(
      internal.workflows.workflow_env.deleteWorkflowEnvInternal,
      {
        organizationId: args.organizationId,
        workflowSlug: args.workflowSlug,
      },
    );

    return null;
  },
});

export const installWorkflow = action({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    const { orgSlug, userId, email } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );

    if (!validateWorkflowSlug(args.workflowSlug)) {
      throw new Error(`Invalid workflow slug: ${args.workflowSlug}`);
    }

    const result = await readWorkflowFile(orgSlug, args.workflowSlug);
    if (!result.ok) {
      throw new Error(`Cannot install workflow: ${result.message}`);
    }

    await ctx.runMutation(internal.workflows.installations.upsertInstallation, {
      organizationId: args.organizationId,
      workflowSlug: args.workflowSlug,
      installedBy: email !== '' ? email : userId,
      contentHash: result.hash,
    });

    await ctx.runMutation(
      internal.workflows.provision_defaults_mutations
        .provisionDeclaredWorkflowTriggers,
      {
        organizationId: args.organizationId,
        workflowSlug: args.workflowSlug,
        events: result.config.triggers?.events,
        schedules: result.config.triggers?.schedules,
        activate: true,
      },
    );

    return { hash: result.hash };
  },
});

/**
 * Bulk-install every available (uninstalled) workflow template in one call —
 * the "install all" entry. Optionally scoped to a `folder` (a top-level subdir
 * of the org's workflows tree, e.g. `issue-desk`), so a pack's workflows can be
 * installed as a group. Idempotent: already-installed slugs are skipped, and a
 * single malformed file is reported (not fatal) so one bad template can't block
 * the rest. Reuses the same recursive scan + slug derivation as listWorkflows.
 */
export const installAllWorkflows = action({
  args: {
    organizationId: v.string(),
    // Restrict to slugs equal to / under this top-level folder (no slash).
    folder: v.optional(v.string()),
  },
  returns: v.object({
    installed: v.array(v.string()),
    alreadyInstalled: v.array(v.string()),
    failed: v.array(v.object({ slug: v.string(), message: v.string() })),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    installed: string[];
    alreadyInstalled: string[];
    failed: { slug: string; message: string }[];
  }> => {
    const { orgSlug, userId, email } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    const installedBy = email !== '' ? email : userId;

    if (args.folder !== undefined && !validateWorkflowSlug(args.folder)) {
      throw new Error(`Invalid folder: ${args.folder}`);
    }
    const inFolder = (slug: string): boolean =>
      args.folder === undefined ||
      slug === args.folder ||
      slug.startsWith(`${args.folder}/`);

    const dir = resolveWorkflowsDir(orgSlug);
    let entries: { name: string; parentPath: string; isDirectory: boolean }[];
    try {
      const raw = await readdir(dir, { recursive: true, withFileTypes: true });
      entries = raw.map((e) => ({
        name: e.name,
        parentPath: e.parentPath ?? '',
        isDirectory: e.isDirectory(),
      }));
    } catch (err) {
      if (errnoCode(err) === 'ENOENT') {
        return { installed: [], alreadyInstalled: [], failed: [] };
      }
      throw new Error(
        `Workflows directory inaccessible: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    const jsonFiles = entries.filter(
      (e) =>
        !e.isDirectory &&
        e.name.endsWith('.json') &&
        !e.name.startsWith('.') &&
        !e.parentPath.includes('.history'),
    );

    const installedRaw: string[] = await ctx.runQuery(
      internal.workflows.installations.listInstalledSlugs,
      { organizationId: args.organizationId },
    );
    const installedSlugs = new Set<string>(installedRaw);

    const installed: string[] = [];
    const alreadyInstalled: string[] = [];
    const failed: { slug: string; message: string }[] = [];

    for (const entry of jsonFiles) {
      const relativePath = path
        .relative(dir, path.join(entry.parentPath, entry.name))
        .replace(/\\/g, '/');
      const slug = workflowSlugFromRelativePath(relativePath);
      if (!validateWorkflowSlug(slug) || !inFolder(slug)) continue;
      if (installedSlugs.has(slug)) {
        alreadyInstalled.push(slug);
        continue;
      }
      const result = await readWorkflowFile(orgSlug, slug);
      if (!result.ok) {
        failed.push({ slug, message: result.message });
        continue;
      }
      await ctx.runMutation(
        internal.workflows.installations.upsertInstallation,
        {
          organizationId: args.organizationId,
          workflowSlug: slug,
          installedBy,
          contentHash: result.hash,
        },
      );
      await ctx.runMutation(
        internal.workflows.provision_defaults_mutations
          .provisionDeclaredWorkflowTriggers,
        {
          organizationId: args.organizationId,
          workflowSlug: slug,
          events: result.config.triggers?.events,
          schedules: result.config.triggers?.schedules,
          activate: true,
        },
      );
      installed.push(slug);
    }

    return { installed, alreadyInstalled, failed };
  },
});

export const uninstallWorkflow = action({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await requireOrgMembershipById(ctx, args.organizationId);

    if (!validateWorkflowSlug(args.workflowSlug)) {
      throw new Error(`Invalid workflow slug: ${args.workflowSlug}`);
    }

    await ctx.runMutation(internal.workflows.installations.deleteInstallation, {
      organizationId: args.organizationId,
      workflowSlug: args.workflowSlug,
    });

    return null;
  },
});

export const duplicateWorkflow = action({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.object({ newSlug: v.string() }),
  handler: async (ctx, args): Promise<{ newSlug: string }> => {
    const { orgSlug, userId, email } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );

    const source = await readWorkflowFile(orgSlug, args.workflowSlug);
    if (!source.ok) {
      throw new Error(`Cannot duplicate: ${source.message}`);
    }

    const parts = args.workflowSlug.split('/');
    const baseName = parts.pop() ?? args.workflowSlug;
    const folderPrefix = parts.length > 0 ? parts.join('/') + '/' : '';

    const dir = resolveWorkflowsDir(orgSlug);
    const targetDir = folderPrefix.length > 0 ? path.join(dir, ...parts) : dir;
    const existingFiles = await readdirSafe(targetDir);
    const existingNames = new Set(
      existingFiles
        .filter((e) => e.endsWith('.json'))
        .map((e) => e.replace(/\.json$/, '')),
    );

    let newBaseName = `${baseName}-copy`;
    let counter = 2;
    while (existingNames.has(newBaseName)) {
      newBaseName = `${baseName}-copy-${counter}`;
      counter++;
    }

    const newSlug = `${folderPrefix}${newBaseName}`;
    // The copy's identity is its new slug — a workflow carries no name.
    const newConfig: WorkflowJsonConfig = { ...source.config };

    const content = serializeWorkflowJson(newConfig);
    const filePath = resolveWorkflowFilePath(orgSlug, newSlug);
    await atomicWrite(filePath, content);

    await ctx.runMutation(internal.workflows.installations.upsertInstallation, {
      organizationId: args.organizationId,
      workflowSlug: newSlug,
      installedBy: email !== '' ? email : userId,
      contentHash: sha256(content),
    });

    return { newSlug };
  },
});

export const renameWorkflow = action({
  args: {
    organizationId: v.string(),
    oldSlug: v.string(),
    newSlug: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );

    if (!validateWorkflowSlug(args.oldSlug)) {
      throw new Error(`Invalid old slug: ${args.oldSlug}`);
    }
    if (!validateWorkflowSlug(args.newSlug)) {
      throw new Error(`Invalid new slug: ${args.newSlug}`);
    }

    const oldPath = resolveWorkflowFilePath(orgSlug, args.oldSlug);
    const newPath = resolveWorkflowFilePath(orgSlug, args.newSlug);
    const baseDir = resolveWorkflowsDir(orgSlug);

    await verifyPathWithinBase(oldPath, baseDir);
    await verifyPathWithinBase(newPath, baseDir);

    const content = await readFileSafe(oldPath);
    if (!content) throw new Error('Workflow not found');
    parseWorkflowJson(content);

    // Refuse to clobber an existing target. `atomicWrite` resolves to a
    // rename-from-temp under the hood, which silently overwrites — without
    // this guard, two concurrent renames or a typo could destroy the target
    // workflow's content with no way to recover.
    const targetExists = await stat(newPath).then(
      () => true,
      (err) => {
        if (errnoCode(err) === 'ENOENT') return false;
        throw err;
      },
    );
    if (targetExists) {
      throw new ConvexError({
        code: 'DUPLICATE_NAME',
        message: `Target workflow already exists: ${args.newSlug}`,
      });
    }

    await mkdir(path.dirname(newPath), { recursive: true });
    await atomicWrite(newPath, content);
    await unlink(oldPath);

    const oldHistoryDir = resolveHistoryDir(orgSlug, args.oldSlug);
    const newHistoryDir = resolveHistoryDir(orgSlug, args.newSlug);
    try {
      await mkdir(path.dirname(newHistoryDir), { recursive: true });
      const { rename: fsRename } = await import('node:fs/promises');
      await fsRename(oldHistoryDir, newHistoryDir);
    } catch (err) {
      console.warn('[renameWorkflow] history move failed', err);
    }

    const existingInstallation = await ctx.runQuery(
      internal.workflows.installations.getInstallationInternal,
      {
        organizationId: args.organizationId,
        workflowSlug: args.oldSlug,
      },
    );
    if (existingInstallation) {
      await ctx.runMutation(
        internal.workflows.installations.deleteInstallation,
        {
          organizationId: args.organizationId,
          workflowSlug: args.oldSlug,
        },
      );
      await ctx.runMutation(
        internal.workflows.installations.upsertInstallation,
        {
          organizationId: args.organizationId,
          workflowSlug: args.newSlug,
          installedBy: existingInstallation.installedBy,
          contentHash: existingInstallation.contentHash,
        },
      );
    }

    return null;
  },
});

export const listHistory = action({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );

    if (!validateWorkflowSlug(args.workflowSlug)) {
      throw new Error(`Invalid workflow slug: ${args.workflowSlug}`);
    }

    const historyDir = resolveHistoryDir(orgSlug, args.workflowSlug);
    const entries = await readdirSafe(historyDir);

    return entries
      .filter((e) => e.endsWith('.json'))
      .map((e) => {
        const ts = e.replace('.json', '');
        const numericPart = ts.split('-')[0];
        return {
          timestamp: ts,
          date: new Date(Number(numericPart)).toISOString(),
        };
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  },
});

export const readHistoryEntry = action({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    timestamp: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );

    if (!validateWorkflowSlug(args.workflowSlug)) {
      throw new Error(`Invalid workflow slug: ${args.workflowSlug}`);
    }
    if (!validateHistoryTimestamp(args.timestamp)) {
      throw new Error(`Invalid history timestamp: ${args.timestamp}`);
    }

    const historyDir = resolveHistoryDir(orgSlug, args.workflowSlug);
    const filePath = safeJoinWithinDir(historyDir, `${args.timestamp}.json`);

    const content = await readFileSafe(filePath);
    if (!content) {
      return {
        ok: false,
        message: `History entry not found: ${args.timestamp}`,
      };
    }
    try {
      return { ok: true, config: parseWorkflowJson(content) };
    } catch (err) {
      return {
        ok: false,
        message: `Corrupted history entry: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

export const restoreFromHistory = action({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    timestamp: v.string(),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );

    if (!validateWorkflowSlug(args.workflowSlug)) {
      throw new Error(`Invalid workflow slug: ${args.workflowSlug}`);
    }
    if (!validateHistoryTimestamp(args.timestamp)) {
      throw new Error(`Invalid history timestamp: ${args.timestamp}`);
    }

    const historyDir = resolveHistoryDir(orgSlug, args.workflowSlug);
    const historyPath = safeJoinWithinDir(historyDir, `${args.timestamp}.json`);

    const historyContent = await readFileSafe(historyPath);
    if (!historyContent) throw new Error('History entry not found');
    const restored = parseWorkflowJson(historyContent);

    // Snapshot current state before overwriting (inline or file, via the store).
    const currentContent = await readCurrentWorkflowContent(
      orgSlug,
      args.workflowSlug,
    );

    // Write the restored version to its home (automation.json field or file).
    // `trustPair`: a history revision is a once-consistent spec/graph pair
    // restored wholesale — never re-stamp it against the pre-restore state.
    await writeWorkflowDefinition(orgSlug, args.workflowSlug, restored, {
      trustPair: true,
    });

    // Snapshot the previous state (best-effort)
    if (currentContent) {
      await mkdir(historyDir, { recursive: true });
      const ts = generateHistoryTimestamp();
      await atomicWrite(path.join(historyDir, `${ts}.json`), currentContent);
      await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);
    }

    return { hash: sha256(historyContent) };
  },
});

// ---------------------------------------------------------------------------
// Internal actions (for engine and agent tools — no auth check)
// ---------------------------------------------------------------------------

export const saveWorkflowForExecution = internalAction({
  args: {
    orgSlug: v.string(),
    workflowSlug: v.string(),
    config: v.any(),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (_ctx, args): Promise<{ hash: string }> => {
    if (!validateWorkflowSlug(args.workflowSlug)) {
      throw new Error(`Invalid workflow slug: ${args.workflowSlug}`);
    }

    const parsed = workflowJsonSchema.parse(args.config);

    const currentContent = await readCurrentWorkflowContent(
      args.orgSlug,
      args.workflowSlug,
    );

    // Same reconcile-then-hash contract as `saveWorkflowWithSnapshot`.
    const config = reconcileSpecificationMeta(
      currentContent ? parseWorkflowJson(currentContent) : undefined,
      parsed,
      Date.now(),
    );
    const newContent = serializeWorkflowJson(config);

    if (currentContent) {
      const historyDir = resolveHistoryDir(args.orgSlug, args.workflowSlug);
      await mkdir(historyDir, { recursive: true });
      const timestamp = generateHistoryTimestamp();
      await atomicWrite(
        path.join(historyDir, `${timestamp}.json`),
        currentContent,
      );
      await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);
    }

    // Inline-owned → its `automation.json` `workflow` field; standalone → its
    // file (created, parent dirs and all, by `writeWorkflowDefinition`).
    await writeWorkflowDefinition(args.orgSlug, args.workflowSlug, config, {
      trustPair: true,
    });

    return { hash: sha256(newContent) };
  },
});

export const readWorkflowForExecution = internalAction({
  args: {
    orgSlug: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.any(),
  handler: async (_ctx, args): Promise<WorkflowReadResult> => {
    return readWorkflowFile(args.orgSlug, args.workflowSlug);
  },
});

export const listWorkflowsForAgent = internalAction({
  args: {
    orgSlug: v.string(),
    organizationId: v.string(),
  },
  returns: v.any(),
  // oxlint-disable-next-line typescript/no-explicit-any -- v.any() at API boundary
  handler: async (ctx, args): Promise<any[]> => {
    const dir = resolveWorkflowsDir(args.orgSlug);
    let raw;
    try {
      raw = await readdir(dir, { recursive: true, withFileTypes: true });
    } catch (err) {
      handleDirReadError(err, 'workflows.listWorkflowsForAgent');
      return [];
    }

    const jsonFiles = raw.filter(
      (e) =>
        !e.isDirectory() &&
        e.name.endsWith('.json') &&
        !e.name.startsWith('.') &&
        !(e.parentPath ?? '').includes('.history'),
    );

    const installedRaw: string[] = await ctx.runQuery(
      internal.workflows.installations.listInstalledSlugs,
      { organizationId: args.organizationId },
    );
    const installedSlugs = new Set<string>(installedRaw);

    const results = await Promise.all(
      jsonFiles.map(async (entry) => {
        const parentPath = entry.parentPath ?? '';
        const relativePath = path
          .relative(dir, path.join(parentPath, entry.name))
          .replace(/\\/g, '/');
        const slug = workflowSlugFromRelativePath(relativePath);

        if (!validateWorkflowSlug(slug)) return null;
        if (!installedSlugs.has(slug)) return null;

        const result = await readWorkflowFile(args.orgSlug, slug);
        if (result.ok) {
          return {
            slug,
            name: slug,
            description: specificationSummary(result.config),
            stepCount: result.config.steps.length,
          };
        }
        return null;
      }),
    );

    return results.filter(Boolean);
  },
});
