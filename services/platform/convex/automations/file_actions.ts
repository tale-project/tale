'use node';

/**
 * Automation discovery for the Automations catalog. Reads each `<slug>/` bundle's manifest
 * (`automation.json`) and its bundled `views/*.json` (the configurable pages).
 * Fully data-driven — a new automation dir appears in the hub with no code change. Malformed manifests
 * are skipped; a malformed VIEW becomes an `{ id, error }` stub in place (never
 * a silent drop, never a failed list) so the automation page can offer a repair.
 *
 * `hidden: true` manifests (a bundle's member automations — see
 * `automations.ts#automationManifestSchema`) never appear in `listAutomations`/`listCatalogAutomations`;
 * they install and run like any other automation, they are just never browsed or
 * installed standalone from the hub. `listCatalogAutomationsForAssistant` and
 * `getAutomationManifestForAssistant` are the exception (internal, assistant-tool
 * only): they see hidden manifests too.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { ConvexError, v } from 'convex/values';
import JSZip from 'jszip';

import {
  type AutomationManifest,
  MAX_AUTOMATION_BUNDLE_ENTRIES,
  MAX_AUTOMATION_BUNDLE_FILE_BYTES,
  MAX_AUTOMATION_BUNDLE_TOTAL_BYTES,
  automationManifestSchema,
  automationScope,
  type BundleManifest,
  bundleManifestSchema,
  isValidAutomationSlug,
  manifestDeclaresBundle,
} from '../../lib/shared/schemas/automations';
import { internal } from '../_generated/api';
import { action, internalAction } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import {
  atomicWrite,
  errnoCode,
  readFileBufferSafe,
  readFileSafe,
  serializeJson,
} from '../lib/file_io';
import { orgSlugFromId } from '../lib/helpers/org_slug';
import { requireDeveloperSettingsAccessById } from '../providers/auth';
import {
  isBundleDir,
  resolveAutomationDir,
  resolveAutomationsDir,
  resolveBundleManifestPath,
  resolveCatalogAutomationDir,
  resolveCatalogAutomationsDir,
  resolveManifestFilePath,
} from './file_utils';
import { readAutomationOrBundleManifest } from './install_fs';
import { parseAutomationView, viewIdFromFilename } from './view_parse';

const MAX_VIEW_BYTES = 256 * 1024;

/** One dir entry's parsed manifest + bundled icon, before display projection. */
interface CatalogRow {
  slug: string;
  manifest: AutomationManifest | BundleManifest;
  iconUrl?: string;
}

/**
 * Enumerate the valid automation-slug subdirs of `dir` and parse each one's
 * manifest: a BUNDLE (`bundle.json`) via the strict `bundleManifestSchema`, an
 * ordinary automation (`automation.json`) via `automationManifestSchema`.
 * Reads its bundled `icon.svg` as a data URI.
 * Malformed manifests are skipped with a console warning (never fail the whole
 * list — the discovery posture); a missing `dir` yields an empty list.
 * `includeHidden` controls whether a `hidden: true` automation (a bundle
 * member) is kept — false for every hub-facing list, true only for the
 * assistant's read. A bundle is never hidden.
 */
async function collectCatalogRows(
  dir: string,
  opts: {
    includeHidden: boolean;
    label: string;
  },
): Promise<CatalogRow[]> {
  let slugs: string[];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    slugs = entries
      .filter((e) => e.isDirectory() && isValidAutomationSlug(e.name))
      .map((e) => e.name);
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') return [];
    throw err;
  }

  const rows: CatalogRow[] = [];
  for (const slug of slugs.sort()) {
    const slugDir = path.join(dir, slug);
    let manifest: AutomationManifest | BundleManifest;
    try {
      if (isBundleDir(slugDir)) {
        const content = await readFile(
          resolveBundleManifestPath(slugDir),
          'utf8',
        );
        manifest = bundleManifestSchema.parse(JSON.parse(content));
      } else {
        const content = await readFile(
          resolveManifestFilePath(slugDir),
          'utf8',
        );
        manifest = automationManifestSchema.parse(JSON.parse(content));
      }
    } catch (err) {
      console.warn(`[${opts.label}] skipping automation "${slug}":`, err);
      continue;
    }
    if (
      !manifestDeclaresBundle(manifest) &&
      manifest.hidden === true &&
      !opts.includeHidden
    ) {
      continue;
    }

    const iconContent = await readFileSafe(path.join(slugDir, 'icon.svg'));
    const iconUrl =
      iconContent &&
      Buffer.byteLength(iconContent) <= MAX_AUTOMATION_BUNDLE_FILE_BYTES
        ? `data:image/svg+xml;base64,${Buffer.from(iconContent).toString('base64')}`
        : undefined;
    rows.push({ slug, manifest, ...(iconUrl !== undefined && { iconUrl }) });
  }
  return rows;
}

