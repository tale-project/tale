import { Command } from 'commander';

import {
  backup,
  backupExport,
  backupImport,
  backupPrune,
} from '../lib/actions/backup';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import { loadEnv } from '../utils/load-env';
import { action } from '../utils/run-command';

async function projectEnv() {
  const projectDir = requireProject();
  await resolveProjectContext(projectDir);
  return loadEnv(projectDir);
}

export function createBackupCommand(): Command {
  const command = new Command('backup')
    .description(
      'Snapshot all Tale data volumes into the project backups volume',
    )
    .option(
      '--archive',
      'Incus: also write a tar.gz archive of each volume into the backups volume (Docker always does)',
      false,
    )
    .action(
      action(async (opts: { archive?: boolean }) => {
        await backup({ env: await projectEnv(), archive: opts.archive });
      }),
    );
  command
    .command('export')
    .description(
      'Write one snapshot as a single portable file (its tar.gz archives and manifest)',
    )
    .argument(
      '<snapshot-id>',
      'the snapshot to export (`tale restore` lists them)',
    )
    .option(
      '--to <file>',
      'where to write it (default: ./tale-snapshot-<id>.tar)',
    )
    .action(
      action(async (snapshotId: string, opts: { to?: string }) => {
        await backupExport({
          env: await projectEnv(),
          id: snapshotId,
          ...(opts.to === undefined ? {} : { to: opts.to }),
        });
      }),
    );
  command
    .command('import')
    .description(
      'Read a snapshot export into the backups volume, checked by sha256 on arrival',
    )
    .argument('<file>', 'a file `tale backup export` wrote')
    .action(
      action(async (file: string) => {
        await backupImport({ env: await projectEnv(), file });
      }),
    );
  command
    .command('prune')
    .description(
      'Incus: list the volumes restores set aside, and delete those no listed snapshot lives on',
    )
    .option('--dry-run', 'only list them', false)
    .option('-y, --yes', 'non-interactive: skip the confirmation prompt')
    .action(
      action(async (opts: { dryRun?: boolean; yes?: boolean }) => {
        await backupPrune({
          env: await projectEnv(),
          ...(opts.dryRun === true ? { dryRun: true } : {}),
          ...(opts.yes === undefined ? {} : { assumeYes: opts.yes }),
        });
      }),
    );
  return command;
}
