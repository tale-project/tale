import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { externalDepError, preconditionError } from '../../utils/fail';
import * as logger from '../../utils/logger';
import { stableJson } from '../config/releases/identity';
import {
  AUTOMATION_CUTOVER_ACQUIRE_SQL,
  AUTOMATION_CUTOVER_PROBE_SQL,
  type CensusLedger,
  cutoverLockOwned,
  emptyLegacyCutoverCensus,
  legacyLedgerShape,
} from './automation-cutover-sql';
export {
  AUTOMATION_CUTOVER_ACQUIRE_SQL,
  AUTOMATION_CUTOVER_PROBE_SQL,
  LEGACY_CUTOVER_LEDGER_SHA256,
} from './automation-cutover-sql';
import { ledgerFloor } from './automation-floor';
import { AUTOMATION_PROTOCOL_LABEL } from './automation-model';
import {
  bundledBackendIdentity,
  databaseIdentitySchema,
  installedAutomationLedger,
  protocolRead,
} from './automation-protocol';
import { automationSession } from './automation-session';
import { runtimeCommand } from './runtime-command';
import {
  atomicRuntimeFile,
  readRegular,
  requireRuntime,
  type RuntimeDependencies,
} from './runtime-model';

export const LEGACY_CUTOVER_REVISION =
  'b4931db4b48bdfde37afe1af2a1479e6640a0799';
const writerSchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  image: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  revision: z.literal(LEGACY_CUTOVER_REVISION),
  protocol: z.literal(1),
  restarts: z.number().int().nonnegative(),
  running: z.boolean(),
  pid: z.number().int().nonnegative(),
  status: z.enum(['running', 'exited']),
  dead: z.literal(false),
  startedAt: z.string(),
  restartPolicy: z.literal('unless-stopped'),
  project: z.string(),
  service: z.enum(['backend-api', 'backend-worker']),
});
const cutoverReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  phase: z.enum(['stopping', 'stopped']),
  targetRevision: z.string().regex(/^[a-f0-9]{40}$/),
  project: z.string(),
  database: databaseIdentitySchema,
  writers: z.array(writerSchema).min(2).max(96),
});

export function requireEmptyLegacyCensus(
  raw: string,
  options: { message?: string; ledger?: CensusLedger } = {},
): void {
  requireRuntime(
    emptyLegacyCutoverCensus(raw, options.ledger),
    options.message ??
      'Automation cutover requires the supported legacy schema and zero unfinished runs across all organizations. Keep the old runtime; retry after the existing runs finish.',
  );
}

type InstalledWriter = Awaited<
  ReturnType<typeof bundledBackendIdentity>
>['writers'][number];

/** Why these writers are not a legacy runtime the cutover may stop, or
 * `null` when they are: the verified v0.5.77 backend (source and protocol),
 * kept stopped by `unless-stopped`, in a known process state, inside the
 * projects the cutover holds custody of. */
export function legacyWriterRefusal(
  writers: readonly InstalledWriter[],
  projects: readonly string[],
): 'source' | 'restart-policy' | 'unrecognized' | 'state' | 'custody' | null {
  const parsed = z.array(writerSchema).min(2).max(96).safeParse(writers);
  if (!parsed.success) {
    if (
      !writers.every(
        (writer) =>
          writer.revision === LEGACY_CUTOVER_REVISION && writer.protocol === 1,
      )
    )
      return 'source';
    if (!writers.every((writer) => writer.restartPolicy === 'unless-stopped'))
      return 'restart-policy';
    return 'unrecognized';
  }
  if (
    !parsed.data.every((writer) =>
      writer.running
        ? writer.status === 'running' && writer.pid > 0
        : writer.status === 'exited' && writer.pid === 0,
    )
  )
    return 'state';
  if (!parsed.data.every((writer) => projects.includes(writer.project)))
    return 'custody';
  return null;
}