/**
 * Project a parsed manifest to the catalog summary shape every list-ish
 * caller shares (`listAutomations`, `listCatalogAutomations`, and the assistant's
 * `automation_search` tool). `kind` is `'bundle'` when the manifest declares
 * `bundle.members` — installing it installs each member through one
 * aggregated wizard (see `install_bundle_actions.ts`) — `'automation'`
 * otherwise. Callers layer their own extra fields (`roles` + per-install
 * `views` for `listAutomations`; an empty `views` for the pre-install catalog).
 */
function buildCatalogEntry(
  manifest: AutomationManifest | BundleManifest,
  slug: string,
  iconUrl: string | undefined,
): Record<string, unknown> {
  const base = {
    slug,
    name: manifest.name,
    description: manifest.description ?? '',
    // A bundle member never gets its own catalog CARD (the grids filter on
    // this) but its detail page — the workflow settings — must resolve.
    ...(!manifestDeclaresBundle(manifest) &&
      manifest.hidden === true && { hidden: true }),
    // Per-locale display overrides — the manifest translates itself; the
    // client resolves via `resolve-automation-locale.ts`.
    ...(manifest.i18n !== undefined && { i18n: manifest.i18n }),
    scope: automationScope(manifest),
    ...(manifest.icon !== undefined && { icon: manifest.icon }),
    ...(iconUrl !== undefined && { iconUrl }),
    // Display folder ('/'-separated) — the hub groups its catalog sections
    // by this, same as the agents/workflows folder-grouped lists.
    ...(manifest.folder !== undefined && { folder: manifest.folder }),
    // Catalog chips (literal display strings, e.g. "GitHub") — rendered on
    // the hub card and the automation details header, before install.
    ...(manifest.labels !== undefined && { labels: manifest.labels }),
  };

  // A BUNDLE installs its members through one aggregated wizard and does
  // nothing itself — no workflows/agents/skills/functions/integrations of
  // its own. `members` is the declared install order.
  if (manifestDeclaresBundle(manifest)) {
    return {
      ...base,
      kind: 'bundle',
      members: manifest.bundle.members,
      workflows: [],
      agents: [],
      skills: [],
      functions: [],
      requiredIntegrations: [],
    };
  }

  return {
    ...base,
    kind: 'automation',
    // The automation's single inline workflow surfaces as `[slug]` (its slug IS
    // the automation slug); a view-only automation has none.
    workflows: manifest.workflow ? [slug] : [],
    agents: manifest.agents ?? [],
    skills: manifest.skills ?? [],
    functions: manifest.capabilities?.functions ?? [],
    // Platform-rendered views the manifest opts into — the client registry
    // (`builtin-views/registry.tsx`) renders them before any JSON views.
    ...(manifest.builtinViews !== undefined && {
      builtinViews: manifest.builtinViews,
    }),
    // Declared integration dependencies — lets the hub know, before install,
    // whether to route through the connect wizard. Pure projection of the
    // already-parsed manifest; the same list is denormalized onto the
    // install record (`automationInstallations.requiredIntegrations`).
    requiredIntegrations: manifest.requires?.integrations ?? [],
  };
}

