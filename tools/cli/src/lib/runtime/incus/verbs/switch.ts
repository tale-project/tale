import { statFile } from '@tale/incus/files';

import { preconditionError } from '../../../../utils/fail';
import type { ApplyHooks } from '../apply/apply';
import { updateJournal } from '../apply/journal';
import type { StackTarget } from '../compile/stack-target';
import { SWITCHED_ROLES } from '../compile/translate';
import type { RenderedFile } from '../plan/plan';
import { execInInstance, type IncusVerbContext } from './exec';
import { cachedImageFacts } from './image-facts-cache';

/**
 * The traffic switch (design D-17, 5.3, 7.3; r3: R3-02, R3-21, R3-26,
 * R3-34): the release's `tale-proxy` image in its `switch` role holds the
 * stable names `platform` and `backend-api` and balances each over the
 * replicas of both colours, with Caddy's active health checks on each
 * replica's admission probe (`services/proxy/Caddyfile.switch`).
 *
 * Its two upstream files list every slot of their role in every colour the
 * address block holds, and are written once, when the switch instance is
 * made (`RenderedFile.instance`). No flip, in-place roll, rollback or scale
 * change rewrites them, and nothing reloads the switch: a slot with no
 * replica, or one that is starting, fails the check and gets no traffic. A
 * replica joins once its admission probe passes, as a Docker replica does
 * once it joins its alias.
 *
 * A replica leaves through its withdrawal marker, which its admission probe
 * reads (`/api/admission` answers 503 while `/tmp/platform-withdrawn`
 * exists, `/admission` while `/tmp/backend-withdrawn` does). `withdraw`
 * creates it by an exec of `touch` as the image's app user (R3-26: a marker
 * root made in the sticky `/tmp` could not be removed by the app), then
 * waits two switch health intervals, by which time the switch sends the
 * replica nothing new; its open requests and streams run on until it stops.
 * `admit` is a no-op unless a marker is there (an aborted flip), which it
 * removes as the same user. The CLI journals each marker it sets, so a
 * replica a crash left withdrawn is admitted again by the next converge.
 */

/** The volume the switch reads, mounted read-only at `/switch`. */
export const SWITCH_VOLUME = 'switch-config';

/** The marker each switched role's admission probe reads. */
export const WITHDRAWAL_MARKERS = {
  platform: '/tmp/platform-withdrawn',
  'backend-api': '/tmp/backend-withdrawn',
} as const satisfies Record<keyof typeof SWITCHED_ROLES, string>;

/** The switch's `health_interval` (`services/proxy/Caddyfile.switch`). */
const SWITCH_HEALTH_INTERVAL_MS = 2_000;
/** How long a withdrawal waits: two health intervals, after which the
 * switch has checked the replica at least once since its marker was set
 * (S20: the last request reached a withdrawn replica at most 1,975 ms
 * after its marker). */
export const WITHDRAWAL_SETTLE_MS = 2 * SWITCH_HEALTH_INTERVAL_MS;
/** Seconds a marker exec may take. */
const MARKER_EXEC_TIMEOUT_S = 15;
const COLOURS = ['blue', 'green'] as const;

export interface SwitchDependencies {
  /** How the withdrawal waits (tests). */
  sleep?: (ms: number) => Promise<void>;
}

const text = (value: string) => new TextEncoder().encode(value);

/** One role's upstream file, as the switch imports it into its
 * `reverse_proxy` block: every slot, `<address>:<port>`. */
export function renderUpstreams(slots: readonly string[]): string {
  if (slots.length === 0)
    throw new Error('The switch needs at least one slot.');
  for (const slot of slots)
    if (!/^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(slot))
      throw new Error(`${slot} is no upstream address of the switch.`);
  return `to ${slots.join(' ')}\n`;
}

/** The switch's upstream files for `target`, owned by the switch instance:
 * written when it is made, and never again (R3-02). None when the target
 * has no switch. */
