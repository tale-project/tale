/**
 * The workspace path on Incus (design 7.2, 7.3): `tale deploy` and
 * `tale rollback` of a workspace whose `tale.json` declares the Incus
 * runtime, over the stack target the compiler makes from the same compose
 * generators Docker Compose runs.
 *
 * A deploy converges the stack scope by scope, each a plan of its own that
 * the applier converges (D-07):
 *
 * 1. the images and the volumes (a missing data volume of a stack that ran
 *    before is refused, never made again empty: R3-22);
 * 2. the infrastructure — the resolvers and the switch, which keep their
 *    running image until a deploy with --stop (R-02);
 * 3. the stateful tier, behind the downtime gate, the spawner drained before
 *    it is replaced;
 * 4. the flip (7.3): the idle colour comes up in its slots and takes traffic
 *    once each replica passes the switch's admission probe; every replica is
 *    healthy; `admit` (a no-op unless a stale marker); the old colour is
 *    withdrawn by its markers, drained, stopped gracefully and deleted, all
 *    through `retireColor`, the order Docker and Incus share. No step
 *    reloads the switch: its upstream files never change.
 *
 * The flip is journaled with its phase (`flip` in the Incus journal), so an
 * interrupted flip resumes from there: a colour that is up is not made
 * again, a marker that is set stays set, the drain and the stop run again.
 * `--services` rolls the live colour one replica at a time instead: each is
 * withdrawn by its marker, drained (a backend, unaimed, as on Docker),
 * stopped and made again, and must be healthy before the next goes.
 */

import { createHash, X509Certificate } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import { emitJson } from '../../utils/json-output';
import {
  getProjectId,
  getReplicaCounts,
  type DeploymentEnv,
  type ReplicaCounts,
} from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { getOutputMode } from '../../utils/output-mode';
import { createSnapshot } from '../backup/create-snapshot';
import { rotateSnapshots } from '../backup/rotate-snapshots';
import { buildColorCompose } from '../compose/generators/generate-color-compose';
import { buildStatefulCompose } from '../compose/generators/generate-stateful-compose';
import {
  ROTATABLE_SERVICES,
  isRotatableService,
  isStatefulService,
  type DeploymentColor,
  type RotatableService,
  type ServiceName,
} from '../compose/types';
import type { RunOrigin } from '../config/dev-origin';
import { stableJson } from '../config/releases/identity';
import { incusRuntimeAccess } from '../deployment/runtime-access-incus';
import { SANDBOX_INCUS_DIRECTORY } from '../deployment/runtime-sandbox';
import { drainSpawner } from '../deployment/runtime-spawner';
import type { ImageFacts } from '../oci/image-facts';
import { applyIncusPlan, type ApplyHooks } from '../runtime/incus/apply/apply';
import {
  assertNoRestorePending,
  readJournal,
  updateJournal,
  type FlipPhase,
  type FlipRecord,
  type RestoreGuardedVerb,
} from '../runtime/incus/apply/journal';
import { readStack } from '../runtime/incus/apply/readback';
import {
  interpolate,
  interpolationSource,
} from '../runtime/incus/compile/interpolate';
import {
  compileStackTarget,
  requireStackTarget,
  type StackTarget,
} from '../runtime/incus/compile/stack-target';
import {
  CHECK_SENTENCES,
  checkNode,
  type CheckReport,
} from '../runtime/incus/contract/check';
import { nodeContract } from '../runtime/incus/contract/contract';
import type { NodeContract } from '../runtime/incus/contract/contract-model';
import { workspaceIncusDirectory } from '../runtime/incus/credentials';
import {
  IncusRuntime as IncusRuntimeClass,
  type IncusRuntime,
} from '../runtime/incus/incus-runtime';
import { loadPlanKey } from '../runtime/incus/plan/digest';
import {
  plan as planStack,
  type DesiredStack,
  type RenderedFile,
} from '../runtime/incus/plan/plan';
import {
  incusPlanSchema,
  parseResourceId,
  type IncusPlan,
  type IncusPlanPhase,
  type IncusPlanResource,
} from '../runtime/incus/plan/plan-model';
import {
  ensureImages,
  pullFailure,
  registryHosts,
} from '../runtime/incus/verbs/images';
import { resolverFiles } from '../runtime/incus/verbs/names';
import { switchFiles } from '../runtime/incus/verbs/switch';
import type { StackRuntime } from '../runtime/types';
import { getCurrentColor } from '../state/get-current-color';
import { getNextColor } from '../state/get-next-color';
import { getOppositeColor } from '../state/get-opposite-color';
import { setCurrentColor } from '../state/set-current-color';
import { setPreviousVersion } from '../state/set-previous-version';
import {
  awaitRunningColorHealthy,
  colorPlatformVersion,
  colorProject,
  retireColor,
} from './color-lifecycle';
import {
  backendApiContainer,
  drainBackend,
  endDrainBackend,
} from './drain-backend';

