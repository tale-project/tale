import { join } from 'node:path';

import pkg from '../../../package.json';
import { compareVersions } from '../../utils/compare-versions';
import * as logger from '../../utils/logger';
import {
  type LegacyMigrationOutcome,
  offerLegacyConvexDataMigration,
} from '../docker/migrate-legacy-convex-data';
import { requireProject } from '../project/find-project';
import { readProject } from '../project/read-project';
import { writeProject } from '../project/write-project';
import { ALIGN_GUARD_ENV } from '../version/align';
import {
  type InstallHandle,
  type ResolvedRelease,
  commitInstall,
  installBinary,
  isDevBuild,
  resolveRelease,
  rollbackInstall,
} from '../version/self-update';
import { update } from './update';

/**
 * Options for `tale update` — move the CLI and the on-disk project files to a
 * new version. Rolling the running containers is a separate step (`tale
 * deploy`); `tale update` does not deploy.
 */
export interface RunUpdateOptions {
  /** Target version (e.g. "0.9.0"); defaults to the latest release. */
  version?: string;
  force?: boolean;
  dryRun?: boolean;
  /**
   * Hidden continuation: run ONLY the file-sync phase under the freshly-
   * installed target binary (so it syncs the new version's templates). Set by
   * the parent invocation when it re-spawns itself after the CLI self-update.
   */
  internalInstance?: boolean;
}

/**
 * Injectable seams so the orchestration (CLI bump → file sync → rollback) is
 * unit-testable without real downloads or subprocesses. Production passes the
 * defaults below.
 */
export interface RunUpdateDeps {
  currentVersion: string;
  isDevBuild: (version?: string) => boolean;
  requireProject: () => string;
  readWorkspaceVersion: (dir: string) => Promise<string>;
  writeWorkspaceVersion: (dir: string, version: string) => Promise<void>;
  resolveRelease: (opts: { version?: string }) => Promise<ResolvedRelease>;
  installBinary: (
    release: ResolvedRelease['release'],
  ) => Promise<InstallHandle>;
  commitInstall: (handle: InstallHandle) => Promise<void>;
  rollbackInstall: (handle: InstallHandle) => Promise<void>;
  /** Spawn `tale update --internal-instance ...` under the new binary; returns the exit code. */
  spawnFileSync: (childArgs: string[]) => number;
  /** Run the file-sync phase in-process (no binary change). */
  syncProjectFiles: (opts: RunUpdateOptions) => Promise<void>;
  /**
   * Best-effort pre-0.3.2 volume-layout pass (P1-8, #1755): warns loudly
   * about an orphaned `platform-data` volume and offers to copy it into
   * the `convex-data` volume before the operator deploys onto a fresh
   * empty one. Never throws.
   */
  offerLegacyConvexDataMigration: (
    projectDir: string,
    opts: { dryRun?: boolean },
  ) => Promise<LegacyMigrationOutcome>;
}

const defaultDeps: RunUpdateDeps = {
  currentVersion: pkg.version,
  isDevBuild,
  requireProject,
  readWorkspaceVersion: async (dir) => (await readProject(dir)).cliVersion,
  writeWorkspaceVersion: async (dir, version) => {
    const project = await readProject(dir);
    if (project.cliVersion !== version) {
      await writeProject(join(dir, 'tale.json'), {
        ...project,
        cliVersion: version,
      });
    }
  },
  resolveRelease,
  installBinary,
  commitInstall,
  rollbackInstall,
  spawnFileSync: (childArgs) => {
    const result = Bun.spawnSync([process.execPath, ...childArgs], {
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
      env: { ...process.env, [ALIGN_GUARD_ENV]: '1' },
    });
    // A signal-killed child reports `exitCode === null`; treat that as a
    // failure (1) rather than masking it as success (0) — the caller rolls the
    // binary back on any non-zero file-sync result.
    return result.exitCode ?? 1;
  },
  syncProjectFiles,
  offerLegacyConvexDataMigration,
};

/** Sync the project files to the running binary's embedded templates. */
async function syncProjectFiles(opts: RunUpdateOptions): Promise<void> {
  await update({
    force: opts.force,
    dryRun: opts.dryRun,
    skipHeader: true,
  });
}

/** Build the `--internal-instance` child argv from the user's options. */
function fileSyncChildArgs(opts: RunUpdateOptions): string[] {
  const args = ['update', '--internal-instance'];
  if (opts.force) args.push('--force');
  return args;
}

/**
 * `tale update`: bring the CLI and the on-disk project files to a new version.
 *
 * Updates the CLI binary first, then syncs the project files to the new
 * version's templates (which stamps `tale.json`'s `cliVersion`). If the file
 * sync fails, the CLI is rolled back to the workspace's previous version so
 * the binary and `cliVersion` stay in lockstep (and the next command's
 * automatic alignment is a no-op). Rolling the running containers is a
 * separate step — run `tale deploy` afterwards.
 */
