import { preconditionError } from '../../../../utils/fail';
import { STOP_GATED_SERVICES } from '../../../compose/types';
import { stableJson } from '../../../config/releases/identity';
import {
  assertCustody,
  deployedBefore,
  resetSinceDeploy,
  BACKUPS_VOLUME,
  type ObservedFile,
  type ObservedInstance,
  type ObservedVolume,
  type Readback,
} from '../apply/readback';
import { INFRASTRUCTURE_FORMATS } from '../compile/placement';
import type { StackTarget, StackVolume } from '../compile/stack-target';
import type { Devices, InstanceSpec } from '../compile/translate';
import { NAMES_VOLUME } from '../verbs/names';
import type { PlanKey } from './digest';
import {
  incusPlanSchema,
  resourceId,
  type IncusDestination,
  type IncusPlan,
  type IncusPlanEffect,
  type IncusPlanPhase,
  type IncusPlanResource,
} from './plan-model';

/**
 * The planner (design D-07): a pure diff of the compiled stack target
 * against a readback, as a plan of resources with an action and its effects.
 * It reads nothing and writes nothing; the applier converges the plan, and
 * a crash resumes by planning again from what the node holds (D-12).
 */

/** A file the stack writes, with its content (the plan keeps its digest). */
export interface RenderedFile {
  volume: string;
  /** Relative to the volume's root, as the target names it. */
  path: string;
  /** Permission bits (0o600). */
  mode: number;
  uid: number;
  gid: number;
  content: Uint8Array;
  /**
   * `overwrite` in place, or `generation`: a new file `<path>.<gen>`, then
   * the older generations are deleted, because the volume file API has no
   * rename and an overwrite a crash cuts short leaves a torn file (R3-29).
   */
  write: 'overwrite' | 'generation';
  /** Written only when this instance is made, as part of it: the switch's
   * upstream lists, which no flip, roll or scale rewrites (R3-02). */
  instance?: string;
}

/** What the stack should be, and where. */
export interface DesiredStack {
  target: StackTarget;
  files: readonly RenderedFile[];
  destination: IncusDestination;
  key: PlanKey;
}

export interface PlanScope {
  phase: IncusPlanPhase;
  /** `--stop`: a running stop-gated instance may be replaced. */
  stop: boolean;
}

/** The infrastructure tier: singletons on fixed addresses that are replaced
 * only on a first deploy, under --stop, or when the CLI writes a file format
 * their image does not read (design D-17, R-02). */
const INFRASTRUCTURE = new Set<string>(Object.keys(INFRASTRUCTURE_FORMATS));
/** Roles the switch admits by a withdrawal marker (R3-02). */
export const SWITCHED_SERVICES = new Set(['platform', 'backend-api']);
const BACKEND_SERVICES = new Set(['backend-api', 'backend-worker']);
const STOP_GATED = new Set<string>([...STOP_GATED_SERVICES, ...INFRASTRUCTURE]);

/** Keys the runtime or the applier writes itself, never compared. */
const RUNTIME_KEYS = new Set([
  'user.tale.config',
  'user.tale.want',
  'user.tale.started',
]);
/** Keys an instance takes live, without being made again. */
const LIVE_PREFIXES = ['limits.', 'boot.'];
const FIXED_LABELS = new Set([
  'user.tale.stack',
  'user.tale.service',
  'user.tale.role',
  'user.tale.index',
  'user.tale.colour',
  'user.tale.image',
  'user.tale.files',
  'user.tale.infra-formats',
]);
/** What changes with the image alone. */
const IMAGE_KEYS = new Set([
  'user.tale.image',
  'user.tale.version',
  'user.tale.revision',
  'user.tale.infra-formats',
  'oci.entrypoint',
]);
const INGRESS_DEVICE = /^ingress-/;

export const DEFERRED_INFRASTRUCTURE_HINT =
  'Keeps its running image until a deploy with --stop replaces it.';
export const DEFERRED_STOP_GATED_HINT =
  'Keeps running as it is until a deploy with --stop replaces it.';
export const MISSING_DATA_HINT =
  'The stack ran before: restore this volume (tale restore) or start over (tale reset).';

function isRuntimeKey(key: string): boolean {
  return (
    RUNTIME_KEYS.has(key) ||
    key.startsWith('volatile.') ||
    key.startsWith('image.')
  );
}