/** The way to the one release the cutover starts from, and back to `release`.
 * `-v`: before the target release, `tale update --version` printed the CLI's
 * own version and changed nothing, and the way back runs v0.5.77's CLI. */
export function viaLegacyRelease(release: string | undefined): string {
  return `Upgrade to v0.5.77 first and then come back: run \`tale update -v 0.5.77\` and \`tale deploy\`, then \`tale update -v ${release ?? '<this release>'}\` and \`tale deploy\` again.`;
}

/** What a workspace deployment refuses to cut over, in its operator's words. */
export function workspaceWriterRefusalMessage(
  refusal: Exclude<ReturnType<typeof legacyWriterRefusal>, null>,
  release?: string,
): string {
  switch (refusal) {
    case 'source':
      return `This backend is not the released v0.5.77 runtime, the only one the automation writer protocol cutover starts from. ${viaLegacyRelease(release)}`;
    case 'restart-policy':
      return `The backend containers do not use the \`unless-stopped\` restart policy the automation writer protocol cutover needs to keep them stopped. Remove the Compose override that changes it, then redeploy v0.5.77. ${viaLegacyRelease(release)}`;
    case 'unrecognized':
    case 'state':
      return 'The backend containers are in a state the automation writer protocol cutover cannot verify. Check them with `tale status`, bring the v0.5.77 deployment back to a clean running state, then run this deploy again.';
    case 'custody':
      return "Automation cutover found backend writers outside this deployment's Compose projects.";
  }
}

/** Managed apply's prepared references; a workspace names its own registry. */
const MANAGED_TARGET_REPOSITORY = 'ghcr.io/tale-project/tale/tale-platform';

/** A workspace (`tale deploy`) deployment runs its backend writers in colour
 * projects, so its cutover holds custody of those, and recovering from an
 * interruption means running `tale deploy` again rather than a managed bundle. */
export interface WorkspaceCutoverScope {
  /** Where legacy writers may run: both colour projects and, for a backend
   *  singleton that predates the colours, the deployment's own. */
  writerProjects: readonly string[];
  /** Where already-created target writers may run: the colour projects. */
  targetProjects: readonly string[];
  /** `<registry>/tale-platform`: the repository of the admitted digest. */
  targetRepository: string;
  /** The release being deployed, named in the way forward. */
  release?: string;
}

/** Stops the legacy writers under a held zero census before the first
 * protocol-2 runtime starts. Managed apply calls it under its deployment
 * custody after images and Compose validate; `tale deploy` calls it with a
 * workspace scope right before the new colour starts. Stopped old writers
 * bridge lock release to protocol-2 boot; the latter installs migration 0163
 * before it starts workers or serves requests. A terminal legacy row is not
 * proof that historical external work has retired. */