export async function runUpdate(
  opts: RunUpdateOptions,
  deps: RunUpdateDeps = defaultDeps,
): Promise<void> {
  // Continuation under the new binary: just do the file-sync phase.
  if (opts.internalInstance) {
    await deps.syncProjectFiles(opts);
    return;
  }

  const projectDir = deps.requireProject();
  const prev = await deps.readWorkspaceVersion(projectDir);

  const { release, skipped, newerLine } = await deps.resolveRelease({
    version: opts.version,
  });
  const target = release.version;
  const comparison = compareVersions(target, deps.currentVersion);
  const isDev = deps.isDevBuild();

  logger.header(opts.dryRun ? '[DRY-RUN] Updating Tale' : 'Updating Tale');
  logger.info(`CLI version:       ${deps.currentVersion}`);
  logger.info(`Workspace version: ${prev}`);
  logger.info(`Target version:    ${target}`);

  // Surface an orphaned pre-0.3.2 data volume BEFORE the operator moves on
  // to `tale deploy` — deploying without the copy brings the instance up
  // empty (P1-8, #1755). Warns loudly and offers to run the copy right
  // here; best-effort, never blocks the update.
  await deps.offerLegacyConvexDataMigration(projectDir, {
    dryRun: opts.dryRun,
  });

  if (!opts.version && skipped.length > 0) {
    logger.warn(
      `Skipping ${skipped.map((t) => t.replace(/^v/, '')).join(', ')} — ` +
        `binary not yet uploaded. Re-run 'tale update' later to pick them up.`,
    );
  }
  if (!opts.version && newerLine !== null) {
    logger.warn(
      `A newer release line is available: v${newerLine}. 'tale update' stays ` +
        `within your current line, and line upgrades can be breaking — review ` +
        `the release notes and the upgrade docs, then run ` +
        `'tale update --version ${newerLine}' to move explicitly.`,
    );
  }
  if (opts.version && !isDev && comparison < 0) {
    logger.warn(
      `Downgrading from ${deps.currentVersion} to ${target}. Data migrations ` +
        `from the newer version persist — reverse them FIRST with ` +
        `\`tale migrate down --to ${target}\` (check \`tale migrate status\`).`,
    );
  }

  if (opts.dryRun) {
    logger.blank();
    logger.info(
      `[DRY-RUN] Would update the CLI to v${target}, then sync project files. ` +
        `Run \`tale deploy\` afterwards to roll the containers.`,
    );
    logger.info(
      'Project-file preview below is based on the current templates; actual ' +
        'changes may differ after the CLI is updated.',
    );
    logger.blank();
    await update({ force: opts.force, dryRun: true, skipHeader: true });
    return;
  }

  // Already on the target binary → no replace/rollback needed; sync in-process.
  if (comparison === 0 && !isDev && !opts.force) {
    logger.blank();
    await deps.syncProjectFiles(opts);
    logger.success(
      `Tale CLI is up to date (v${target}); project files synced. ` +
        `Run \`tale deploy\` to roll the instance.`,
    );
    return;
  }

  // Phase 1: install the target binary, keeping a backup for rollback.
  logger.step(`Updating CLI ${deps.currentVersion} → ${target}...`);
  const handle = await deps.installBinary(release);

  // Phase 2: sync project files under the new binary, in a child process so
  // this (old-binary) parent stays alive to orchestrate a rollback on failure.
  logger.step('Syncing project files...');
  const exitCode = deps.spawnFileSync(fileSyncChildArgs(opts));

  if (exitCode !== 0) {
    logger.blank();
    logger.warn(`File sync failed — rolling the CLI back to v${prev}.`);
    await deps.rollbackInstall(handle);
    // The file sync stamps cliVersion only on success, so a failed run leaves
    // it at `prev`; reset defensively to keep binary ↔ cliVersion in lockstep.
    try {
      await deps.writeWorkspaceVersion(projectDir, prev);
    } catch (err) {
      // tale.json unreadable post-failure — nothing more to reconcile here.
      logger.debug(`could not reset cliVersion after rollback: ${String(err)}`);
    }
    throw new Error(
      `Update to v${target} failed during file sync; CLI rolled back to ` +
        `v${prev}. See the output above for the cause.`,
    );
  }

  await deps.commitInstall(handle);
  logger.blank();
  logger.success(
    `Tale CLI updated to v${target} and project files synced. ` +
      `Run \`tale deploy\` to roll the instance to v${target}.`,
  );
}
