import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * One row per installed automation per org — the ORG-LEVEL resource ledger. An
 * automation is installed by COPYING its bundle's resources
 * (agents/workflows/integration-defs) from the template catalog into the org's
 * config dirs; this row is the activation record + the copied-file ledger that
 * powers integrity checks (missing file → status 'broken' → reinstall) and a
 * clean uninstall (remove exactly what was copied). Mirrors `wfInstallations`.
 * Secrets are NEVER part of an automation install — the per-org credential
 * (e.g. a GitHub token) lives in `integrationCredentials`.
 *
 * Project membership for a `scope: 'project'` automation lives in the separate
 * `automationProjectBindings` junction (one row per bound project), NOT here:
 * this row is shared by every project the automation is bound to. Resources,
 * `status`, and `automationName` are therefore org-level and read through to
 * the binding.
 */
export const automationInstallationsTable = defineTable({
  organizationId: v.string(),
  automationSlug: v.string(),
  /**
   * Denormalized automation display name (from the manifest at install) — lets
   * the in-project nav render a labelled tab from a cheap reactive query
   * without an FS manifest read. Refreshed on reinstall. Absent on legacy rows.
   */
  automationName: v.optional(v.string()),
  installedAt: v.number(),
  installedBy: v.string(),
  /** 'active' = all copied resources present; 'broken' = a copied file is gone. */
  status: v.union(v.literal('active'), v.literal('broken')),
  /**
   * Transient teardown lock. Set true by `uninstallAutomation` once it has confirmed 0
   * bindings, before the (non-transactional) filesystem teardown;
   * `bindAutomationToProject` refuses while it is true so a racing "add to
   * project" can't resurrect an automation mid-uninstall. Cleared only by
   * deleting the row at the end of teardown.
   */
  uninstalling: v.optional(v.boolean()),
  /**
   * Integration slugs the automation requires connected (denormalized from the
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
      /**
       * The file existed before this automation claimed it (a pre-existing org
       * file the install would have overwritten) — uninstall leaves it in
       * place. Inherited across reinstalls; absent ⇒ automation-owned.
       */
      adopted: v.optional(v.boolean()),
    }),
  ),
})
  .index('by_org', ['organizationId'])
  .index('by_org_slug', ['organizationId', 'automationSlug']);

/**
 * One row per (org, automationSlug, project): a `scope: 'project'` automation's
 * membership in a project. Drives the in-project nav tab and the project-delete
 * guard; the automation's shared org resources live once on
 * `automationInstallations`. A binding exists only while the org install row
 * exists (enforced in `bindAutomationToProject`), and removing a binding never
 * touches shared resources (that is `uninstallAutomation`'s job, and it is
 * refused while any binding remains).
 */
export const automationProjectBindingsTable = defineTable({
  organizationId: v.string(),
  automationSlug: v.string(),
  projectId: v.id('projects'),
  boundAt: v.number(),
  boundBy: v.string(),
})
  // listProjectAutomations (project Automations list) + the project-delete guard.
  .index('by_project', ['projectId'])
  // Prefix-queried for all bindings of (org, automationSlug) — uninstall guard,
  // listAutomationBindings — and for the exact-row idempotent bind / unbind.
  .index('by_org_slug_project', [
    'organizationId',
    'automationSlug',
    'projectId',
  ]);

/**
 * Per-(organizationId, slug) exclusion lock for `uploadAutomationBundle` — the
 * private automation upload path. The upload does a stage-then-rename swap on disk;
 * two concurrent `force: true` uploads to the same slug would race past the
 * existence check and last-writer-wins, silently destroying one bundle. The
 * action inserts a claim row (uniqueness via the `by_org_slug` index +
 * pre-insert lookup that expires stale claims) before the rename pair and
 * deletes it in `finally` alongside the storage-blob cleanup. `expiresAt` lets
 * a crashed action's stale claim be reclaimed lazily on the next attempt — no
 * cron sweep. Mirrors `skillUploadClaims`.
 */
export const automationUploadClaimTable = defineTable({
  organizationId: v.string(),
  slug: v.string(),
  claimedAt: v.number(),
  expiresAt: v.number(),
}).index('by_org_slug', ['organizationId', 'slug']);

/**
 * Binds an `_storage` blob to the org + user that requested its upload URL,
 * for `uploadAutomationBundle`. Without this, the action would `ctx.storage.get` a
 * client-supplied id with no ownership verification — letting a caller in org
 * A point the server at org B's pending blob. Written by `generateAutomationUploadUrl`
 * at presign time, looked up by `uploadAutomationBundle`, deleted in the same
 * `finally` block as the storage blob. Mirrors `skillUploadIntents`.
 */
export const automationUploadIntentTable = defineTable({
  storageId: v.id('_storage'),
  organizationId: v.string(),
  userId: v.string(),
  createdAt: v.number(),
}).index('by_storageId', ['storageId']);