function isLiveKey(key: string): boolean {
  if (LIVE_PREFIXES.some((prefix) => key.startsWith(prefix))) return true;
  return key.startsWith('user.') && !FIXED_LABELS.has(key);
}

/** Keys Incus fills from the OCI image when an instance is made without
 * them; the target sets none of them. */
const IMAGE_FILLED_KEYS = new Set(['oci.cwd', 'oci.uid', 'oci.gid']);

/** Whether Incus filled `key` from the image. Where the instance carries
 * the image's own value (`image.<key>`), only that value counts as filled,
 * and any other was set by hand. Incus 7.6 copies the image's working
 * directory, uid and gid into `oci.*` at create without keeping an
 * `image.oci.*` beside them, so there a value cannot be told from one set
 * by hand, and the key is taken as filled. A configuration the target
 * renders never sets these keys, so none of its own counts as filled. */
export function isImageFilled(
  config: Readonly<Record<string, string>>,
  key: string,
): boolean {
  if (!IMAGE_FILLED_KEYS.has(key)) return false;
  const image = config[`image.${key}`];
  return image === undefined
    ? config['image.type'] === 'oci'
    : image === config[key];
}

function comparable(
  config: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(config).filter(
      ([key]) => !isRuntimeKey(key) && !isImageFilled(config, key),
    ),
  );
}

/** The devices an instance is made with: everything but the ingress, which
 * is its own resource and comes last (design 7.1). */
export function withoutIngress(devices: Devices): Devices {
  return Object.fromEntries(
    Object.entries(devices).filter(([name]) => !INGRESS_DEVICE.test(name)),
  );
}

export function ingressOf(devices: Devices): Devices {
  return Object.fromEntries(
    Object.entries(devices).filter(([name]) => INGRESS_DEVICE.test(name)),
  );
}

function absentDigest(key: PlanKey): string {
  return key.digest({ absent: true });
}

function fileState(
  key: PlanKey,
  file: { sha256: string; mode: number; uid: number; gid: number },
): string {
  return key.digest({
    sha256: file.sha256,
    mode: file.mode,
    uid: file.uid,
    gid: file.gid,
  });
}

/** The keyed digest of the target and every file it writes. */
export function targetDigest(desired: DesiredStack): string {
  const { key } = desired;
  return key.digest({
    target: desired.target,
    files: desired.files.map((file) => ({
      volume: file.volume,
      path: file.path,
      mode: file.mode,
      uid: file.uid,
      gid: file.gid,
      write: file.write,
      instance: file.instance ?? null,
      sha256: key.digestBytes(file.content),
    })),
  });
}

/** The state of an instance the planner compares: its configuration without
 * the runtime's own keys, its devices without the ingress, and whether it
 * runs. */
function instanceState(
  key: PlanKey,
  config: Readonly<Record<string, string>>,
  devices: Devices,
  running: boolean,
): string {
  return key.digest({
    config: comparable(config),
    devices: withoutIngress(devices),
    running,
  });
}

export function observedInstanceState(
  key: PlanKey,
  instance: ObservedInstance | undefined,
): string {
  if (instance === undefined) return absentDigest(key);
  return instanceState(
    key,
    instance.config,
    instance.devices,
    instance.running,
  );
}

/** The configuration an instance is made with, before the applier stamps
 * `user.tale.config` and `user.tale.want`, and its state digest. */
export function desiredInstance(
  spec: InstanceSpec,
  desired: DesiredStack,
): { config: Record<string, string>; devices: Devices; sha256: string } {
  const owned = desired.files
    .filter((file) => file.instance === spec.name)
    .map((file) => ({
      volume: file.volume,
      path: file.path,
      state: fileState(desired.key, {
        sha256: desired.key.digestBytes(file.content),
        mode: file.mode,
        uid: file.uid,
        gid: file.gid,
      }),
    }))
    .sort((left, right) =>
      `${left.volume}/${left.path}`.localeCompare(
        `${right.volume}/${right.path}`,
      ),
    );
  const config: Record<string, string> = { ...spec.config };
  if (owned.length > 0)
    config['user.tale.files'] = desired.key.digest(owned).slice(0, 32);
  return {
    config,
    devices: spec.devices,
    sha256: instanceState(desired.key, config, spec.devices, true),
  };
}

