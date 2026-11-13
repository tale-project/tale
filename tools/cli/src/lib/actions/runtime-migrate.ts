/**
 * `tale runtime migrate` (design 14): move a workspace's deployment from
 * Docker Compose to Incus, roll it back, or finish it.
 *
 * `--to incus` runs these steps, each recorded in `.tale/migration.json`
 * once done, so an interrupted run resumes after the last one it finished:
 *
 * 1. preconditions: `runtime.next` declares the Incus runtime, `tale incus
 *    check` passes with its forwarding probes (a FORWARD drop policy is
 *    refused with its remedies, R-16, R3-13), and the CLI deploys exactly
 *    the version Docker runs;
 * 2. `quiesced`: under the deploy lock, the backend and the spawner drained,
 *    then every container of the Docker stack stopped with `docker stop`,
 *    Docker's `proxy` among them (R3-27). Downtime starts here. Under
 *    `unless-stopped` a container stopped this way stays stopped across a
 *    Docker restart and a reboot, so nothing changes its restart policy;
 * 3. `archived`: a Docker snapshot in today's archive format;
 * 4. `exported`: the snapshot as one file;
 * 5. `imported`: the Incus stack's images and volumes made (nothing
 *    starts), and the file imported into its `backups`, every archive
 *    checked by sha256;
 * 6. `restored`: the snapshot restored into fresh Incus volumes (D-29);
 * 7. `deployed`: once no running Docker container publishes 80 or 443
 *    (the proxy devices would take that traffic beside it, S15), the same
 *    version deployed on Incus with the same `.env`;
 * 8. `checked`: the public smoke checks against the new edge;
 * 9. `flipped`: `runtime.engine` becomes `incus`.
 *
 * The Docker stack stays stopped, its volumes as they were. `--to docker`
 * rolls back to them: the Incus instances are stopped and deleted (their
 * volumes kept), `tale.json` and the colour state go back to Docker's, and
 * the Docker stack starts again. `--finish` removes the Docker stack after
 * an explicit confirmation; nothing removes it on its own.
 */

import { existsSync } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { preconditionError } from '../../utils/fail';
import { getProjectId, type DeploymentEnv } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { resolveConsent } from '../../utils/output-mode';
import { BACKUP_VOLUME, RESTORABLE_ARCHIVES } from '../backup/constants';
import { createSnapshot } from '../backup/create-snapshot';
import { exportSnapshot, importSnapshot } from '../backup/export-import';
import { listSnapshots } from '../backup/list-snapshots';
import { resolveSnapshotPrefix } from '../backup/resolve-prefix';
import { verifySnapshot } from '../backup/verify-snapshot';
import { REQUIRED_VOLUMES } from '../compose/generators/constants';
import { runDeploymentSmoke } from '../deployment/deployment-smoke';
import { docker as dockerCommand } from '../docker/docker';
import { readProject } from '../project/read-project';
import type { RuntimeDeclaration } from '../project/runtime-declaration';
import { writeProject } from '../project/write-project';
import { readJournal, updateJournal } from '../runtime/incus/apply/journal';
import type { CheckReport } from '../runtime/incus/contract/check';
import { workspaceContractSource } from '../runtime/incus/contract/contract';
import {
  DEFAULT_PROBE_NAME,
  DEFAULT_PROBE_PUBLIC,
  defaultProbeImage,
  probedCheck,
} from '../runtime/incus/contract/probed-check';
import { workspaceIncusDirectory } from '../runtime/incus/credentials';
import { IncusRuntime } from '../runtime/incus/incus-runtime';
import type { StackRuntime } from '../runtime/types';
import { getFlipPending } from '../state/flip-pending';
import { getCurrentColor } from '../state/get-current-color';
import { getPreviousVersion } from '../state/get-previous-version';
import { getPreviousVersionFilePath } from '../state/get-previous-version-file-path';
import { getStateFilePath } from '../state/get-state-file-path';
import {
  ENDED_STEPS,
  MIGRATION_STEPS,
  migrationJournalFile,
  migrationJournalSchema,
  readMigrationJournal,
  type MigrationJournal,
  type MigrationStep,
} from '../state/migration-journal';
import { writePrivateJson } from '../state/private-files';
import { setCurrentColor } from '../state/set-current-color';
import { setPreviousVersion } from '../state/set-previous-version';
import { withLock } from '../state/with-lock';
import { colorPlatformVersion } from './color-lifecycle';
import { deploy } from './deploy';
import { drainBackend, endDrainBackend } from './drain-backend';
import { drainSandbox } from './drain-sandbox';
import { incusWorkspaceOf } from './incus-deploy';
import {
  environmentInstances,
  startEnvironment,
  stopEnvironment,
} from './stop';

