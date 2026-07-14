'use node';

/**
 * Workflow definition I/O actions.
 *
 * All workflow reads/writes go through these actions, and every one of them
 * routes through `definition_store.ts`: a workflow lives ONLY inline in its
 * automation's `automation.json` (`workflow` field; workflowSlug === automation
 * slug). Writes rewrite the manifest atomically (temp → fsync → rename).
 * History snapshots live in the automation's own dir
 * (`automations/<slug>/.history/`, epoch-ms filenames, 100-entry retention).
 * Supports compare-and-swap via expectedHash to prevent lost updates.
 *
 * Install/uninstall/duplicate/rename verbs live on the AUTOMATION lifecycle
 * (`automations/install_actions.ts`), not here — the standalone-workflow verbs
 * this module once carried are gone with the standalone files themselves.
 */

import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { ConvexError, v } from 'convex/values';

import { isValidAutomationSlug } from '../../lib/shared/schemas/automations';
import type { WorkflowJsonConfig } from '../../lib/shared/schemas/workflows';
import { workflowJsonSchema } from '../../lib/shared/schemas/workflows';
import { internal } from '../_generated/api';
import { action, internalAction } from '../_generated/server';
import {
  type InstalledAutomationDisplay,
  readInstalledAutomationDisplays,
  readInstalledAutomationFolders,
  resolveAutomationWorkflowHistoryDir,
} from '../automations/file_utils';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import {
  atomicWrite,
  generateHistoryTimestamp,
  pruneHistory,
  readFileSafe,
  readdirSafe,
  safeJoinWithinDir,
  sha256,
} from '../lib/file_io';
import {
  type InlineWorkflowOwner,
  readCurrentWorkflowContent,
  readWorkflowDefinition,
  resolveInlineWorkflowOwner,
  writeWorkflowDefinition,
} from './definition_store';
import type { WorkflowReadResult } from './file_utils';
import {
  MAX_HISTORY_ENTRIES,
  parseWorkflowJson,
  serializeWorkflowJson,
  validateWorkflowSlug,
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
  // Inline-only: served from the owning automation's `automation.json`
  // `workflow` field — see `definition_store.ts`.
  return readWorkflowDefinition(orgSlug, workflowSlug);
}

/**
 * Best-effort "created at" for a workflow.
 *
 * Saves rewrite `automation.json` via atomic temp+rename, so the manifest's
 * birthtime resets on every save. The oldest history snapshot's epoch-ms
 * filename is the earliest preserved revision, which is the closest signal to
 * "first save". If no history exists yet, the manifest install is the origin —
 * fall back to its birthtime (or mtime where birthtime is unavailable).
 */
async function resolveCreatedAtMs(
  orgSlug: string,
  workflowSlug: string,
  manifestPath: string,
): Promise<number | undefined> {
  const historyDir = resolveAutomationWorkflowHistoryDir(orgSlug, workflowSlug);
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
    const s = await stat(manifestPath);
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
 * icon chips on its list card. Reads `requires.integrations[].name` when
 * present, then falls back to integration-type step parameters. Template
 * placeholders like `{{integrationName}}` are skipped — they don't pin to a
 * specific brand. A workflow with no third-party integration surfaces the
 * Tale brand so its card still shows an icon chip.
 */
function extractWorkflowIntegrations(config: WorkflowJsonConfig): string[] {
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

  if (found.size === 0) found.add('tale');

  return [...found];
}

/**
 * Enumerate the org's workflows: every INSTALLED automation whose org
 * `automation.json` carries an inline `workflow` contributes exactly one
 * (slug = automation slug). The shared core of `listWorkflows` and
 * `listWorkflowsForAgent`. Only installed automations count: uploaded private
 * bundles also live on disk before install (and stay after uninstall), so a
 * disk scan would surface never-installed workflows (#2564 class). Automations
 * with no inline workflow (bundles, view-only ones) — and unreadable
 * manifests — are skipped.
 */
async function enumerateInstalledInlineWorkflows(
  ctx: { runQuery: (ref: never, args: never) => Promise<unknown> },
  organizationId: string,
  orgSlug: string,
): Promise<{ slug: string; owner: InlineWorkflowOwner }[]> {
  const automationSlugs = (await ctx.runQuery(
    internal.automations.install_mutations
      .listAutomationInstallationsInternal as never,
    { organizationId } as never,
  )) as string[];
  const entries = await Promise.all(
    automationSlugs.map(async (slug) => {
      const owner = await resolveInlineWorkflowOwner(orgSlug, slug);
      return owner ? [{ slug, owner }] : [];
    }),
  );
  return entries.flat();
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
    // Accepted for client compatibility and IGNORED: with inline-only
    // workflows every listed entry belongs to an installed automation, so the
    // listing is always the "installed" set and standalone templates no
    // longer exist.
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

    const installedRaw: string[] = await ctx.runQuery(
      internal.workflows.installations.listInstalledSlugs,
      { organizationId: args.organizationId },
    );
    const installedSlugs = new Set<string>(installedRaw);

    // Project one inline workflow to its list item. Every entry is
    // automation-owned: it carries the owning automation's slug, its display
    // `folder`, and — when `automationDisplay` resolved — the automation's
    // self-translated `automationName`/`automationDescription`/`automationI18n`,
    // so a binding picker can show the AUTOMATION's identity instead of the
    // workflow's own slug-derived one.
    const projectWorkflow = async (
      slug: string,
      owner: InlineWorkflowOwner,
      folder?: string,
      automationDisplay?: InstalledAutomationDisplay,
    ) => {
      if (!validateWorkflowSlug(slug)) return null;
      const ownerTag = {
        automationSlug: slug,
        folder: folder ?? slug,
        ...(automationDisplay && {
          automationName: automationDisplay.name,
          automationDescription: automationDisplay.description,
          automationI18n: automationDisplay.i18n,
        }),
      };
      const result = await readWorkflowFile(orgSlug, slug);
      if (!result.ok) {
        return {
          slug,
          status: result.error,
          message: result.message,
          ...ownerTag,
        };
      }
      const createdAtMs = await resolveCreatedAtMs(
        orgSlug,
        slug,
        owner.manifestPath,
      );
      const integrations = extractWorkflowIntegrations(result.config);
      return {
        slug,
        name: slug,
        description: specificationSummary(result.config),
        installed: installedSlugs.has(slug),
        version: result.config.version,
        stepCount: result.config.steps.length,
        integrations,
        hash: result.hash,
        createdAtMs,
        ...ownerTag,
      };
    };

    const inline = await enumerateInstalledInlineWorkflows(
      ctx as never,
      args.organizationId,
      orgSlug,
    );
    const slugs = inline.map((e) => e.slug);
    const appFolders = await readInstalledAutomationFolders(orgSlug, slugs);
    const appDisplays = await readInstalledAutomationDisplays(orgSlug, slugs);

    const results = await Promise.all(
      inline.map(({ slug, owner }) =>
        projectWorkflow(
          slug,
          owner,
          appFolders.get(slug),
          appDisplays.get(slug),
        ),
      ),
    );

    return results.filter(Boolean);
  },
});