export function volumeConfig(volume: StackVolume, stack: string) {
  return {
    ...volume.config,
    ...(volume.size === undefined ? {} : { size: volume.size }),
    'security.shifted': 'true',
    'user.tale.stack': stack,
    'user.tale.volume': volume.name,
    'user.tale.kind': volume.kind,
  };
}

/** A volume is compared on the keys the target sets alone: Incus copies the
 * pool's `volume.*` defaults (`size`, `snapshots.*`, `zfs.*`) into every new
 * volume's configuration, and those are the pool's, not drift to undo. */
function volumeState(
  key: PlanKey,
  desired: Readonly<Record<string, string>>,
  observed: Readonly<Record<string, string>>,
): string {
  const compared = Object.fromEntries(
    Object.keys(desired).map((name) => [name, observed[name] ?? null]),
  );
  return key.digest({ config: compared });
}

export function observedVolumeState(
  key: PlanKey,
  desired: Readonly<Record<string, string>>,
  volume: ObservedVolume | undefined,
): string {
  return volume === undefined
    ? absentDigest(key)
    : volumeState(key, desired, volume.config);
}

function desiredVolumeState(
  key: PlanKey,
  desired: Readonly<Record<string, string>>,
): string {
  return volumeState(key, desired, desired);
}

/** The newest generation of a file and the older ones it supersedes. */
export function fileGenerations(
  files: readonly ObservedFile[],
  volume: string,
  path: string,
): { newest: ObservedFile | undefined; stale: ObservedFile[] } {
  const found = files
    .filter((file) => file.volume === volume && file.path === path)
    .sort((left, right) => (right.generation ?? -1) - (left.generation ?? -1));
  return { newest: found[0], stale: found.slice(1) };
}

export function desiredFileState(key: PlanKey, file: RenderedFile): string {
  return fileState(key, {
    sha256: key.digestBytes(file.content),
    mode: file.mode,
    uid: file.uid,
    gid: file.gid,
  });
}

export function observedFileState(
  key: PlanKey,
  file: ObservedFile | undefined,
): string {
  return file === undefined ? absentDigest(key) : fileState(key, file);
}

export function ingressState(key: PlanKey, devices: Devices): string {
  return key.digest({ ingress: ingressOf(devices) });
}

function formatsOf(value: string | undefined): string[] {
  return (value ?? '').split(/[\s,]+/).filter((item) => item !== '');
}

function inPhase(spec: InstanceSpec, phase: IncusPlanPhase): boolean {
  switch (phase) {
    case 'full':
      return true;
    case 'infrastructure':
      return INFRASTRUCTURE.has(spec.service);
    case 'stateful':
      return spec.index === null && !INFRASTRUCTURE.has(spec.service);
    case 'colour-blue':
      return spec.colour === 'blue';
    case 'colour-green':
      return spec.colour === 'green';
  }
}

function orphanInPhase(
  instance: ObservedInstance,
  phase: IncusPlanPhase,
): boolean {
  const service = instance.config['user.tale.service'] ?? '';
  const role = instance.config['user.tale.role'] ?? '';
  const colour = instance.config['user.tale.colour'];
  const indexed = instance.config['user.tale.index'] !== undefined;
  switch (phase) {
    case 'full':
      return true;
    case 'infrastructure':
      return INFRASTRUCTURE.has(service);
    case 'stateful':
      return !indexed && !INFRASTRUCTURE.has(service) && role !== 'helper';
    case 'colour-blue':
      return colour === 'blue';
    case 'colour-green':
      return colour === 'green';
  }
}

function infrastructureEffect(service: string): IncusPlanEffect[] {
  if (service === 'switch') return ['switch'];
  if (service === 'names' || service === 'names-sessions') return ['names'];
  return [];
}

/** What stopping a running instance costs. */
function retireEffects(service: string, running: boolean): IncusPlanEffect[] {
  if (!running) return infrastructureEffect(service);
  return [
    ...(STOP_GATED.has(service) ? (['downtime'] as const) : []),
    ...(service === 'sandbox' ? (['drain-sandbox'] as const) : []),
    ...(BACKEND_SERVICES.has(service) ? (['drain-backend'] as const) : []),
    ...infrastructureEffect(service),
  ];
}

