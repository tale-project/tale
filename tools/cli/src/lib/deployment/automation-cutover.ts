import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { externalDepError, preconditionError } from '../../utils/fail';
import * as logger from '../../utils/logger';
import { stableJson } from '../config/releases/identity';
import {
  AUTOMATION_CUTOVER_ACQUIRE_SQL,
  AUTOMATION_CUTOVER_PROBE_SQL,
  cutoverLockOwned,
  emptyLegacyCutoverCensus,
} from './automation-cutover-sql';
export {
  AUTOMATION_CUTOVER_ACQUIRE_SQL,
  AUTOMATION_CUTOVER_PROBE_SQL,
  LEGACY_CUTOVER_LEDGER_SHA256,
} from './automation-cutover-sql';
import { AUTOMATION_PROTOCOL_LABEL } from './automation-model';
import {
  bundledBackendIdentity,
  databaseIdentitySchema,
  installedAutomationProtocol,
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

export function requireEmptyLegacyCensus(raw: string): void {
  requireRuntime(
    emptyLegacyCutoverCensus(raw),
    'Automation cutover requires the supported legacy schema and zero unfinished runs across all organizations. Keep the old runtime; retry after the existing runs finish.',
  );
}

/** Invoked only by managed apply, under its deployment custody, after images and
 * Compose validate. Stopped old writers bridge lock release to protocol-2 boot;
 * the latter installs migration0163 before it starts workers or serves requests.
 * A terminal legacy row is not proof that historical external work has retired. */
export async function cutoverLegacyAutomation(
  options: {
    databaseId: string;
    project: string;
    stateDirectory: string;
    targetRevision: string;
    targetBackendImages: readonly string[];
  },
  dependencies: RuntimeDependencies,
): Promise<void> {
  const { databaseId, project } = options;
  const inventory = () =>
    bundledBackendIdentity(
      [project, `${project}-blue`, `${project}-green`],
      dependencies,
    );
  const before = await inventory();
  const floor = await installedAutomationProtocol(
    databaseId,
    project,
    dependencies,
  );
  if (floor === 2) return;
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
        'The automation cutover recovery receipt is unreadable; keep the pending runtime.',
      );
    }
  };
  if (before.protocol === 2) {
    // A created protocol-2 image raises the rollback floor, but is not itself
    // proof this legacy transition ever held a zero census. Resume only our
    // stopped-writer handoff for this exact target and DB incarnation.
    const prior = readPrior();
    const references = [...new Set(options.targetBackendImages)];
    requireRuntime(
      references.length > 0 &&
        references.length <= 2 &&
        references.every((reference) =>
          /^ghcr\.io\/tale-project\/tale\/tale-platform@sha256:[a-f0-9]{64}$/.test(
            reference,
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
        stableJson(prior.database) === stableJson(database) &&
        before.writers.every((writer) => {
          const old = prior.writers.find(
            (retained) => retained.id === writer.id,
          );
          return old
            ? stableJson(writer) ===
                stableJson(
                  Object.assign({}, old, {
                    running: false,
                    pid: 0,
                    status: 'exited',
                  }),
                )
            : writer.protocol === 2 &&
                writer.revision === options.targetRevision &&
                writer.project === project &&
                targetIds.includes(writer.image);
        }) &&
        before.identity === (await inventory()).identity &&
        stableJson(database) === stableJson(await readDatabase()),
      'Interrupted automation cutover lacks a matching stopped-writer handoff or has mixed old and new writers. Keep the pending managed deployment.',
    );
    return;
  }
  const parsed = z.array(writerSchema).min(2).max(96).safeParse(before.writers);
  requireRuntime(
    parsed.success,
    'Automation cutover supports only the verified b493 legacy runtime with unless-stopped backend writers. Keep this runtime and use a supported managed upgrade.',
  );
  const writers = parsed.data;
  requireRuntime(
    writers.every((writer) =>
      writer.running
        ? writer.status === 'running' && writer.pid > 0
        : writer.status === 'exited' && writer.pid === 0,
    ),
    'Automation cutover writer process state is uncertain.',
  );
  requireRuntime(
    writers.every((writer) => writer.project === project),
    'Automation cutover requires the single managed Compose project; blue/green writers are outside its custody.',
  );
  const receipt = {
    schemaVersion: 1 as const,
    phase: 'stopping' as const,
    targetRevision: options.targetRevision,
    project,
    database,
    writers,
  };
  if (existsSync(receiptFile)) {
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
          'Automation cutover is pending: the graceful stop did not complete. Keep the deployment bundle and .tale/automation-cutover.json receipt, then retry the same managed deployment. Do not manually restart containers.',
        );
      }
    }
    clearInterval(heartbeat);
    heartbeat = undefined;
    await heartbeatWork;
    await probe();
    const after = await inventory();
    requireRuntime(
      stableJson(after.writers) ===
        stableJson(
          writers.map((writer) =>
            Object.assign({}, writer, {
              running: false,
              pid: 0,
              status: 'exited',
            }),
          ),
        ) && stableJson(database) === stableJson(await readDatabase()),
      'Automation cutover did not observe every exact old writer stopped. Keep the pending deployment; do not start the new runtime.',
    );
    await probe();
    atomicRuntimeFile(
      receiptFile,
      JSON.stringify({ ...receipt, phase: 'stopped' }),
    );
    requireRuntime(
      session.healthy() && !lost,
      'Automation cutover lock was lost before handoff. Retry the same managed deployment.',
    );
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await heartbeatWork;
    await session.close();
  }
}
