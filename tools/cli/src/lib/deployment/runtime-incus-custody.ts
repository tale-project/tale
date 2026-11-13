/**
 * Custody of a managed stack on Incus (design 7.1): whether the instances the
 * Incus project holds for the deployment's stack are this deployment's own,
 * in its topology, and as the CLI made them. It replaces
 * `assertContainerCustody`'s Docker JSON (`runtime-apply.ts`) for Incus
 * only, over the one normalized readback (`InstanceInfo`) the managed
 * modules read through `runtime-access-incus.ts`.
 *
 * Every instance of the stack must carry the stack's labels, be the first
 * and only replica of a service of the target (the managed /25 runs one of
 * each and has no colours), and never be a one-off helper. Its disk devices
 * must be the ones the target gives it — the same pool, volume, path and
 * read-only flag — and no disk may name anything outside the allow-list: the
 * stack's data volumes and its four runtime volumes (`proxy-files`,
 * `sandbox-credentials`, `names-config`, `switch-config`). Its configuration
 * must still be what the CLI applied: the state digest of what it holds
 * equals the `user.tale.config` digest the applier stamped. At admission a
 * volume the release adds may still be missing from an instance, as Docker
 * allows a new named volume; once ready, every instance is exactly the
 * target's.
 */

import { preconditionError } from '../../utils/fail';
import {
  assertCustody,
  instanceInfo,
  type ObservedInstance,
} from '../runtime/incus/apply/readback';
import type { Devices } from '../runtime/incus/compile/translate';
import {
  desiredInstance,
  observedInstanceState,
  type DesiredStack,
} from '../runtime/incus/plan/plan';
import type { InstanceInfo } from '../runtime/types';

export const INCUS_CUSTODY_SENTENCES = {
  topology:
    'Existing instances do not match this managed runtime identity and topology.',
  disk: 'Existing runtime data-volume or file-volume identity differs.',
  allowList:
    'An existing instance mounts a disk outside the managed volume allow-list.',
  drift:
    'An existing instance was changed outside the CLI since it was applied; review it before deploying.',
  ready: 'The ready runtime instances differ from the applied plan.',
} as const;

const CONFIG_LABEL = 'user.tale.config';

export interface IncusCustodyInput {
  desired: DesiredStack;
  /** Every instance the project holds (the readback's). */
  instances: readonly ObservedInstance[];
  /** `admission`: before an apply; `ready`: a ready runtime, exactly. */
  phase: 'admission' | 'ready';
  /** At admission: the volumes the project holds, so a volume the release
   * adds may still be missing from an instance. */
  volumes?: ReadonlySet<string>;
}

function disks(devices: Devices): [string, Record<string, string>][] {
  return Object.entries(devices).filter(
    ([, device]) => device.type === 'disk' && device.path !== '/',
  );
}

function sameDisk(
  actual: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>,
): boolean {
  return (
    actual.pool === expected.pool &&
    actual.source === expected.source &&
    actual.path === expected.path &&
    (actual.readonly === 'true') === (expected.readonly === 'true')
  );
}

/**
 * Check the stack's instances against the target; returns their readback.
 * Instances of other stacks are not looked at, except where one holds a name
 * the stack needs (the planner's rule, `assertCustody`).
 */
export function assertIncusCustody(input: IncusCustodyInput): InstanceInfo[] {
  const { desired, phase } = input;
  const { target, key } = desired;
  const specs = new Map(target.instances.map((spec) => [spec.name, spec]));
  const allowed = new Set(target.volumes.map((volume) => volume.name));
  for (const instance of input.instances)
    if (specs.has(instance.name))
      assertCustody('instance', instance.name, instance.custody, target.stack);
  const own = input.instances.filter(
    (instance) => instance.custody.verdict === 'stack',
  );
  const seen = new Set<string>();
  const infos: InstanceInfo[] = [];
  for (const instance of own) {
    const info = instanceInfo(instance, key);
    const spec = specs.get(instance.name);
    const index = instance.config['user.tale.index'];
    if (
      spec === undefined ||
      info.stack !== target.stack ||
      info.oneOff ||
      instance.config['user.tale.role'] === 'helper' ||
      info.colour !== undefined ||
      info.service !== spec.service ||
      (index !== undefined && index !== '1') ||
      seen.has(info.service)
    )
      throw preconditionError(INCUS_CUSTODY_SENTENCES.topology);
    seen.add(info.service);

    const expected = new Map(disks(spec.devices));
    const matched = new Set<string>();
    for (const [name, device] of disks(instance.devices)) {
      if (
        device.pool !== target.pool ||
        device.source === undefined ||
        device.source.startsWith('/') ||
        !allowed.has(device.source)
      )
        throw preconditionError(INCUS_CUSTODY_SENTENCES.allowList);
      const want = expected.get(name);
      if (want === undefined || !sameDisk(device, want))
        throw preconditionError(INCUS_CUSTODY_SENTENCES.disk);
      matched.add(name);
    }
    const missing = [...expected].filter(([name]) => !matched.has(name));
    const additive =
      phase === 'admission' &&
      input.volumes !== undefined &&
      missing.every(([, device]) => !input.volumes?.has(device.source ?? ''));
    if (missing.length > 0 && !additive)
      throw preconditionError(INCUS_CUSTODY_SENTENCES.disk);

    // What it holds is what the CLI applied: no hand edit since.
    const stamped = instance.config[CONFIG_LABEL];
    if (
      stamped === undefined ||
      observedInstanceState(key, { ...instance, running: true }) !== stamped
    )
      throw preconditionError(INCUS_CUSTODY_SENTENCES.drift);
    if (phase === 'ready' && stamped !== desiredInstance(spec, desired).sha256)
      throw preconditionError(INCUS_CUSTODY_SENTENCES.ready);
    infos.push(info);
  }
  if (phase === 'ready' && seen.size !== specs.size)
    throw preconditionError(INCUS_CUSTODY_SENTENCES.ready);
  return infos.sort((left, right) => left.name.localeCompare(right.name));
}
