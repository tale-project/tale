import { Command } from 'commander';

import { runMigrations } from '../lib/actions/run-migrations';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import { action } from '../utils/run-command';

/**
 * `tale migrate` — re-provision the configuration defaults against the
 * running deployment: the shipped configuration files an organization is
 * missing, and the starter project for an organization that has no project.
 * It adds no automation and changes none an organization has; a person adds
 * a shipped automation from the template catalog in the app.
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
      'Re-provision configuration defaults for every organization against ' +
        'the running deployment: missing configuration files, and the ' +
        'starter project for an organization without one. Adds no ' +
        'automations. Idempotent; schema migrations apply themselves at ' +
        'backend boot.',
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
