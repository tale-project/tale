import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * One row per installed app per org. An app is installed by COPYING its bundle's
 * resources (agents/workflows/integration-defs) from the template catalog into
 * the org's config dirs; this row is the activation record + the copied-file
 * ledger that powers integrity checks (missing file → status 'broken' →
 * reinstall) and a clean uninstall (remove exactly what was copied). Mirrors
 * `wfInstallations`. Secrets are NEVER part of an app install — the per-org
 * credential (e.g. a GitHub token) lives in `integrationCredentials`.
 */
export const appInstallationsTable = defineTable({
  organizationId: v.string(),
  appSlug: v.string(),
  installedAt: v.number(),
  installedBy: v.string(),
  /** 'active' = all copied resources present; 'broken' = a copied file is gone. */
  status: v.union(v.literal('active'), v.literal('broken')),
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
