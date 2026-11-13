/**
 * A managed deployment on the Incus runtime (design 7.1): the sibling of
 * Docker's `applyRuntime` (`runtime-apply.ts`, which this module leaves
 * alone), over the stack target the compiler makes from the bundle's own
 * `compose.yml`.
 *
 * `applyIncusRuntime` probes the node, checks it against the stack's node
 * contract, compiles the target from the deployment's `.env`, holds it to
 * the compiled stack the bundle pins (`incus-stack.json`), reads the project
 * back, checks custody, plans, and — unless only the plan is asked for —
 * applies the plan (images, volumes, files, instances tier by tier behind
 * health gates, the spawner drained before it is replaced, the switch, the
 * ingress, orphans last), reads back again and records the same runtime
 * receipt (`.tale/runtime.json`) the Docker path records. A pending restore
 * stops it (R3-22). The deployment's files (`compose.yml`, `Caddyfile`,
 * `.env`, `secrets.env`) live in the state directory exactly as on Docker,
 * so the receipt, the secrets and the environment stay one format.
 *
 * The managed /25 has no colours: a new release replaces platform and
 * backend-api in place, and while a role has no admitted replica the switch
 * answers 503 and the edge serves its maintenance page, the window compose's
 * recreate has today (R3-36). The plan says so as a notice.
 */

