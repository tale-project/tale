import { IncusApiError } from '@tale/incus/api';
import type { IncusClient } from '@tale/incus/client';

import { preconditionError } from '../../../utils/fail';
import { waitForHealthy } from '../../docker/wait-for-healthy';
import { readImageFacts } from '../../oci/image-facts';
import {
  createRegistryClient,
  ociCacheDirectory,
  parseImageReference,
  type RegistryClient,
} from '../../oci/registry';
import type {
  CopyOutOptions,
  CopyResult,
  EnsuredImages,
  ExecResult,
  FileOwner,
  HealthState,
  ImageFacts,
  ImageRef,
  InstanceInfo,
  LogOptions,
  OneShotJob,
  ProbeResult,
  RuntimeCheck,
  RuntimeSession,
  StackRuntime,
  WaitHealthyOptions,
  WaitServiceHealthyOptions,
} from '../types';
import type { ApplyHooks } from './apply/apply';
import { markInterruptedSync } from './apply/journal';
import type {
  IncusDeclaration,
  StackImage,
  StackTarget,
} from './compile/stack-target';
import { imageAlias, type InstanceSpec } from './compile/translate';
import { loadPlanKey, type PlanKey } from './plan/digest';
import {
  execInInstance,
  execSessionInInstance,
  reapPayloads,
  type IncusExecOptions,
  type IncusVerbContext,
} from './verbs/exec';
import { copyIntoInstance, copyOutOfInstance } from './verbs/files';
import { IncusHealth, type HealthcheckLookup } from './verbs/health';
import {
  imageFsFacts,
  reapProbes,
  type ImageFsFacts,
} from './verbs/image-facts-cache';
import {
  ensureImages,
  pruneImages,
  pullFailure,
  registryHosts,
} from './verbs/images';
import {
  createStackInstance,
  declaredGrace,
  freezeStackInstances,
  inspectStackInstance,
  listStackInstances,
  provePid1,
  removeStackInstance,
  startStackInstance,
  stopStackInstance,
  thawStackInstances,
  type Pid1Proof,
  type StopGrace,
} from './verbs/instances';
import {
  crashReport,
  crashTail,
  readInstanceLogs,
  type LogReadDependencies,
} from './verbs/logs';
import { reapHelpers, runOneShot } from './verbs/oneshot';
import { probeIncus, type IncusProbe } from './verbs/probe';
import {
  admitReplicas,
  switchApplyHooks,
  withdrawReplicas,
  type SwitchDependencies,
} from './verbs/switch';
import {
  assertPoolUnchanged,
  ensureStackVolumes,
  listStackVolumes,
  mountPointsByDigest,
  removeStackVolume,
  volumeOwners,
  type VolumeInfo,
  type VolumeOwner,
} from './verbs/volumes';

/**
 * The Incus runtime: the stack's instances, images and volumes in one
 * restricted Incus project, over the REST API (design 3, 4).
 *
 * This is the part of `StackRuntime` that the probe, the images, the volumes,
 * the instances, exec, the file copies, the console, one-shot helpers,
 * health and the switch's admission answer. A verb the Incus runtime cannot
 * answer yet — converge and quiescing — is refused with a sentence that says so, never
 * answered with Docker's meaning. Beyond the interface, the runtime offers
 * the whole-stack steps a managed deployment drives: the image facts, the
 * volumes with their owners, instance creation, a stop with a chosen grace,
 * freeze and thaw, image pruning, the PID 1 proof, the reaping of what a
 * crash left (exec stdin files, helpers) and a stopped instance's crash
 * tail.
 */

export interface IncusRuntimeOptions {
  client: IncusClient;
  declaration: IncusDeclaration;
  /** `user.tale.stack`: the workspace project id or the managed project. */
  stack: string;
  /** Where `.tale/incus/` (plan key, image facts, pull order) lives. */
  stateRoot: string;
  /** The registry `inspectImage` reads; an anonymous client with the
   * declared mirror and a cache under the state root by default. */
  registry?: RegistryClient;
  /** The healthcheck of each instance; from the compiled stack the
   * runtime was given (`useTarget`) by default. */
  healthchecks?: HealthcheckLookup;
  /** The `tale-proxy` image one-shot helpers run from (design D-30); the
   * target's proxy image by default. */
  helperImage?: { alias: string; digest?: string };
  /** How `logs --follow` waits between reads (tests). */
  logReads?: LogReadDependencies;
  /** How a withdrawal waits for the switch (tests). */
  switchDependencies?: SwitchDependencies;
}