export const listAutomations = action({
  args: { organizationId: v.string() },
  returns: v.any(),
  // oxlint-disable-next-line typescript/no-explicit-any -- heterogeneous automation/view shapes at the API boundary
  handler: async (ctx, args): Promise<any[]> => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );

    // Installed HIDDEN automations (a bundle's members) stay in this payload,
    // tagged `hidden` — their detail pages (the workflow settings) must
    // resolve; only the hub's card grid filters them out.
    const rows = await collectCatalogRows(resolveAutomationsDir(orgSlug), {
      includeHidden: true,
      label: 'listAutomations',
    });

    const automations: Array<Record<string, unknown>> = [];
    for (const { slug, manifest, iconUrl } of rows) {
      const views: unknown[] = [];
      const viewsDir = path.join(resolveAutomationDir(orgSlug, slug), 'views');
      let viewFiles: string[] = [];
      try {
        viewFiles = (await readdir(viewsDir)).filter((f) =>
          f.endsWith('.json'),
        );
      } catch {
        // No views dir — an automation can ship workflows/agents without UI pages.
      }
      for (const file of viewFiles.sort()) {
        const filePath = path.join(viewsDir, file);
        try {
          const info = await stat(filePath);
          if (info.size > MAX_VIEW_BYTES) {
            console.warn(`[listAutomations] view too large: ${filePath}`);
            views.push({
              id: viewIdFromFilename(file),
              error: {
                code: 'INVALID_VIEW',
                message: `${file} exceeds the ${MAX_VIEW_BYTES}-byte view cap`,
              },
            });
            continue;
          }
          // Strict parse, shared with the publish gate. A pre-enforcement view
          // that no longer parses surfaces as an `{ id, error }` stub in place
          // — the automation page renders a repair affordance, valid views still work.
          const result = parseAutomationView(
            file,
            await readFile(filePath, 'utf8'),
          );
          if (result.ok) {
            views.push(result.view);
          } else {
            console.warn(
              `[listAutomations] invalid view ${file}:`,
              result.error.message,
            );
            views.push({ id: result.id, error: result.error });
          }
        } catch (err) {
          console.warn(`[listAutomations] view read failed ${file}:`, err);
          views.push({
            id: viewIdFromFilename(file),
            error: {
              code: 'INVALID_VIEW',
              message: `${file} could not be read`,
            },
          });
        }
      }

      automations.push({
        ...buildCatalogEntry(manifest, slug, iconUrl),
        // role token -> composite agent slug (the automation's cast) — AgentChat
        // blocks resolve their `role` through this map. A bundle has no cast.
        roles: manifestDeclaresBundle(manifest) ? {} : (manifest.roles ?? {}),
        views,
      });
    }

    return automations;
  },
});

/**
 * The built-in automation CATALOG — every installable automation from `<builtin>/automations/<slug>`,
 * projected to the same summary shape as {@link listAutomations} (minus the per-install
 * `views`, which only materialize once an automation is copied into the org).
 *
 * This is the in-UI discovery source: the Automations catalog unions it with the org's
 * installed automations so a fresh org can browse and install from the catalog instead
 * of only ever seeing automations seeded out-of-band. Membership-gated; malformed
 * manifests are skipped (never fail the whole list); a missing catalog dir
 * yields an empty list.
 */
export const listCatalogAutomations = action({
  args: { organizationId: v.string() },
  returns: v.any(),
  // oxlint-disable-next-line typescript/no-explicit-any -- heterogeneous automation shapes at the API boundary
  handler: async (ctx, args): Promise<any[]> => {
    // Gate on org membership (discovery is an in-org action); the catalog itself
    // is org-independent, so we don't need the resolved slug.
    await requireOrgMembershipById(ctx, args.organizationId);

    const catalogDir = resolveCatalogAutomationsDir();
    const rows = await collectCatalogRows(catalogDir, {
      includeHidden: false,
      label: 'listCatalogAutomations',
    });

    const automations: Array<Record<string, unknown>> = [];
    for (const { slug, manifest, iconUrl } of rows) {
      automations.push({
        ...buildCatalogEntry(manifest, slug, iconUrl),
        // Catalog entries carry no view docs: views are bundled per-install
        // and only read off the org dir once the automation is copied in.
        views: [],
      });
    }
    return automations;
  },
});

/**
 * Name + description for explicit slugs, INCLUDING hidden — the bundle
 * catalog panel's "what's inside" read for a bundle whose members are
 * hidden (absent from `listAutomations`/`listCatalogAutomations`, so they carry no
 * projection there). Scoped to caller-supplied slugs only, never a full
 * hidden-catalog enumeration: safe because a bundle's own PUBLIC manifest
 * already discloses its members (`kind: 'bundle'` catalog entries carry
 * `members`), so resolving those exact slugs' name/description reveals
 * nothing the caller couldn't already see. Membership-gated only (same as
 * `listCatalogAutomations`) — no `developerSettings` capability needed to preview.
 * An unresolvable slug is skipped, never fails the batch.
 */
