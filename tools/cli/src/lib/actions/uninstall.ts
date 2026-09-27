import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { preconditionError } from '../../utils/fail';
import { loadEnv } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { getOutputMode } from '../../utils/output-mode';
import { confirm as promptConfirm, isInteractive } from '../../utils/prompt';
import { findProject } from '../project/find-project';
import { resolveProjectContext } from '../project/project-context';
import {
  readSandboxDeviceConfig,
  sandboxDeviceConfigPath,
} from '../sandbox-device/config';
import {
  getBinaryPath,
  isDevBuild,
  removeBinary,
  removeBinaryBackups,
} from '../version/self-update';
import { reset } from './reset';
import { disconnectSandboxDevice } from './sandbox-device';

/**
 * `tale uninstall` — the inverse of the install script. It always removes the
 * CLI binary, and *offers* (interactively, or non-interactively via `--purge`)
 * to also disconnect this machine's sandbox device (its containers and
 * workspaces), remove the retired `tale daemon`'s `~/.tale-daemon`, and tear
 * down a detected project's Docker resources + files.
 *
 * Destructive extras never run silently: they require an interactive "yes" or
 * the explicit `--purge` flag, so a CI / piped run only ever removes the binary.
 * The binary is removed LAST so a failure mid-run leaves a working CLI to retry.
 */
interface UninstallOptions {
  /** Skip the binary-removal confirmation (binary only — does not select extras). */
  force?: boolean;
  /** Non-interactively select all destructive extras (device, legacy config, project). */
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
  /** The sandbox device connected on this machine, if any. */
  findSandboxDevice: () => Promise<{ name: string; stateDir: string } | null>;
  disconnectSandboxDevice: () => Promise<void>;
  /** Per-user state of retired features still on disk (`~/.tale-daemon`). */
  legacyUserDirs: () => string[];
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
  findSandboxDevice: async () => {
    const config = await readSandboxDeviceConfig(sandboxDeviceConfigPath());
    return config === null
      ? null
      : { name: config.name, stateDir: config.stateDir };
  },
  // Consent was given at the uninstall level: no second prompt.
  disconnectSandboxDevice: () =>
    disconnectSandboxDevice({ keepData: false, force: true }),
  legacyUserDirs: () => {
    const legacy =
      process.env.TALE_DAEMON_HOME?.trim() || join(homedir(), '.tale-daemon');
    return existsSync(legacy) ? [legacy] : [];
  },
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
      const device = await deps.findSandboxDevice();
      if (device) {
        logger.info(
          `${prefix}Would disconnect the sandbox device "${device.name}" and remove ${device.stateDir}`,
        );
      }
      for (const dir of deps.legacyUserDirs()) {
        logger.info(`${prefix}Would remove ${dir}`);
      }
      const project = deps.findProject();
      if (project) {
        logger.info(
          `${prefix}Would tear down Docker resources and delete ${project}`,
        );
      }
    } else {
      logger.info(
        `${prefix}Re-run with --purge to also disconnect a sandbox device and remove a project's Docker resources + files`,
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
  const device = await deps.findSandboxDevice();
  const removeDevice =
    device !== null &&
    (await offerExtra(
      `Also disconnect the sandbox device "${device.name}" and delete its workspaces in ${device.stateDir}?`,
    ));
  const legacyDirs = deps.legacyUserDirs();
  const removeLegacy =
    legacyDirs.length > 0 &&
    (await offerExtra(
      `Also remove the retired per-user config at ${legacyDirs.join(', ')}?`,
    ));

  // Run the extras BEFORE deleting the binary, so a failure here leaves a
  // working CLI to retry with. The device goes first and is the one extra
  // whose failure stops the uninstall: its containers restart with Docker,
  // so without a CLI nothing would be left to stop them.
  if (removeDevice) {
    try {
      await deps.disconnectSandboxDevice();
    } catch (err) {
      throw preconditionError(
        `Could not stop this machine's sandbox device (${err instanceof Error ? err.message : String(err)}); nothing was uninstalled.`,
        [
          'tale sandbox disconnect   # retry once Docker is running',
          'tale uninstall            # then uninstall',
        ],
      );
    }
  }

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

  if (removeLegacy) {
    for (const dir of legacyDirs) {
      await deps.removeDir(dir);
      logger.success(`Removed ${dir}`);
    }
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
