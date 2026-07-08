import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.92 / 01 — retire the `issue-desk` builtin app.
 *
 * `issue-desk` left the builtin catalog (`builtin-configs/apps/`), replaced by
 * the "Resolve GitHub issues" bundle (`resolve-github-issues`, four hidden
 * member automations: triage-github-issues, sync-github-issues,
 * create-github-pr, review-github-pr). Uninstall-only by design — this
 * migration does NOT install the new bundle; an admin re-installs it where
 * wanted.
 *
 * Per org that has `issue-desk` installed: snapshots its on-disk app
 * directory (`<org>/apps/issue-desk/` — the manifest, both agents, and both
 * workflows all live there; nothing fans out to a shared domain dir, so one
 * `fs-tree` snapshot covers the whole bundle), records which projects had it
 * bound (a small sidecar JSON written into that same directory before the
 * snapshot, so ONE snapshot call also preserves the binding list), then runs
 * the ordinary uninstall core: unbind every bound project (deleting each
 * project's `issue-desk/reconcile` schedule first, since `uninstallAutomation`
 * refuses while any binding remains), deregister the two workflows and two
 * agents, sweep their env/secrets, delete the copied files, and delete the
 * install row. `down` restores the snapshotted directory, recreates the
 * `wfInstallations` / `agentInstallations` / `appInstallations` rows by
 * re-hashing the restored files (the builtin catalog copy is GONE by design,
 * so the normal reinstall path — which copies FROM the catalog — cannot run
 * any more; this is why the fs-tree snapshot is retained rather than treated
 * as a disposable rollback aid), and rebinds every project the sidecar
 * recorded. Schedule variables an operator had customized (owner/repo/test
 * command/repo notes) are NOT restored by `down` — same as any fresh
 * install/bind, the operator re-enters them once.
 */
export const meta: MigrationMeta = {
  id: '0.2.92/01_retire_issue_desk',
  semver: '0.2.92',
  numericId: 1,
  slug: 'retire_issue_desk',
  title: 'Retire the issue-desk builtin app',
  description:
    'For every org with `issue-desk` installed: snapshots its app directory ' +
    '(fs-tree) plus the bound-project list, unbinds every project (deleting ' +
    "each project's issue-desk/reconcile schedule), then runs the ordinary " +
    'uninstall core (deregister workflows/agents, sweep env/secrets, delete ' +
    'files, delete the install row). Does NOT install the replacement ' +
    '"Resolve GitHub issues" bundle — an admin re-installs it. down restores ' +
    'the app directory and re-registers the workflows/agents/install row/' +
    'project bindings from the restored files; per-schedule operator ' +
    'variable overrides are not restored (re-enter them, as with any fresh ' +
    'install).',
  kind: 'node',
  reversible: true,
  destructive: true,
  snapshot: 'fs-tree',
};