/** The words `tale runtime migrate` speaks. */
export const MIGRATE_SENTENCES = {
  noTarget: (directory: string) =>
    `tale.json in ${directory} declares no Incus runtime to migrate to: runtime.next with engine "incus" and its incus block.`,
  notDocker: 'The workspace does not run on Docker: there is nothing to move.',
  nothingDeployed:
    'Docker runs no deployment of this workspace (no live colour): deploy it first, or start on Incus directly.',
  flipPending:
    'A Docker deploy did not finish its colour flip: run tale deploy to finish it, then migrate.',
  version: (running: string | null, cli: string) =>
    `Docker runs ${running ?? 'an unknown version'}, and this CLI deploys ${cli}: the migration moves one version as it is.`,
  check: 'The Incus node cannot take the stack yet (tale incus check):',
  ports: (holders: readonly string[]) =>
    `Docker still publishes port 80 or 443 (${holders.join(', ')}): the Incus proxy devices would take that traffic beside it.`,
  smoke: 'The stack on Incus failed the smoke checks:',
  migrated:
    'The workspace runs on Incus. The Docker stack stays stopped: tale runtime migrate --to docker rolls back to it, tale runtime migrate --finish removes it.',
  noMigration: 'No migration from Docker is recorded: nothing to roll back.',
  finished:
    'The migration was finished: the Docker stack is removed, so there is nothing to roll back to.',
  rolledBack:
    'The migration was rolled back already: the workspace runs on Docker.',
  notFlipped:
    'Only a migration that completed can be finished: run tale runtime migrate --to incus to complete it, or --to docker to roll it back.',
} as const;

/** What the migration does outside the runtimes' own verbs: each one a
 * production operation, and a scripted one in the tests. */
export interface MigrationOperations {
  /** `tale incus check` of the node, with its forwarding probes. */
  check(): Promise<CheckReport>;
  /** Drain the backend's turns and the spawner's runs on Docker. */
  drain(docker: StackRuntime): Promise<void>;
  /** Every running Docker container with the ports it publishes (`docker
   * ps --format`), on the host the CLI drives Docker on. */
  publishedPorts(): Promise<{ name: string; ports: string }[]>;
  /** Take the Docker snapshot (archives); returns its id. */
  archive(docker: StackRuntime, version: string): Promise<string>;
  /** Write snapshot `id` to `file`. */
  exportSnapshot(docker: StackRuntime, id: string, file: string): Promise<void>;
  /** Make the Incus stack's images and volumes, starting nothing. */
  prepareIncus(incus: StackRuntime, version: string): Promise<void>;
  /** Whether Incus's `backups` holds snapshot `id`. */
  hasSnapshot(incus: StackRuntime, id: string): Promise<boolean>;
  /** Import the export `file` into Incus's `backups`. */
  importSnapshot(incus: StackRuntime, file: string): Promise<void>;
  /** Restore `id` into fresh Incus volumes, or finish the restore a crash
   * left pending. */
  restore(incus: StackRuntime, id: string): Promise<void>;
  /** Deploy `version` on Incus (the caller holds the lock). */
  deploy(incus: StackRuntime, version: string): Promise<void>;
  /** The public smoke checks against the Incus edge; the failed checks'
   * lines when it fails. */
  smoke(
    incus: StackRuntime,
    version: string,
  ): Promise<{ passed: boolean; failures: string[] }>;
  /** Clear the drain the snapshot carried over (best effort). */
  endDrain(runtime: StackRuntime): Promise<void>;
  /** Undo what an Incus deploy or restore left half done before the Incus
   * instances go: a pending restore is aborted, a flip record cleared. */
  settleIncus(incus: StackRuntime): Promise<void>;
}

export interface MigrationContext {
  deployDir: string;
  /** The version this CLI deploys. */
  cliVersion: string;
  docker: StackRuntime;
  /** The Incus runtime the migration moves to (or leaves). */
  incus: () => Promise<StackRuntime>;
  operations: MigrationOperations;
  /** Seconds each started instance may take to become healthy. */
  healthTimeout: number;
  now?: () => Date;
  /** Called after each recorded step (the tests interrupt here). */
  afterStep?: (step: string) => void | Promise<void>;
}