/**
 * Save a workflow with an atomic snapshot-then-write operation.
 *
 * The write lands in the owning automation's `automation.json` `workflow`
 * field; a slug with no inline owner is refused (a workflow is created by
 * creating an automation, never by saving to a bare slug). `isNew` keeps the
 * create-collision contract for API compatibility: it refuses to clobber an
 * existing slug and throws `DUPLICATE_NAME` instead. Edits (the default)
 * overwrite in place after snapshotting the prior revision to
 * `automations/<slug>/.history/`. Optionally performs compare-and-swap via
 * `expectedHash`.
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
    // `definition_store` — the owning automation's `automation.json`
    // `workflow` field.
    const currentContent = await readCurrentWorkflowContent(
      orgSlug,
      args.workflowSlug,
    );

    // A create must not overwrite an existing workflow. `isNew` and
    // `expectedHash` are mutually exclusive intents (create vs.
    // compare-and-swap an existing definition), so check it first.
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
      const historyDir = resolveAutomationWorkflowHistoryDir(
        orgSlug,
        args.workflowSlug,
      );
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
    // History lives in the owning automation's dir; a slug that can't name an
    // automation (e.g. a historical foldered one) simply has none.
    if (!isValidAutomationSlug(args.workflowSlug)) return [];

    const historyDir = resolveAutomationWorkflowHistoryDir(
      orgSlug,
      args.workflowSlug,
    );
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
    // See `listHistory`: no automation, no history.
    if (!isValidAutomationSlug(args.workflowSlug)) {
      return {
        ok: false,
        message: `History entry not found: ${args.timestamp}`,
      };
    }

    const historyDir = resolveAutomationWorkflowHistoryDir(
      orgSlug,
      args.workflowSlug,
    );
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
    // See `listHistory`: no automation, no history.
    if (!isValidAutomationSlug(args.workflowSlug)) {
      throw new Error('History entry not found');
    }

    const historyDir = resolveAutomationWorkflowHistoryDir(
      orgSlug,
      args.workflowSlug,
    );
    const historyPath = safeJoinWithinDir(historyDir, `${args.timestamp}.json`);

    const historyContent = await readFileSafe(historyPath);
    if (!historyContent) throw new Error('History entry not found');
    const restored = parseWorkflowJson(historyContent);

    // Snapshot current state before overwriting (read through the store).
    const currentContent = await readCurrentWorkflowContent(
      orgSlug,
      args.workflowSlug,
    );

    // Write the restored version into the automation manifest. `trustPair`: a
    // history revision is a once-consistent spec/graph pair restored wholesale
    // — never re-stamp it against the pre-restore state.
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
      const historyDir = resolveAutomationWorkflowHistoryDir(
        args.orgSlug,
        args.workflowSlug,
      );
      await mkdir(historyDir, { recursive: true });
      const timestamp = generateHistoryTimestamp();
      await atomicWrite(
        path.join(historyDir, `${timestamp}.json`),
        currentContent,
      );
      await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);
    }

    // Lands in the owning automation's `automation.json` `workflow` field;
    // refused (clear error) when no automation owns the slug.
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
    // Same enumeration as `listWorkflows` (installed automations' inline
    // workflows), projected to the compact summary the agent tools read.
    const inline = await enumerateInstalledInlineWorkflows(
      ctx as never,
      args.organizationId,
      args.orgSlug,
    );
    return inline.map(({ slug, owner }) => ({
      slug,
      name: slug,
      description: specificationSummary(owner.workflow),
      stepCount: owner.workflow.steps.length,
    }));
  },
});
