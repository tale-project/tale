import { Command } from 'commander';

import { runMigrations } from '../lib/actions/run-migrations';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import * as logger from '../utils/logger';

/**
 * `tale migrate` runs the Convex migration + provisioning runner
 * (`migrations:runAll`) against the running deployment. This is the same
 * idempotent runner the container executes on every deploy, exposed as a
 * command so operators can apply pending data migrations and re-provision
 * built-in defaults without a full redeploy.
 */
export function createMigrateCommand(): Command {
  return new Command('migrate')
    .description(
      'Apply pending data migrations and re-provision built-in defaults ' +
        'against the running deployment.',
    )
    .option(
      '--dry-run',
      'Preview the runner invocation without executing it',
      false,
    )
    .action(async (opts: { dryRun?: boolean }) => {
      try {
        const projectDir = requireProject();
        await resolveProjectContext(projectDir);
        await runMigrations({ dryRun: opts.dryRun ?? false });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