export function switchFiles(target: StackTarget): RenderedFile[] {
  if (!target.volumes.some((volume) => volume.name === SWITCH_VOLUME))
    return [];
  return Object.keys(SWITCHED_ROLES).map((role): RenderedFile => ({
    volume: SWITCH_VOLUME,
    path: `${role}.upstreams`,
    mode: 0o644,
    uid: 0,
    gid: 0,
    content: text(
      renderUpstreams(target.switch[role as keyof typeof SWITCHED_ROLES]),
    ),
    write: 'overwrite',
    instance: 'switch',
  }));
}

/** The marker of a switched role; null for any other service. */
function withdrawalMarker(service: string): string | null {
  return Object.hasOwn(WITHDRAWAL_MARKERS, service)
    ? WITHDRAWAL_MARKERS[service as keyof typeof WITHDRAWAL_MARKERS]
    : null;
}

const KNOWN_MARKERS = new Set<string>(Object.values(WITHDRAWAL_MARKERS));

/** The uid and gid of the image's app user, from the image facts the
 * deploy read (R3-26); refused where they name none. */
async function appUserOf(
  context: IncusVerbContext,
  name: string,
  config: Readonly<Record<string, string>>,
): Promise<{ uid: number; gid: number }> {
  const digest = config['user.tale.image'] ?? '';
  const facts =
    digest === '' ? null : await cachedImageFacts(context.stateRoot, digest);
  if (facts === null || facts.appUser === null)
    throw preconditionError(
      `The image facts of ${name} (${digest || 'no image digest'}) name no app user, so its withdrawal marker cannot be set as that user.`,
      'Deploy the stack again, which reads the facts of every image it runs.',
    );
  return facts.appUser;
}

async function markerPresent(
  context: IncusVerbContext,
  name: string,
  marker: string,
): Promise<boolean> {
  return (
    (await statFile(context.client, { instance: name }, marker)) !== undefined
  );
}

async function runAsAppUser(
  context: IncusVerbContext,
  name: string,
  config: Readonly<Record<string, string>>,
  argv: readonly string[],
): Promise<void> {
  const user = await appUserOf(context, name, config);
  const result = await execInInstance(context, name, argv, {
    user,
    timeoutS: MARKER_EXEC_TIMEOUT_S,
    output: 'discard',
  });
  if (!result.success)
    throw new Error(
      `${argv.join(' ')} in ${name} failed (exit ${result.exitCode}): ${result.stderr.trim() || 'no output'}`,
    );
}

/** A running instance's config; null when it is absent or not running. */
async function runningConfig(
  context: IncusVerbContext,
  name: string,
): Promise<Record<string, string> | null> {
  const read = await context.client.getInstance(name);
  if (read?.instance.status !== 'Running') return null;
  return read.instance.config;
}

/**
 * Set the withdrawal marker of one replica; the marker, or null for a
 * replica the switch does not hold or one that is not running (it takes no
 * traffic). A marker that is there already is kept as it is.
 */
async function setWithdrawalMarker(
  context: IncusVerbContext,
  name: string,
  service: string,
): Promise<string | null> {
  const marker = withdrawalMarker(service);
  if (marker === null) return null;
  const config = await runningConfig(context, name);
  if (config === null) return null;
  if (!(await markerPresent(context, name, marker)))
    await runAsAppUser(context, name, config, ['touch', marker]);
  return marker;
}

/**
 * Remove a withdrawal marker from one replica, as the image's app user;
 * true when there was one. Nothing runs where there is none, or where the
 * replica is not running (a start's entrypoint clears every marker).
 */
async function clearWithdrawalMarker(
  context: IncusVerbContext,
  name: string,
  marker: string,
): Promise<boolean> {
  if (!KNOWN_MARKERS.has(marker))
    throw new Error(`${marker} is no withdrawal marker.`);
  const config = await runningConfig(context, name);
  if (config === null) return false;
  if (!(await markerPresent(context, name, marker))) return false;
  await runAsAppUser(context, name, config, ['rm', '-f', marker]);
  if (await markerPresent(context, name, marker))
    throw new Error(
      `${marker} in ${name} is still there after its removal as the app user.`,
    );
  return true;
}