export const getAutomationSummariesBySlug = action({
  args: { organizationId: v.string(), slugs: v.array(v.string()) },
  returns: v.array(
    v.object({
      slug: v.string(),
      name: v.string(),
      description: v.string(),
      requiredIntegrations: v.array(v.string()),
    }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      slug: string;
      name: string;
      description: string;
      requiredIntegrations: string[];
    }>
  > => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    const out: Array<{
      slug: string;
      name: string;
      description: string;
      requiredIntegrations: string[];
    }> = [];
    for (const slug of args.slugs) {
      if (!isValidAutomationSlug(slug)) continue;
      const manifest = await readAutomationOrBundleManifest(
        orgSlug,
        slug,
      ).catch(() => null);
      if (!manifest) continue;
      out.push({
        slug,
        name: manifest.name,
        description: manifest.description ?? '',
        requiredIntegrations: manifestDeclaresBundle(manifest)
          ? []
          : (manifest.requires?.integrations ?? []),
      });
    }
    return out;
  },
});

/**
 * The catalog projection for the ASSISTANT's `automation_search` tool ONLY
 * (`convex/agent_tools/automations/automation_search_tool.ts`): unions the
 * org's installed automations with the built-in catalog (an org-installed entry wins
 * on a slug collision — the same precedence the hub computes client-side in
 * `useAutomations`/`useAutomationCatalog`) and, unlike `listAutomations`/
 * `listCatalogAutomations`, INCLUDES `hidden` manifests. A bundle's member
 * automations are exactly what the assistant needs to see so it can point a
 * user at (or extend) an existing one instead of authoring a duplicate.
 *
 * Internal: never exposed to the client. No membership gate — the calling
 * agent-tool context is already org-scoped/trusted (mirrors
 * `internal.workflows.file_actions.listWorkflowsForAgent`).
 */
export const listCatalogAutomationsForAssistant = internalAction({
  args: { organizationId: v.string() },
  returns: v.any(),
  // oxlint-disable-next-line typescript/no-explicit-any -- heterogeneous automation shapes at the API boundary
  handler: async (ctx, args): Promise<any[]> => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    const catalogDir = resolveCatalogAutomationsDir();

    const [catalogRows, orgRows] = await Promise.all([
      collectCatalogRows(catalogDir, {
        includeHidden: true,
        label: 'listCatalogAutomationsForAssistant',
      }),
      collectCatalogRows(resolveAutomationsDir(orgSlug), {
        includeHidden: true,
        label: 'listCatalogAutomationsForAssistant',
      }),
    ]);

    const bySlug = new Map(catalogRows.map((row) => [row.slug, row]));
    for (const row of orgRows) bySlug.set(row.slug, row);

    const automations: Array<Record<string, unknown>> = [];
    for (const { slug, manifest } of bySlug.values()) {
      // A bundle does nothing itself — no workflows/agents/skills/integrations
      // of its own; it only aggregates its members' installs.
      if (manifestDeclaresBundle(manifest)) {
        automations.push({
          slug,
          kind: 'bundle',
          name: manifest.name,
          description: manifest.description ?? '',
          hidden: false,
          folder: manifest.folder,
          labels: manifest.labels ?? [],
          requiredIntegrations: [],
          workflows: [],
          agents: [],
          skills: [],
          members: manifest.bundle.members,
        });
        continue;
      }
      automations.push({
        slug,
        kind: 'automation',
        name: manifest.name,
        description: manifest.description ?? '',
        hidden: manifest.hidden === true,
        folder: manifest.folder,
        labels: manifest.labels ?? [],
        requiredIntegrations: manifest.requires?.integrations ?? [],
        workflows: manifest.workflow ? [slug] : [],
        agents: manifest.agents ?? [],
        skills: manifest.skills ?? [],
      });
    }
    return automations;
  },
});

