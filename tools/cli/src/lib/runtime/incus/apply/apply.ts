import { posix } from 'node:path';

import { IncusApiError } from '@tale/incus/api';
import { isIncusNameConflict, type IncusClient } from '@tale/incus/client';
import {
  deleteFile,
  makeDirectory,
  readFile,
  writeFile,
} from '@tale/incus/files';
import { startInstance, stopInstance } from '@tale/incus/state';
import { detachDevice } from '@tale/incus/volumes';

import { preconditionError } from '../../../../utils/fail';
import { stableJson } from '../../../config/releases/identity';
import type { StackImage, StackVolume } from '../compile/stack-target';
import type { Devices, InstanceSpec } from '../compile/translate';
import {
  desiredFileState,
  desiredInstance,
  fileGenerations,
  ingressOf,
  ingressState,
  isImageFilled,
  observedFileState,
  observedInstanceState,
  observedVolumeState,
  SWITCHED_SERVICES,
  targetDigest,
  volumeConfig,
  withoutIngress,
  type DesiredStack,
  type RenderedFile,
} from '../plan/plan';
import {
  incusPlanSchema,
  parseResourceId,
  type IncusPlan,
  type IncusPlanResource,
} from '../plan/plan-model';
import {
  assertNoRestorePending,
  readJournal,
  updateJournal,
  type IncusJournal,
} from './journal';
import {
  BACKUPS_VOLUME,
  custodyOf,
  readStackRecord,
  resetSinceDeploy,
  stackRecordFiles,
  stackRecordSchema,
  type ObservedFile,
  type ObservedInstance,
  type StackRecord,
} from './readback';

/**
 * The applier (design D-07): converges a reviewed plan, in order — images,
 * volumes, files, the instances tier by tier (made stopped, started, and
 * health-gated before their dependants), the superseded resolver records,
 * the switch, the ingress, and the orphans last — and journals each step.
 *
 * Every write is compare-and-swap. An instance PATCH carries the planned
 * ETag (`If-Match`); where Incus gives none, or the ETag moved, the resource
 * is read again and compared with the plan (the rule of
 * `platform-apply.ts`'s `assertUnchanged`): what the plan expected is
 * changed, what the plan wanted is adopted (an earlier write whose answer was
 * lost), and anything else is refused. Effects are gates: `downtime` needs
 * --stop, and `data` is never applied — a missing data volume of a stack
 * that ran before is `tale restore`'s or `tale reset`'s.
 *
 * What a verb owns arrives as a hook: how an image is pulled, when an
 * instance is healthy, how the spawner and a backend are drained, and how a
 * switched replica is withdrawn.
 */

export interface ApplyHooks {
  /** Pull `image` into the project under its alias. */
  pullImage(image: StackImage): Promise<void>;
  /** Resolve once `instance` is healthy; throw when it will not be. */
  waitHealthy(instance: InstanceSpec): Promise<void>;
  /** Drain the spawner before it stops. */
  drainSandbox(instance: string): Promise<void>;
  /** Drain a backend replica before it stops. */
  drainBackend(instance: string): Promise<void>;
  /** Withdraw a switched replica (R3-02); the marker it set, or null. */
  withdraw(instance: string, service: string): Promise<string | null>;
  /** Admit a replica a crash left withdrawn: remove its marker. */
  admit(instance: string, marker: string): Promise<void>;
  /** The owner and mode a new volume's root gets (`initial.*`). */
  volumeOwner?(
    volume: StackVolume,
  ): { uid: number; gid: number; mode: string } | undefined;
}

export interface ApplyOptions {
  /** `--stop`: a running stop-gated instance may stop. */
  stop: boolean;
  /** The profiles every instance is made with. */
  profiles?: readonly string[];
  now?: () => Date;
}

export interface ApplyInput {
  client: IncusClient;
  stateRoot: string;
  desired: DesiredStack;
  plan: unknown;
  hooks: ApplyHooks;
  options: ApplyOptions;
}

export interface ApplyReceipt {
  /** Resources the apply wrote. */
  changed: string[];
  /** Resources it found already as the plan wanted them. */
  adopted: string[];
  deferred: { id: string; hint: string }[];
}

