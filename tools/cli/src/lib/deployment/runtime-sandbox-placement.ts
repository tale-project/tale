import { preconditionError } from '../../utils/fail';
import * as logger from '../../utils/logger';
import type { IncusRuntime } from '../runtime/incus/incus-runtime';
import { SANDBOX_STATE_VOLUME } from './runtime-sandbox';

/** The flag that clears the spawner's record of each session's host. */
const CLEAR_SANDBOX_PLACEMENT_FLAG = '--clear-sandbox-placement';

export const SANDBOX_PLACEMENT_SENTENCES = {
  kept: `The sandbox spawner of this stack keeps a record of the Incus host each session lives on (the ${SANDBOX_STATE_VOLUME} volume), and the deployment no longer declares runtime.incus.sandboxHosts: the sessions the one host makes would be missing from that record, and a later list could place one of them on another host, where it comes back with an empty workspace.`,
  keptRemedy: [
    'Keep the record: declare the one host as the only entry of runtime.incus.sandboxHosts (the list takes one host).',
    `Delete the record: deploy again with ${CLEAR_SANDBOX_PLACEMENT_FLAG} (it is deleted once the spawner no longer mounts it).`,
  ],
  listed: `${CLEAR_SANDBOX_PLACEMENT_FLAG} deletes the record of a spawner that leaves the list form; this deployment declares runtime.incus.sandboxHosts, whose spawner reads that record.`,
  wouldClear: `Would delete the ${SANDBOX_STATE_VOLUME} volume, the sandbox spawner's record of each session's host (${CLEAR_SANDBOX_PLACEMENT_FLAG}).`,
  cleared: `Deleted the ${SANDBOX_STATE_VOLUME} volume, the sandbox spawner's record of each session's host (${CLEAR_SANDBOX_PLACEMENT_FLAG}).`,
  stillMounted: (users: readonly string[]) =>
    `The ${SANDBOX_STATE_VOLUME} volume is still mounted by ${users.join(', ')}, so it is kept; deploy again with ${CLEAR_SANDBOX_PLACEMENT_FLAG} once the spawner runs without the host list.`,
} as const;

type PlacementRuntime = Pick<IncusRuntime, 'listVolumes' | 'removeVolume'>;

/**
 * Before anything changes: a stack whose spawner kept a placement record
 * (`sandbox-state`) may leave the list form only when the operator clears
 * that record (`clear`); the flag is refused beside the list, whose spawner
 * reads the record. True when the record is to be deleted after the apply.
 */
export async function admitSandboxPlacement(
  runtime: PlacementRuntime,
  listed: boolean,
  clear: boolean,
): Promise<boolean> {
  if (listed) {
    if (clear) throw preconditionError(SANDBOX_PLACEMENT_SENTENCES.listed);
    return false;
  }
  const kept = (await runtime.listVolumes()).some(
    (volume) => volume.name === SANDBOX_STATE_VOLUME,
  );
  if (!kept) return false;
  if (!clear)
    throw preconditionError(SANDBOX_PLACEMENT_SENTENCES.kept, [
      ...SANDBOX_PLACEMENT_SENTENCES.keptRemedy,
    ]);
  return true;
}

/**
 * After the apply: delete the record the operator cleared, once no instance
 * mounts it (the spawner runs without the list). One a running spawner still
 * mounts is kept, with a warning, and the next deploy refuses again.
 */
export async function clearSandboxPlacement(
  runtime: PlacementRuntime,
  dryRun: boolean,
): Promise<void> {
  const volume = (await runtime.listVolumes()).find(
    (candidate) => candidate.name === SANDBOX_STATE_VOLUME,
  );
  if (volume === undefined) return;
  if (dryRun) {
    logger.info(SANDBOX_PLACEMENT_SENTENCES.wouldClear);
    return;
  }
  if (volume.usedBy.length > 0) {
    logger.warn(SANDBOX_PLACEMENT_SENTENCES.stillMounted(volume.usedBy));
    return;
  }
  await runtime.removeVolume(SANDBOX_STATE_VOLUME);
  logger.info(SANDBOX_PLACEMENT_SENTENCES.cleared);
}