function changedKeys(
  desired: Readonly<Record<string, string>>,
  observed: Readonly<Record<string, string>>,
): string[] {
  const left = comparable(desired);
  const right = comparable(observed);
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((key) => left[key] !== right[key])
    .sort();
}

function planInstance(
  spec: InstanceSpec,
  observed: ObservedInstance | undefined,
  desired: DesiredStack,
  scope: PlanScope,
): IncusPlanResource {
  const { key } = desired;
  const want = desiredInstance(spec, desired);
  const base = {
    id: resourceId('instance', spec.name),
    currentSha256: observedInstanceState(key, observed),
    desiredSha256: want.sha256,
    revision: observed?.revision ?? null,
  };
  if (observed === undefined)
    return {
      ...base,
      action: 'create',
      effects: infrastructureEffect(spec.service),
    };
  if (base.currentSha256 === base.desiredSha256)
    return { ...base, action: 'unchanged', effects: [] };
  const changed = changedKeys(want.config, observed.config);
  const devicesChanged =
    stableJson(withoutIngress(want.devices)) !==
    stableJson(withoutIngress(observed.devices));
  // Only keys an instance takes live changed, or nothing but its state (a
  // crash between create and start, a stop outside a deploy): patch and
  // start it in place.
  if (!devicesChanged && changed.every(isLiveKey))
    return { ...base, action: 'update', effects: [] };

  const running = observed.running;
  if (running && INFRASTRUCTURE.has(spec.service)) {
    const format = INFRASTRUCTURE_FORMATS[spec.service] ?? '';
    const reads = formatsOf(observed.config['user.tale.infra-formats']);
    if (!reads.includes(format))
      return {
        ...base,
        action: 'replace',
        effects: retireEffects(spec.service, true),
        hint: `The running ${spec.name} does not read ${format}; replacing it needs --stop.`,
      };
    const imageOnly =
      !devicesChanged && changed.every((k) => IMAGE_KEYS.has(k));
    if (imageOnly && !scope.stop)
      return {
        ...base,
        action: 'deferred',
        effects: [],
        hint: DEFERRED_INFRASTRUCTURE_HINT,
      };
  } else if (running && STOP_GATED.has(spec.service) && !scope.stop) {
    return {
      ...base,
      action: 'deferred',
      effects: [],
      hint: DEFERRED_STOP_GATED_HINT,
    };
  }
  return {
    ...base,
    action: 'replace',
    effects: retireEffects(spec.service, running),
  };
}

function startPriority(spec: InstanceSpec): number {
  return Number(spec.config['boot.autostart.priority'] ?? '0');
}

/**
 * The order instances are made in: by start priority (the highest first,
 * as Incus starts them at boot), except that an instance comes after every
 * service it depends on, and the switch comes after the whole tier.
 */
export function tierOrder(specs: readonly InstanceSpec[]): InstanceSpec[] {
  const byPriority = [...specs].sort(
    (left, right) =>
      Number(left.service === 'switch') - Number(right.service === 'switch') ||
      startPriority(right) - startPriority(left) ||
      left.name.localeCompare(right.name),
  );
  const services = new Set(byPriority.map((spec) => spec.service));
  const placed = new Set<string>();
  const ordered: InstanceSpec[] = [];
  const left = [...byPriority];
  while (left.length > 0) {
    const index = left.findIndex((spec) =>
      spec.dependsOn.every(
        (dependency) =>
          !services.has(dependency.service) ||
          placed.has(dependency.service) ||
          dependency.service === spec.service,
      ),
    );
    // The compiler refuses a cycle; were there one, priority order stands.
    const [next] = left.splice(index === -1 ? 0 : index, 1);
    if (next === undefined) break;
    ordered.push(next);
    if (!left.some((spec) => spec.service === next.service))
      placed.add(next.service);
  }
  return ordered;
}

/**
 * Plan `desired` against `readback` within `scope`. Pure: the same inputs
 * give the same plan. Refuses (throws) when a resource the stack needs
 * belongs to someone else.
 */