async function writeMigrationJournal(
  context: MigrationContext,
  journal: MigrationJournal,
): Promise<MigrationJournal> {
  const next = {
    ...journal,
    updatedAt: (context.now ?? (() => new Date()))().toISOString(),
  };
  await mkdir(join(context.deployDir, '.tale'), {
    recursive: true,
    mode: 0o700,
  });
  await writePrivateJson(
    migrationJournalFile(context.deployDir),
    migrationJournalSchema.parse(next),
  );
  return next;
}

function reached(journal: MigrationJournal, step: MigrationStep): boolean {
  const at = MIGRATION_STEPS.indexOf(journal.step as MigrationStep);
  return at >= MIGRATION_STEPS.indexOf(step);
}

/** The host ports a `docker ps` Ports column publishes. */
export function publishedHostPorts(ports: string): number[] {
  const found: number[] = [];
  for (const entry of ports.split(',')) {
    const match = /:(\d+)(?:-(\d+))?->/.exec(entry.trim());
    if (match === null) continue;
    const first = Number(match[1]);
    const last = match[2] === undefined ? first : Number(match[2]);
    for (let port = first; port <= last && port - first < 65536; port += 1)
      found.push(port);
  }
  return found;
}

/** Refuse while a running Docker container publishes 80 or 443 (R3-27). */
async function assertEdgePortsFree(
  operations: MigrationOperations,
): Promise<void> {
  const holders = (await operations.publishedPorts()).filter((container) =>
    publishedHostPorts(container.ports).some(
      (port) => port === 80 || port === 443,
    ),
  );
  if (holders.length > 0)
    throw preconditionError(
      MIGRATE_SENTENCES.ports(
        holders.map((holder) => `${holder.name}: ${holder.ports}`),
      ),
      [
        `docker stop ${holders.map((holder) => holder.name).join(' ')}`,
        'then run tale runtime migrate --to incus again; it resumes where it stopped.',
      ],
    );
}

/** Put Docker's colour and previous version back (or clear them). */
async function writeDeploymentState(
  deployDir: string,
  state: MigrationJournal['docker'],
): Promise<void> {
  if (state.colour === null) await removeFile(getStateFilePath(deployDir));
  else await setCurrentColor(deployDir, state.colour);
  if (state.previousVersion === null)
    await removeFile(getPreviousVersionFilePath(deployDir));
  else await setPreviousVersion(deployDir, state.previousVersion);
}

