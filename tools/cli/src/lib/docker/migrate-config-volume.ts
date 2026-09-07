import * as defaultLogger from '../../utils/logger';
import {
  BACKUP_HELPER_IMAGE,
  CONFIG_VOLUME,
  LEGACY_CONFIG_VOLUME,
} from '../backup/constants';
import { volumeExists as defaultVolumeExists } from './ensure-volumes';
import { exec as defaultExec } from './exec';
import { withVolumeContainersPaused as defaultWithPaused } from './with-volume-paused';

/**
 * Move the org config store from its historical volume name to its real one.
 *
 * The store was named `convex-data` when Convex owned it. The runtime is
 * gone, the backend tier owns every write, and the name now misleads every
 * operator who reads a compose file or a volume listing — so it becomes
 * `config-data`. Docker has no `volume rename`: changing the string in the
 * compose file alone silently mounts a NEW, EMPTY volume, and the deployment
 * comes up with no organization configuration at all.
 *
 * So the rename is a copy, run by the CLI before anything remounts:
 *
 *   1. `config-data` already has content → use it; nothing to do.
 *   2. `convex-data` has content and `config-data` does not → create
 *      `config-data` and `cp -a` into it, with every container that mounts
 *      either volume PAUSED for the duration (the same discipline the
 *      pre-deploy snapshot uses — a copy racing the backend's own writes
 *      copies a torn config tree).
 *   3. Neither has content → a fresh install; nothing to carry over.
 *
 * A failed copy ABORTS the caller. The old volume is never deleted and never
 * written to, so recovery is to fix the cause and re-run — and an operator
 * who cannot wait can point the stack back at the old name. `convex-data`
 * stays in the volume lists as an unused stub (the same treatment
 * `platform-data` got) so teardown and detection still see it; deleting it
 * is the operator's call once they are past the upgrade window.
 *
 * The decision is made on CONTENT, not existence: `ensureVolumes` pre-creates
 * every required volume on every run, so "does `config-data` exist" would
 * answer yes on the very first upgrade and skip the copy.
 */

export type ConfigVolumeMigration =
  /** `config-data` was already the live store. */
  | 'current'
  /** Nothing to carry over — a fresh install. */
  | 'fresh'
  /** Contents were copied over from `convex-data`. */
  | 'copied';

export interface MigrateConfigVolumeDeps {
  exec: typeof defaultExec;
  volumeExists: typeof defaultVolumeExists;
  withVolumeContainersPaused: typeof defaultWithPaused;
  logger: Pick<typeof defaultLogger, 'step' | 'info' | 'success'>;
}

function realDeps(): MigrateConfigVolumeDeps {
  return {
    exec: defaultExec,
    volumeExists: defaultVolumeExists,
    withVolumeContainersPaused: defaultWithPaused,
    logger: defaultLogger,
  };
}

/** The config store is small text; it settles in seconds. Bounded anyway so a
 *  hung docker cannot hold the deploy lock forever. */
const COPY_TIMEOUT_SECONDS = 600;

/** Find probe: any top-level name except `lost+found` (ext filesystems). */
const CONTENT_PROBE =
  'find /data -mindepth 1 -maxdepth 1 ! -name lost+found -print -quit';

/** Wipe a half-copied target so the next run actually starts over. */
const WIPE_TARGET = 'find /to -mindepth 1 -delete';

/**
 * Is the volume present AND holding at least one real entry?
 * A failed probe throws — treating "could not inspect" as empty would
 * skip a live `convex-data` tree and boot an empty store.
 */
async function hasContent(
  deps: MigrateConfigVolumeDeps,
  volumeName: string,
): Promise<boolean> {
  if (!(await deps.volumeExists(volumeName))) return false;
  const result = await deps.exec('docker', [
    'run',
    '--rm',
    '-v',
    `${volumeName}:/data:ro`,
    BACKUP_HELPER_IMAGE,
    'sh',
    '-c',
    CONTENT_PROBE,
  ]);
  if (!result.success) {
    throw new Error(
      `Could not inspect ${volumeName} for existing content: ${
        result.stderr.trim() || result.stdout.trim() || 'docker run failed'
      }. The copy was not started.`,
    );
  }
  return result.stdout.trim().length > 0;
}

async function wipeVolume(
  deps: MigrateConfigVolumeDeps,
  volumeName: string,
): Promise<void> {
  const wiped = await deps.exec('docker', [
    'run',
    '--rm',
    '-v',
    `${volumeName}:/to`,
    BACKUP_HELPER_IMAGE,
    'sh',
    '-c',
    WIPE_TARGET,
  ]);
  if (!wiped.success) {
    deps.logger.info(
      `  Could not empty the half-copied ${volumeName} (${wiped.stderr.trim()}); empty it by hand before re-running.`,
    );
  }
}

/**
 * Ensure `${prefix}config-data` is the live config store, carrying over
 * `${prefix}convex-data` when that is where the configuration still lives.
 * Idempotent: safe to run before every deploy, rollback and dev bring-up.
 */
export async function migrateConfigVolume(
  prefix: string,
  injected: Partial<MigrateConfigVolumeDeps> = {},
): Promise<ConfigVolumeMigration> {
  const deps = { ...realDeps(), ...injected };
  const target = `${prefix}${CONFIG_VOLUME}`;
  const legacy = `${prefix}${LEGACY_CONFIG_VOLUME}`;

  if (await hasContent(deps, target)) return 'current';
  if (!(await hasContent(deps, legacy))) return 'fresh';

  deps.logger.step(
    `Moving the org config store from ${legacy} to ${target} (one-time)...`,
  );

  // Create the target BEFORE pausing, so the pause window covers only the
  // copy. `docker run -v` would create it implicitly, but unlabelled — and
  // `tale reset` prunes this project's volumes by that label.
  const created = await deps.exec('docker', [
    'volume',
    'create',
    '--label',
    `project=${prefix.replace(/[-_]$/, '')}`,
    target,
  ]);
  if (!created.success) {
    throw new Error(
      `Could not create the ${target} volume: ${created.stderr.trim()}. ` +
        `The config store is untouched in ${legacy}; nothing was migrated.`,
    );
  }

  await deps.withVolumeContainersPaused(
    [legacy, target],
    async (pausedCount) => {
      const copied = await deps.exec(
        'docker',
        [
          'run',
          '--rm',
          '-v',
          `${legacy}:/from:ro`,
          '-v',
          `${target}:/to`,
          BACKUP_HELPER_IMAGE,
          'sh',
          '-c',
          // `-a` keeps mode, ownership and timestamps: the store holds
          // `*.secrets.json` files the app user must read back, and a copy
          // that lands them root-owned breaks every later write. `/from/.`
          // copies the CONTENTS, dotfiles (`.history/`) included.
          'cp -a /from/. /to/',
        ],
        { timeout: COPY_TIMEOUT_SECONDS },
      );
      if (!copied.success) {
        await wipeVolume(deps, target);
        throw new Error(
          `Copying the org config store from ${legacy} to ${target} failed: ` +
            `${copied.stderr.trim() || copied.stdout.trim()}. ` +
            `Nothing was deleted — the store is still intact in ${legacy}. ` +
            `Fix the cause and re-run; the copy starts over.`,
        );
      }
      deps.logger.info(
        `  Config store copied${pausedCount > 0 ? ` (${pausedCount} container(s) paused during the copy)` : ''}.`,
      );
    },
  );

  deps.logger.success(
    `Org config store now lives in ${target}. ${legacy} is left untouched as a fallback — ` +
      `delete it by hand once you are past the upgrade.`,
  );
  return 'copied';
}
