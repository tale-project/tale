import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * One row per installed app per org — the ORG-LEVEL resource ledger. An app is
 * installed by COPYING its bundle's resources (agents/workflows/integration-defs)
 * from the template catalog into the org's config dirs; this row is the
 * activation record + the copied-file ledger that powers integrity checks
 * (missing file → status 'broken' → reinstall) and a clean uninstall (remove
 * exactly what was copied). Mirrors `wfInstallations`. Secrets are NEVER part of
 * an app install — the per-org credential (e.g. a GitHub token) lives in
 * `integrationCredentials`.
 *
 * Project membership for a `scope: 'project'` app lives in the separate
 * `appProjectBindings` junction (one row per bound project), NOT here: this row
 * is shared by every project the app is bound to. Resources, `status`, and
 * `appName` are therefore org-level and read through to the binding.
 */
export const appInstallationsTable = defineTable({
  organizationId: v.string(),
  appSlug: v.string(),
  /**
   * Denormalized app display name (from the manifest at install) — lets the
   * in-project nav render a labelled tab from a cheap reactive query without an
   * FS manifest read. Refreshed on reinstall. Absent on legacy rows.
   */
  appName: v.optional(v.string()),
  installedAt: v.number(),
  installedBy: v.string(),
  /** 'active' = all copied resources present; 'broken' = a copied file is gone. */
  status: v.union(v.literal('active'), v.literal('broken')),
  /**
   * Transient teardown lock. Set true by `uninstallApp` once it has confirmed 0
   * bindings, before the (non-transactional) filesystem teardown; `bindAppToProject`
   * refuses while it is true so a racing "add to project" can't resurrect an app
   * mid-uninstall. Cleared only by deleting the row at the end of teardown.
   */
  uninstalling: v.optional(v.boolean()),
  /**
   * Integration slugs the app requires connected (denormalized from the
   * manifest's `requires.integrations` at install) so the readiness query stays
   * DB-only + reactive — no manifest re-read to compute the setup checklist.
   */
  requiredIntegrations: v.array(v.string()),
  /**
   * The copied-file ledger: one entry per file materialized into the org. `path`
   * is relative to the domain dir (e.g. agents → 'desk-coordinator.json';
   * workflows → 'issue-desk/desk-process.json'). Drives uninstall + integrity.
   */
  resources: v.array(
    v.object({
      domain: v.string(),
      path: v.string(),
      contentHash: v.string(),
    }),
  ),
})
  .index('by_org', ['organizationId'])
  .index('by_org_slug', ['organizationId', 'appSlug']);

/**
 * One row per (org, appSlug, project): a `scope: 'project'` app's membership in a
 * project. Drives the in-project nav tab and the project-delete guard; the app's
 * shared org resources live once on `appInstallations`. A binding exists only
 * while the org install row exists (enforced in `bindAppToProject`), and removing
 * a binding never touches shared resources (that is `uninstallApp`'s job, and it
 * is refused while any binding remains).
 */
export const appProjectBindingsTable = defineTable({
  organizationId: v.string(),
  appSlug: v.string(),
  projectId: v.id('projects'),
  boundAt: v.number(),
  boundBy: v.string(),
})
  // listProjectApps (nav strip) + the project-delete guard.
  .index('by_project', ['projectId'])
  // Prefix-queried for all bindings of (org, appSlug) — uninstall guard,
  // listAppBindings — and for the exact-row idempotent bind / unbind.
  .index('by_org_slug_project', ['organizationId', 'appSlug', 'projectId']);