/** The sentences the workspace path on Incus speaks. */
const INCUS_DEPLOY_SENTENCES = {
  probe: 'The Incus node cannot run this stack:',
  check: 'The Incus node differs from the stack contract:',
  protocol: (image: string) =>
    `${image} is no automation writer protocol 2 image (v0.5.78 or later); a workspace on Incus runs only those.`,
  credentials: (directory: string) =>
    `The sandbox spawner's Incus credentials are missing in ${directory}: place client.crt, client.key and server.crt there (mode 0600).`,
  noColour:
    'No colour is live yet: run a full deploy (without --services) first.',
  reviewed:
    'The reviewed plan differs from what the node needs now; create and review a new plan (tale deploy --plan-only --json).',
  unfinished: (flip: FlipRecord) =>
    `An interrupted flip onto ${flip.promoting} (${flip.version}) has reached its ${flip.phase} phase and serves that release; a rollback does not finish it.`,
  resume: (flip: FlipRecord) =>
    `Resuming the interrupted flip onto ${flip.promoting} from its ${flip.phase} phase (a colour that is up is not made again).`,
} as const;

/** The switched roles a colour withdraws and admits. */
const SWITCHED_ROLES: readonly RotatableService[] = ['platform', 'backend-api'];

/** The scopes of a deploy, in the order they converge. */
export type WorkspaceScope =
  | 'volumes'
  | 'infrastructure'
  | 'stateful'
  | `colour-${DeploymentColor}`;

const SCOPES = [
  'volumes',
  'infrastructure',
  'stateful',
  'colour-blue',
  'colour-green',
] as const satisfies readonly WorkspaceScope[];

/** What a deploy's reviewed plan holds: one plan per scope, in order. */
export const workspacePlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  scopes: z
    .array(z.strictObject({ scope: z.enum(SCOPES), plan: incusPlanSchema }))
    .max(SCOPES.length),
});
export type WorkspacePlan = z.infer<typeof workspacePlanSchema>;

/** The reviewed plan a `--plan <file>` names: JSON, as `--plan-only
 * --json` printed it (its `data`), or the plan alone. */
