import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.89 / 02 — rewrite `threadFiles.path` to the canonical absolute
 * `/user/<root>/<name>` form.
 *
 * The thread workspace is now one virtual filesystem rooted at `/user`, mounted
 * 1:1 by the sandbox, with ONE canonical path per file used by every file tool,
 * by `run_code` scripts, and by staging/harvest — no per-tool conversion. This
 * folds the old flat path + `source` into the single absolute path implied by
 * that `source` (`user_upload`→`/user/uploads`, `agent_write`→`/user/code`,
 * `run_output`→`/user/output`). `source` stays as denormalized provenance.
 *
 * `up` prepends the root; `down` strips it. Both are idempotent (skip a row
 * already in the target shape) and lose no data — a pure, reversible rename.
 */
export const meta: MigrationMeta = {
  id: '0.2.89/02_thread_files_absolute_paths',
  semver: '0.2.89',
  numericId: 2,
  slug: 'thread_files_absolute_paths',
  title: 'Rewrite thread workspace file paths to absolute /user/<root>/ form',
  description:
    'Folds threadFiles.path (flat relative + source) into the single canonical ' +
    'absolute /user/{uploads,code,output}/<name> path implied by its source, so ' +
    'file tools, run_code, and staging/harvest all share one scheme. up prepends ' +
    'the root; down strips it. Idempotent, reversible, non-destructive.',
  kind: 'db',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};
