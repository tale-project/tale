import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';

import { configPath } from '../../daemon/config';
import { preconditionError } from '../../utils/fail';
import { loadEnv } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { getOutputMode } from '../../utils/output-mode';
import { confirm as promptConfirm, isInteractive } from '../../utils/prompt';
import { findProject } from '../project/find-project';
import { resolveProjectContext } from '../project/project-context';
import {
  getBinaryPath,
  isDevBuild,
  removeBinary,
  removeBinaryBackups,
} from '../version/self-update';
import { reset } from './reset';

/**
 * `tale uninstall` — the inverse of the install script. It always removes the
 * CLI binary, and *offers* (interactively, or non-interactively via `--purge`)
 * to also remove the per-user config (`~/.tale-daemon`) and tear down a
 * detected project's Docker resources + files.
 *
 * Destructive extras never run silently: they require an interactive "yes" or
 * the explicit `--purge` flag, so a CI / piped run only ever removes the binary.
 * The binary is removed LAST so a failure mid-run leaves a working CLI to retry.
 */
interface UninstallOptions {
  /** Skip the binary-removal confirmation (binary only — does not select extras). */
  force?: boolean;
  /** Non-interactively select all destructive extras (daemon config + project). */
  purge?: boolean;
  /** Preview what would be removed without touching anything. */
  dryRun?: boolean;
}

/**
 * Injectable seams (binary I/O, file removal, Docker teardown, prompting) so the
 * decision logic is unit-testable without deleting the real binary. Production
 * passes the defaults below.
 */
export interface UninstallDeps {
  isDevBuild: () => boolean;
  getBinaryPath: () => string;
  removeBinary: (path: string) => Promise<void>;
  removeBinaryBackups: (path: string) => Promise<void>;
  removeDir: (path: string) => Promise<void>;
  findProject: () => string | null;
  getDaemonHome: () => string;
  tearDownDocker: (projectDir: string) => Promise<void>;
  confirm: (message: string) => Promise<boolean>;
  isInteractive: () => boolean;
  assumeYes: () => boolean;
}

const defaultDeps: UninstallDeps = {
  isDevBuild,
  getBinaryPath,
  removeBinary,
  removeBinaryBackups,
  removeDir: (path) => rm(path, { recursive: true, force: true }),
  findProject: () => findProject(),
  // The daemon config lives at `<home>/config.json`; its parent is the home dir.
  getDaemonHome: () => dirname(configPath()),
  tearDownDocker: async (projectDir) => {
    await resolveProjectContext(projectDir);
    const env = loadEnv(projectDir);
    // `force: true` — we already consented at the uninstall level, so skip
    // reset's own inner confirmation. `includeStateful` removes the db/proxy
    // containers and prunes the project's volumes too.
    await reset({ env, force: true, includeStateful: true, dryRun: false });
  },
  confirm: (message) => promptConfirm({ message, default: false }),
  isInteractive,
  assumeYes: () => getOutputMode().assumeYes,
};

export async function uninstall(
  options: UninstallOptions,
  deps: UninstallDeps = defaultDeps,
): Promise<void> {
  const { force = false, purge = false, dryRun = false } = options;

  // A dev build runs under the `bun` runtime, so `process.execPath` is bun —
  // not a tale release binary. Removing it would delete the user's bun install.
  if (deps.isDevBuild()) {
    throw preconditionError(
      'tale uninstall removes an installed release binary, but you are running a dev build (bun). Nothing to uninstall.',
      'Run the compiled binary, or remove your dev checkout manually.',
    );
  }

  const binaryPath = deps.getBinaryPath();
  const prefix = dryRun ? '[DRY-RUN] ' : '';
  logger.header(`${prefix}Uninstalling Tale CLI`);
  logger.info(`Binary: ${binaryPath}`);

  // Dry-run: report and exit without prompting or touching anything.
  if (dryRun) {
    logger.info(`${prefix}Would remove the binary and any update backups`);
    if (purge) {
      logger.info(`${prefix}Would remove ${deps.getDaemonHome()}`);
      const project = deps.findProject();
      if (project) {
        logger.info(
          `${prefix}Would tear down Docker resources and delete ${project}`,
        );
      }
    } else {
      logger.info(
        `${prefix}Re-run with --purge to also remove ~/.tale-daemon and a project's Docker resources + files`,
      );
    }
    logger.success(`${prefix}Dry-run complete`);
    return;
  }

  // Primary confirmation. `--force` or the global `--yes` proceeds without it.
  if (!force && !deps.assumeYes()) {
    const confirmed = await deps.confirm(
      `Remove the Tale CLI binary at ${binaryPath}?`,
    );
    if (!confirmed) {
      logger.info('Uninstall cancelled');
      return;
    }
  }

  // Resolve the opt-in destructive extras. `--purge` selects all of them
  // non-interactively; otherwise we only offer them on a real terminal so a
  // CI / piped run never surprise-deletes data.
  const offerExtra = async (message: string): Promise<boolean> => {
    if (purge) return true;
    if (force) return false; // --force = binary only, no further prompts
    if (!deps.isInteractive()) return false;
    return deps.confirm(message);
  };

  const project = deps.findProject();
  const removeProject =
    project !== null &&
    (await offerExtra(
      `Also tear down Docker resources and delete the project at ${project}? This is irreversible.`,
    ));
  const removeDaemon = await offerExtra(
    `Also remove the per-user config at ${deps.getDaemonHome()}?`,
  );

  // Run the extras BEFORE deleting the binary, so a failure here leaves a
  // working CLI to retry with.
  if (removeProject && project) {
    try {
      await deps.tearDownDocker(project);
    } catch (err) {
      logger.warn(
        `Skipped Docker teardown for ${project}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    await deps.removeDir(project);
    logger.success(`Removed project directory ${project}`);
  }

  if (removeDaemon) {
    const daemonHome = deps.getDaemonHome();
    await deps.removeDir(daemonHome);
    logger.success(`Removed ${daemonHome}`);
  }

  // Binary last — clean up leftover update backups, then remove the binary.
  await deps.removeBinaryBackups(binaryPath);
  await deps.removeBinary(binaryPath);
  logger.success(`Removed ${binaryPath}`);

  logger.success('Tale CLI uninstalled');
  if (project && !removeProject) {
    logger.info(
      `Project at ${project} and its Docker resources were left intact. ` +
        'Run `tale reset --all` there to remove them.',
    );
  }
}