export function readWorkspacePlan(file: string): WorkspacePlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw preconditionError(
      `The reviewed plan ${file} cannot be read as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const envelope = z.object({ data: z.unknown() }).safeParse(parsed);
  const plan = workspacePlanSchema.safeParse(
    envelope.success ? envelope.data.data : parsed,
  );
  if (!plan.success)
    throw preconditionError(
      `The reviewed plan ${file} is no workspace plan of the Incus runtime.`,
      'Create it with tale deploy --plan-only --json.',
    );
  return plan.data;
}

/** Collaborators a test replaces. */
export interface IncusDeployDependencies {
  /** Replaces the applier hooks it names. */
  hooks?: Partial<ApplyHooks>;
  /** The CLI's health wait of one replica (`awaitRunningColorHealthy`). */
  waitHealthy?: (name: string, timeoutS: number) => Promise<boolean>;
  /** The node's server certificate digest. */
  serverCertificateSha256?: string;
  /** Runs after each step of a flip or roll (tests crash here). */
  afterStep?: (step: string) => Promise<void> | void;
  /** The node check against the stack's contract; `checkNode` without the
   * forwarding probes by default (`tale incus check` runs them). */
  nodeCheck?: (
    client: IncusRuntime['client'],
    contract: NodeContract,
  ) => Promise<CheckReport>;
  now?: () => Date;
}

export interface IncusWorkspaceOptions {
  runtime: IncusRuntime;
  deployDir: string;
  /** `GHCR_REGISTRY`: where the release's images come from. */
  registry: string;
  hostAlias: string;
  origin?: RunOrigin;
  replicas: ReplicaCounts;
  /** Seconds one replica may take to become healthy. */
  healthTimeout: number;
  /** Seconds the web tier drains before the old colour stops. */
  drainTimeout: number;
  /** `--stop`: a running stop-gated instance may stop. */
  stop: boolean;
  /** The process environment `.env` interpolation reads (workspace). */
  environment?: NodeJS.ProcessEnv;
  dependencies?: IncusDeployDependencies;
}

/** The versions one target runs: the stateful tier and each live colour. */
export interface WorkspaceVersions {
  stateful: string;
  colours: Partial<Record<DeploymentColor, string>>;
}

/** `plan` with only the resources `keep` names changing; every other
 * resource is left as it is (`unchanged`) by this apply. */
export function restrictPlan(
  plan: IncusPlan,
  keep: (resource: IncusPlanResource) => boolean,
): IncusPlan {
  return {
    ...plan,
    resources: plan.resources.map((resource) =>
      keep(resource)
        ? resource
        : { ...resource, action: 'unchanged' as const, effects: [] },
    ),
  };
}

/** What a reviewer decides on in one scope: what happens to which resource
 * with which effects (digests left out, as on the managed path). */
function reviewable(plan: IncusPlan): unknown {
  // Images are pulled by digest before anything is applied, and the target
  // digest already names each; what a reviewer decides on is the rest.
  return plan.resources
    .filter(
      (resource) =>
        resource.action !== 'unchanged' &&
        parseResourceId(resource.id).kind !== 'image',
    )
    .map((resource) => ({
      id: resource.id,
      action: resource.action,
      effects: resource.effects,
    }));
}

function sameReview(reviewed: IncusPlan, made: IncusPlan): boolean {
  return stableJson(reviewable(reviewed)) === stableJson(reviewable(made));
}

/** Refuse unless every scope a deploy would apply is the reviewed one:
 * checked before anything changes. */
function assertReviewed(made: WorkspacePlan, reviewed: WorkspacePlan): void {
  const matches =
    made.scopes.length === reviewed.scopes.length &&
    made.scopes.every((entry, index) => {
      const other = reviewed.scopes[index];
      return (
        other !== undefined &&
        other.scope === entry.scope &&
        sameReview(other.plan, entry.plan)
      );
    });
  if (!matches) throw preconditionError(INCUS_DEPLOY_SENTENCES.reviewed);
}

/** The plan of one scope as an operator reads it. */
function describeScope(scope: WorkspaceScope, plan: IncusPlan): string[] {
  const lines: string[] = [];
  for (const resource of plan.resources) {
    if (resource.action === 'unchanged') continue;
    const effects =
      resource.effects.length === 0 ? '' : ` [${resource.effects.join(', ')}]`;
    lines.push(
      `${scope}: ${resource.action.padEnd(9)} ${resource.id}${effects}${resource.hint === undefined ? '' : ` — ${resource.hint}`}`,
    );
  }
  return lines;
}

/** A first deploy's volume step: the images and the volumes the target
 * makes or changes, nothing else, and never a volume deletion. */
function volumesOnly(resource: IncusPlanResource): boolean {
  const { kind } = parseResourceId(resource.id);
  return (
    (kind === 'image' || kind === 'volume') && resource.action !== 'delete'
  );
}

/** Everything but images and volumes, which the volume step makes. */
function withoutVolumes(resource: IncusPlanResource): boolean {
  const { kind } = parseResourceId(resource.id);
  return kind !== 'image' && kind !== 'volume';
}

/**
 * One workspace stack on Incus: its compiled targets, its plans and the
 * applier with the workspace's hooks.
 */
export class IncusWorkspace {
  readonly runtime: IncusRuntime;
  private readonly options: IncusWorkspaceOptions;
  private readonly facts = new Map<string, ImageFacts>();
  private architecture: string | undefined;
  private serverArchitecture = '';
  private backendDrained = false;

  constructor(options: IncusWorkspaceOptions) {
    this.runtime = options.runtime;
    this.options = options;
  }

  get dependencies(): IncusDeployDependencies {
    return this.options.dependencies ?? {};
  }

  /** The node's facts, refused when it cannot run the stack. */
  async probe(registries: readonly string[] = []): Promise<void> {
    const probe = await this.runtime.probeDetail(registries);
    if (probe.errors.length > 0 || probe.facts === null)
      throw preconditionError(
        [INCUS_DEPLOY_SENTENCES.probe, ...probe.errors].join('\n'),
        'tale incus check names each remedy.',
      );
    for (const warning of probe.warnings) logger.warn(warning);
    this.architecture = probe.facts.platform.split('/')[1] ?? '';
    this.serverArchitecture = probe.facts.architecture;
  }

  private async factsOf(reference: string): Promise<ImageFacts> {
    const known = this.facts.get(reference);
    if (known !== undefined) return known;
    const read = await this.runtime.inspectImage(reference);
    const facts = { ...read, reference: read.reference };
    this.facts.set(reference, facts);
    return facts;
  }

  /** The `.env` the stack's services and interpolation read. */
  private dotenv(): string {
    const path = join(this.options.deployDir, '.env');
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
  }

  /** Compile the stack: the stateful document at one version and one
   * document per live colour at its own. */
  async compile(versions: WorkspaceVersions): Promise<StackTarget> {
    if (this.architecture === undefined) await this.probe();
    const { registry, hostAlias, origin } = this.options;
    const documents: { compose: unknown; colour?: DeploymentColor }[] = [
      {
        compose: buildStatefulCompose(
          { version: versions.stateful, registry },
          hostAlias,
          origin,
        ),
      },
    ];
    for (const colour of ['blue', 'green'] as const) {
      const version = versions.colours[colour];
      if (version === undefined) continue;
      documents.push({
        compose: buildColorCompose({ version, registry }, colour, origin),
        colour,
      });
    }
    const dotenv = this.dotenv();
    const { variables } = interpolationSource('workspace', {
      dotenv,
      processEnvironment: this.options.environment ?? process.env,
      documents: documents.map((document) => document.compose),
    });
    const images: Record<string, ImageFacts> = {};
    for (const { compose } of documents)
      for (const service of Object.values(
        (compose as { services?: Record<string, { image?: unknown }> })
          .services ?? {},
      )) {
        const reference = interpolate(String(service.image ?? ''), (name) =>
          Object.hasOwn(variables, name) ? variables[name] : undefined,
        );
        if (reference !== '' && images[reference] === undefined)
          images[reference] = await this.factsOf(reference);
      }
    const sessions = await this.factsOf(
      `${registry}/tale-sandbox-runtime:${versions.stateful}`,
    );
    return requireStackTarget(
      compileStackTarget({
        path: 'workspace',
        stack: this.runtime.stack,
        documents,
        variables,
        envFiles: { '.env': dotenv },
        declaration: this.runtime.declaration,
        images,
        sandboxRuntime: {
          reference: sessions.reference,
          digest: sessions.digest,
        },
        architecture: this.architecture ?? '',
        replicas: this.options.replicas,
      }),
    );
  }

  /** The platform image of a target must write automation protocol 2. */
  assertProtocol(target: StackTarget): void {
    for (const image of target.images)
      if (
        image.services.some((service) => isRotatableService(service)) &&
        this.facts.get(image.reference)?.automationWriterProtocol !== '2' &&
        ![...this.facts.values()].some(
          (facts) =>
            facts.digest === image.digest &&
            facts.automationWriterProtocol === '2',
        )
      )
        throw preconditionError(
          INCUS_DEPLOY_SENTENCES.protocol(image.reference),
        );
  }

  /** The files the stack writes beside the target: the spawner's
   * credentials from `<workspace>/.tale/sandbox-incus/` (where `tale incus
   * bootstrap` writes them), the resolvers' files and
   * the switch's lists. */
  private files(target: StackTarget): RenderedFile[] {
    const directory = join(
      this.options.deployDir,
      '.tale',
      SANDBOX_INCUS_DIRECTORY,
    );
    const files: RenderedFile[] = target.files.map((file) => {
      const path = join(directory, file.source.file);
      if (!existsSync(path))
        throw preconditionError(INCUS_DEPLOY_SENTENCES.credentials(directory));
      return {
        volume: file.volume,
        path: file.path,
        mode: file.mode,
        uid: 0,
        gid: 0,
        content: new Uint8Array(readFileSync(path)),
        write: 'overwrite',
      };
    });
    return [...files, ...resolverFiles(target), ...switchFiles(target)];
  }

  private serverCertificateSha256(): string {
    if (this.dependencies.serverCertificateSha256 !== undefined)
      return this.dependencies.serverCertificateSha256;
    const pem = readFileSync(
      join(workspaceIncusDirectory(this.options.deployDir), 'server.crt'),
      'utf8',
    );
    return createHash('sha256')
      .update(new X509Certificate(pem).raw)
      .digest('hex');
  }

  /** What the stack should be, and where. */
  async desired(target: StackTarget): Promise<DesiredStack> {
    if (this.architecture === undefined) await this.probe();
    const { declaration } = this.runtime;
    return {
      target,
      files: this.files(target),
      destination: {
        endpoint:
          declaration.endpoint ?? `https://${declaration.network.gateway}:8443`,
        serverCertificateSha256: this.serverCertificateSha256(),
        project: declaration.project,
        pool: declaration.pool,
        architecture: this.serverArchitecture,
      },
      key: await loadPlanKey(this.options.deployDir),
    };
  }

  /** The plan of one scope against what the node holds now. */
  async plan(desired: DesiredStack, scope: WorkspaceScope): Promise<IncusPlan> {
    const readback = await readStack(this.runtime.client, {
      stack: desired.target.stack,
      pool: desired.target.pool,
      key: desired.key,
      files: desired.files.map((file) => ({
        volume: file.volume,
        path: file.path,
        write: file.write,
      })),
    });
    const phase: IncusPlanPhase = scope === 'volumes' ? 'full' : scope;
    const made = planStack(desired, readback, {
      phase,
      stop: this.options.stop,
    });
    return scope === 'volumes'
      ? restrictPlan(made, volumesOnly)
      : restrictPlan(made, withoutVolumes);
  }

  /** The applier's hooks on this workspace. */
  hooks(): ApplyHooks {
    const { runtime } = this;
    return {
      pullImage: async (image) => {
        const ensured = await ensureImages(runtime.client, [image], {
          stateRoot: runtime.stateRoot,
          registryMirror: runtime.declaration.registryMirror,
          registryMirrors: runtime.declaration.registryMirrors,
        });
        if (ensured.failed.length > 0) throw pullFailure(ensured.failed);
      },
      waitHealthy: async (instance) => {
        const healthy = await this.waitHealthy(instance.name);
        // Healthy by the CLI's probe is not yet reachable by the switch: a
        // replica made again in place waits for the switch to admit it
        // before the next one is withdrawn.
        if (healthy) {
          await runtime.awaitSwitchAdmission(instance.name, instance.service);
          return;
        }
        // A third-party sidecar is best effort, as on Docker (deploy.ts).
        if (instance.service === 'bgutil-provider') {
          logger.warn(
            'bgutil-provider did not become healthy (YouTube ingestion falls back to no PO token).',
          );
          return;
        }
        throw new Error(`${instance.name} did not become healthy.`);
      },
      // The spawner's own drain, as the managed path drains it: new
      // sessions are refused, and the deploy waits (bounded) until it holds
      // none. Best effort, as on Docker: the spawner's SIGTERM ends what is
      // left.
      drainSandbox: async (instance) => {
        logger.step('Draining the sandbox spawner before it is replaced...');
        try {
          const drained = await drainSpawner(instance, {
            access: incusRuntimeAccess<{ timeout?: number }>({
              runtime,
              images: [],
              budget: {
                bounds: (tag) => ({ timeout: tag?.timeout ?? 60 }),
                failed: () =>
                  preconditionError(
                    'The Incus runtime could not complete the command.',
                  ),
                refused: () =>
                  preconditionError('The Incus runtime refused the command.'),
              },
            }),
          });
          if (!drained.drained)
            logger.warn(
              `The sandbox spawner still holds ${drained.sessions ?? 'an unknown number of'} session(s); replacing it anyway, its SIGTERM ends them.`,
            );
        } catch (error) {
          logger.warn(
            `The sandbox drain is unavailable — proceeding (the spawner's SIGTERM drain handles its sessions): ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
      // An in-place replica: the drain is unaimed, as Docker's in-place
      // update drains the live api, and it is cleared once the roll ends.
      drainBackend: async () => {
        if (this.backendDrained) return;
        this.backendDrained = true;
        await drainBackend({ dryRun: false, runtime });
      },
      ...runtime.switchHooks(),
      volumeOwner: (volume) => runtime.volumeOwner(volume),
      ...this.dependencies.hooks,
    };
  }

  /** Clear an unaimed drain this workspace began. */
  async endDrain(): Promise<void> {
    if (!this.backendDrained) return;
    this.backendDrained = false;
    await endDrainBackend(this.runtime);
  }

  /** The CLI's health wait of one instance. */
  waitHealthy(name: string): Promise<boolean> {
    const wait = this.dependencies.waitHealthy;
    return wait === undefined
      ? this.runtime.waitHealthy(name, { timeout: this.options.healthTimeout })
      : wait(name, this.options.healthTimeout);
  }

  /** Apply one scope's plan; `reviewed` must match it when given. */
  async apply(
    desired: DesiredStack,
    scope: WorkspaceScope,
    options: {
      reviewed?: WorkspacePlan;
      keep?: (resource: IncusPlanResource) => boolean;
    } = {},
  ): Promise<IncusPlan> {
    let made = await this.plan(desired, scope);
    if (options.keep !== undefined) made = restrictPlan(made, options.keep);
    if (options.reviewed !== undefined) {
      const reviewed = options.reviewed.scopes.find(
        (entry) => entry.scope === scope,
      );
      if (reviewed === undefined || !sameReview(reviewed.plan, made))
        throw preconditionError(INCUS_DEPLOY_SENTENCES.reviewed);
    }
    for (const line of describeScope(scope, made)) logger.info(line);
    const now = this.dependencies.now;
    await applyIncusPlan({
      client: this.runtime.client,
      stateRoot: this.options.deployDir,
      desired,
      plan: made,
      hooks: this.hooks(),
      options: {
        stop: this.options.stop,
        ...(now === undefined ? {} : { now }),
      },
    });
    return made;
  }

  /**
   * The node against the stack's contract (design 7.2's preflight), as the
   * workspace's restricted certificate reads it: a project whose limits,
   * profile, bridge or trust differ from what this target needs is refused
   * before anything changes. Forwarding is `tale incus check`'s to probe.
   */
  async checkNode(target: StackTarget): Promise<void> {
    const contract = nodeContract(this.runtime.declaration, target);
    const report = await (
      this.dependencies.nodeCheck ??
      ((client, against) =>
        checkNode(client, against, {
          clientCertificate: readFileSync(
            join(workspaceIncusDirectory(this.options.deployDir), 'client.crt'),
            'utf8',
          ),
          probes: null,
          publicTarget: { host: '1.1.1.1', port: 443 },
          publicName: 'tale.dev',
        }))
    )(this.runtime.client, contract);
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
          INCUS_DEPLOY_SENTENCES.check,
          ...refusals.map((finding) => finding.sentence),
        ].join('\n'),
        'tale incus bootstrap brings the node to the contract; tale incus check names each remedy.',
      );
    for (const finding of report.findings)
      if (finding.level === 'warning') logger.warn(finding.sentence);
  }

  /** Make the target's images present and read its volumes' owners. */
  async prepare(target: StackTarget): Promise<void> {
    this.runtime.useTarget(target);
    await this.probe(registryHosts(target.images, this.runtime.declaration));
    await this.checkNode(target);
    await this.runtime.ensureTargetImages(target);
    if (this.dependencies.hooks?.volumeOwner === undefined)
      await this.runtime.readVolumeOwners(target);
  }

  /** Record the flip's phase in the journal (or clear it). */
  async recordFlip(flip: FlipRecord | null): Promise<void> {
    await updateJournal(
      this.options.deployDir,
      this.runtime.stack,
      (journal) => {
        journal.flip = flip;
      },
      this.dependencies.now,
    );
  }

  async step(name: string): Promise<void> {
    await this.dependencies.afterStep?.(name);
  }

  get stopAccepted(): boolean {
    return this.options.stop;
  }

  get healthTimeout(): number {
    return this.options.healthTimeout;
  }

  get drainTimeout(): number {
    return this.options.drainTimeout;
  }

  get replicas(): ReplicaCounts {
    return this.options.replicas;
  }

  get deployDir(): string {
    return this.options.deployDir;
  }
}

/** The journal of the workspace, refused while a restore is pending. */
async function admission(
  workspace: IncusWorkspace,
  verb: RestoreGuardedVerb,
): Promise<FlipRecord | null> {
  const journal = await readJournal(workspace.deployDir);
  assertNoRestorePending(journal, verb);
  return journal?.flip ?? null;
}

/** The colours a target holds while a flip runs: the promoting one at its
 * version, and the retiring one at the version it runs. */
async function flipVersions(
  workspace: IncusWorkspace,
  flip: FlipRecord,
  stateful: string,
): Promise<WorkspaceVersions> {
  const colours: Partial<Record<DeploymentColor, string>> = {
    [flip.promoting]: flip.version,
  };
  if (flip.retiring !== null) {
    const running = await colorPlatformVersion(
      flip.retiring,
      workspace.runtime,
    );
    if (running !== null) colours[flip.retiring] = running;
  }
  return { stateful, colours };
}

const PHASE_ORDER: readonly FlipPhase[] = ['starting', 'admitted', 'retiring'];

function reached(flip: FlipRecord, phase: FlipPhase): boolean {
  return PHASE_ORDER.indexOf(flip.phase) >= PHASE_ORDER.indexOf(phase);
}

/**
 * Run a colour flip from its journaled phase (design 7.3): the promoting
 * colour up and healthy, admitted, recorded as current; the retiring colour
 * withdrawn by its markers, drained, stopped and deleted; then the names of
 * the retired colour leave the resolvers.
 */
async function runFlip(
  workspace: IncusWorkspace,
  flip: FlipRecord,
  stateful: string,
  previousVersion: string | null,
  reviewed?: WorkspacePlan,
): Promise<void> {
  const { runtime } = workspace;
  const services = [...ROTATABLE_SERVICES];
  let current = flip;
  if (current.phase === 'starting') {
    const target = await workspace.compile(
      await flipVersions(workspace, current, stateful),
    );
    const desired = await workspace.desired(target);
    // The names of both colours (a deploy converged them already; a
    // rollback names its colour here), then the new colour in its slots:
    // each replica takes traffic once its admission probe passes.
    await workspace.apply(desired, 'infrastructure');
    logger.step(`Starting the ${current.promoting} colour...`);
    await workspace.apply(
      desired,
      `colour-${current.promoting}`,
      reviewed === undefined ? {} : { reviewed },
    );
    await workspace.step('colour-up');
    // Every replica healthy by the CLI's own health, those this run made
    // and those an earlier run left up alike.
    await awaitRunningColorHealthy(
      {
        color: current.promoting,
        services,
        replicas: workspace.replicas,
        healthTimeout: workspace.healthTimeout,
        runtime,
      },
      { wait: (name) => workspace.waitHealthy(name) },
    );
    // A no-op unless a replica carries a marker an aborted flip left.
    await runtime.admit(colorProject(current.promoting), SWITCHED_ROLES);
    await setCurrentColor(workspace.deployDir, current.promoting);
    if (previousVersion !== null && previousVersion !== current.version) {
      await setPreviousVersion(workspace.deployDir, previousVersion);
      logger.info(`Previous version saved: ${previousVersion}`);
    }
    current = { ...current, phase: 'admitted' };
    await workspace.recordFlip(current);
    await workspace.step('admitted');
  }
  if (reached(current, 'admitted') && current.retiring !== null) {
    current = { ...current, phase: 'retiring' };
    await workspace.recordFlip(current);
    // Withdraw by markers (and wait out two switch intervals), drain, stop
    // gracefully, delete, end the drain: the order Incus withdraws in.
    await retireColor({
      color: current.retiring as DeploymentColor,
      drainTimeout: workspace.drainTimeout,
      runtime,
    });
    await workspace.step('retired');
  }
  // The retired colour's names leave the resolvers.
  const settled = await workspace.compile({
    stateful,
    colours: { [current.promoting]: current.version },
  });
  await workspace.apply(await workspace.desired(settled), 'infrastructure');
  await workspace.recordFlip(null);
}

export interface DeployOnIncusOptions {
  workspace: IncusWorkspace;
  version: string;
  services?: ServiceName[];
  dryRun: boolean;
  /** `--plan <file>`: the reviewed plan (from `--plan-only --json`). */
  plan?: WorkspacePlan;
  override?: boolean;
  overrideAll?: boolean;
  skipBackup?: boolean;
}

/** The scopes a deploy would apply, planned against the node as it is. */
async function planDeploy(
  workspace: IncusWorkspace,
  versions: WorkspaceVersions,
  colour: DeploymentColor | null,
  services?: readonly string[],
): Promise<WorkspacePlan> {
  const target = await workspace.compile(versions);
  const desired = await workspace.desired(target);
  const scopes: WorkspacePlan['scopes'] = [];
  const keep =
    services === undefined
      ? undefined
      : (resource: IncusPlanResource) => {
          const { kind, name } = parseResourceId(resource.id);
          if (kind !== 'instance') return true;
          const spec = target.instances.find((item) => item.name === name);
          return spec !== undefined && services.includes(spec.service);
        };
  const order: WorkspaceScope[] =
    services === undefined
      ? [
          'volumes',
          'infrastructure',
          'stateful',
          ...(colour === null ? [] : ([`colour-${colour}`] as const)),
        ]
      : [
          'volumes',
          ...(services.some(isStatefulService) ? (['stateful'] as const) : []),
          ...(colour === null ? [] : ([`colour-${colour}`] as const)),
        ];
  for (const scope of order) {
    const made = await workspace.plan(desired, scope);
    scopes.push({
      scope,
      plan: keep === undefined ? made : restrictPlan(made, keep),
    });
  }
  return { schemaVersion: 1, scopes };
}

/**
 * `tale deploy` of a workspace on Incus. The caller holds the deploy lock.
 * `dryRun` plans every scope against the node and changes nothing.
 */
export async function deployOnIncus(
  options: DeployOnIncusOptions,
): Promise<void> {
  const { workspace, version } = options;
  const { runtime } = workspace;
  const inPlace = options.services !== undefined && options.services.length > 0;
  const pending = await admission(workspace, inPlace ? 'services' : 'deploy');
  await workspace.probe();
  const currentColor = await getCurrentColor(workspace.deployDir);
  const firstDeploy = currentColor === null && pending === null;
  const runningVersion =
    currentColor === null
      ? null
      : await colorPlatformVersion(currentColor, runtime);

  if (inPlace) {
    if (currentColor === null)
      throw preconditionError(INCUS_DEPLOY_SENTENCES.noColour);
    if (options.plan !== undefined)
      throw preconditionError(
        'A reviewed plan applies to a full deploy; --services rolls one replica at a time and is planned with --plan-only alone.',
      );
    const services = options.services ?? [];
    const versions: WorkspaceVersions = {
      stateful: version,
      colours: { [currentColor]: version },
    };
    if (options.dryRun) {
      printPlan(await planDeploy(workspace, versions, currentColor, services));
      return;
    }
    await rollInPlace(workspace, {
      versions,
      colour: currentColor,
      services,
      snapshot: () =>
        snapshotBeforeChange(workspace, options, runningVersion, version),
    });
    if (
      services.includes('platform') &&
      runningVersion !== null &&
      runningVersion !== version
    ) {
      await setPreviousVersion(workspace.deployDir, runningVersion);
      logger.info(`Previous version saved: ${runningVersion}`);
    }
    return;
  }

  // A full deploy: a flip onto the idle colour, or the one a crash left.
  const flip: FlipRecord = pending ?? {
    promoting: getNextColor(currentColor),
    retiring: currentColor,
    version,
    phase: 'starting',
    startedAt: (
      workspace.dependencies.now ?? (() => new Date())
    )().toISOString(),
  };
  const versions = await flipVersions(
    workspace,
    flip.phase === 'starting' ? { ...flip, version } : flip,
    version,
  );
  if (options.dryRun) {
    printPlan(await planDeploy(workspace, versions, flip.promoting));
    return;
  }
  if (pending !== null) logger.info(INCUS_DEPLOY_SENTENCES.resume(pending));
  else if (firstDeploy)
    logger.notice(
      'First deployment detected — including infrastructure services',
    );

  const target = await workspace.compile(versions);
  workspace.assertProtocol(target);
  const reviewed = options.plan;
  if (reviewed !== undefined)
    assertReviewed(
      await planDeploy(workspace, versions, flip.promoting),
      reviewed,
    );
  await workspace.prepare(target);
  await snapshotBeforeChange(workspace, options, runningVersion, version);
  const desired = await workspace.desired(target);
  await workspace.apply(
    desired,
    'volumes',
    reviewed === undefined ? {} : { reviewed },
  );
  if (pending === null || pending.phase === 'starting') {
    await workspace.apply(
      desired,
      'infrastructure',
      reviewed === undefined ? {} : { reviewed },
    );
    logger.step('Deploying the stateful services...');
    await workspace.apply(
      desired,
      'stateful',
      reviewed === undefined ? {} : { reviewed },
    );
    await workspace.step('stateful');
  }
  // A flip a crash left before its colour was up starts again on this
  // release; one past that point is finished as it was.
  const started: FlipRecord =
    pending?.phase === 'starting' ? { ...pending, version } : flip;
  await workspace.recordFlip(started);
  await workspace.step('flip-recorded');
  await runFlip(workspace, started, version, runningVersion, reviewed);
  if (started.version !== version)
    logger.warn(
      `The interrupted flip onto ${started.version} finished; run tale deploy again to deploy ${version}.`,
    );
}

/** The pre-deploy snapshot (D-28), when the deploy can change data. */
async function snapshotBeforeChange(
  workspace: IncusWorkspace,
  options: DeployOnIncusOptions,
  runningVersion: string | null,
  version: string,
): Promise<void> {
  if (runningVersion === null) return;
  const mutates =
    runningVersion !== version ||
    Boolean(options.override) ||
    Boolean(options.overrideAll);
  if (!mutates) return;
  if (options.skipBackup) {
    logger.warn(
      '--skip-backup: skipping the pre-deploy snapshot — if this deploy migrates data, recovery falls back to your own external backups.',
    );
    return;
  }
  const prefix = `${getProjectId()}_`;
  await createSnapshot({
    prefix,
    trigger: 'deploy',
    platformVersion: runningVersion,
    runtime: workspace.runtime,
  });
  await rotateSnapshots({ prefix, runtime: workspace.runtime });
}

function printPlan(plan: WorkspacePlan): void {
  if (getOutputMode().json) {
    emitJson('deploy', plan);
    return;
  }
  const lines = plan.scopes.flatMap(({ scope, plan: made }) =>
    describeScope(scope, made),
  );
  if (lines.length === 0)
    lines.push('The Incus stack is as planned; nothing changes.');
  for (const line of lines) logger.info(line);
}

/**
 * `--services` on Incus: the stateful services named are converged in
 * their scope, then the live colour's replicas of the named roles are
 * rolled one at a time — withdrawn by marker, drained (a backend, unaimed),
 * stopped, made again, healthy — so the others keep serving.
 */
async function rollInPlace(
  workspace: IncusWorkspace,
  args: {
    versions: WorkspaceVersions;
    colour: DeploymentColor;
    services: readonly ServiceName[];
    snapshot: () => Promise<void>;
  },
): Promise<void> {
  const target = await workspace.compile(args.versions);
  workspace.assertProtocol(target);
  await workspace.prepare(target);
  await args.snapshot();
  const desired = await workspace.desired(target);
  await workspace.apply(desired, 'volumes');
  const stateful = args.services.filter(isStatefulService);
  if (stateful.length > 0)
    await workspace.apply(desired, 'stateful', {
      keep: (resource) => {
        const { kind, name } = parseResourceId(resource.id);
        if (kind !== 'instance') return true;
        const spec = target.instances.find((item) => item.name === name);
        return (
          spec !== undefined &&
          (stateful as readonly string[]).includes(spec.service)
        );
      },
    });
  const roles = args.services.filter(isRotatableService);
  if (roles.length === 0) return;
  logger.warn(
    `In-place update of the live ${args.colour} colour: one replica at a time is withdrawn and replaced while the others serve.`,
  );
  try {
    for (const role of ROTATABLE_SERVICES) {
      if (!roles.includes(role)) continue;
      const replicas = target.instances
        .filter((spec) => spec.colour === args.colour && spec.service === role)
        .map((spec) => spec.name)
        .sort((left, right) =>
          left.localeCompare(right, 'en', { numeric: true }),
        );
      for (const name of replicas) {
        await workspace.apply(desired, `colour-${args.colour}`, {
          keep: (resource) => {
            const parsed = parseResourceId(resource.id);
            return parsed.kind !== 'instance' || parsed.name === name;
          },
        });
        await workspace.step(`rolled ${name}`);
      }
    }
  } finally {
    await workspace.endDrain();
  }
}

/**
 * `tale rollback` on Incus: the same flip toward the previous version on
 * the opposite colour (design 7.3). The stateful tier and the
 * infrastructure keep what they run. The caller holds the lock, and has
 * checked the version gate and the operator's consent.
 */
export async function rollbackOnIncus(args: {
  workspace: IncusWorkspace;
  currentColor: DeploymentColor;
  currentVersion: string;
  rollbackVersion: string;
}): Promise<void> {
  const { workspace } = args;
  const pending = await admission(workspace, 'rollback');
  // An interrupted flip toward another release is never finished as a
  // rollback: one still starting turns toward the previous release (its
  // colour is the one a rollback brings up), and one past its admission
  // already serves its release, so `tale deploy` finishes it first.
  if (
    pending !== null &&
    pending.version !== args.rollbackVersion &&
    pending.phase !== 'starting'
  )
    throw preconditionError(
      INCUS_DEPLOY_SENTENCES.unfinished(pending),
      'Run tale deploy to finish it, then tale rollback.',
    );
  const flip: FlipRecord =
    pending === null
      ? {
          promoting: getOppositeColor(args.currentColor),
          retiring: args.currentColor,
          version: args.rollbackVersion,
          phase: 'starting',
          startedAt: (
            workspace.dependencies.now ?? (() => new Date())
          )().toISOString(),
        }
      : { ...pending, version: args.rollbackVersion };
  if (pending !== null) logger.info(INCUS_DEPLOY_SENTENCES.resume(flip));
  const versions = await flipVersions(workspace, flip, args.currentVersion);
  const target = await workspace.compile(versions);
  workspace.assertProtocol(target);
  await workspace.prepare(target);
  await workspace.recordFlip(flip);
  await runFlip(workspace, flip, args.currentVersion, args.currentVersion);
}

/** The workspace stack of a deploy, rollback or cleanup on Incus. */
export function incusWorkspaceOf(
  runtime: IncusRuntime,
  options: {
    env: DeploymentEnv;
    hostAlias: string;
    origin?: RunOrigin;
    stop?: boolean;
    dependencies?: IncusDeployDependencies;
  },
): IncusWorkspace {
  const { env } = options;
  return new IncusWorkspace({
    runtime,
    deployDir: env.DEPLOY_DIR,
    registry: env.GHCR_REGISTRY,
    hostAlias: options.hostAlias,
    ...(options.origin === undefined ? {} : { origin: options.origin }),
    replicas: getReplicaCounts(),
    healthTimeout: env.HEALTH_CHECK_TIMEOUT,
    drainTimeout: env.DRAIN_TIMEOUT,
    stop: options.stop ?? false,
    ...(options.dependencies === undefined
      ? {}
      : { dependencies: options.dependencies }),
  });
}

/**
 * The api replica a control call addresses (`tale migrate`, `tale auth
 * reset-owner`). On Incus it is one of the serving colour's (design 7.3),
 * never the colour a flip retires, and a pending restore refuses `verb`
 * first (R3-22). Docker keeps the replica it always took.
 */
export async function servingApiReplica(
  runtime: StackRuntime,
  verb?: RestoreGuardedVerb,
): Promise<string | null> {
  if (!(runtime instanceof IncusRuntimeClass))
    return backendApiContainer(null, runtime);
  if (verb !== undefined)
    assertNoRestorePending(await readJournal(runtime.stateRoot), verb);
  return backendApiContainer(await getCurrentColor(runtime.stateRoot), runtime);
}