function notYet(verb: string): Promise<never> {
  return Promise.reject(
    preconditionError(
      `The Incus runtime cannot ${verb} yet in this CLI.`,
      'Deploy this stack on Docker until the Incus runtime is complete.',
    ),
  );
}

export class IncusRuntime implements StackRuntime {
  readonly engine = 'incus' as const;
  readonly withdrawal = 'marker' as const;
  readonly client: IncusClient;
  readonly declaration: IncusDeclaration;
  readonly stack: string;
  readonly stateRoot: string;
  private readonly registry: RegistryClient;
  private key: Promise<PlanKey> | undefined;
  private platform: string | undefined;
  private target: StackTarget | undefined;
  private owners = new Map<string, VolumeOwner>();
  private readonly healthReader: IncusHealth;
  private readonly helperImage: IncusRuntimeOptions['helperImage'];
  private readonly logReads: LogReadDependencies;
  private readonly switchDependencies: SwitchDependencies;
  /** One-shot helpers running in this process. */
  private readonly activeHelpers = new Set<string>();

  constructor(options: IncusRuntimeOptions) {
    this.client = options.client;
    this.declaration = options.declaration;
    this.stack = options.stack;
    this.stateRoot = options.stateRoot;
    this.helperImage = options.helperImage;
    this.logReads = options.logReads ?? {};
    this.switchDependencies = options.switchDependencies ?? {};
    this.healthReader = new IncusHealth(
      this.verbContext,
      options.healthchecks ??
        ((name) =>
          this.target?.instances.find((instance) => instance.name === name)
            ?.healthcheck),
    );
    this.registry =
      options.registry ??
      createRegistryClient({
        ...(options.declaration.registryMirror === undefined
          ? {}
          : { registryMirror: options.declaration.registryMirror }),
        cacheDirectory: ociCacheDirectory(options.stateRoot),
      });
  }

  /** What the exec, file, log, health and helper verbs act within. */
  get verbContext(): IncusVerbContext {
    return {
      client: this.client,
      stack: this.stack,
      stateRoot: this.stateRoot,
    };
  }

  /** The API the client dials, as the declaration names it. */
  private get endpoint(): string {
    return (
      this.declaration.endpoint ??
      `https://${this.declaration.network.gateway}:8443`
    );
  }

  private planKey(): Promise<PlanKey> {
    this.key ??= loadPlanKey(this.stateRoot);
    return this.key;
  }

  /** The compiled stack the volume verbs make volumes for. */
  useTarget(target: StackTarget): void {
    if (target.stack !== this.stack || target.pool !== this.declaration.pool)
      throw new Error(
        `The target ${target.stack} on ${target.pool} is not this runtime's stack ${this.stack} on ${this.declaration.pool}.`,
      );
    this.target = target;
  }

  private requireTarget(): StackTarget {
    if (this.target === undefined)
      throw new Error('The Incus runtime has no stack target yet.');
    return this.target;
  }

  // ---- readiness -----------------------------------------------------------

  /** The full probe: every refusal and warning, and the server's facts. */
  async probeDetail(registries?: readonly string[]): Promise<IncusProbe> {
    const probe = await probeIncus(this.client, {
      pool: this.declaration.pool,
      registries:
        registries ??
        (this.target === undefined
          ? []
          : registryHosts(this.target.images, this.declaration.registryMirror)),
    });
    if (probe.facts !== null) this.platform = probe.facts.platform;
    return probe;
  }