/** The running replicas of the switched `services` of `stack`: the whole
 * stack, or one colour of it (`<stack>-<colour>`, the name a colour's
 * project has on Docker); only those named in `replicas`, when given. */
async function switchedReplicas(
  context: IncusVerbContext,
  stack: string,
  services: readonly string[],
  replicas: readonly string[] | undefined,
): Promise<{ name: string; service: string }[]> {
  let colour: string | null = null;
  if (stack !== context.stack) {
    colour =
      COLOURS.find((candidate) => stack === `${context.stack}-${candidate}`) ??
      null;
    if (colour === null)
      throw preconditionError(
        `${stack} is no stack of this Incus runtime (${context.stack}).`,
      );
  }
  const wanted = new Set(
    services.filter((service) => withdrawalMarker(service) !== null),
  );
  return (await context.client.listInstances())
    .filter((instance) => {
      const config = instance.config;
      return (
        instance.status === 'Running' &&
        config['user.tale.stack'] === context.stack &&
        wanted.has(config['user.tale.service'] ?? '') &&
        (colour === null || config['user.tale.colour'] === colour) &&
        (replicas === undefined || replicas.includes(instance.name))
      );
    })
    .map((instance) => ({
      name: instance.name,
      service: instance.config['user.tale.service'] ?? '',
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * `withdraw` on Incus: set the marker of every running replica of the
 * switched `services` (each journaled first, so a crash leaves a record of
 * it), then wait two switch health intervals. Cuts nothing: returns 0.
 */
export async function withdrawReplicas(
  context: IncusVerbContext,
  stack: string,
  services: readonly string[],
  replicas?: readonly string[],
  dependencies: SwitchDependencies = {},
): Promise<number> {
  const targets = await switchedReplicas(context, stack, services, replicas);
  for (const target of targets) {
    const marker = withdrawalMarker(target.service) ?? '';
    await updateJournal(context.stateRoot, context.stack, (journal) => {
      if (!journal.withdrawn.some((entry) => entry.instance === target.name))
        journal.withdrawn.push({ instance: target.name, marker });
    });
    await setWithdrawalMarker(context, target.name, target.service);
  }
  if (targets.length > 0)
    await (dependencies.sleep ?? Bun.sleep)(WITHDRAWAL_SETTLE_MS);
  return 0;
}

/**
 * `admit` on Incus: remove the marker of every running replica of the
 * switched `services` that carries one; a replica without one is left
 * alone. Its journal record goes with it.
 */
export async function admitReplicas(
  context: IncusVerbContext,
  stack: string,
  services: readonly string[],
  replicas?: readonly string[],
): Promise<void> {
  const targets = await switchedReplicas(context, stack, services, replicas);
  for (const target of targets) {
    await clearWithdrawalMarker(
      context,
      target.name,
      withdrawalMarker(target.service) ?? '',
    );
    await updateJournal(context.stateRoot, context.stack, (journal) => {
      journal.withdrawn = journal.withdrawn.filter(
        (entry) => entry.instance !== target.name,
      );
    });
  }
}

/** The applier's withdrawal hooks (it journals the markers itself): a
 * replica it retires is withdrawn, and waited on, before its drain. */
export function switchApplyHooks(
  context: IncusVerbContext,
  dependencies: SwitchDependencies = {},
): Pick<ApplyHooks, 'withdraw' | 'admit'> {
  return {
    async withdraw(instance, service) {
      const marker = await setWithdrawalMarker(context, instance, service);
      if (marker !== null)
        await (dependencies.sleep ?? Bun.sleep)(WITHDRAWAL_SETTLE_MS);
      return marker;
    },
    async admit(instance, marker) {
      await clearWithdrawalMarker(context, instance, marker);
    },
  };
}
