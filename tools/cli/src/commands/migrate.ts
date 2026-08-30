import { Command } from 'commander';

import { runMigrations } from '../lib/actions/run-migrations';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import { action } from '../utils/run-command';

/**
 * `tale migrate` — re-provision built-in defaults against the running
 * deployment.
 *
 * SCHEMA migrations are not a command: the backend applies them under an
 * advisory lock at boot, so a container is always at its own schema and a
 * deploy migrates by definition. The 0.4 versioned DATA-migration framework
 * (`status` / `up` / `down`) retired with the Convex runtime it ran on — 0.5
 * carries no data forward, so there is nothing for it to step through.
 *
 * What remains operator-triggered is the idempotent per-org seeding, which is
 * what this command queues.
 */
export function createMigrateCommand(): Command {
  return new Command('migrate')
    .description(
      'Re-provision built-in defaults for every organization against the ' +
        'running deployment. Idempotent; schema migrations apply themselves ' +
        'at backend boot.',
    )
    .option(
      '--dry-run',
      'Preview the provisioning invocation without executing it',
      false,
    )
    .action(
      action(async (opts: { dryRun?: boolean }) => {
        await resolveProjectContext(requireProject());
        await runMigrations({ dryRun: opts.dryRun ?? false });
      }),
    );
}