  async probe(): Promise<ProbeResult> {
    let probe: IncusProbe;
    try {
      probe = await this.probeDetail();
    } catch (error) {
      return {
        status: 'failed',
        detail: `The Incus API at ${this.endpoint} did not answer: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (probe.errors.length > 0)
      return { status: 'refused', detail: probe.errors.join('\n') };
    for (const warning of probe.warnings) console.warn(warning);
    return {
      status: 'ready',
      detail: `Incus ${probe.facts?.version ?? ''} on ${probe.facts?.architecture ?? ''}, pool ${this.declaration.pool} (${probe.facts?.poolDriver ?? ''})`,
    };
  }

  async checkReachable(): Promise<RuntimeCheck> {
    try {
      await this.client.getServer();
      return { status: 'ok', detail: `Incus API ${this.endpoint}` };
    } catch (error) {
      return {
        status: 'fail',
        detail: `The Incus API at ${this.endpoint} did not answer: ${error instanceof Error ? error.message : String(error)}`,
        fix: 'Check runtime.incus.endpoint and that the client certificate is trusted.',
      };
    }
  }

  async checkEngine(): Promise<RuntimeCheck> {
    const probe = await this.probeDetail();
    if (probe.errors.length > 0)
      return {
        status: 'fail',
        detail: probe.errors.join('\n'),
        fix: 'tale incus contract prints what the project needs.',
      };
    return probe.warnings.length > 0
      ? { status: 'warn', detail: probe.warnings.join('\n') }
      : {
          status: 'ok',
          detail: `Incus ${probe.facts?.version ?? ''} (${probe.facts?.platform ?? ''})`,
        };
  }

  // ---- census and readback ---------------------------------------------------

  async list(filter: { stack: string; service?: string }) {
    return listStackInstances(this.client, filter, await this.planKey());
  }

  async listByName(fragment: string) {
    return (await this.client.listInstances())
      .filter(
        (instance) =>
          instance.name.includes(fragment) &&
          instance.config['user.tale.stack'] === this.stack,
      )
      .map((instance) => ({ name: instance.name, status: instance.status }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async exists(name: string): Promise<boolean> {
    return (await this.client.getInstance(name)) !== undefined;
  }

  async isRunning(name: string): Promise<boolean> {
    return (await this.client.getInstance(name))?.instance.status === 'Running';
  }

  async state(name: string): Promise<string | null> {
    return (await this.inspect(name))?.state ?? null;
  }

  async version(name: string): Promise<string | null> {
    return (
      (await this.client.getInstance(name))?.instance.config[
        'user.tale.version'
      ] ?? null
    );
  }

  /** Docker's health, judged by the CLI from exec probes (design D-24). */
  health(name: string): Promise<HealthState> {
    return this.healthReader.health(name);
  }

  async inspect(name: string): Promise<InstanceInfo | null> {
    return inspectStackInstance(this.client, name, await this.planKey());
  }

  // ---- images ------------------------------------------------------------------

  /** The platform the server runs, from the probe. */
  private async serverPlatform(): Promise<string> {
    if (this.platform === undefined) {
      const probe = await this.probeDetail([]);
      if (probe.facts === null)
        throw preconditionError(
          `The Incus server's platform is unknown:\n${probe.errors.join('\n')}`,
        );
    }
    return this.platform ?? '';
  }

  async inspectImage(reference: string): Promise<ImageFacts> {
    return readImageFacts(
      this.registry,
      reference,
      await this.serverPlatform(),
    );
  }

  /** An `ImageRef` as the stack image Incus pulls; it must name a digest. */
  private stackImage(ref: ImageRef): StackImage {
    const digest = parseImageReference(ref.reference).digest;
    if (digest === null)
      throw preconditionError(
        `Image ${ref.reference} names no digest; Incus pulls a stack image by digest only.`,
      );
    const alias = imageAlias({ reference: ref.reference, digest });
    // An alias names exactly one digest: one of another shape (Docker's
    // `tale-sandbox:latest`) fails this image alone, not the whole pull.
    if (ref.alias !== undefined && ref.alias !== alias)
      throw preconditionError(
        `Image ${ref.reference} is asked for under the alias ${ref.alias}, not ${alias}.`,
      );
    return {
      alias,
      reference: ref.reference,
      digest,
      services: [],
    };
  }