/**
 * The `automation_search` tool's `get` operation: the full parsed manifest
 * for one slug — a BUNDLE (`bundle.json`) or an automation (`automation.json`),
 * org-installed copy preferred over the built-in catalog (the same
 * `resolveAutomationBundleSourceDir` precedence the install path uses). Unlike
 * `listAutomations`/`listCatalogAutomations` this does NOT filter `hidden` — a
 * bundle member is exactly what the assistant may need the full definition of.
 * Returns `null` for an unknown/malformed slug rather than throwing, so a wrong
 * guess from the LLM surfaces as a normal "not found" tool result.
 */
export const getAutomationManifestForAssistant = internalAction({
  args: { organizationId: v.string(), slug: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (
    ctx,
    args,
  ): Promise<AutomationManifest | BundleManifest | null> => {
    if (!isValidAutomationSlug(args.slug)) return null;
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    return await readAutomationOrBundleManifest(orgSlug, args.slug).catch(
      () => null,
    );
  },
});

/**
 * Package an installed automation's on-disk bundle — its manifest
 * (`automation.json`, or a bundle's `bundle.json`) plus `icon.svg`, `views/`,
 * `messages/`, `scripts/`, and any app-scoped `agents/` — into a downloadable
 * `.zip`, returned base64-encoded. The inverse of `uploadAutomationBundle`:
 * reads bytes byte-for-byte so binary assets survive, and re-applies the bundle
 * entry/size caps so a hand-edited on-disk bundle can't produce an oversized
 * download. Gated on developer-settings access — the scripts and agent configs
 * it bundles are capability-bearing (matching `exportIntegration`).
 */
export const exportAutomation = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
  },
  returns: v.object({
    ok: v.literal(true),
    filename: v.string(),
    dataBase64: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true; filename: string; dataBase64: string }> => {
    if (!isValidAutomationSlug(args.slug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid automation slug: ${args.slug}`,
      });
    }
    const { orgSlug } = await requireDeveloperSettingsAccessById(
      ctx,
      args.organizationId,
    );

    // The org copy (installed / privately uploaded) wins; a not-yet-installed
    // catalog automation exports its built-in bundle instead — export is not
    // gated on installation.
    const automationDir = resolveAutomationDir(orgSlug, args.slug);
    let files = await walkAutomationBundle(automationDir);
    if (files.length === 0) {
      files = await walkAutomationBundle(
        resolveCatalogAutomationDir(args.slug),
      );
    }
    if (files.length === 0) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: `Automation "${args.slug}" does not exist`,
      });
    }
    if (files.length > MAX_AUTOMATION_BUNDLE_ENTRIES) {
      throw new ConvexError({
        code: 'BUNDLE_TOO_LARGE',
        message: `Bundle has too many entries (max ${MAX_AUTOMATION_BUNDLE_ENTRIES})`,
      });
    }

    const zip = new JSZip();
    let totalBytes = 0;
    for (const file of files) {
      const buf = await readFileBufferSafe(file.abs);
      // A file that vanished between walk and read is skipped, not fatal — the
      // export is best-effort over whatever is on disk at read time.
      if (buf === null) continue;
      if (buf.length > MAX_AUTOMATION_BUNDLE_FILE_BYTES) {
        throw new ConvexError({
          code: 'FILE_TOO_LARGE',
          message: `${file.rel} exceeds per-file cap of ${MAX_AUTOMATION_BUNDLE_FILE_BYTES} bytes`,
        });
      }
      totalBytes += buf.length;
      if (totalBytes > MAX_AUTOMATION_BUNDLE_TOTAL_BYTES) {
        throw new ConvexError({
          code: 'BUNDLE_TOO_LARGE',
          message: `Bundle exceeds ${MAX_AUTOMATION_BUNDLE_TOTAL_BYTES} bytes`,
        });
      }
      zip.file(file.rel, buf);
    }

    const dataBase64 = await zip.generateAsync({ type: 'base64' });
    return { ok: true as const, filename: `${args.slug}.zip`, dataBase64 };
  },
});

/**
 * Recursively list every regular file under an installed automation's bundle
 * dir, relative to the dir root (POSIX separators). Skips symlinks and dotfiles
 * (defense-in-depth, mirroring the skill bundle walker). Returns absolute +
 * relative paths so the caller reads bytes directly without re-joining.
 */
async function walkAutomationBundle(
  rootDir: string,
): Promise<Array<{ abs: string; rel: string; size: number }>> {
  const out: Array<{ abs: string; rel: string; size: number }> = [];
  async function walk(dir: string, relPrefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch((err) => {
      if (
        err instanceof Error &&
        (err as NodeJS.ErrnoException).code !== 'ENOENT'
      ) {
        console.warn('[walkAutomationBundle] readdir failed:', dir, err);
      }
      return [] as never[];
    });
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.isSymbolicLink()) continue;
      const abs = path.join(dir, e.name);
      const rel = relPrefix === '' ? e.name : `${relPrefix}/${e.name}`;
      if (e.isDirectory()) {
        await walk(abs, rel);
        continue;
      }
      if (!e.isFile()) continue;
      const st = await stat(abs).catch(() => null);
      if (!st) continue;
      out.push({ abs, rel, size: st.size });
    }
  }
  await walk(rootDir, '');
  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return out;
}

/**
 * Edit an installed automation's display identity — the manifest `name` +
 * `description`, the automation's ONLY user-facing strings (its inline
 * workflow carries none). Atomically rewrites the org manifest
 * (`automation.json`, or `bundle.json` for a bundle) preserving every other
 * field. The English literals are the edit target, so per-locale overrides of
 * the edited fields are dropped — a stale translation must never shadow a
 * manual rename; the rest of the `i18n` block survives. Also refreshes the
 * denormalized `automationInstallations.automationName` nav cache.
 */
export const updateAutomationIdentity = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (!isValidAutomationSlug(args.slug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid automation slug: ${args.slug}`,
      });
    }
    const { orgSlug } = await requireDeveloperSettingsAccessById(
      ctx,
      args.organizationId,
    );
    const name = args.name.trim();
    if (!name) {
      throw new ConvexError({
        code: 'INVALID_NAME',
        message: 'Automation name must not be empty',
      });
    }
    const description = args.description?.trim() || undefined;

    const manifestPath = resolveManifestFilePath(
      resolveAutomationDir(orgSlug, args.slug),
    );
    const content = await readFileSafe(manifestPath);
    if (content === null) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: `Automation "${args.slug}" does not exist`,
      });
    }
    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      throw new ConvexError({
        code: 'INVALID_MANIFEST',
        message: `Automation "${args.slug}" has an unparsable manifest`,
      });
    }
    if (typeof raw !== 'object' || raw === null) {
      throw new ConvexError({
        code: 'INVALID_MANIFEST',
        message: `Automation "${args.slug}" has an invalid manifest`,
      });
    }

    const next: Record<string, unknown> = {
      ...(raw as Record<string, unknown>),
      name,
    };
    if (description === undefined) {
      delete next.description;
    } else {
      next.description = description;
    }
    // Drop per-locale overrides of the two edited fields (see doc above).
    if (typeof next.i18n === 'object' && next.i18n !== null) {
      const i18n: Record<string, unknown> = {
        ...(next.i18n as Record<string, unknown>),
      };
      for (const [locale, entry] of Object.entries(i18n)) {
        if (typeof entry !== 'object' || entry === null) continue;
        const rest: Record<string, unknown> = {
          ...(entry as Record<string, unknown>),
        };
        delete rest.name;
        delete rest.description;
        if (Object.keys(rest).length === 0) {
          delete i18n[locale];
        } else {
          i18n[locale] = rest;
        }
      }
      if (Object.keys(i18n).length === 0) {
        delete next.i18n;
      } else {
        next.i18n = i18n;
      }
    }

    // Re-validate with the matching schema so a bad edit can never land.
    const schema =
      typeof next.bundle === 'object' && next.bundle !== null
        ? bundleManifestSchema
        : automationManifestSchema;
    const parsed = schema.safeParse(next);
    if (!parsed.success) {
      throw new ConvexError({
        code: 'INVALID_MANIFEST',
        message: `Edited manifest failed validation: ${parsed.error.message}`,
      });
    }

    await atomicWrite(manifestPath, serializeJson(next));
    await ctx.runMutation(
      internal.automations.install_mutations.patchAutomationName,
      {
        organizationId: args.organizationId,
        automationSlug: args.slug,
        automationName: name,
      },
    );
    return null;
  },
});
