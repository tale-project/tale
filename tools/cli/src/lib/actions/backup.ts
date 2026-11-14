import { getProjectId, type DeploymentEnv } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { resolveConsent } from '../../utils/output-mode';
import { confirm } from '../../utils/prompt';
import { createSnapshot } from '../backup/create-snapshot';
import { exportSnapshot, importSnapshot } from '../backup/export-import';
import { resolveSnapshotPrefix } from '../backup/resolve-prefix';
import { rotateSnapshots } from '../backup/rotate-snapshots';
import { snapshotStoreOf } from '../runtime/incus/verbs/snapshots';
import { selectRuntime } from '../runtime/select-runtime';
import type { StackRuntime } from '../runtime/types';
import { getCurrentColor } from '../state/get-current-color';
import { withLock } from '../state/with-lock';
import { colorPlatformVersion } from './color-lifecycle';

interface BackupOptions {
  env: DeploymentEnv;
  /** The runtime to snapshot on; selected from `tale.json` when absent. */
  runtime?: StackRuntime;
  /** Incus: also write a tar.gz archive of each volume (Docker always
   * does). */
  archive?: boolean;
}

/**
 * Manual snapshot trigger — the same snapshot `tale deploy`/`tale dev`
 * take automatically before mutating steps, runnable on demand (e.g.
 * right before a restore drill or ahead of risky host maintenance).
 */
export async function backup(options: BackupOptions): Promise<void> {
  const { env } = options;
  const runtime = options.runtime ?? (await selectRuntime(env.DEPLOY_DIR));

  await withLock(env.DEPLOY_DIR, 'backup', async () => {
    logger.header('Creating Volume Snapshot');

    const prefix = await resolveSnapshotPrefix(runtime);
    if (prefix === null) {
      throw new Error(
        'No Tale data volumes found for this project — nothing to back up. ' +
          'Run `tale dev` or `tale deploy` first.',
      );
    }
    logger.info(`Volume namespace: ${prefix}*`);

    // Best-effort platform version for the manifest: the live colour's
    // replicas first, then the dev container name (`tale dev` stacks run an
    // uncoloured platform container under a pinned name).
    const currentColor = await getCurrentColor(env.DEPLOY_DIR);
    const platformVersion = currentColor
      ? await colorPlatformVersion(currentColor, runtime)
      : await runtime.version(`${getProjectId()}-platform`);

    await createSnapshot({
      prefix,
      trigger: 'manual',
      platformVersion,
      runtime,
      ...(options.archive === true ? { archive: true } : {}),
    });
    await rotateSnapshots({ prefix, runtime });
  });
}

/** The volume namespace of an existing deployment, or a refusal. */
async function requirePrefix(
  runtime: StackRuntime,
  what: string,
): Promise<string> {
  const prefix = await resolveSnapshotPrefix(runtime);
  if (prefix === null)
    throw new Error(
      `No Tale data volumes found for this project — nothing to ${what}. Run \`tale dev\` or \`tale deploy\` first.`,
    );
  return prefix;
}

/** `tale backup export <id> [--to file]`: one portable file of a snapshot. */
export async function backupExport(options: {
  env: DeploymentEnv;
  id: string;
  to?: string;
  runtime?: StackRuntime;
}): Promise<string> {
  const runtime =
    options.runtime ?? (await selectRuntime(options.env.DEPLOY_DIR));
  return withLock(
    options.env.DEPLOY_DIR,
    `backup export ${options.id}`,
    async () =>
      exportSnapshot({
        runtime,
        prefix: await requirePrefix(runtime, 'export from'),
        id: options.id,
        ...(options.to === undefined ? {} : { to: options.to }),
      }),
  );
}

/** `tale backup import <file>`: a snapshot export into this host's backups. */
export async function backupImport(options: {
  env: DeploymentEnv;
  file: string;
  runtime?: StackRuntime;
}): Promise<void> {
  const runtime =
    options.runtime ?? (await selectRuntime(options.env.DEPLOY_DIR));
  await withLock(options.env.DEPLOY_DIR, 'backup import', async () => {
    const prefix =
      (await resolveSnapshotPrefix(runtime)) ??
      (runtime.engine === 'incus' ? '' : `${getProjectId()}_`);
    await importSnapshot({ runtime, prefix, file: options.file });
  });
}

/**
 * `tale backup prune`: list the volumes restores set aside
 * (`<v>.pre-restore-<ts>`) with the snapshots that still live on them, and
 * delete those no manifest names any more. One a manifest still references
 * is never deleted: it holds that snapshot (design D-29, R-06).
 */
export async function backupPrune(options: {
  env: DeploymentEnv;
  assumeYes?: boolean;
  dryRun?: boolean;
  runtime?: StackRuntime;
}): Promise<void> {
  const runtime =
    options.runtime ?? (await selectRuntime(options.env.DEPLOY_DIR));
  const store = snapshotStoreOf(runtime);
  if (store === null) {
    logger.info(
      'Docker restores in place: there are no set-aside volumes to prune.',
    );
    return;
  }
  await withLock(options.env.DEPLOY_DIR, 'backup prune', async () => {
    const holders = await store.holders();
    if (holders.length === 0) {
      logger.info('No volumes set aside by a restore.');
      return;
    }
    logger.header('Volumes set aside by restores');
    logger.table(
      holders.map((holder) => [
        holder.volume,
        holder.referencedBy.length > 0
          ? `kept: holds ${holder.referencedBy.length} listed snapshot(s), oldest ${holder.referencedBy[0]}`
          : holder.usedBy.length > 0
            ? `kept: used by ${holder.usedBy.join(', ')}`
            : 'no listed snapshot: can be deleted',
      ]),
    );
    const deletable = holders.filter(
      (holder) =>
        holder.referencedBy.length === 0 && holder.usedBy.length === 0,
    );
    if (deletable.length === 0 || options.dryRun === true) return;
    if (!resolveConsent(options.assumeYes)) {
      const ok = await confirm({
        message: `Delete ${deletable.length} set-aside volume(s) and every snapshot left on them?`,
        default: false,
      });
      if (!ok) {
        logger.info('Nothing was deleted.');
        return;
      }
    }
    const deleted = await store.deleteUnreferencedHolders();
    logger.success(
      `Deleted ${deleted.length} set-aside volume(s): ${deleted.join(', ')}`,
    );
  });
}
