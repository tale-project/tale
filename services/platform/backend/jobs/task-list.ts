import type { Sql } from 'postgres';
import { z } from 'zod';

import { removeOrgSubtree } from '../../convex/organizations/scaffold.ts';
import { scaffoldNewOrganization } from '../domains/organizations/scaffold.ts';

/** One task handler; `payload` is a job row — external input, re-validate. */
export type TaskHandler = (payload: unknown) => Promise<void>;

export type BackendTaskList = Record<string, TaskHandler>;

const orgScaffoldSchema = z.object({
  orgSlug: z.string().min(1),
  cleanFirst: z.boolean().optional(),
});

const orgCleanupSchema = z.object({
  orgSlug: z.string().min(1),
});

export interface TaskDeps {
  sql: Sql;
}

/**
 * The production task list. Handlers are registered here as domains land;
 * every identifier must exist in `TaskPayloads` (tasks.ts), every handler is
 * idempotent (at-least-once delivery), and every payload is re-validated at
 * the boundary.
 */
export function createTaskList(deps: TaskDeps): BackendTaskList {
  return {
    noop: (payload) => {
      console.debug(`[backend] noop task executed: ${JSON.stringify(payload)}`);
      return Promise.resolve();
    },
    'org.scaffold': async (payload) => {
      const input = orgScaffoldSchema.parse(payload);
      const result = await scaffoldNewOrganization(input);
      if (!result.ok) {
        // Throw so pg-boss retries — scaffold is idempotent per domain.
        throw new Error(`org scaffold failed: ${result.error}`);
      }
    },
    'maintenance.rate_limit_gc': async () => {
      // Any row idle for 7 days is past every window/refill horizon.
      const cutoff = Date.now() - 7 * 24 * 3_600_000;
      const deleted = await deps.sql`
        DELETE FROM app.rate_limits WHERE ts < ${cutoff}
      `;
      console.log(`[maintenance] rate_limit_gc removed ${deleted.count} rows`);
    },
    'maintenance.login_attempts_ttl': async () => {
      const attemptsCutoff = Date.now() - 30 * 24 * 3_600_000;
      const countersCutoff = Date.now() - 90 * 24 * 3_600_000;
      const attempts = await deps.sql`
        DELETE FROM app.login_attempts
        WHERE last_failure_at < ${attemptsCutoff}
      `;
      const counters = await deps.sql`
        DELETE FROM app.login_block_counters
        WHERE window_start < ${countersCutoff}
      `;
      console.log(
        `[maintenance] login_attempts_ttl removed ${attempts.count} attempts, ${counters.count} counters`,
      );
    },
    'org.cleanup_files': async (payload) => {
      const input = orgCleanupSchema.parse(payload);
      const configRoot = process.env.TALE_CONFIG_DIR;
      if (!configRoot) {
        throw new Error(
          'TALE_CONFIG_DIR is unset — cannot clean up the org config subtree',
        );
      }
      // Guarded two-phase rename-then-delete (slug validation, traversal +
      // symlink defenses) — reused from the 0.4 module unchanged.
      await removeOrgSubtree(configRoot, input.orgSlug);
    },
  };
}