  async ensureImages(refs: readonly ImageRef[]): Promise<EnsuredImages> {
    const images: StackImage[] = [];
    const failed: EnsuredImages['failed'] = [];
    for (const ref of refs) {
      try {
        images.push(this.stackImage(ref));
      } catch (error) {
        failed.push({
          reference: ref.reference,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const ensured = await ensureImages(this.client, images, {
      stateRoot: this.stateRoot,
      ...(this.declaration.registryMirror === undefined
        ? {}
        : { registryMirror: this.declaration.registryMirror }),
    });
    return { failed: [...failed, ...ensured.failed] };
  }

  /** Pull the target's images; any failure is refused. */
  async ensureTargetImages(target: StackTarget): Promise<void> {
    const ensured = await ensureImages(this.client, target.images, {
      stateRoot: this.stateRoot,
      ...(this.declaration.registryMirror === undefined
        ? {}
        : { registryMirror: this.declaration.registryMirror }),
    });
    if (ensured.failed.length > 0) throw pullFailure(ensured.failed);
  }

  /** Delete the stack's images beyond the target's and the ones before. */
  pruneImages(current: readonly string[]): Promise<string[]> {
    return pruneImages(this.client, current, { stateRoot: this.stateRoot });
  }

  /** The filesystem facts of every image of `target` (its images must be
   * in the project): the mount points' owners, the app user, `timeout`
   * and the infrastructure formats. */
  async imageFacts(target: StackTarget): Promise<Map<string, ImageFsFacts>> {
    const paths = mountPointsByDigest(target);
    await reapProbes(this.client, this.stack);
    const requests = [];
    for (const image of target.images) {
      const facts = await this.inspectImage(image.reference);
      requests.push({
        alias: image.alias,
        digest: image.digest,
        env: facts.env,
        labels: facts.labels,
        paths: paths.get(image.digest) ?? [],
      });
    }
    return imageFsFacts(this.client, requests, {
      stateRoot: this.stateRoot,
      stack: this.stack,
    });
  }

  pull(image: string): Promise<boolean> {
    return this.ensureImages([{ reference: image }]).then(
      (ensured) => ensured.failed.length === 0,
    );
  }

  /** Whether the project holds the image; one named by tag alone never
   * is, because Incus holds stack images by digest. */
  async imagePresent(image: string): Promise<boolean> {
    if (parseImageReference(image).digest === null) return false;
    return (
      (await this.client.getImageAlias(
        this.stackImage({ reference: image }).alias,
      )) !== undefined
    );
  }

  tag(): Promise<never> {
    return notYet('give an image a second name (Incus names it by its alias)');
  }

  // ---- volumes and networks --------------------------------------------------

  /** Make the target's volumes (all of them, or those named) with the
   * owners their images give them; the pool must not have changed. */
  async ensureStackVolumes(
    target: StackTarget,
    names?: readonly string[],
  ): Promise<string[]> {
    this.useTarget(target);
    await assertPoolUnchanged(this.client, target);
    const facts = await this.imageFacts(target);
    this.owners = volumeOwners(target, facts);
    const volumes =
      names === undefined
        ? target.volumes
        : target.volumes.filter((volume) => names.includes(volume.name));
    return ensureStackVolumes(this.client, target, volumes, this.owners);
  }

  /** Read the owners the target's volumes are made with, for the applier's
   * `volumeOwner` hook, and make none: the applier makes them, and refuses a
   * missing data volume first (R3-22). The target's images must be in the
   * project. */
  async readVolumeOwners(target: StackTarget): Promise<void> {
    this.useTarget(target);
    await assertPoolUnchanged(this.client, target);
    this.owners = volumeOwners(target, await this.imageFacts(target));
  }

  /** The owner a volume of the last target is made with (the applier's
   * `volumeOwner` hook). */
  volumeOwner(volume: { name: string }): VolumeOwner | undefined {
    return this.owners.get(volume.name);
  }

  async volumeExists(name: string): Promise<boolean> {
    return (
      (await this.client.getVolume(this.declaration.pool, name)) !== undefined
    );
  }

  /** Incus volumes carry no prefix (D-27): `names` are the target's
   * logical names, which must all be in it. */
  async ensureVolumes(names: readonly string[]): Promise<boolean> {
    const target = this.requireTarget();
    const unknown = names.filter(
      (name) => !target.volumes.some((volume) => volume.name === name),
    );
    if (unknown.length > 0)
      throw preconditionError(`The stack has no volume ${unknown.join(', ')}.`);
    await this.ensureStackVolumes(target, names);
    return true;
  }

  listVolumes(): Promise<VolumeInfo[]> {
    return listStackVolumes(this.client, this.declaration.pool, this.stack);
  }

  removeVolume(name: string): Promise<boolean> {
    return removeStackVolume(
      this.client,
      this.declaration.pool,
      this.stack,
      name,
    );
  }

  async volumeRemovalHint(name: string): Promise<string | null> {
    return (await this.volumeExists(name))
      ? `incus storage volume delete ${this.declaration.pool} ${name} --project ${this.client.project}`
      : null;
  }

  /** Docker's pre-rename config volume never existed on Incus. */
  async migrateConfigVolume(): Promise<void> {}

  /** The CLI makes no network on Incus (D-15): the declared bridge must
   * exist, and only it may be asked for. */
  async ensureNetwork(name: string): Promise<boolean> {
    if (name !== this.declaration.network.name) return false;
    try {
      await this.client.getNetwork(name);
      return true;
    } catch (error) {
      if (error instanceof IncusApiError && error.status === 404) return false;
      throw error;
    }
  }

  /** The stack has no sandbox network on Incus (D-14): sessions are routed
   * in from their own zone. */
  async ensureSandboxNetwork(): Promise<boolean> {
    return true;
  }

  async pruneNetworks() {
    return { success: true, stdout: '', stderr: '', exitCode: 0 };
  }

  async volumeUsers(volume: string): Promise<string[]> {
    const found = await this.client.getVolume(this.declaration.pool, volume);
    if (found === undefined) return [];
    const users: string[] = [];
    for (const url of found.usedBy) {
      const path = url.split('?')[0] ?? '';
      const name = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
      if (await this.isRunning(name)) users.push(name);
    }
    return users.sort();
  }

  quiesce(): Promise<never> {
    return notYet('quiesce volumes for a snapshot');
  }

  // ---- lifecycle -----------------------------------------------------------------

  converge(): Promise<never> {
    return notYet('converge a compose document');
  }

  /** Wait as Docker's wait does, every 2 s, on the CLI's own health; the
   * console of a running instance is never read (`streamLogs` is not). */
  waitHealthy(name: string, options: WaitHealthyOptions): Promise<boolean> {
    return waitForHealthy(name, { ...options, runtime: this });
  }

  async waitServiceHealthy(
    stack: string,
    service: string,
    options: WaitServiceHealthyOptions,
  ): Promise<boolean> {
    const replicas = await this.list({ stack, service });
    if (replicas.length < options.expectedReplicas) {
      console.error(
        `Expected ${options.expectedReplicas} ${service} replica(s) in ${stack}, found ${replicas.length}`,
      );
      return false;
    }
    for (const replica of replicas)
      if (!(await this.waitHealthy(replica.name, options))) return false;
    return true;
  }

  /** Make an instance of the target, stopped. */
  createInstance(spec: InstanceSpec): Promise<void> {
    return createStackInstance(this.client, spec);
  }

  /** Start an instance and record that the CLI started it. */
  async start(name: string): Promise<void> {
    await startStackInstance(this.client, name);
  }

  /** Stop within its declared grace, then force with a warning. */
  async stop(name: string): Promise<boolean> {
    const read = await this.client.getInstance(name);
    if (read === undefined) return false;
    await stopStackInstance(
      this.client,
      name,
      declaredGrace(read.instance.config),
    );
    return true;
  }

  /** Stop within `grace` seconds, then force with a warning; `forever`
   * waits the declared grace and never forces. */
  stopWithin(name: string, grace: StopGrace): Promise<void> {
    return stopStackInstance(this.client, name, grace);
  }

  remove(name: string): Promise<boolean> {
    return removeStackInstance(this.client, this.stack, name);
  }

  freeze(names: readonly string[]): Promise<void> {
    return freezeStackInstances(this.client, names);
  }

  thaw(names: readonly string[]): Promise<void> {
    return thawStackInstances(this.client, names);
  }

  /** What runs as PID 1 of a converged instance. */
  provePid1(name: string): Promise<Pid1Proof> {
    return provePid1(this.client, name);
  }

  /** Remove the withdrawal marker of each replica that carries one (an
   * aborted flip), as the image's app user; a no-op for the rest. */
  admit(
    stack: string,
    services: readonly string[],
    replicas?: readonly string[],
  ): Promise<void> {
    return admitReplicas(this.verbContext, stack, services, replicas);
  }

  /** Set each replica's withdrawal marker, as the image's app user, and
   * wait two switch health intervals. Cuts nothing: 0. */
  withdraw(
    stack: string,
    services: readonly string[],
    replicas?: readonly string[],
  ): Promise<number> {
    return withdrawReplicas(
      this.verbContext,
      stack,
      services,
      replicas,
      this.switchDependencies,
    );
  }

  /** The applier's withdrawal hooks (design 7.3). */
  switchHooks(): Pick<ApplyHooks, 'withdraw' | 'admit'> {
    return switchApplyHooks(this.verbContext, this.switchDependencies);
  }

  /** Nothing to clean up synchronously (D-12): the journal records the
   * interrupt, and the next run plans from what the node holds. */
  onInterrupt(): void {
    markInterruptedSync(this.stateRoot);
  }

  // ---- exec, files, logs, helpers ------------------------------------------------

  /** Run one command (design D-03): modes 1-2 under the image's `timeout`,
   * else over the websocket; bounded in time and output. */
  exec(
    name: string,
    argv: readonly string[],
    options: IncusExecOptions = {},
  ): Promise<ExecResult> {
    return execInInstance(this.verbContext, name, argv, options);
  }

  /** A command held open over a websocket exec. */
  execSession(name: string, argv: readonly string[]): Promise<RuntimeSession> {
    return execSessionInInstance(this.verbContext, name, argv);
  }

  /** Delete the exec stdin files a crash left, as the journal lists them. */
  reapExecPayloads(instance?: string): Promise<string[]> {
    return reapPayloads(this.verbContext, instance);
  }

  copyIn(
    name: string,
    dir: string,
    target: string,
    owner?: FileOwner,
  ): Promise<CopyResult> {
    return copyIntoInstance(this.verbContext, name, dir, target, owner);
  }

  copyOut(
    name: string,
    source: string,
    dir: string,
    options: CopyOutOptions,
  ): Promise<ExecResult> {
    return copyOutOfInstance(this.verbContext, name, source, dir, options);
  }

  /** The instance's console (design 11): a running one only with
   * `consume`, after a one-line warning. */
  logs(
    name: string,
    options: LogOptions,
    onLine?: (line: string) => void,
  ): Promise<number> {
    return readInstanceLogs(
      this.verbContext,
      name,
      options,
      onLine,
      this.logReads,
    );
  }

  /** What a stopped instance's console still holds, labelled as such; null
   * while it runs. */
  crashTail(name: string, lines?: number) {
    return crashTail(this.verbContext, name, lines);
  }

  /** "stopped after repeated crashes" with the console tail Incus kept,
   * for an instance `boot.autorestart` gave up on; null for any other. */
  crashReport(name: string, lines?: number) {
    return crashReport(this.verbContext, name, lines);
  }

  /** The `tale-proxy` image helpers run from. */
  private helper(): { alias: string; digest?: string } {
    if (this.helperImage !== undefined) return this.helperImage;
    const proxy = this.target?.images.find((image) =>
      image.services.includes('proxy'),
    );
    if (proxy === undefined)
      throw preconditionError(
        "A one-shot job on Incus runs from the release's tale-proxy image, and this runtime knows none yet.",
      );
    return { alias: proxy.alias, digest: proxy.digest };
  }

  /** Run one helper job over volumes (design D-30) and delete the helper. */
  oneShot(job: OneShotJob): Promise<ExecResult> {
    const helper = this.helper();
    return runOneShot(this.verbContext, job, {
      image: helper.alias,
      ...(helper.digest === undefined ? {} : { digest: helper.digest }),
      pool: this.declaration.pool,
      active: this.activeHelpers,
    });
  }

  /** Delete the helpers a crash left in the stack. */
  reapHelpers(): Promise<string[]> {
    return reapHelpers(this.verbContext, this.activeHelpers);
  }
}

/** The Incus runtime for one stack. */
export function createIncusRuntime(options: IncusRuntimeOptions): IncusRuntime {
  return new IncusRuntime(options);
}
