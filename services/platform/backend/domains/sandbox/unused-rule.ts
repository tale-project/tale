import type { SandboxWorkspacesConfig } from '@tale/shared/schemas/governance';
import type { Sql, TransactionSql } from 'postgres';

/**
 * When an organization's unused-workspace rule (the `sandbox_workspaces`
 * policy), in its current form, took effect — `app.sandbox_workspace_retention`,
 * see migration 0145. The workspace cleanup deletes nothing for being unused
 * until a full window has passed since then, so the upgrade that brings the
 * cleanup, turning the rule on and shortening its window never take a
 * workspace nobody had the window to use or pin.
 *
 * Recorded where the rule changes — the policy's save — and by the hourly
 * sweep, which also catches a policy written some other way (a configuration
 * release, a file edit) and the upgrade itself.
 */

/**
 * Record the rule as it is now and answer when it took effect: stamped the
 * first time it is seen on, restamped by a shorter window, kept by a longer
 * one (waiting longer never needs a new notice), and forgotten while the rule
 * is off, so turning it back on starts a fresh window. `now` while it is off,
 * which retires nothing for being unused.
 */
export async function recordUnusedWorkspaceRule(
  sql: Sql | TransactionSql,
  organizationId: string,
  policy: SandboxWorkspacesConfig,
  now: number,
): Promise<number> {
  if (!policy.deleteUnused) {
    await sql`
      DELETE FROM app.sandbox_workspace_retention
      WHERE org_id = ${organizationId}
    `;
    return now;
  }
  const rows = await sql<{ since: number }[]>`
    INSERT INTO app.sandbox_workspace_retention AS r (
      org_id, unused_days, applies_since_ms
    ) VALUES (${organizationId}, ${policy.unusedDays}, ${now})
    ON CONFLICT (org_id) DO UPDATE SET
      applies_since_ms = CASE
        WHEN EXCLUDED.unused_days < r.unused_days THEN EXCLUDED.applies_since_ms
        ELSE r.applies_since_ms END,
      unused_days = EXCLUDED.unused_days
    RETURNING applies_since_ms::float8 AS since
  `;
  return rows[0]?.since ?? now;
}

/** When the rule took effect as {@link recordUnusedWorkspaceRule} would
 * answer it now, without recording anything — for a page that dates the
 * deletions the next sweep will make. */
export async function readUnusedRuleSince(
  sql: Sql | TransactionSql,
  organizationId: string,
  policy: SandboxWorkspacesConfig,
  now: number,
): Promise<number> {
  const rows = await sql<{ days: number; since: number }[]>`
    SELECT unused_days AS days, applies_since_ms::float8 AS since
    FROM app.sandbox_workspace_retention WHERE org_id = ${organizationId}
  `;
  const row = rows[0];
  return row === undefined || policy.unusedDays < row.days ? now : row.since;
}