export function plan(
  desired: DesiredStack,
  readback: Readback,
  scope: PlanScope,
): IncusPlan {
  const { target, key } = desired;
  if (
    target.project !== desired.destination.project ||
    target.pool !== desired.destination.pool
  )
    throw preconditionError(
      `The stack is compiled for project ${target.project} on pool ${target.pool}, not ${desired.destination.project} on ${desired.destination.pool}.`,
    );
  if (readback.stack !== target.stack || readback.pool !== target.pool)
    throw new Error('The readback is of another stack or pool.');
  const instanceNames = new Set(target.instances.map((spec) => spec.name));
  const volumeNames = new Set(target.volumes.map((volume) => volume.name));
  for (const file of target.files)
    if (
      !desired.files.some(
        (rendered) =>
          rendered.volume === file.volume && rendered.path === file.path,
      )
    )
      throw new Error(`No content for ${file.volume}/${file.path}.`);
  for (const file of desired.files) {
    if (!volumeNames.has(file.volume))
      throw new Error(`${file.volume} is no volume of the target.`);
    if (file.instance !== undefined && !instanceNames.has(file.instance))
      throw new Error(`${file.instance} is no instance of the target.`);
  }

  const observedInstances = new Map(
    readback.instances.map((instance) => [instance.name, instance]),
  );
  const observedVolumes = new Map(
    readback.volumes.map((volume) => [volume.name, volume]),
  );
  const specs = target.instances.filter((spec) => inPhase(spec, scope.phase));
  for (const spec of specs) {
    const observed = observedInstances.get(spec.name);
    if (observed)
      assertCustody('instance', spec.name, observed.custody, target.stack);
  }

  // Images the phase's instances run.
  const aliases = new Set(specs.map((spec) => spec.image));
  const images: IncusPlanResource[] = target.images
    .filter((image) => aliases.has(image.alias))
    .map((image): IncusPlanResource => {
      const desiredSha = key.digest({
        alias: image.alias,
        reference: image.reference,
      });
      const present = Object.hasOwn(readback.aliases, image.alias);
      return {
        id: resourceId('image', image.alias),
        currentSha256: present ? desiredSha : absentDigest(key),
        desiredSha256: desiredSha,
        revision: null,
        action: present ? 'unchanged' : 'create',
        effects: [],
      };
    });

  // Volumes the phase's instances mount; `backups` with the stateful tier.
  const withBackups =
    scope.phase === 'full' || scope.phase === 'stateful'
      ? volumeNames.has(BACKUPS_VOLUME)
        ? target.volumes
        : [
            ...target.volumes,
            {
              name: BACKUPS_VOLUME,
              kind: 'data' as const,
              pool: target.pool,
              config: {},
            },
          ]
      : target.volumes;
  const mounted = new Set(
    specs.flatMap((spec) =>
      Object.values(spec.devices)
        .filter((device) => device.type === 'disk')
        .map((device) => device.source ?? ''),
    ),
  );
  const phaseVolumes = withBackups.filter(
    (volume) =>
      scope.phase === 'full' ||
      mounted.has(volume.name) ||
      (volume.name === BACKUPS_VOLUME && scope.phase === 'stateful'),
  );
  const refuseData =
    deployedBefore(readback) && !resetSinceDeploy(readback.record);
  const volumes = phaseVolumes.map((volume): IncusPlanResource => {
    const observed = observedVolumes.get(volume.name);
    if (observed)
      assertCustody('volume', volume.name, observed.custody, target.stack);
    const config = volumeConfig(volume, target.stack);
    const desiredSha = desiredVolumeState(key, config);
    const currentSha = observedVolumeState(key, config, observed);
    const base = {
      id: resourceId('volume', volume.name),
      currentSha256: currentSha,
      desiredSha256: desiredSha,
      revision: null,
    };
    if (observed === undefined)
      return volume.kind === 'data' && refuseData
        ? {
            ...base,
            action: 'create',
            effects: ['data'],
            hint: MISSING_DATA_HINT,
          }
        : { ...base, action: 'create', effects: [] };
    return {
      ...base,
      action: currentSha === desiredSha ? 'unchanged' : 'update',
      effects: [],
    };
  });
  const planned = new Set(phaseVolumes.map((volume) => volume.name));

  // Files on those volumes, except those an instance owns.
  const files: IncusPlanResource[] = desired.files
    .filter((file) => file.instance === undefined && planned.has(file.volume))
    .map((file): IncusPlanResource => {
      const { newest, stale } = fileGenerations(
        readback.files,
        file.volume,
        file.path,
      );
      const current =
        file.write === 'overwrite'
          ? readback.files.find(
              (found) =>
                found.volume === file.volume &&
                found.path === file.path &&
                found.generation === null,
            )
          : newest;
      const currentSha = observedFileState(key, current);
      const desiredSha = desiredFileState(key, file);
      const same = currentSha === desiredSha && stale.length === 0;
      const names: IncusPlanEffect[] =
        file.volume === NAMES_VOLUME ? ['names'] : [];
      return {
        id: resourceId('file', `${file.volume}/${file.path}`),
        currentSha256: currentSha,
        desiredSha256: desiredSha,
        revision: null,
        action:
          current === undefined ? 'create' : same ? 'unchanged' : 'update',
        effects: same ? [] : names,
      };
    });

  // Instances: the tier order, the switch after the tier it fronts.
  const instances = tierOrder(specs).map((spec) =>
    planInstance(spec, observedInstances.get(spec.name), desired, scope),
  );

  // The ingress, once the instances behind it run.
  const ingress: IncusPlanResource[] = [];
  const proxy = specs.find((spec) => spec.service === 'proxy');
  const observedProxy = proxy && observedInstances.get(proxy.name);
  if (
    proxy &&
    (scope.phase === 'full' || scope.phase === 'stateful') &&
    // A routed ingress publishes nothing: no resource, unless a device of
    // an earlier proxy-device ingress is left to remove.
    (Object.keys(ingressOf(proxy.devices)).length > 0 ||
      Object.keys(ingressOf(observedProxy?.devices ?? {})).length > 0)
  ) {
    const observed = observedProxy;
    const proxyPlan = instances.find(
      (resource) => resource.id === resourceId('instance', proxy.name),
    );
    const made =
      proxyPlan?.action === 'create' || proxyPlan?.action === 'replace';
    const currentSha = ingressState(key, made ? {} : (observed?.devices ?? {}));
    const desiredSha = ingressState(key, proxy.devices);
    const wanted = Object.keys(ingressOf(proxy.devices)).length;
    ingress.push({
      id: resourceId('ingress', proxy.name),
      currentSha256: currentSha,
      desiredSha256: desiredSha,
      revision: made ? null : (observed?.revision ?? null),
      action:
        currentSha === desiredSha
          ? 'unchanged'
          : wanted === 0
            ? 'delete'
            : made ||
                Object.keys(ingressOf(observed?.devices ?? {})).length === 0
              ? 'create'
              : 'update',
      effects: [],
    });
  }

  // Orphans last: the stack's instances the target no longer has, then the
  // runtime volumes nothing renders any more. A data volume is never an
  // orphan: removing one is `tale reset`'s.
  const orphans: IncusPlanResource[] = readback.instances
    .filter(
      (instance) =>
        instance.custody.verdict === 'stack' &&
        !instanceNames.has(instance.name) &&
        orphanInPhase(instance, scope.phase),
    )
    .map((instance): IncusPlanResource => ({
      id: resourceId('instance', instance.name),
      currentSha256: observedInstanceState(key, instance),
      desiredSha256: absentDigest(key),
      revision: instance.revision,
      action: 'delete',
      effects: retireEffects(
        instance.config['user.tale.service'] ?? '',
        instance.running,
      ),
    }));
  if (scope.phase === 'full')
    for (const volume of readback.volumes)
      if (
        volume.custody.verdict === 'stack' &&
        volume.config['user.tale.kind'] === 'runtime' &&
        !volumeNames.has(volume.name)
      )
        orphans.push({
          id: resourceId('volume', volume.name),
          currentSha256: observedVolumeState(key, volume.config, volume),
          desiredSha256: absentDigest(key),
          revision: null,
          action: 'delete',
          effects: [],
        });

  return incusPlanSchema.parse({
    schemaVersion: 1,
    targetSha256: targetDigest(desired),
    phase: scope.phase,
    destination: desired.destination,
    resources: [
      ...images,
      ...volumes,
      ...files,
      ...instances,
      ...ingress,
      ...orphans,
    ],
  });
}