const STACK_PROFILE = 'tale-stack';
const WAIT_MS = 120_000;
const WANT_LABEL = 'user.tale.want';
const CONFIG_LABEL = 'user.tale.config';

/** Mark an instance as wanted running and start it (R-09). */
export async function startStackInstance(
  client: IncusClient,
  name: string,
): Promise<void> {
  await client.patchInstance(name, { config: { [WANT_LABEL]: 'running' } });
  await startInstance(client, name);
}

/**
 * Mark an instance as stopped by the CLI (R-09), then stop it within its
 * grace; a stop that does not finish in time is forced, with a warning.
 */
export async function stopStackInstance(
  client: IncusClient,
  name: string,
  graceSeconds: number,
): Promise<void> {
  await client.patchInstance(name, { config: { [WANT_LABEL]: 'stopped' } });
  try {
    await stopInstance(client, name, { timeoutSeconds: graceSeconds });
  } catch (error) {
    // A stop Incus refused or could not finish in time; anything else (the
    // connection, a cancellation) is no reason to force.
    if (!(error instanceof IncusApiError)) throw error;
    console.warn(
      `${name} did not stop within ${graceSeconds} s; forcing it:`,
      error instanceof Error ? error.message : error,
    );
    await stopInstance(client, name, { timeoutSeconds: 0, force: true });
  }
}

/** Write the deploy record by a new generation, then delete the older ones
 * (R3-29): a crash leaves the previous record in force. */
export async function writeStackRecord(
  client: IncusClient,
  pool: string,
  record: StackRecord,
): Promise<void> {
  const parsed = stackRecordSchema.parse(record);
  const target = { pool, volume: BACKUPS_VOLUME };
  const existing = await stackRecordFiles(client, pool);
  const generation = (existing[0]?.generation ?? 0) + 1;
  const path = `/stack.${generation}.json`;
  const bytes = new TextEncoder().encode(
    `${JSON.stringify(parsed, null, 2)}\n`,
  );
  await writeFile(client, target, path, bytes, {
    uid: 0,
    gid: 0,
    mode: '0600',
  });
  const back = await readFile(client, target, path);
  if (
    back?.type !== 'file' ||
    stableJson(
      stackRecordSchema.parse(
        JSON.parse(new TextDecoder().decode(back.content)),
      ),
    ) !== stableJson(parsed)
  )
    throw new Error(`The deploy record ${path} did not read back.`);
  for (const file of existing)
    await deleteFile(client, target, `/${file.name}`);
}

function modeText(mode: number): string {
  return `0${mode.toString(8).padStart(3, '0')}`;
}

function isPreconditionFailed(error: unknown): boolean {
  return error instanceof IncusApiError && error.status === 412;
}

async function readInstance(
  client: IncusClient,
  name: string,
  stack: string,
): Promise<ObservedInstance | undefined> {
  const read = await client.getInstance(name);
  if (read === undefined) return undefined;
  return {
    name,
    revision: read.etag ?? null,
    status: read.instance.status,
    running: read.instance.status === 'Running',
    config: read.instance.config,
    devices: read.instance.devices,
    profiles: read.instance.profiles,
    createdAt: read.instance.createdAt,
    custody: custodyOf(read.instance.config, stack),
  };
}

function changedSincePlanning(resource: IncusPlanResource) {
  return preconditionError(
    `The Incus resource ${resource.id} changed since planning. Create and review a new plan.`,
  );
}

/** The applier's rule for a resource read again: `adopt` what is already as
 * planned, `proceed` from what the plan read, refuse anything else. */
function compareWithPlan(
  resource: IncusPlanResource,
  observedSha: string,
): 'adopt' | 'proceed' {
  if (observedSha === resource.desiredSha256) return 'adopt';
  if (observedSha === resource.currentSha256) return 'proceed';
  throw changedSincePlanning(resource);
}

function grace(config: Readonly<Record<string, string>>): number {
  const value = Number(config['user.tale.grace'] ?? '10');
  return Number.isSafeInteger(value) && value >= 0 ? value : 10;
}