import { createHash, randomUUID, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { IncusInstance } from '@tale/incus/api';
import { IncusClient } from '@tale/incus/client';

import { preconditionError } from '../../utils/fail';
import * as logger from '../../utils/logger';
import { stableJson } from '../config/releases/identity';
import type { ImageFacts } from '../oci/image-facts';
import type { RegistryClient } from '../oci/registry';
import { applyIncusPlan, type ApplyHooks } from '../runtime/incus/apply/apply';
import {
  assertNoRestorePending,
  readJournal,
} from '../runtime/incus/apply/journal';
import {
  readStack,
  type ObservedInstance,
} from '../runtime/incus/apply/readback';
import {
  type IncusDeclaration,
  type StackTarget,
} from '../runtime/incus/compile/stack-target';
import type { InstanceSpec } from '../runtime/incus/compile/translate';
import {
  CHECK_SENTENCES,
  checkNode,
  type CheckReport,
} from '../runtime/incus/contract/check';
import { nodeContract } from '../runtime/incus/contract/contract';
import type { NodeContract } from '../runtime/incus/contract/contract-model';
import {
  managedIncusDirectory,
  readIncusCredentials,
} from '../runtime/incus/credentials';
import {
  createIncusRuntime,
  type IncusRuntime,
} from '../runtime/incus/incus-runtime';
import { loadPlanKey } from '../runtime/incus/plan/digest';
import {
  plan as planStack,
  SWITCHED_SERVICES,
  type DesiredStack,
  type RenderedFile,
} from '../runtime/incus/plan/plan';
import {
  incusPlanSchema,
  isEmptyPlan,
  parseResourceId,
  type IncusPlan,
} from '../runtime/incus/plan/plan-model';
import { reapProbes } from '../runtime/incus/verbs/image-facts-cache';
import {
  ensureImages,
  pullFailure,
  registryHosts,
} from '../runtime/incus/verbs/images';
import { resolverFiles } from '../runtime/incus/verbs/names';
import { switchFiles } from '../runtime/incus/verbs/switch';
import {
  bundledBackendIdentity,
  installedAutomationProtocol,
  requireAutomationProtocol,
} from './automation-protocol';
import {
  budgetedDockerRun,
  dockerRuntimeAccess,
  type DockerCommandOptions,
  type RuntimeAccess,
  type RuntimeBudget,
} from './runtime-access';
import { incusRuntimeAccess, instanceIdentity } from './runtime-access-incus';
import {
  currentHash,
  installedFiles,
  pendingBytes,
  readReceipt,
  receiptInput,
  receiptSchema,
  sameAdditionalOrigins,
  targetPath,
  validateOptions,
  type RuntimeReceipt,
} from './runtime-apply';
import {
  activateConfiguration,
  spawnerBootSchema,
  type RuntimeConfigurationEffect,
} from './runtime-configuration';
import {
  parseRuntimeEnvironment,
  prepareRuntimeEnvironment,
} from './runtime-env';
import { assertIncusCustody } from './runtime-incus-custody';
import {
  assertPreparedStack,
  compileIncusStack,
  PREPARED_STACK_SENTENCE,
} from './runtime-incus-stack';
import {
  atomicRuntimeFile,
  hash,
  INCUS_STACK_FILE,
  readRegular,
  readRuntimeBundle,
  requireRuntime,
  type ApplyRuntimeOptions,
  type RuntimeBundle,
  type RuntimeDependencies,
  type RuntimeResult,
} from './runtime-model';
import {
  SANDBOX_INCUS_DIRECTORY,
  SANDBOX_OWNED_VARIABLES,
} from './runtime-sandbox';
import { assertIncusCredentials } from './runtime-sandbox-credentials';
import { drainSpawner } from './runtime-spawner';

/** The sentences the managed Incus path speaks. */
export const INCUS_APPLY_SENTENCES = {
  notIncus: 'This runtime bundle is not for the Incus runtime.',
  prepared: PREPARED_STACK_SENTENCE,
  platform: 'Incus destination platform differs from the prepared runtime.',
  probe: 'The Incus node cannot run this stack:',
  check: 'The Incus node differs from the stack contract:',
  owner: 'Existing runtime receipt belongs to another instance.',
  pending:
    'A different runtime operation is pending; recover that exact operation first.',
  drift:
    'Managed runtime file drift requires operator review before deployment.',
  orphanState:
    'Unrecognized existing state prevents initializing this runtime.',
  docker:
    'This state directory holds a deployment the Incus project has nothing of, such as one on Docker Compose; a deploy does not move its data to Incus.',
  drained: (sessions: number | null) =>
    `The sandbox spawner still holds ${sessions ?? 'an unknown number of'} session(s) and refuses new ones. It stops them itself after its linger (SANDBOX_SESSION_MAX_LINGER_MS, 30 minutes by default); apply the same bundle again after that.`,
  notReady: 'No ready runtime receipt matches this exact deployment bundle.',
  reviewed:
    'The reviewed Incus plan differs from what the node needs now; create and review a new plan (deploy --bundle --plan-only --json).',
  snapshot:
    'A changed existing deployment on Incus needs a recovery snapshot, and this CLI cannot take one on Incus yet.',
  unhealthy: (names: readonly string[]) =>
    `The ready runtime is not complete and healthy on its pinned images (${names.join(', ')}).`,
  window: (roles: readonly string[]) =>
    `${roles.join(' and ')} ${roles.length === 1 ? 'is' : 'are'} replaced in place with one replica: from the old replica's withdrawal until the new one is admitted, the switch has no upstream for ${roles.length === 1 ? 'it' : 'them'} and the edge serves its maintenance page, as compose's recreate does.`,
} as const;

/** How long one instance may take to become healthy. */
const HEALTH_TIMEOUT_S = 600;

// ---- the connection -------------------------------------------------------------

export interface ManagedIncusOptions {
  stateDirectory: string;
  composeProject: string;
  declaration: IncusDeclaration;
}

/** The Incus runtime of a managed stack, over the CLI's own credentials in
 * `<stateDirectory>/incus/` (never the spawner's). */
async function managedIncusRuntime(
  options: ManagedIncusOptions,
  overrides: { client?: IncusClient; registry?: RegistryClient } = {},
): Promise<IncusRuntime> {
  const client =
    overrides.client ??
    new IncusClient({
      endpoint:
        options.declaration.endpoint ??
        `https://${options.declaration.network.gateway}:8443`,
      project: options.declaration.project,
      tls: await readIncusCredentials(
        managedIncusDirectory(options.stateDirectory),
      ),
      signal: () => undefined,
    });
  return createIncusRuntime({
    client,
    declaration: options.declaration,
    stack: options.composeProject,
    stateRoot: options.stateDirectory,
    ...(overrides.registry === undefined
      ? {}
      : { registry: overrides.registry }),
  });
}

/** The pinned server certificate's SHA-256, for the plan's destination. */
function serverCertificateSha256(stateDirectory: string): string {
  const pem = readRegular(
    join(managedIncusDirectory(stateDirectory), 'server.crt'),
  ).toString('utf8');
  return createHash('sha256')
    .update(new X509Certificate(pem).raw)
    .digest('hex');
}

// ---- the files ------------------------------------------------------------------

/** Every file the stack writes, with its content: the bundle's Caddyfile,
 * the spawner's credentials, the resolvers' files and the switch's lists. */
function managedFiles(
  target: StackTarget,
  sources: { bundleDirectory: string; stateDirectory: string },
): RenderedFile[] {
  const files: RenderedFile[] = target.files.map((file) => ({
    volume: file.volume,
    path: file.path,
    mode: file.mode,
    uid: 0,
    gid: 0,
    content: new Uint8Array(
      readRegular(
        file.source.kind === 'bundle'
          ? join(sources.bundleDirectory, file.source.file)
          : join(
              sources.stateDirectory,
              SANDBOX_INCUS_DIRECTORY,
              file.source.file,
            ),
      ),
    ),
    write: 'overwrite',
  }));
  return [...files, ...resolverFiles(target), ...switchFiles(target)];
}

// ---- the plan ----------------------------------------------------------------

/** The roles a plan replaces in place, with one replica each (R3-36). */
function inPlaceWindow(plan: IncusPlan, target: StackTarget): string[] {
  const roles = new Set<string>();
  for (const resource of plan.resources) {
    const { kind, name } = parseResourceId(resource.id);
    if (kind !== 'instance') continue;
    if (!['replace', 'delete'].includes(resource.action)) continue;
    const spec = target.instances.find((instance) => instance.name === name);
    const service = spec?.service ?? name.replace(/-\d+$/, '');
    if (!SWITCHED_SERVICES.has(service)) continue;
    const replicas = target.instances.filter(
      (instance) => instance.service === service,
    ).length;
    if (replicas <= 1) roles.add(service);
  }
  return [...roles].sort();
}

/** What a reviewer of a plan decides on: where, and what happens to which
 * resource with which effects. Digests are left out: a first deploy's
 * secrets exist only once it runs, so its plan's digests cannot be known
 * when the plan is reviewed. */
function reviewable(plan: IncusPlan): unknown {
  return {
    phase: plan.phase,
    destination: plan.destination,
    resources: plan.resources.map((resource) => ({
      id: resource.id,
      action: resource.action,
      effects: resource.effects,
    })),
  };
}

/** The plan as lines an operator reviews: every change, its effects and
 * hints, and the in-place window. */
export function describeIncusPlan(
  plan: IncusPlan,
  target: StackTarget,
): string[] {
  const lines: string[] = [];
  for (const resource of plan.resources) {
    if (resource.action === 'unchanged') continue;
    const effects =
      resource.effects.length === 0 ? '' : ` [${resource.effects.join(', ')}]`;
    lines.push(
      `${resource.action.padEnd(9)} ${resource.id}${effects}${resource.hint === undefined ? '' : ` — ${resource.hint}`}`,
    );
  }
  if (lines.length === 0)
    lines.push('The Incus stack is as planned; nothing changes.');
  const window = inPlaceWindow(plan, target);
  if (window.length > 0)
    lines.push(`Notice: ${INCUS_APPLY_SENTENCES.window(window)}`);
  return lines;
}

// ---- apply --------------------------------------------------------------------

export interface ApplyIncusRuntimeOptions extends ApplyRuntimeOptions {
  /** The deployment's `runtime.incus` block. */
  incus: IncusDeclaration;
  /** The declared `sandbox.egressProxy`, if any (R-13). */
  egressProxy?: string;
  /** `--stop`: a running stop-gated instance may stop. */
  stop?: boolean;
  /** `--plan <file>`: the reviewed plan; the apply refuses unless the node
   * still needs exactly it. */
  plan?: unknown;
}

export interface IncusRuntimeDependencies extends RuntimeDependencies {
  /** The stack's runtime; from the state directory's credentials by
   * default. */
  incusRuntime?: IncusRuntime;
  /** Replaces the apply hooks it names (tests). */
  hooks?: Partial<ApplyHooks>;
  /** The node's server certificate digest (tests). */
  serverCertificateSha256?: string;
  /** The node check against the contract (tests); `checkNode` without the
   * forwarding probes by default. */
  nodeCheck?: (
    client: IncusClient,
    contract: NodeContract,
  ) => Promise<CheckReport>;
  now?: () => Date;
}

export interface IncusRuntimeResult extends RuntimeResult {
  /** The reviewed plan; empty when nothing changes. */
  plan: IncusPlan;
  /** The plan as an operator reads it. */
  planLines: string[];
}

/** The image facts of every image the bundle's services run, by the
 * reference the compose file names. */
async function bundleFacts(
  runtime: IncusRuntime,
  bundle: RuntimeBundle,
): Promise<Map<string, ImageFacts>> {
  const facts = new Map<string, ImageFacts>();
  for (const image of bundle.images) {
    if (
      image.services.length === 0 &&
      !image.repository.endsWith('/tale-sandbox-runtime')
    )
      continue;
    const read = await runtime.inspectImage(image.reference);
    requireRuntime(
      read.digest === image.digest,
      'Runtime image identity differs from the bundle.',
    );
    facts.set(image.reference, { ...read, reference: image.reference });
  }
  return facts;
}

/** The hooks the applier runs, on the stack's runtime. */
function applyHooks(
  runtime: IncusRuntime,
  dependencies: IncusRuntimeDependencies,
): ApplyHooks {
  const access = stackAccess(runtime, []);
  return {
    pullImage: async (image) => {
      const ensured = await ensureImages(runtime.client, [image], {
        stateRoot: runtime.stateRoot,
        registryMirror: runtime.declaration.registryMirror,
        registryMirrors: runtime.declaration.registryMirrors,
      });
      if (ensured.failed.length > 0) throw pullFailure(ensured.failed);
    },
    waitHealthy: async (instance: InstanceSpec) => {
      requireRuntime(
        await runtime.waitHealthy(instance.name, { timeout: HEALTH_TIMEOUT_S }),
        `${instance.name} did not become healthy.`,
      );
    },
    // The spawner's sessions live on; a replaced spawner would not see them.
    drainSandbox: async (instance) => {
      const drained = await drainSpawner(instance, {
        ...dependencies,
        access,
      });
      requireRuntime(
        drained.drained,
        INCUS_APPLY_SENTENCES.drained(drained.sessions),
      );
    },
    // Compose's recreate drains no backend either: in-flight work ends with
    // the old replica's grace (R3-36).
    drainBackend: async () => undefined,
    ...runtime.switchHooks(),
    volumeOwner: (volume) => runtime.volumeOwner(volume),
    ...dependencies.hooks,
  };
}

/** The access the managed steps use on this stack, under a minute per call. */
function stackAccess(runtime: IncusRuntime, images: readonly string[]) {
  return incusRuntimeAccess<{ timeout?: number; maxOutputBytes?: number }>({
    runtime,
    images,
    budget: {
      bounds: (tag) => ({
        timeout: tag?.timeout ?? 60,
        ...(tag?.maxOutputBytes === undefined
          ? {}
          : { maxOutputBytes: tag.maxOutputBytes }),
      }),
      failed: () =>
        preconditionError('The Incus runtime could not complete the command.'),
      refused: () =>
        preconditionError('The Incus runtime refused the command.'),
    },
  });
}

/**
 * Refuse a bundle whose automation writer protocol is older than the one the
 * running stack installed. A stack without a running database has none yet.
 * A protocol cutover from a legacy writer is Docker's alone: an Incus stack
 * started on this CLI's bundles.
 */
async function checkInstalledProtocol(
  runtime: IncusRuntime,
  bundle: RuntimeBundle,
  stack: string,
  installed: RuntimeBundle['images'],
): Promise<void> {
  const databases = (await runtime.client.listInstances()).filter(
    (instance) =>
      instance.config['user.tale.stack'] === stack &&
      instance.config['user.tale.service'] === 'db' &&
      instance.status === 'Running',
  );
  if (databases.length === 0) return;
  const [database] = databases;
  // The running writers' images are the installed release's.
  const access = stackAccess(
    runtime,
    [...bundle.images, ...installed].map((image) => image.reference),
  );
  const dependencies = { access };
  const backend = await bundledBackendIdentity([stack], dependencies);
  const floor = await installedAutomationProtocol(
    instanceIdentity(runtime.client.project, database as IncusInstance),
    stack,
    dependencies,
  );
  const target = bundle.automationWriterProtocol ?? 1;
  const installedProtocol = backend.protocol === 2 ? 2 : floor;
  requireAutomationProtocol(installedProtocol, target);
  // Docker's legacy cutover moves a protocol-1 install forward; an Incus
  // stack starts on a protocol it keeps.
  requireRuntime(
    installedProtocol === target,
    'The installed automation writer protocol differs from the bundle; an Incus stack keeps the protocol it started with.',
  );
}

/** The stack's own state, read once: receipt, journal, instances. */
async function admission(
  options: ApplyIncusRuntimeOptions,
  runtime: IncusRuntime,
): Promise<{ receipt: RuntimeReceipt | null; instances: number }> {
  const receipt = readReceipt(
    join(options.stateDirectory, '.tale', 'runtime.json'),
  );
  if (receipt)
    requireRuntime(
      receipt.name === options.name &&
        receipt.stateDirectory === options.stateDirectory &&
        receipt.composeProject === options.composeProject,
      INCUS_APPLY_SENTENCES.owner,
    );
  assertNoRestorePending(await readJournal(options.stateDirectory), 'deploy');
  const instances = (await runtime.client.listInstances()).filter(
    (instance) => instance.config['user.tale.stack'] === options.composeProject,
  ).length;
  return { receipt, instances };
}

/**
 * Apply a managed deployment's runtime bundle on Incus. The caller holds the
 * deployment lock and, for a changed existing runtime, its recovery point.
 * `dryRun` plans and changes nothing.
 */
export async function applyIncusRuntime(
  options: ApplyIncusRuntimeOptions,
  dependencies: IncusRuntimeDependencies = {},
): Promise<IncusRuntimeResult> {
  validateOptions(options);
  const { bundle, identity, compose, contents } = readRuntimeBundle(
    options.bundleDirectory,
  );
  requireRuntime(bundle.runtime === 'incus', INCUS_APPLY_SENTENCES.notIncus);
  requireRuntime(
    SANDBOX_OWNED_VARIABLES.every(
      (name) => !Object.hasOwn(options.environment ?? {}, name),
    ),
    'Managed runtime environment names a variable the Incus sandbox shape sets itself.',
  );
  // The spawner's credentials, before the first call to the node.
  assertIncusCredentials(options.stateDirectory);
  const runtime =
    dependencies.incusRuntime ??
    (await managedIncusRuntime({
      stateDirectory: options.stateDirectory,
      composeProject: options.composeProject,
      declaration: options.incus,
    }));

  // The node: its API extensions, project, profile and pool, then its
  // platform.
  const probe = await runtime.probeDetail(
    // The stack pulls the images its services run; the spawner pulls the
    // sessions' image into its own project.
    registryHosts(
      bundle.images.filter((image) => image.services.length > 0),
      options.incus,
    ),
  );
  if (probe.errors.length > 0)
    throw preconditionError(
      [INCUS_APPLY_SENTENCES.probe, ...probe.errors].join('\n'),
    );
  for (const warning of probe.warnings) logger.warn(warning);
  requireRuntime(
    probe.facts?.platform === bundle.platform,
    INCUS_APPLY_SENTENCES.platform,
  );

  const { receipt: found, instances } = await admission(options, runtime);
  let receipt = found;
  const inputSha256 = receiptInput(options);
  const sourceDirectory = join(options.stateDirectory, 'src');
  if (receipt?.phase === 'pending')
    requireRuntime(
      receipt.bundleSha256 === identity && receipt.inputSha256 === inputSha256,
      INCUS_APPLY_SENTENCES.pending,
    );
  const existing =
    instances > 0 ||
    existsSync(join(options.stateDirectory, 'secrets.env')) ||
    existsSync(join(sourceDirectory, '.env')) ||
    Boolean(receipt?.existing);
  // State the Incus project holds nothing of is a Docker Compose deployment:
  // a deploy would start its stack on empty data volumes beside it.
  requireRuntime(
    !existing ||
      instances > 0 ||
      (await runtime.listVolumes()).length > 0 ||
      (receipt?.phase === 'pending' && !receipt.existing),
    INCUS_APPLY_SENTENCES.docker,
  );
  if (receipt) {
    for (const file of installedFiles) {
      const current = currentHash(targetPath(options, file));
      requireRuntime(
        current === receipt.files[file] ||
          (receipt.phase === 'pending' && current === receipt.before[file]),
        INCUS_APPLY_SENTENCES.drift,
      );
    }
  } else if (!existing)
    requireRuntime(
      !existsSync(options.stateDirectory) ||
        readdirSync(options.stateDirectory).every((file) =>
          ['src', '.tale', 'incus', SANDBOX_INCUS_DIRECTORY].includes(file),
        ),
      INCUS_APPLY_SENTENCES.orphanState,
    );

  const environment = prepareRuntimeEnvironment(
    options,
    bundle.revision,
    existing && !(receipt?.phase === 'pending' && !receipt.existing),
    !options.dryRun,
    'incus',
  );
  const planned: Record<(typeof installedFiles)[number], Buffer> = {
    'compose.yml': contents['compose.yml'],
    'Caddyfile.production': contents['Caddyfile.production'],
    '.env': Buffer.from(environment.environment),
    'secrets.env': Buffer.from(environment.secrets),
  };

  // The target, from the deployment's own `.env`, held to the prepared one.
  // A pending operation resumes with the files it staged, whose secrets the
  // stack may already run with; anything else with the new ones.
  const dotenv =
    receipt?.phase === 'pending'
      ? pendingBytes(options, receipt)['.env'].toString('utf8')
      : environment.environment;
  const target = compileIncusStack({
    compose,
    dotenv,
    declaration: options.incus,
    stack: options.composeProject,
    platform: bundle.platform,
    facts: await bundleFacts(runtime, bundle),
    ...(options.egressProxy === undefined
      ? {}
      : { egressProxy: options.egressProxy }),
  });
  const prepared = contents[INCUS_STACK_FILE];
  requireRuntime(prepared !== undefined, INCUS_APPLY_SENTENCES.notIncus);
  assertPreparedStack(target, prepared);
  runtime.useTarget(target);

  // The node against the stack's contract, as the restricted certificate
  // reads it; forwarding is judged by `tale incus check`'s probes.
  const contract = nodeContract(
    options.incus,
    target,
    options.egressProxy === undefined
      ? {}
      : { egressProxy: options.egressProxy },
  );
  const report = await (
    dependencies.nodeCheck ??
    ((client, against) =>
      checkNode(client, against, {
        clientCertificate: readRegular(
          join(managedIncusDirectory(options.stateDirectory), 'client.crt'),
        ).toString('utf8'),
        probes: null,
        publicTarget: { host: '1.1.1.1', port: 443 },
        publicName: 'tale.dev',
      }))
  )(runtime.client, contract);
  const probeNotRun = CHECK_SENTENCES.probeNotRun(
    'they were turned off, so forwarding from the app bridge is not judged',
  );
  const refusals = report.findings.filter(
    (finding) =>
      finding.level === 'refusal' && finding.sentence !== probeNotRun,
  );
  if (refusals.length > 0)
    throw preconditionError(
      [
        INCUS_APPLY_SENTENCES.check,
        ...refusals.map((finding) => finding.sentence),
      ].join('\n'),
      'tale incus check names each remedy.',
    );
  for (const finding of report.findings)
    if (finding.level === 'warning') logger.warn(finding.sentence);

  // The automation writer protocol the running stack has installed: a
  // bundle may only keep it or move it forward, as on Docker. A first deploy
  // that stopped part-way (a health gate, a crash) has installed nothing: it
  // resumes with the bundle it began with (held above), whose tiers may have
  // started the database before any backend exists.
  if (!(receipt?.phase === 'pending' && !receipt.existing))
    await checkInstalledProtocol(
      runtime,
      bundle,
      options.composeProject,
      receipt?.images ?? [],
    );

  const key = await loadPlanKey(options.stateDirectory);
  const desired: DesiredStack = {
    target,
    files: managedFiles(target, {
      bundleDirectory: options.bundleDirectory,
      stateDirectory: options.stateDirectory,
    }),
    destination: {
      endpoint:
        options.incus.endpoint ??
        `https://${options.incus.network.gateway}:8443`,
      serverCertificateSha256:
        dependencies.serverCertificateSha256 ??
        serverCertificateSha256(options.stateDirectory),
      project: options.incus.project,
      pool: options.incus.pool,
      architecture: probe.facts?.architecture ?? '',
    },
    key,
  };
  const read = () =>
    readStack(runtime.client, {
      stack: target.stack,
      pool: target.pool,
      key,
      files: desired.files.map((file) => ({
        volume: file.volume,
        path: file.path,
        write: file.write,
      })),
    });
  // What a crash left in the stack — one-off helpers and image probes — is
  // deleted before custody reads it; a plan alone deletes nothing.
  if (!options.dryRun) {
    await runtime.reapHelpers();
    await reapProbes(runtime.client, target.stack);
  }
  const readback = await read();
  assertIncusCustody({
    desired,
    instances: readback.instances,
    phase: 'admission',
    volumes: new Set(readback.volumes.map((volume) => volume.name)),
  });
  const plan = planStack(desired, readback, {
    phase: 'full',
    stop: options.stop === true,
  });
  if (options.plan !== undefined) {
    const reviewed = incusPlanSchema.safeParse(options.plan);
    requireRuntime(
      reviewed.success &&
        stableJson(reviewable(reviewed.data)) === stableJson(reviewable(plan)),
      INCUS_APPLY_SENTENCES.reviewed,
    );
  }
  const planLines = describeIncusPlan(plan, target);

  const changed =
    receipt?.phase !== 'ready' ||
    receipt.bundleSha256 !== identity ||
    receipt.inputSha256 !== inputSha256 ||
    !isEmptyPlan(plan) ||
    installedFiles.some(
      (file) => currentHash(targetPath(options, file)) !== hash(planned[file]),
    );
  const backend = () =>
    readback.instances.find(
      (instance) =>
        instance.custody.verdict === 'stack' &&
        instance.config['user.tale.service'] === 'backend-api',
    );
  const result = (backendId: string | null): IncusRuntimeResult => ({
    backendContainer: backendId,
    sourceDirectory,
    regeneratedSecrets:
      receipt?.phase === 'pending'
        ? receipt.regeneratedSecrets
        : environment.regeneratedSecrets,
    images: bundle.images,
    revision: bundle.revision,
    changed,
    existing,
    // The gateway's store migrates forward on the first start of a newer
    // gateway image, as on Docker; Incus keeps the image digest on the
    // instance.
    gateway: gatewayOf(
      readback.instances,
      readback.volumes.some((volume) => volume.name === 'llm-gateway-data'),
      bundle,
    ),
    dryRun: options.dryRun ?? false,
    plan,
    planLines,
  });
  const before = backend();
  const backendId =
    before === undefined
      ? null
      : instanceIdentity(runtime.client.project, before);
  if (options.dryRun) {
    for (const line of planLines) logger.info(line);
    return result(backendId);
  }
  if (!changed) {
    await waitHealthyAll(runtime, target);
    return result(backendId);
  }
  for (const line of planLines) logger.info(line);

  // The pending receipt and the staged files, as on Docker: a crash leaves
  // the exact operation to recover.
  mkdirSync(join(options.stateDirectory, '.tale'), {
    recursive: true,
    mode: 0o750,
  });
  mkdirSync(sourceDirectory, { recursive: true, mode: 0o750 });
  const receiptPath = join(options.stateDirectory, '.tale', 'runtime.json');
  if (receipt?.phase !== 'pending') {
    const stage = randomUUID();
    const stageDirectory = join(
      options.stateDirectory,
      '.tale',
      `runtime-${stage}`,
    );
    mkdirSync(stageDirectory, { mode: 0o700 });
    for (const file of installedFiles)
      atomicRuntimeFile(join(stageDirectory, file), planned[file]);
    receipt = receiptSchema.parse({
      schemaVersion: 1,
      phase: 'pending',
      name: options.name,
      stateDirectory: options.stateDirectory,
      composeProject: options.composeProject,
      revision: bundle.revision,
      bundleSha256: identity,
      inputSha256,
      stage,
      existing,
      before: Object.fromEntries(
        installedFiles.map((file) => [
          file,
          currentHash(targetPath(options, file)),
        ]),
      ),
      files: Object.fromEntries(
        installedFiles.map((file) => [file, hash(planned[file])]),
      ),
      regeneratedSecrets: environment.regeneratedSecrets,
      images: bundle.images,
    });
    atomicRuntimeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  const staged = pendingBytes(options, receipt);
  for (const file of installedFiles)
    atomicRuntimeFile(targetPath(options, file), staged[file]);

  // The images first, so the volumes' owners can be read from them; the
  // applier then finds the images present and makes the volumes itself.
  await runtime.ensureTargetImages(target);
  if (dependencies.hooks?.volumeOwner === undefined)
    await runtime.readVolumeOwners(target);
  await applyIncusPlan({
    client: runtime.client,
    stateRoot: options.stateDirectory,
    desired,
    plan,
    hooks: applyHooks(runtime, dependencies),
    options: {
      stop: options.stop === true,
      ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
    },
  });

  // Readback: exactly the target, every instance healthy.
  const after = await read();
  assertIncusCustody({ desired, instances: after.instances, phase: 'ready' });
  await waitHealthyAll(runtime, target);
  for (const file of installedFiles)
    requireRuntime(
      currentHash(targetPath(options, file)) === receipt.files[file],
      'Runtime files changed before the health receipt could be recorded.',
    );
  receipt = { ...receipt, phase: 'ready' };
  atomicRuntimeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  const api = after.instances.find(
    (instance) =>
      instance.custody.verdict === 'stack' &&
      instance.config['user.tale.service'] === 'backend-api',
  );
  return result(
    api === undefined ? null : instanceIdentity(runtime.client.project, api),
  );
}

/** The gateway's store as the deploy found it (`RuntimeResult.gateway`). */
function gatewayOf(
  instances: readonly ObservedInstance[],
  volume: boolean,
  bundle: RuntimeBundle,
): RuntimeResult['gateway'] {
  const image = bundle.images.find((candidate) =>
    candidate.services.includes('sandbox-llm-gateway'),
  );
  const running = instances.find(
    (instance) =>
      instance.custody.verdict === 'stack' &&
      instance.config['user.tale.service'] === 'sandbox-llm-gateway',
  );
  const runningDigest = running?.config['user.tale.image'] ?? null;
  return {
    volume,
    newImage: image !== undefined && runningDigest !== image.digest,
    target: image?.reference ?? null,
    running:
      runningDigest === null
        ? null
        : (bundle.images.find((candidate) => candidate.digest === runningDigest)
            ?.reference ?? runningDigest),
  };
}

/** Wait until every instance of the target with a health check is healthy. */
async function waitHealthyAll(
  runtime: IncusRuntime,
  target: StackTarget,
): Promise<void> {
  const unhealthy: string[] = [];
  for (const instance of target.instances)
    if (
      !(await runtime.waitHealthy(instance.name, { timeout: HEALTH_TIMEOUT_S }))
    )
      unhealthy.push(instance.name);
  if (unhealthy.length > 0)
    throw preconditionError(INCUS_APPLY_SENTENCES.unhealthy(unhealthy));
}

// ---- a ready runtime ------------------------------------------------------------

/** One instance of a ready stack, in the shape the managed checks read
 * (Docker's container readback, normalized: ID, name, image reference,
 * labels, state, mounts). */
export interface ReadyInstance {
  Id: string;
  Name: string;
  Config: { Image: string; Labels: Record<string, string> };
  State: { Running: boolean; StartedAt?: string; Health?: { Status: string } };
  Mounts: {
    Type: string;
    Name?: string;
    Source: string;
    Destination: string;
    RW?: boolean;
  }[];
}

/**
 * Observe an already-ready Incus runtime without changing it: its receipt
 * matches the bundle, its files have not drifted, its origin is the declared
 * one, custody holds exactly, and every instance runs its pinned image and
 * is healthy. The shape is `observeReadyState`'s, so acceptance, observation,
 * provisioning and the export read both runtimes alike.
 */
export async function observeReadyIncusState(
  options: Omit<ApplyIncusRuntimeOptions, 'environment' | 'dryRun'>,
  dependencies: IncusRuntimeDependencies = {},
): Promise<{
  containers: ReadyInstance[];
  runtime: Pick<
    RuntimeResult,
    'backendContainer' | 'sourceDirectory' | 'images' | 'revision'
  >;
  incus: IncusRuntime;
}> {
  validateOptions(options);
  const { bundle, identity, compose, contents } = readRuntimeBundle(
    options.bundleDirectory,
  );
  requireRuntime(bundle.runtime === 'incus', INCUS_APPLY_SENTENCES.notIncus);
  const receipt = readReceipt(
    join(options.stateDirectory, '.tale', 'runtime.json'),
  );
  requireRuntime(
    receipt?.phase === 'ready' &&
      receipt.name === options.name &&
      receipt.stateDirectory === options.stateDirectory &&
      receipt.composeProject === options.composeProject &&
      receipt.revision === bundle.revision &&
      receipt.bundleSha256 === identity &&
      JSON.stringify(receipt.images) === JSON.stringify(bundle.images),
    INCUS_APPLY_SENTENCES.notReady,
  );
  for (const file of installedFiles)
    requireRuntime(
      currentHash(targetPath(options, file)) === receipt.files[file],
      'Managed runtime files drifted from the ready runtime receipt.',
    );
  const dotenv = readRegular(
    join(options.stateDirectory, 'src', '.env'),
  ).toString('utf8');
  const environment = parseRuntimeEnvironment(dotenv, 'compose');
  requireRuntime(
    environment.SITE_URL === options.origin &&
      environment.HOST === new URL(options.origin).hostname &&
      environment.TLS_MODE === options.tlsMode &&
      sameAdditionalOrigins(environment, options.additionalOrigins),
    'Managed runtime origin differs from the declared deployment origin.',
  );
  const runtime =
    dependencies.incusRuntime ??
    (await managedIncusRuntime({
      stateDirectory: options.stateDirectory,
      composeProject: options.composeProject,
      declaration: options.incus,
    }));
  const probe = await runtime.probeDetail([]);
  requireRuntime(
    probe.facts?.platform === bundle.platform,
    'Destination architecture differs from the bundle platform.',
  );
  assertNoRestorePending(await readJournal(options.stateDirectory), 'deploy');
  const target = compileIncusStack({
    compose,
    dotenv,
    declaration: options.incus,
    stack: options.composeProject,
    platform: bundle.platform,
    facts: await bundleFacts(runtime, bundle),
    ...(options.egressProxy === undefined
      ? {}
      : { egressProxy: options.egressProxy }),
  });
  const prepared = contents[INCUS_STACK_FILE];
  requireRuntime(prepared !== undefined, INCUS_APPLY_SENTENCES.notIncus);
  assertPreparedStack(target, prepared);
  runtime.useTarget(target);
  const key = await loadPlanKey(options.stateDirectory);
  const desired: DesiredStack = {
    target,
    files: managedFiles(target, {
      bundleDirectory: options.bundleDirectory,
      stateDirectory: options.stateDirectory,
    }),
    destination: {
      endpoint:
        options.incus.endpoint ??
        `https://${options.incus.network.gateway}:8443`,
      serverCertificateSha256:
        dependencies.serverCertificateSha256 ??
        serverCertificateSha256(options.stateDirectory),
      project: options.incus.project,
      pool: options.incus.pool,
      architecture: probe.facts?.architecture ?? '',
    },
    key,
  };
  const readback = await readStack(runtime.client, {
    stack: target.stack,
    pool: target.pool,
    key,
    files: [],
  });
  const infos = assertIncusCustody({
    desired,
    instances: readback.instances,
    phase: 'ready',
  });
  const unhealthy: string[] = [];
  const containers: ReadyInstance[] = [];
  for (const info of infos) {
    const observed = readback.instances.find(
      (instance) => instance.name === info.name,
    );
    if (observed === undefined) continue;
    const health = await runtime.health(info.name);
    // The image the target gives the instance: a runtime-owned role
    // (resolvers, switch) runs another service's image.
    const spec = target.instances.find(
      (instance) => instance.name === info.name,
    );
    const image = target.images.find(
      (candidate) => candidate.alias === spec?.image,
    );
    if (
      !info.running ||
      (health !== 'healthy' && health !== 'none') ||
      image === undefined ||
      info.image.digest !== image.digest
    )
      unhealthy.push(info.name);
    const started = await runtime.inspect(info.name);
    containers.push({
      Id: instanceIdentity(runtime.client.project, observed),
      Name: `/${info.name}`,
      Config: {
        Image: image?.reference ?? info.image.reference,
        Labels: {
          'com.docker.compose.project': info.stack,
          'com.docker.compose.service': info.service,
          'com.docker.compose.container-number': String(info.index),
          'com.docker.compose.oneoff': 'False',
        },
      },
      State: {
        Running: info.running,
        ...(started?.startedAt == null ? {} : { StartedAt: started.startedAt }),
        ...(health === 'none' ? {} : { Health: { Status: health } }),
      },
      Mounts: info.mounts.map((mount) => ({
        Type: 'volume',
        Name: mount.source,
        Source: mount.source,
        Destination: mount.target,
        RW: !mount.readOnly,
      })),
    });
  }
  if (unhealthy.length > 0)
    throw preconditionError(INCUS_APPLY_SENTENCES.unhealthy(unhealthy));
  const backend = containers.find(
    (container) =>
      container.Config.Labels['com.docker.compose.service'] === 'backend-api',
  );
  requireRuntime(backend, 'Ready backend was not identified.');
  return {
    containers,
    runtime: {
      backendContainer: backend.Id,
      sourceDirectory: join(options.stateDirectory, 'src'),
      images: bundle.images,
      revision: bundle.revision,
    },
    incus: runtime,
  };
}

/** `observeReadyRuntime` on Incus. */
export async function observeReadyIncusRuntime(
  options: Omit<ApplyIncusRuntimeOptions, 'environment' | 'dryRun'>,
  dependencies: IncusRuntimeDependencies = {},
) {
  return (await observeReadyIncusState(options, dependencies)).runtime;
}

// ---- the managed checks ------------------------------------------------------------

/** What a managed check needs of the deployment to reach its runtime. */
export interface DeploymentRuntimeSpec {
  runtime: { engine?: 'docker' | 'incus'; incus?: IncusDeclaration };
  stateDirectory: string;
  composeProject: string;
}

/** The deployment's Incus declaration; refused when it declares none. */
export function incusDeclarationOf(
  spec: DeploymentRuntimeSpec,
): IncusDeclaration {
  if (spec.runtime.incus === undefined)
    throw preconditionError(
      'The deployment declares runtime.engine "incus" without runtime.incus.',
    );
  return spec.runtime.incus;
}

/**
 * The access a managed check uses on the deployment's runtime: Docker's
 * argv under the check's budget, or the stack's Incus access under the same
 * budget. `images` are the bundle's references, by which Incus names an
 * image read by its digest.
 */
export async function deploymentAccess<Tag>(
  spec: DeploymentRuntimeSpec,
  budget: RuntimeBudget<Tag>,
  docker: DockerCommandOptions,
  images: readonly string[],
  incusRuntime?: IncusRuntime,
): Promise<RuntimeAccess<Tag>> {
  if (spec.runtime.engine !== 'incus')
    return dockerRuntimeAccess(budgetedDockerRun(budget, docker));
  // A check that holds no bundle names images by the ready receipt's.
  const references =
    images.length > 0
      ? images
      : (readReceipt(
          join(spec.stateDirectory, '.tale', 'runtime.json'),
        )?.images.map((image) => image.reference) ?? []);
  return incusRuntimeAccess({
    runtime:
      incusRuntime ??
      (await managedIncusRuntime({
        stateDirectory: spec.stateDirectory,
        composeProject: spec.composeProject,
        declaration: incusDeclarationOf(spec),
      })),
    budget,
    images: references,
  });
}

/**
 * `activateRuntimeConfiguration` on Incus: the spawner is drained and
 * restarted through the stack's Incus access, and its boot is read from the
 * ready readback.
 */
export async function activateIncusRuntimeConfiguration(
  options: ApplyIncusRuntimeOptions,
  effect: RuntimeConfigurationEffect,
  dependencies: IncusRuntimeDependencies = {},
) {
  const { identity } = readRuntimeBundle(options.bundleDirectory);
  const first = await observeReadyIncusState(options, dependencies);
  const runtime = first.incus;
  const access = stackAccess(
    runtime,
    first.runtime.images.map((image) => image.reference),
  );
  const observe = async () => {
    const { containers } = await observeReadyIncusState(options, {
      ...dependencies,
      incusRuntime: runtime,
    });
    const sandbox = containers.find(
      (container) =>
        container.Config.Labels['com.docker.compose.service'] === 'sandbox',
    );
    return spawnerBootSchema.parse({
      containerId: sandbox?.Id,
      startedAt: sandbox?.State.StartedAt,
    });
  };
  return activateConfiguration(
    options,
    effect,
    identity,
    observe,
    async () => {
      requireRuntime(
        await runtime.waitHealthy('sandbox', { timeout: HEALTH_TIMEOUT_S }),
        INCUS_APPLY_SENTENCES.unhealthy(['sandbox']),
      );
    },
    { ...dependencies, access },
  );
}