export async function cutoverLegacyAutomation(
  options: {
    databaseId: string;
    project: string;
    stateDirectory: string;
    targetRevision: string;
    targetBackendImages: readonly string[];
    workspace?: WorkspaceCutoverScope;
    /** Read and verify only: never lock or stop. Verifies the recorded
     * handoff when new writers exist and otherwise returns, unchanged. */
    verifyOnly?: boolean;
  },
  dependencies: RuntimeDependencies,
): Promise<void> {
  const { databaseId, project, workspace } = options;
  const writerProjects = workspace?.writerProjects ?? [project];
  const targetProjects = workspace?.targetProjects ?? [project];
  const targetRepository =
    workspace?.targetRepository ?? MANAGED_TARGET_REPOSITORY;
  const inventory = () =>
    bundledBackendIdentity(
      [project, `${project}-blue`, `${project}-green`],
      dependencies,
    );
  const before = await inventory();
  const ledger = await installedAutomationLedger(
    databaseId,
    project,
    dependencies,
  );
  if (ledgerFloor(ledger) === 2) return;
  const readDatabase = async () => {
    try {
      const values = z
        .array(databaseIdentitySchema)
        .length(1)
        .parse(
          JSON.parse(
            await protocolRead(
              ['container', 'inspect', databaseId],
              dependencies,
            ),
          ),
        );
      const value = values[0];
      const labels = value.Config.Labels;
      requireRuntime(
        value.Id === databaseId &&
          labels['com.docker.compose.project'] === project &&
          labels['com.docker.compose.service'] === 'db' &&
          labels['com.docker.compose.container-number'] === '1' &&
          labels['com.docker.compose.oneoff']?.toLowerCase() === 'false',
        'Cutover database custody changed.',
      );
      // Persist custody facts only; unrelated Docker labels are not public
      // deployment evidence and can contain operator-provided metadata.
      return {
        ...value,
        Config: {
          Image: value.Config.Image,
          Labels: Object.fromEntries(
            [
              'com.docker.compose.project',
              'com.docker.compose.service',
              'com.docker.compose.container-number',
              'com.docker.compose.oneoff',
            ].map((name) => [name, labels[name]]),
          ),
        },
      };
    } catch {
      throw preconditionError(
        'Automation cutover database identity is unreadable.',
      );
    }
  };
  const database = await readDatabase();
  const receiptFile = join(
    options.stateDirectory,
    '.tale',
    'automation-cutover.json',
  );
  const readPrior = () => {
    try {
      return cutoverReceiptSchema.parse(
        JSON.parse(readRegular(receiptFile).toString('utf8')),
      );
    } catch {
      throw preconditionError(
        workspace
          ? 'The automation cutover receipt .tale/automation-cutover.json is unreadable. Keep it and the stopped backend containers as they are; run `tale deploy` again once the receipt is restored.'
          : 'The automation cutover recovery receipt is unreadable; keep the pending runtime.',
      );
    }
  };
  const asStopped = (writer: InstalledWriter | z.infer<typeof writerSchema>) =>
    Object.assign({}, writer, { running: false, pid: 0, status: 'exited' });
  const notStopped = ' The old backend was not stopped.';
  // A workspace's new colour that runs installs 0163 before it serves or
  // works, so only its resume is left to verify. One that does not run never
  // finished migrating and the deploy recreates it: the old writers then take
  // a fresh held census below, whatever the database went through since (a
  // reboot, or a snapshot restored in place with unfinished runs in it).
  const newWriters = before.writers.filter((writer) => writer.protocol === 2);
  const oldWriters = workspace
    ? before.writers.filter((writer) => writer.protocol !== 2)
    : before.writers;
  if (
    workspace
      ? newWriters.some((writer) => writer.running)
      : before.protocol === 2
  ) {
    // A created protocol-2 image raises the rollback floor, but is not itself
    // proof this legacy transition ever held a zero census. Resume only our
    // stopped-writer handoff for this exact target and DB incarnation.
    const prior = readPrior();
    const references = [...new Set(options.targetBackendImages)];
    requireRuntime(
      references.length > 0 &&
        references.length <= 2 &&
        references.every(
          (reference) =>
            reference.startsWith(`${targetRepository}@`) &&
            /^sha256:[a-f0-9]{64}$/.test(
              reference.slice(targetRepository.length + 1),
            ),
        ),
      'Cutover recovery requires exact prepared backend image references.',
    );
    let targetIds: string[];
    try {
      const images = z
        .array(
          z.object({
            Id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
            RepoDigests: z.array(z.string()),
            Config: z.object({ Labels: z.record(z.string(), z.string()) }),
          }),
        )
        .length(references.length)
        .parse(
          JSON.parse(
            await protocolRead(
              ['image', 'inspect', ...references],
              dependencies,
            ),
          ),
        );
      requireRuntime(
        references.every(
          (reference) =>
            images.filter((image) => image.RepoDigests.includes(reference))
              .length === 1,
        ) &&
          images.every(
            (image) =>
              image.Config.Labels['org.opencontainers.image.revision'] ===
                options.targetRevision &&
              image.Config.Labels[AUTOMATION_PROTOCOL_LABEL] === '2',
          ),
        'Target image capability differs.',
      );
      targetIds = images.map((image) => image.Id);
    } catch {
      throw preconditionError(
        'Automation cutover recovery cannot verify the prepared target images.',
      );
    }
    requireRuntime(
      prior.phase === 'stopped' &&
        prior.targetRevision === options.targetRevision &&
        prior.project === project &&
        // A running new colour restarts with its database after a reboot and
        // migrates on; a workspace does not ask for the same incarnation.
        (workspace !== undefined ||
          stableJson(prior.database) === stableJson(database)) &&
        before.writers.every((writer) => {
          const old = prior.writers.find(
            (retained) => retained.id === writer.id,
          );
          return old
            ? stableJson(writer) === stableJson(asStopped(old))
            : writer.protocol === 2 &&
                writer.revision === options.targetRevision &&
                targetProjects.includes(writer.project) &&
                targetIds.includes(writer.image);
        }) &&
        before.identity === (await inventory()).identity &&
        stableJson(database) === stableJson(await readDatabase()),
      workspace
        ? 'An interrupted automation cutover left backend writers that do not match its stopped handoff in .tale/automation-cutover.json, or old and new writers side by side. Keep the containers and the receipt as they are; do not start the old backend.'
        : 'Interrupted automation cutover lacks a matching stopped-writer handoff or has mixed old and new writers. Keep the pending managed deployment.',
    );
    return;
  }
  if (workspace)
    requireRuntime(
      newWriters.every(
        (writer) => !writer.running && targetProjects.includes(writer.project),
      ),
      `Automation cutover found new backend writers outside this deployment's colour projects.${notStopped}`,
    );
  if (options.verifyOnly) return;
  // A workspace's ledger is v0.5.77's, or v0.5.77's continued by the new
  // colour's first boot that was cut before 0163 committed (the deploy's
  // interrupt removes that colour). Neither has run a protocol-2 writer, so
  // both take the held census below; it proves zero again whatever happened
  // since an earlier attempt, a restarted database included.
  if (workspace)
    requireRuntime(
      legacyLedgerShape(ledger.ids) !== 'unsupported',
      `This database is not at v0.5.77, the only release the automation writer protocol cutover starts from. ${viaLegacyRelease(workspace.release)}${notStopped}`,
    );
  const refusal = legacyWriterRefusal(oldWriters, writerProjects);
  if (workspace && refusal !== null)
    throw preconditionError(
      `${workspaceWriterRefusalMessage(refusal, workspace.release)}${notStopped}`,
    );
  requireRuntime(
    refusal !== 'source' &&
      refusal !== 'restart-policy' &&
      refusal !== 'unrecognized',
    'Automation cutover supports only the verified b493 legacy runtime with unless-stopped backend writers. Keep this runtime and use a supported managed upgrade.',
  );
  requireRuntime(
    refusal !== 'state',
    'Automation cutover writer process state is uncertain.',
  );
  requireRuntime(
    refusal !== 'custody',
    'Automation cutover requires the single managed Compose project; blue/green writers are outside its custody.',
  );
  const writers = z.array(writerSchema).parse(oldWriters);
  const receipt = {
    schemaVersion: 1 as const,
    phase: 'stopping' as const,
    targetRevision: options.targetRevision,
    project,
    database,
    writers,
  };
  if (workspace && existsSync(receiptFile)) {
    // No protocol-2 writer exists and 0163 never committed, so an earlier
    // attempt's receipt proves nothing this one needs: the held census below
    // decides afresh.
    logger.info(
      'Automation cutover: an earlier attempt left its receipt; taking a fresh census.',
    );
  } else if (existsSync(receiptFile)) {
    const prior = readPrior();
    const normalize = (value: typeof writers) =>
      value.map((writer) => ({
        ...writer,
        running: false,
        pid: 0,
        status: 'exited',
      }));
    requireRuntime(
      prior.targetRevision === options.targetRevision &&
        prior.project === project &&
        stableJson(prior.database) === stableJson(database) &&
        stableJson(normalize(prior.writers)) === stableJson(normalize(writers)),
      'Automation cutover recovery identities changed. Keep the pending runtime and reconcile its recorded writers.',
    );
  }
  const session = await (dependencies.automationSession ?? automationSession)(
    databaseId,
    workspace ? 'run `tale deploy` again' : 'retry the same managed deployment',
  );
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let heartbeatWork = Promise.resolve();
  let lost = false;
  const probe = async () => {
    requireRuntime(
      !lost && session.healthy(),
      'The automation cutover lock was lost. No runtime was started.',
    );
    try {
      requireRuntime(
        cutoverLockOwned(await session.query(AUTOMATION_CUTOVER_PROBE_SQL)),
        'Cutover lock ownership differs.',
      );
    } catch {
      lost = true;
      throw preconditionError(
        'The automation cutover lock was lost. No runtime was started.',
      );
    }
  };
  try {
    requireEmptyLegacyCensus(
      await session.query(AUTOMATION_CUTOVER_ACQUIRE_SQL),
      workspace
        ? {
            ledger: 'legacy-or-continued',
            message:
              'The automation writer protocol cutover found unfinished automation runs (queued, running or waiting) or a write in progress. Nothing was stopped: let the runs finish or cancel them, then run `tale deploy` again.',
          }
        : {},
    );
    requireRuntime(
      before.identity === (await inventory()).identity &&
        stableJson(database) === stableJson(await readDatabase()),
      'Automation cutover identities changed before stopping writers.',
    );
    await probe();
    atomicRuntimeFile(receiptFile, JSON.stringify(receipt));
    heartbeat = setInterval(() => {
      heartbeatWork = heartbeatWork.then(probe).catch(() => {
        lost = true;
      });
    }, 2_000);
    const running = writers
      .filter((writer) => writer.running)
      .map((writer) => writer.id);
    if (running.length) {
      logger.info(
        'Automation cutover: holding admission while gracefully stopping legacy backend writers (up to 60 seconds).',
      );
      try {
        await runtimeCommand(['stop', '--time=-1', ...running], dependencies, {
          timeout: 60,
          maxOutputBytes: 1_048_576,
        });
      } catch {
        throw externalDepError(
          workspace
            ? 'Automation cutover is pending: the graceful stop did not complete. Keep the .tale/automation-cutover.json receipt, then run `tale deploy` again. Do not manually restart containers.'
            : 'Automation cutover is pending: the graceful stop did not complete. Keep the deployment bundle and .tale/automation-cutover.json receipt, then retry the same managed deployment. Do not manually restart containers.',
        );
      }
    }
    clearInterval(heartbeat);
    heartbeat = undefined;
    await heartbeatWork;
    await probe();
    const after = await inventory();
    requireRuntime(
      stableJson(
        workspace
          ? after.writers.filter((writer) => writer.protocol !== 2)
          : after.writers,
      ) === stableJson(writers.map(asStopped)) &&
        after.writers.every(
          (writer) => writer.protocol !== 2 || !writer.running,
        ) &&
        stableJson(database) === stableJson(await readDatabase()),
      'Automation cutover did not observe every exact old writer stopped. Keep the pending deployment; do not start the new runtime.',
    );
    await probe();
    atomicRuntimeFile(
      receiptFile,
      JSON.stringify({ ...receipt, phase: 'stopped' }),
    );
    requireRuntime(
      session.healthy() && !lost,
      workspace
        ? 'Automation cutover lock was lost before handoff. Run `tale deploy` again.'
        : 'Automation cutover lock was lost before handoff. Retry the same managed deployment.',
    );
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await heartbeatWork;
    await session.close();
  }
}