function priority(spec: InstanceSpec): number {
  return Number(spec.config['boot.autostart.priority'] ?? '0');
}

/** Apply a reviewed plan of `desired`. The caller holds the deploy lock. */
export async function applyIncusPlan(input: ApplyInput): Promise<ApplyReceipt> {
  const { client, stateRoot, desired, hooks, options } = input;
  const { target, key } = desired;
  const now = options.now ?? (() => new Date());
  const profiles = [...(options.profiles ?? [STACK_PROFILE])];
  const plan: IncusPlan = incusPlanSchema.parse(input.plan);
  if (plan.targetSha256 !== targetDigest(desired))
    throw preconditionError(
      'The Incus plan was made for another stack target. Create and review a new plan.',
    );
  if (stableJson(plan.destination) !== stableJson(desired.destination))
    throw preconditionError(
      'The Incus plan was made for another Incus destination. Create and review a new plan.',
    );

  const journal = await readJournal(stateRoot);
  assertNoRestorePending(journal, 'converge');
  const data = plan.resources.filter((resource) =>
    resource.effects.includes('data'),
  );
  if (data.length > 0)
    throw preconditionError(
      `The stack ran before, and its data volume${data.length === 1 ? '' : 's'} ${data.map((resource) => parseResourceId(resource.id).name).join(', ')} ${data.length === 1 ? 'is' : 'are'} missing; a deploy never makes ${data.length === 1 ? 'it' : 'them'} again empty.`,
      [
        'tale restore <snapshot>   (bring the data back)',
        'tale reset                (start over without it)',
      ],
    );
  const downtime = plan.resources.filter(
    (resource) =>
      resource.effects.includes('downtime') && resource.action !== 'deferred',
  );
  if (downtime.length > 0 && !options.stop)
    throw preconditionError(
      `This deploy stops ${downtime.map((resource) => parseResourceId(resource.id).name).join(', ')}.`,
      'Run it again with --stop to accept the downtime.',
    );

  const specs = new Map(target.instances.map((spec) => [spec.name, spec]));
  const filesById = new Map(
    desired.files.map((file) => [`file/${file.volume}/${file.path}`, file]),
  );
  const resources = new Map(
    plan.resources.map((resource) => [resource.id, resource]),
  );
  const receipt: ApplyReceipt = { changed: [], adopted: [], deferred: [] };

  const journalUpdate = (change: (journal: IncusJournal) => void) =>
    updateJournal(stateRoot, target.stack, change, now);

  // A replica a crash left withdrawn, which this plan keeps, is admitted.
  for (const entry of journal?.withdrawn ?? []) {
    const resource = resources.get(`instance/${entry.instance}`);
    const kept =
      resource !== undefined &&
      (resource.action === 'unchanged' ||
        resource.action === 'update' ||
        resource.action === 'deferred');
    const exists = (await client.getInstance(entry.instance)) !== undefined;
    if (kept && exists) await hooks.admit(entry.instance, entry.marker);
    // A replica the plan replaces or deletes keeps its marker until it goes.
    if (kept || !exists)
      await journalUpdate((next) => {
        next.withdrawn = next.withdrawn.filter(
          (other) => other.instance !== entry.instance,
        );
      });
  }

  await journalUpdate((next) => {
    next.phase = 'pending';
    next.planSha256 = key.digest(plan);
    next.steps = [];
  });
  const done = async (
    resource: IncusPlanResource,
    outcome: 'changed' | 'adopted',
  ) => {
    receipt[outcome].push(resource.id);
    await journalUpdate((next) => {
      next.steps.push({ id: resource.id, action: resource.action });
    });
  };

  // ---- the steps, one resource at a time --------------------------------

  const pullImage = async (resource: IncusPlanResource) => {
    const alias = parseResourceId(resource.id).name;
    const image = target.images.find((candidate) => candidate.alias === alias);
    if (image === undefined)
      throw new Error(`No image ${alias} in the target.`);
    if ((await client.getImageAlias(alias)) !== undefined)
      return done(resource, 'adopted');
    await hooks.pullImage(image);
    return done(resource, 'changed');
  };

  const volumeSpec = (name: string): StackVolume =>
    target.volumes.find((volume) => volume.name === name) ?? {
      name,
      kind: 'data',
      pool: target.pool,
      config: {},
    };

  const convergeVolume = async (resource: IncusPlanResource) => {
    const name = parseResourceId(resource.id).name;
    const volume = volumeSpec(name);
    const config = volumeConfig(volume, target.stack);
    const observed = await client.getVolume(target.pool, name);
    const verdict = compareWithPlan(
      resource,
      observedVolumeState(
        key,
        config,
        observed && {
          name,
          config: observed.config,
          usedBy: [],
          custody: custodyOf(observed.config, target.stack),
        },
      ),
    );
    if (verdict === 'adopt') return done(resource, 'adopted');
    if (observed === undefined) {
      const owner = hooks.volumeOwner?.(volume);
      try {
        await client.createVolume(target.pool, {
          name,
          type: 'custom',
          content_type: 'filesystem',
          config: {
            ...config,
            ...(owner === undefined
              ? {}
              : {
                  'initial.uid': String(owner.uid),
                  'initial.gid': String(owner.gid),
                  'initial.mode': owner.mode,
                }),
          },
        });
      } catch (error) {
        if (!isIncusNameConflict(error)) throw error;
        // Made by an earlier attempt whose answer was lost: compared next run.
        console.warn(`Volume ${name} already exists; keeping it.`);
      }
      return done(resource, 'changed');
    }
    const changes: Record<string, string> = {};
    for (const [field, value] of Object.entries(config))
      if (observed.config[field] !== value) changes[field] = value;
    await client.sync(
      'PATCH',
      `/1.0/storage-pools/${encodeURIComponent(target.pool)}/volumes/custom/${encodeURIComponent(name)}`,
      { query: { project: client.project }, json: { config: changes } },
    );
    return done(resource, 'changed');
  };

  const readFiles = async (file: RenderedFile): Promise<ObservedFile[]> => {
    const volumeTarget = { pool: target.pool, volume: file.volume };
    const paths: { path: string; generation: number | null }[] = [];
    if (file.write === 'overwrite')
      paths.push({ path: `/${file.path}`, generation: null });
    else {
      const directory = posix.dirname(`/${file.path}`);
      const base = posix.basename(file.path);
      const listing = await readFile(client, volumeTarget, directory);
      if (listing?.type === 'directory')
        for (const entry of listing.entries) {
          const suffix = entry.slice(base.length + 1);
          if (entry.startsWith(`${base}.`) && /^\d{1,12}$/.test(suffix))
            paths.push({
              path: posix.join(directory, entry),
              generation: Number(suffix),
            });
        }
    }
    const found: ObservedFile[] = [];
    for (const candidate of paths) {
      const entry = await readFile(client, volumeTarget, candidate.path);
      if (entry?.type !== 'file') continue;
      found.push({
        volume: file.volume,
        path: file.path,
        generation: candidate.generation,
        sha256: key.digestBytes(entry.content),
        mode: Number.parseInt(entry.mode, 8),
        uid: entry.uid,
        gid: entry.gid,
      });
    }
    return found;
  };

  const putFile = async (file: RenderedFile, path: string) => {
    const volumeTarget = { pool: target.pool, volume: file.volume };
    const parts = posix
      .dirname(path)
      .split('/')
      .filter((part) => part !== '');
    for (let depth = 1; depth <= parts.length; depth += 1)
      await makeDirectory(
        client,
        volumeTarget,
        `/${parts.slice(0, depth).join('/')}`,
        { uid: file.uid, gid: file.gid, mode: '0755' },
      );
    await writeFile(client, volumeTarget, path, file.content, {
      uid: file.uid,
      gid: file.gid,
      mode: modeText(file.mode),
    });
  };

  const convergeFile = async (resource: IncusPlanResource) => {
    const file = filesById.get(resource.id);
    if (file === undefined) throw new Error(`No file ${resource.id}.`);
    const found = await readFiles(file);
    const { newest } = fileGenerations(found, file.volume, file.path);
    const current =
      file.write === 'overwrite'
        ? found.find((entry) => entry.generation === null)
        : newest;
    const observedSha = observedFileState(key, current);
    // Superseded generations go once the instances converged (the names
    // step), so an equal newest generation is adopted as it is.
    if (observedSha === desiredFileState(key, file))
      return done(resource, 'adopted');
    compareWithPlan(resource, observedSha);
    const next =
      Math.max(0, ...found.map((entry) => entry.generation ?? 0)) + 1;
    await putFile(
      file,
      file.write === 'overwrite' ? `/${file.path}` : `/${file.path}.${next}`,
    );
    return done(resource, 'changed');
  };

  const retireGenerations = async (file: RenderedFile) => {
    const found = await readFiles(file);
    const { stale } = fileGenerations(found, file.volume, file.path);
    for (const entry of stale)
      await deleteFile(
        client,
        { pool: target.pool, volume: file.volume },
        `/${file.path}.${entry.generation}`,
      );
  };

  /** PATCH under `revision` (the planned ETag, or the one a comparison
   * accepted); when Incus answers 412, compare what is there now. */
  const patchChecked = async (
    resource: IncusPlanResource,
    name: string,
    patch: { config?: Record<string, string>; devices?: Devices },
    stateOf: (instance: ObservedInstance | undefined) => string,
    revision: string | null,
  ): Promise<'adopted' | 'changed'> => {
    try {
      await client.patchInstance(
        name,
        patch,
        revision === null ? {} : { ifMatch: revision },
      );
      return 'changed';
    } catch (error) {
      if (!isPreconditionFailed(error)) throw error;
    }
    // The ETag moved since planning: compare what is there now.
    const read = await readInstance(client, name, target.stack);
    if (compareWithPlan(resource, stateOf(read)) === 'adopt') return 'adopted';
    await client.patchInstance(
      name,
      patch,
      read?.revision ? { ifMatch: read.revision } : {},
    );
    return 'changed';
  };

  const retire = async (
    resource: IncusPlanResource,
    observed: ObservedInstance,
  ) => {
    const name = observed.name;
    const service = observed.config['user.tale.service'] ?? '';
    if (observed.running) {
      if (SWITCHED_SERVICES.has(service)) {
        const marker = await hooks.withdraw(name, service);
        if (marker !== null)
          await journalUpdate((next) => {
            if (!next.withdrawn.some((entry) => entry.instance === name))
              next.withdrawn.push({ instance: name, marker });
          });
      }
      if (resource.effects.includes('drain-backend'))
        await hooks.drainBackend(name);
      if (resource.effects.includes('drain-sandbox'))
        await hooks.drainSandbox(name);
      await stopStackInstance(client, name, grace(observed.config));
    }
    await client.deleteInstance(name, WAIT_MS);
    await journalUpdate((next) => {
      next.withdrawn = next.withdrawn.filter(
        (entry) => entry.instance !== name,
      );
    });
  };

  /** Make the instance stopped, with the files it owns, then start it. */
  const create = async (spec: InstanceSpec, sha256: string) => {
    const want = desiredInstance(spec, desired);
    for (const file of desired.files)
      if (file.instance === spec.name) await putFile(file, `/${file.path}`);
    try {
      await client.createInstance(
        {
          name: spec.name,
          ephemeral: false,
          profiles,
          config: {
            ...want.config,
            [CONFIG_LABEL]: sha256,
            [WANT_LABEL]: 'running',
          },
          devices: withoutIngress(want.devices),
          source: { type: 'image', alias: spec.image },
          start: false,
        },
        WAIT_MS,
      );
    } catch (error) {
      if (!isIncusNameConflict(error)) throw error;
      const read = await readInstance(client, spec.name, target.stack);
      if (
        read === undefined ||
        read.custody.verdict !== 'stack' ||
        observedInstanceState(key, { ...read, running: true }) !== sha256
      )
        throw error;
    }
    await startInstance(client, spec.name);
  };

  /** Converge one instance of the target; true when it was started. */
  const convergeInstance = async (
    resource: IncusPlanResource,
  ): Promise<boolean> => {
    const name = parseResourceId(resource.id).name;
    const spec = specs.get(name);
    if (spec === undefined)
      throw new Error(`No instance ${name} in the target.`);
    const want = desiredInstance(spec, desired);
    const stateOf = (instance: ObservedInstance | undefined) =>
      observedInstanceState(key, instance);
    if (resource.action === 'create') {
      const read = await readInstance(client, name, target.stack);
      if (compareWithPlan(resource, stateOf(read)) === 'adopt') {
        await done(resource, 'adopted');
        return false;
      }
      await create(spec, want.sha256);
      await done(resource, 'changed');
      return true;
    }
    if (resource.action === 'update') {
      const read = await readInstance(client, name, target.stack);
      if (read === undefined) throw changedSincePlanning(resource);
      // The planned ETag still holds: the PATCH carries it. Otherwise the
      // instance is compared with the plan first.
      if (
        (resource.revision === null || read.revision !== resource.revision) &&
        compareWithPlan(resource, stateOf(read)) === 'adopt'
      ) {
        await done(resource, 'adopted');
        return false;
      }
      const changes: Record<string, string> = {};
      const config = {
        ...want.config,
        [CONFIG_LABEL]: want.sha256,
        [WANT_LABEL]: 'running',
      };
      for (const [field, value] of Object.entries(config))
        if (read.config[field] !== value) changes[field] = value;
      for (const field of Object.keys(read.config))
        if (
          !Object.hasOwn(config, field) &&
          !field.startsWith('volatile.') &&
          !field.startsWith('image.') &&
          !isImageFilled(read.config, field) &&
          field !== 'user.tale.started'
        )
          changes[field] = '';
      if (Object.keys(changes).length > 0)
        await patchChecked(
          resource,
          name,
          { config: changes },
          stateOf,
          read.revision,
        );
      const started = !read.running;
      if (started) await startInstance(client, name);
      await done(resource, 'changed');
      return started;
    }
    if (resource.action === 'replace') {
      const read = await readInstance(client, name, target.stack);
      if (read === undefined) throw changedSincePlanning(resource);
      if (compareWithPlan(resource, stateOf(read)) === 'adopt') {
        await done(resource, 'adopted');
        return false;
      }
      await retire(resource, read);
      await create(spec, want.sha256);
      await done(resource, 'changed');
      return true;
    }
    if (resource.action === 'deferred')
      receipt.deferred.push({ id: resource.id, hint: resource.hint ?? '' });
    return false;
  };

  const convergeIngress = async (resource: IncusPlanResource) => {
    const name = parseResourceId(resource.id).name;
    const spec = specs.get(name);
    if (spec === undefined)
      throw new Error(`No instance ${name} in the target.`);
    const read = await readInstance(client, name, target.stack);
    if (read === undefined)
      throw preconditionError(
        `${name} is missing, so its ingress cannot be set. Create and review a new plan.`,
      );
    const stateOf = (instance: ObservedInstance | undefined) =>
      ingressState(key, instance?.devices ?? {});
    if (compareWithPlan(resource, stateOf(read)) === 'adopt')
      return done(resource, 'adopted');
    const want = ingressOf(spec.devices);
    const have = ingressOf(read.devices);
    const add = Object.fromEntries(
      Object.entries(want).filter(
        ([device, value]) =>
          have[device] === undefined ||
          stableJson(have[device]) !== stableJson(value),
      ),
    );
    if (Object.keys(add).length > 0)
      await patchChecked(
        resource,
        name,
        { devices: add },
        stateOf,
        read.revision,
      );
    for (const device of Object.keys(have))
      if (!Object.hasOwn(want, device)) {
        const fresh = await client.getInstance(name);
        await detachDevice(client, name, device, {
          ifMatch: fresh?.etag ?? '',
        });
      }
    return done(resource, 'changed');
  };

  const deleteOrphan = async (resource: IncusPlanResource) => {
    const { kind, name } = parseResourceId(resource.id);
    if (kind === 'instance') {
      const read = await readInstance(client, name, target.stack);
      if (read === undefined) return done(resource, 'adopted');
      compareWithPlan(resource, observedInstanceState(key, read));
      await retire(resource, read);
      return done(resource, 'changed');
    }
    if (kind === 'volume') {
      const observed = await client.getVolume(target.pool, name);
      if (observed === undefined) return done(resource, 'adopted');
      compareWithPlan(
        resource,
        observedVolumeState(key, observed.config, {
          name,
          config: observed.config,
          usedBy: [],
          custody: custodyOf(observed.config, target.stack),
        }),
      );
      await client.deleteVolume(target.pool, name);
      return done(resource, 'changed');
    }
    if (kind === 'ingress') return convergeIngress(resource);
    throw new Error(`A plan does not delete ${resource.id}.`);
  };

  // ---- the order ---------------------------------------------------------

  const of = (kind: string) =>
    plan.resources.filter(
      (resource) =>
        parseResourceId(resource.id).kind === kind &&
        resource.action !== 'delete',
    );
  const isSwitch = (resource: IncusPlanResource) =>
    specs.get(parseResourceId(resource.id).name)?.service === 'switch';

  for (const resource of of('image'))
    if (resource.action !== 'unchanged') await pullImage(resource);
  for (const resource of of('volume'))
    if (resource.action !== 'unchanged') await convergeVolume(resource);
  for (const resource of of('file'))
    if (resource.action !== 'unchanged') await convergeFile(resource);

  // The tier, wave by wave: a wave is gated healthy before the next starts,
  // and before an instance that depends on one of it.
  const waiting: InstanceSpec[] = [];
  let wavePriority: number | null = null;
  const gate = async () => {
    for (const spec of waiting.splice(0)) await hooks.waitHealthy(spec);
  };
  const instanceStep = async (resource: IncusPlanResource) => {
    const spec = specs.get(parseResourceId(resource.id).name);
    if (spec === undefined) return;
    const dependsOnWave = spec.dependsOn.some((dependency) =>
      waiting.some((other) => other.service === dependency.service),
    );
    if (
      waiting.length > 0 &&
      (priority(spec) !== wavePriority || dependsOnWave)
    )
      await gate();
    wavePriority = priority(spec);
    if (resource.action === 'unchanged') return;
    if (await convergeInstance(resource)) waiting.push(spec);
  };
  for (const resource of of('instance').filter((r) => !isSwitch(r)))
    await instanceStep(resource);
  await gate();

  // The names: the records the instances now answer by; older generations go.
  for (const resource of of('file')) {
    const file = filesById.get(resource.id);
    if (file?.write === 'generation' && resource.action !== 'unchanged')
      await retireGenerations(file);
  }

  for (const resource of of('instance').filter(isSwitch))
    await instanceStep(resource);
  await gate();

  for (const resource of of('ingress'))
    if (resource.action !== 'unchanged') await convergeIngress(resource);

  for (const resource of plan.resources.filter(
    (candidate) =>
      candidate.action === 'delete' &&
      parseResourceId(candidate.id).kind !== 'volume',
  ))
    await deleteOrphan(resource);
  for (const resource of plan.resources.filter(
    (candidate) =>
      candidate.action === 'delete' &&
      parseResourceId(candidate.id).kind === 'volume',
  ))
    await deleteOrphan(resource);

  // The deploy record, once the stack first ran (or first ran since a reset).
  if (
    (plan.phase === 'full' || plan.phase === 'stateful') &&
    (await client.getVolume(target.pool, BACKUPS_VOLUME)) !== undefined
  ) {
    const record = await readStackRecord(client, target.pool, target.stack);
    if (record?.deployedAt === undefined || resetSinceDeploy(record))
      await writeStackRecord(client, target.pool, {
        schemaVersion: 1,
        stack: target.stack,
        deployedAt: now().toISOString(),
        ...(record?.resetAt === undefined ? {} : { resetAt: record.resetAt }),
      });
  }

  await journalUpdate((next) => {
    next.phase = 'ready';
  });
  return receipt;
}
