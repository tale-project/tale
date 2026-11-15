import { preconditionError } from '../../utils/fail';
import * as logger from '../../utils/logger';
import { stableJson } from '../config/releases/identity';
import { readJournal, updateJournal } from '../runtime/incus/apply/journal';
import type { StackTarget } from '../runtime/incus/compile/stack-target';
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

/** The one Incus host a spawner of the single form dials: its endpoint and
 * the project its sessions live in. */
export interface SingleSandboxHost {
  endpoint: string;
  project: string;
}

export const SANDBOX_HOST_MOVE_SENTENCES = {
  unmatched: (host: SingleSandboxHost) =>
    `The sandbox spawner of this stack ran with the one Incus host ${host.endpoint} (project ${host.project}), and runtime.incus.sandboxHosts lists no entry with that endpoint and project: the spawner would not see the sessions that host holds, and they would come back with an empty workspace.`,
  unmatchedRemedy: (host: SingleSandboxHost) => [
    `Keep the sessions: declare an entry of runtime.incus.sandboxHosts with endpoint ${host.endpoint} and project ${host.project}.`,
    'Leave them on purpose: tale reset --all starts the stack over.',
  ],
} as const;

/** The spawner's service, and the variables its host comes from. */
const SPAWNER_SERVICE = 'sandbox';
const ENDPOINT_KEY = 'environment.SANDBOX_INCUS_ENDPOINT';
const ENDPOINTS_KEY = 'environment.SANDBOX_INCUS_ENDPOINTS';
const PROJECT_KEY = 'environment.SANDBOX_INCUS_PROJECT';

/** An endpoint as the spawner reads it: its https origin. */
function origin(endpoint: string): string {
  // Not a URL: the spawner refuses it at boot; compared as written.
  return URL.canParse(endpoint) ? new URL(endpoint).origin : endpoint;
}

/** The one host a spawner's config names, or null for the list form. */
function singleHostOf(
  config: Readonly<Record<string, string>>,
): SingleSandboxHost | null {
  const endpoint = config[ENDPOINT_KEY];
  if (config[ENDPOINTS_KEY] !== undefined || endpoint === undefined)
    return null;
  return { endpoint: origin(endpoint), project: config[PROJECT_KEY] ?? '' };
}

/** The hosts a list-form spawner's config names, each with its project, or
 * undefined for the single form. */
function listedHostsOf(
  config: Readonly<Record<string, string>>,
): SingleSandboxHost[] | undefined {
  const text = config[ENDPOINTS_KEY];
  if (text === undefined) return undefined;
  const entries = JSON.parse(text) as { endpoint: string; project?: string }[];
  return entries.map((entry) => ({
    endpoint: origin(entry.endpoint),
    project: entry.project ?? config[PROJECT_KEY] ?? '',
  }));
}

type HostMoveRuntime = Pick<IncusRuntime, 'client' | 'stack' | 'stateRoot'>;

/**
 * Before anything changes: a stack whose spawner ran with the one host may
 * take `runtime.incus.sandboxHosts` only with an entry of that host's
 * endpoint and project, so the record the spawner rebuilds from the hosts'
 * listings holds the sessions it made. The one host is read from the
 * running spawner, and kept in the Incus journal (`sandboxHost`) for a
 * deploy that finds no spawner, as a crash between its removal and its
 * replacement leaves; a plan reads it and writes nothing.
 */
export async function admitSandboxHostMove(
  runtime: HostMoveRuntime,
  target: Pick<StackTarget, 'instances'>,
  dryRun: boolean,
): Promise<void> {
  const running = (await runtime.client.listInstances()).filter(
    (instance) =>
      instance.config['user.tale.stack'] === runtime.stack &&
      instance.config['user.tale.service'] === SPAWNER_SERVICE,
  );
  let previous: SingleSandboxHost | null;
  if (running.length === 0)
    previous = (await readJournal(runtime.stateRoot))?.sandboxHost ?? null;
  else {
    const hosts = running.map((instance) => singleHostOf(instance.config));
    previous = hosts.includes(null) ? null : (hosts[0] ?? null);
    const recorded = (await readJournal(runtime.stateRoot))?.sandboxHost;
    if (!dryRun && stableJson(recorded ?? null) !== stableJson(previous))
      await updateJournal(runtime.stateRoot, runtime.stack, (journal) => {
        journal.sandboxHost = previous;
      });
  }
  if (previous === null) return;
  const spawner = target.instances.find(
    (instance) => instance.service === SPAWNER_SERVICE,
  );
  const listed =
    spawner === undefined ? undefined : listedHostsOf(spawner.config);
  if (listed === undefined) return;
  const old = previous;
  if (
    listed.some(
      (host) => host.endpoint === old.endpoint && host.project === old.project,
    )
  )
    return;
  throw preconditionError(SANDBOX_HOST_MOVE_SENTENCES.unmatched(old), [
    ...SANDBOX_HOST_MOVE_SENTENCES.unmatchedRemedy(old),
  ]);
}