async function removeFile(file: string): Promise<void> {
  try {
    await unlink(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/** The check's refusals, each with its remedy's lines indented. */
function refusalLines(report: CheckReport): string[] {
  const lines: string[] = [MIGRATE_SENTENCES.check];
  for (const finding of report.findings) {
    if (finding.level !== 'refusal') continue;
    lines.push(finding.sentence);
    for (const line of finding.remedy?.split('\n') ?? [])
      lines.push(`  ${line}`);
  }
  return lines;
}

/** The fresh start: every precondition, then the journal's first entry. */
async function begin(context: MigrationContext): Promise<MigrationJournal> {
  const { deployDir, docker, operations } = context;
  const project = await readProject(deployDir);
  const runtime = project.runtime;
  if ((runtime?.engine ?? 'docker') !== 'docker')
    throw preconditionError(MIGRATE_SENTENCES.notDocker);
  if (runtime?.next?.engine !== 'incus' || runtime.next.incus === undefined)
    throw preconditionError(MIGRATE_SENTENCES.noTarget(deployDir), [
      'Add runtime.next to tale.json: { "engine": "incus", "incus": { ... } }, as tale init --runtime incus writes runtime.',
      'Then tale incus bootstrap (as root) and tale incus check.',
    ]);
  if ((await getFlipPending(deployDir)) !== null)
    throw preconditionError(MIGRATE_SENTENCES.flipPending);
  const live = await getCurrentColor(deployDir);
  if (live === null) throw preconditionError(MIGRATE_SENTENCES.nothingDeployed);
  const running = await colorPlatformVersion(live, docker);
  if (running !== context.cliVersion)
    throw preconditionError(
      MIGRATE_SENTENCES.version(running, context.cliVersion),
      'Deploy this CLI version on Docker first (tale deploy), or align the CLI with tale update --version <the version Docker runs>.',
    );
  logger.step('Checking the Incus node (tale incus check)...');
  const report = await operations.check();
  if (!report.ok)
    throw preconditionError(
      refusalLines(report).join('\n'),
      'Fix the node, then run tale runtime migrate --to incus again.',
    );
  const at = (context.now ?? (() => new Date()))().toISOString();
  const journal = await writeMigrationJournal(context, {
    schemaVersion: 1,
    from: 'docker',
    to: 'incus',
    version: context.cliVersion,
    step: 'started',
    startedAt: at,
    updatedAt: at,
    snapshot: null,
    exportFile: null,
    docker: {
      colour: live,
      previousVersion: await getPreviousVersion(deployDir),
    },
  });
  await context.afterStep?.('started');
  return journal;
}

/** Record `step` as done and tell the test hook. */
async function record(
  context: MigrationContext,
  journal: MigrationJournal,
  step: MigrationJournal['step'],
  change: Partial<MigrationJournal> = {},
): Promise<MigrationJournal> {
  const next = await writeMigrationJournal(context, {
    ...journal,
    ...change,
    step,
  });
  await context.afterStep?.(step);
  return next;
}

function requireSnapshot(journal: MigrationJournal): string {
  if (journal.snapshot === null)
    throw new Error('The migration journal records no snapshot.');
  return journal.snapshot;
}

/** `tale runtime migrate --to incus`. */
export async function migrateToIncus(context: MigrationContext): Promise<void> {
  const { deployDir, docker, operations } = context;
  await withLock(deployDir, 'runtime migrate --to incus', async () => {
    logger.header('Migrating the deployment from Docker to Incus');
    const found = await readMigrationJournal(deployDir);
    if (found?.step === 'flipped') {
      logger.success(MIGRATE_SENTENCES.migrated);
      return;
    }
    let journal: MigrationJournal;
    if (
      found === null ||
      (ENDED_STEPS as readonly string[]).includes(found.step)
    )
      journal = await begin(context);
    else {
      journal = found;
      logger.info(
        `Resuming the migration of ${journal.version} after its ${journal.step} step.`,
      );
    }

    if (!reached(journal, 'quiesced')) {
      logger.step('Draining the backend and the sandbox on Docker...');
      await operations.drain(docker);
      // Every container, the edge first: downtime starts here.
      await stopEnvironment({ deployDir, runtime: docker, lockHeld: true });
      // The colour state is the runtime's that serves; Docker's is in the
      // journal, and a rollback puts it back.
      await writeDeploymentState(deployDir, {
        colour: null,
        previousVersion: null,
      });
      journal = await record(context, journal, 'quiesced');
    }

    if (!reached(journal, 'archived')) {
      logger.step('Archiving the Docker volumes...');
      const id = await operations.archive(docker, journal.version);
      journal = await record(context, journal, 'archived', { snapshot: id });
    }
    const id = requireSnapshot(journal);
    const file = join(deployDir, '.tale', `migration-${id}.tar`);

    if (!reached(journal, 'exported')) {
      // The export renames its file into place only once complete.
      if (!existsSync(file)) await operations.exportSnapshot(docker, id, file);
      journal = await record(context, journal, 'exported', {
        exportFile: file,
      });
    }

    const incus = await context.incus();
    if (!reached(journal, 'imported')) {
      logger.step('Making the Incus stack’s images and volumes...');
      await operations.prepareIncus(incus, journal.version);
      if (!(await operations.hasSnapshot(incus, id)))
        await operations.importSnapshot(incus, file);
      journal = await record(context, journal, 'imported');
    }
    if (journal.exportFile !== null) {
      await removeFile(journal.exportFile);
      journal = await writeMigrationJournal(context, {
        ...journal,
        exportFile: null,
      });
    }

    if (!reached(journal, 'restored')) {
      logger.step(`Restoring snapshot ${id} into fresh Incus volumes...`);
      await operations.restore(incus, id);
      journal = await record(context, journal, 'restored');
    }

    if (!reached(journal, 'deployed')) {
      await assertEdgePortsFree(operations);
      await operations.deploy(incus, journal.version);
      await operations.endDrain(incus);
      journal = await record(context, journal, 'deployed');
    }

    if (!reached(journal, 'checked')) {
      logger.step('Running the smoke checks against the Incus edge...');
      const smoke = await operations.smoke(incus, journal.version);
      if (!smoke.passed)
        throw preconditionError(
          [MIGRATE_SENTENCES.smoke, ...smoke.failures].join('\n'),
          [
            'tale runtime migrate --to incus   (check again once fixed; it resumes here)',
            'tale runtime migrate --to docker  (roll back to the stopped Docker stack)',
          ],
        );
      journal = await record(context, journal, 'checked');
    }

    await flipEngine(deployDir, 'incus');
    await record(context, journal, 'flipped');
    logger.success(MIGRATE_SENTENCES.migrated);
  });
}

/** Move the Incus block between `runtime.incus` and `runtime.next`. */
async function flipEngine(
  deployDir: string,
  to: 'incus' | 'docker',
): Promise<void> {
  const path = join(deployDir, 'tale.json');
  const project = await readProject(deployDir);
  const runtime = project.runtime;
  let next: RuntimeDeclaration | undefined;
  if (to === 'incus') {
    if (runtime?.engine === 'incus') return;
    const incus = runtime?.next?.incus;
    if (runtime?.next?.engine !== 'incus' || incus === undefined)
      throw preconditionError(MIGRATE_SENTENCES.noTarget(deployDir));
    next = { engine: 'incus', incus };
  } else {
    if ((runtime?.engine ?? 'docker') === 'docker') return;
    const incus = runtime?.incus;
    next = {
      engine: 'docker',
      ...(incus === undefined ? {} : { next: { engine: 'incus', incus } }),
    };
  }
  await writeProject(path, { ...project, runtime: next });
  logger.info(`tale.json: runtime.engine is now ${to}.`);
}

/** `tale runtime migrate --to docker`: back to the kept Docker stack. */
export async function migrateToDocker(
  context: MigrationContext,
): Promise<void> {
  const { deployDir, docker, operations } = context;
  await withLock(deployDir, 'runtime migrate --to docker', async () => {
    logger.header('Rolling the migration back to Docker');
    const journal = await readMigrationJournal(deployDir);
    if (journal === null)
      throw preconditionError(MIGRATE_SENTENCES.noMigration);
    if (journal.step === 'finished')
      throw preconditionError(MIGRATE_SENTENCES.finished);
    if (journal.step === 'rolled-back') {
      logger.success(MIGRATE_SENTENCES.rolledBack);
      return;
    }
    if (journal.step === 'flipped')
      logger.warn(
        'What changed on Incus since the migration does not go back: Docker starts on its data as the migration left it.',
      );

    // The Incus instances go first: their proxy devices hold 80 and 443.
    if (reached(journal, 'imported')) {
      const incus = await context.incus();
      await operations.settleIncus(incus);
      await stopEnvironment({ deployDir, runtime: incus, lockHeld: true });
      for (const instance of await environmentInstances(incus))
        if (!(await incus.remove(instance.name)))
          throw new Error(
            `Could not delete the Incus instance ${instance.name}.`,
          );
      logger.info(
        'The Incus instances are deleted; their volumes stay, and a later migration sets them aside.',
      );
    }
    await flipEngine(deployDir, 'docker');
    await writeDeploymentState(deployDir, journal.docker);
    await startEnvironment({
      deployDir,
      runtime: docker,
      healthTimeout: context.healthTimeout,
      lockHeld: true,
    });
    await operations.endDrain(docker);
    if (journal.exportFile !== null) await removeFile(journal.exportFile);
    await record(context, journal, 'rolled-back', { exportFile: null });
    logger.success('The workspace runs on Docker again.');
  });
}

/** The Docker volumes `--finish` removes: every data volume a deploy
 * creates; `backups`, which holds Docker's snapshots and is none of them,
 * stays. */
function dockerDataVolumes(): string[] {
  return REQUIRED_VOLUMES.map((name) => `${getProjectId()}_${name}`);
}

/** `tale runtime migrate --finish`: remove the stopped Docker stack. */
export async function finishMigration(
  context: MigrationContext & {
    assumeYes?: boolean;
    confirm: (message: string) => Promise<boolean>;
  },
): Promise<void> {
  const { deployDir, docker } = context;
  await withLock(deployDir, 'runtime migrate --finish', async () => {
    const journal = await readMigrationJournal(deployDir);
    if (journal === null)
      throw preconditionError(MIGRATE_SENTENCES.noMigration);
    if (journal.step === 'finished') {
      logger.success('The migration is finished already.');
      return;
    }
    if (journal.step !== 'flipped')
      throw preconditionError(MIGRATE_SENTENCES.notFlipped);
    const containers = await environmentInstances(docker);
    const running = containers.filter((instance) => instance.running);
    if (running.length > 0)
      throw preconditionError(
        `Docker containers of the stack run again: ${running.map((instance) => instance.name).join(', ')}. --finish removes only a stopped stack.`,
        `docker stop ${running.map((instance) => instance.name).join(' ')}`,
      );
    const volumes: string[] = [];
    for (const volume of dockerDataVolumes())
      if (await docker.volumeExists(volume)) volumes.push(volume);
    logger.warn(
      `This removes the Docker stack for good: ${containers.length} container(s)${containers.length === 0 ? '' : ` (${containers.map((instance) => instance.name).join(', ')})`} and the volumes ${volumes.join(', ') || '(none)'}. A rollback to Docker is not possible afterwards. ${getProjectId()}_${BACKUP_VOLUME} stays.`,
    );
    const consent =
      resolveConsent(context.assumeYes) ||
      (await context.confirm('Remove the Docker stack?'));
    if (!consent) {
      logger.info('Nothing was removed.');
      return;
    }
    for (const instance of containers)
      if (!(await docker.remove(instance.name)))
        throw new Error(`Could not remove the container ${instance.name}.`);
    for (const volume of volumes)
      if (!(await docker.removeVolume(volume)))
        throw new Error(`Could not remove the volume ${volume}.`);
    const pruned = await docker.pruneNetworks();
    if (!pruned.success)
      logger.warn(
        `Could not prune the project's Docker networks: ${pruned.stderr.trim() || 'no output'}`,
      );
    await record(context, journal, 'finished');
    const hint = await docker.volumeRemovalHint(
      `${getProjectId()}_${BACKUP_VOLUME}`,
    );
    logger.success('The Docker stack is removed; the migration is finished.');
    if (hint !== null)
      logger.info(
        `Kept: ${getProjectId()}_${BACKUP_VOLUME}, with Docker's snapshots. To delete it as well: ${hint}`,
      );
  });
}

/** What the production operations read beside the runtimes. */
export interface ProductionMigrationOptions {
  env: DeploymentEnv;
  /** The CLI's own version, for the probe helper's image. */
  cliVersion: string;
  /** Where the smoke checks reach the new edge; `SITE_URL` by default. */
  smokeUrl?: string;
}

/** The migration's operations as the CLI runs them. */
export function productionMigrationOperations(
  options: ProductionMigrationOptions,
): MigrationOperations {
  const { env } = options;
  const deployDir = env.DEPLOY_DIR;
  const workspaceOf = (incus: StackRuntime) => {
    if (!(incus instanceof IncusRuntime))
      throw new Error('The migration moves to the Incus runtime.');
    return incusWorkspaceOf(incus, {
      env,
      hostAlias: process.env.HOST ?? 'localhost',
    });
  };
  const dockerPrefix = async (docker: StackRuntime) => {
    const prefix = await resolveSnapshotPrefix(docker);
    if (prefix === null)
      throw preconditionError(
        'No Tale data volumes found on Docker for this project: nothing to migrate.',
      );
    return prefix;
  };
  return {
    check: async () =>
      probedCheck(
        await workspaceContractSource(deployDir, options.cliVersion),
        workspaceIncusDirectory(deployDir),
        {
          image: defaultProbeImage(options.cliVersion),
          publicTarget: DEFAULT_PROBE_PUBLIC,
          publicName: DEFAULT_PROBE_NAME,
          probes: true,
        },
      ),
    drain: async (docker) => {
      await drainBackend({ dryRun: false, runtime: docker });
      await drainSandbox({ dryRun: false, runtime: docker });
    },
    publishedPorts: async () => {
      const listed = await dockerCommand(
        'ps',
        '--format',
        '{{.Names}}\t{{.Ports}}',
      );
      if (!listed.success)
        throw preconditionError(
          `Docker's published ports could not be read (docker ps): ${listed.stderr.trim() || 'no output'}`,
        );
      return listed.stdout
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => {
          const [name = '', ports = ''] = line.split('\t');
          return { name: name.trim(), ports: ports.trim() };
        });
    },
    archive: async (docker, version) => {
      const manifest = await createSnapshot({
        prefix: await dockerPrefix(docker),
        trigger: 'manual',
        platformVersion: version,
        runtime: docker,
      });
      if (manifest === null)
        throw new Error('The Docker snapshot found no volume to archive.');
      return manifest.id;
    },
    exportSnapshot: async (docker, id, file) => {
      await exportSnapshot({
        runtime: docker,
        prefix: await dockerPrefix(docker),
        id,
        to: file,
      });
    },
    prepareIncus: async (incus, version) => {
      const workspace = workspaceOf(incus);
      const target = await workspace.compile({
        stateful: version,
        colours: { blue: version },
      });
      workspace.assertProtocol(target);
      await workspace.prepare(target);
      await workspace.apply(await workspace.desired(target), 'volumes');
    },
    hasSnapshot: async (incus, id) =>
      (await listSnapshots('', incus)).some((manifest) => manifest.id === id),
    importSnapshot: async (incus, file) => {
      await importSnapshot({ runtime: incus, prefix: '', file });
    },
    restore: async (incus, id) => {
      if ((await readJournal(deployDir))?.restorePending) {
        await incus.restoreSnapshot({ kind: 'resume' });
        return;
      }
      const manifest = (await listSnapshots('', incus)).find(
        (candidate) => candidate.id === id,
      );
      if (manifest === undefined)
        throw new Error(`Incus's backups holds no snapshot ${id}.`);
      await verifySnapshot('', manifest, incus);
      await incus.restoreSnapshot({
        kind: 'start',
        id,
        volumes: Object.keys(manifest.volumes).filter((archive) =>
          (RESTORABLE_ARCHIVES as readonly string[]).includes(archive),
        ),
      });
    },
    deploy: async (incus, version) => {
      await deploy({
        version,
        stop: false,
        env,
        hostAlias: process.env.HOST ?? 'localhost',
        dryRun: false,
        // The migration's own snapshot holds the data.
        skipBackup: true,
        runtime: incus,
        lockHeld: true,
      });
    },
    smoke: async (incus, version) => {
      const url = options.smokeUrl ?? env.SITE_URL;
      const request = await loopbackEdge(incus, url);
      const report = await runDeploymentSmoke({
        url,
        ...(request === undefined ? {} : { request }),
        ...(version === 'latest' ? {} : { expectedVersion: version }),
        timeoutMs: 15_000,
        turnTimeoutMs: 60_000,
      });
      return {
        passed: report.passed,
        failures: report.checks
          .filter((check) => check.status === 'fail')
          .map((check) => `${check.name}: ${check.detail}`),
      };
    },
    endDrain: (runtime) => endDrainBackend(runtime),
    settleIncus: async (incus) => {
      const journal = await readJournal(deployDir);
      if (journal?.restorePending) {
        logger.step('Undoing the restore the migration left pending...');
        await incus.restoreSnapshot({ kind: 'abort' });
      }
      if (journal?.flip)
        await updateJournal(deployDir, journal.stack, (next) => {
          next.flip = null;
        });
    },
  };
}

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * A site served under a loopback name (`http://localhost`) is reached on
 * Docker through its userland proxy, but an Incus NAT proxy device takes
 * no loopback traffic. The smoke checks then go to the edge instance's own
 * address, with the site's `Host`, so they judge the new edge and not
 * whatever else answers on the loopback.
 */
export async function loopbackEdge(
  incus: StackRuntime,
  url: string,
): Promise<typeof fetch | undefined> {
  const site = new URL(url);
  if (!LOOPBACK_NAMES.has(site.hostname)) return undefined;
  const address = (await incus.inspect(`${getProjectId()}-proxy`))?.address;
  if (address === null || address === undefined) return undefined;
  logger.info(
    `${site.host} is a loopback name, which the Incus proxy devices do not take: the smoke checks reach the edge at ${address}.`,
  );
  const request = (input: string | URL | Request, init?: RequestInit) => {
    const target = new URL(input instanceof Request ? input.url : input);
    if (target.origin !== site.origin) return fetch(input, init);
    target.hostname = address;
    const headers = new Headers(init?.headers);
    headers.set('Host', site.host);
    return fetch(target, { ...init, headers });
  };
  return Object.assign(request, { preconnect: fetch.preconnect });
}
