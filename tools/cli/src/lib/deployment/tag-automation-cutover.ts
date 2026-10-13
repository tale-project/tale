import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import { migrationReadScript } from './acceptance-migrations';
import {
  cutoverLegacyAutomation,
  legacyWriterRefusal,
  viaLegacyRelease,
  type WorkspaceCutoverScope,
  workspaceWriterRefusalMessage,
} from './automation-cutover';
import {
  AUTOMATION_CUTOVER_READINESS_SQL,
  legacyCutoverBusy,
  legacyLedgerShape,
} from './automation-cutover-sql';
import { ledgerFloor } from './automation-floor';
import {
  bundledBackendIdentity,
  installedAutomationLedger,
  protocolRead,
} from './automation-protocol';
import {
  requireRuntime,
  revisionSchema,
  type RuntimeDependencies,
} from './runtime-model';
import { tagDatabaseId } from './tag-automation-protocol';

/**
 * `tale deploy` across the automation writer protocol cutover.
 *
 * The first release with writer protocol 2 (v0.5.78) quarantines every
 * unfinished legacy run in migration 0163, so the old writers must be stopped
 * under a held zero census before the new ones boot. A workspace deployment
 * runs that same barrier (`cutoverLegacyAutomation`) with custody of its
 * colour projects, right before the new colour starts. Everything that can
 * refuse is asked first, read-only, before the deploy changes anything.
 */

/** What the barrier needs, settled before the deploy changes anything. */
export interface TagCutoverPlan {
  /** An earlier `tale deploy` already began this cutover. */
  resume: boolean;
  /** The admitted protocol-2 digest every backend role runs. */
  platformImage: string;
  targetRevision: string;
}

export function workspaceCutoverScope(
  project: string,
  registry: string,
  release?: string,
): WorkspaceCutoverScope {
  return {
    writerProjects: [project, `${project}-blue`, `${project}-green`],
    targetProjects: [`${project}-blue`, `${project}-green`],
    targetRepository: `${registry}/tale-platform`,
    ...(release === undefined ? {} : { release }),
  };
}

const UNCHANGED = ' Nothing was changed.';

export const CUTOVER_BUSY = `This deploy upgrades the automation writer protocol once, and that needs every automation run in every organization to have finished. Some are still queued, running or waiting for an answer: let them finish or cancel them, and pause schedules and triggers so no new ones start, then run \`tale deploy\` again.${UNCHANGED}`;

/**
 * Where an existing protocol-1 host stands, assuming the target image is
 * protocol 2: `none` when nothing is crossed (an empty host, or a database
 * already at protocol 2), `resume` when an earlier deploy already stopped the
 * old backend or created the new one, `ready` when it can start. Throws, with the operator's next step, when it
 * cannot. Reads only.
 */
export async function assessTagAutomationCutover(
  args: {
    project: string;
    runningVersion: string | null;
    /** The release this deploy rolls, named in the way forward. */
    release?: string;
    deployDir: string;
    /** The workspace records no live colour (`.tale/deployment-color`). */
    firstDeploy: boolean;
  },
  dependencies: RuntimeDependencies = {},
): Promise<'none' | 'resume' | 'ready'> {
  const { project } = args;
  const running = args.runningVersion
    ? `This host runs Tale ${args.runningVersion}. `
    : '';
  const database = await tagDatabaseId(project, dependencies);
  if (database === null) return 'none';
  const ledger = await installedAutomationLedger(
    database,
    project,
    dependencies,
  );
  if (ledgerFloor(ledger) === 2) return 'none';
  // A first deploy takes no snapshot and replaces the database container: it
  // must never be the one that crosses the cutover of a database it found.
  requireRuntime(
    !args.firstDeploy,
    `This workspace has no record of the deployment that runs this database (.tale/deployment-color is missing), so a deploy would neither snapshot it nor keep its container. Run \`tale deploy\` from the workspace directory that deployed it.${UNCHANGED}`,
  );
  const scope = workspaceCutoverScope(project, '');
  const inventory = await bundledBackendIdentity(
    scope.writerProjects,
    dependencies,
  );
  // A new colour that runs is migrating: the barrier verifies the recorded
  // handoff. One that does not run is recreated by the deploy, so the old
  // writers alone are judged and counted, as on a first attempt.
  const newWriters = inventory.writers.filter(
    (writer) => writer.protocol === 2,
  );
  if (newWriters.some((writer) => writer.running)) return 'resume';
  const oldWriters = inventory.writers.filter(
    (writer) => writer.protocol !== 2,
  );
  const shape = legacyLedgerShape(ledger.ids);
  if (shape === 'unsupported')
    throw preconditionError(
      `${running}This database is not at v0.5.77, the only release the automation writer protocol cutover starts from. ${viaLegacyRelease(args.release)}${UNCHANGED}`,
    );
  const refusal = legacyWriterRefusal(oldWriters, scope.writerProjects);
  if (refusal !== null)
    throw preconditionError(
      `${running}${workspaceWriterRefusalMessage(refusal, args.release)}${UNCHANGED}`,
    );
  let busy: boolean;
  try {
    busy = legacyCutoverBusy(
      await protocolRead(
        ['exec', '-i', database, 'sh', '-s'],
        dependencies,
        migrationReadScript('db', AUTOMATION_CUTOVER_READINESS_SQL),
      ),
    );
  } catch {
    throw preconditionError(
      `The automation runs could not be counted before the automation writer protocol cutover. Check the database with \`tale status\`, then run \`tale deploy\` again.${UNCHANGED}`,
    );
  }
  requireRuntime(!busy, CUTOVER_BUSY);
  // An earlier deploy already stopped the old backend: it stays stopped.
  return oldWriters.every((writer) => !writer.running) ? 'resume' : 'ready';
}

/** The plan for a deploy whose admitted image is `platformImage` (undefined
 * for a protocol-1 target, which crosses nothing). */
export async function planTagAutomationCutover(
  args: {
    project: string;
    registry: string;
    platformImage: string | undefined;
    runningVersion: string | null;
    release?: string;
    deployDir: string;
    firstDeploy: boolean;
    /** `--stop`: would replace the database container mid-cutover. */
    stop: boolean;
    /** `--services`: an in-place roll has no colour to start after the stop. */
    inPlace: boolean;
  },
  dependencies: RuntimeDependencies = {},
): Promise<TagCutoverPlan | null> {
  if (args.platformImage === undefined) return null;
  const state = await assessTagAutomationCutover(args, dependencies);
  if (state === 'none') return null;
  requireRuntime(
    !args.inPlace,
    `This deploy upgrades the automation writer protocol once, which needs a full deploy: run \`tale deploy\` without --services.${UNCHANGED}`,
  );
  requireRuntime(
    !args.stop,
    `This deploy upgrades the automation writer protocol once and keeps the database container while it does: run \`tale deploy\` without --stop or --override-all, then \`tale deploy --stop\` afterwards to update db, object-store and proxy.${UNCHANGED}`,
  );
  const plan: TagCutoverPlan = {
    resume: state === 'resume',
    platformImage: args.platformImage,
    targetRevision: await imageRevision(args.platformImage, dependencies),
  };
  // With new writers already created, the barrier only verifies the recorded
  // handoff: ask it now, read-only, before the deploy changes anything.
  if (state === 'resume')
    await runTagAutomationCutover(
      { ...args, plan, verifyOnly: true },
      dependencies,
    );
  return plan;
}

async function imageRevision(
  reference: string,
  dependencies: RuntimeDependencies,
): Promise<string> {
  const [image] = z
    .array(
      z.object({
        Config: z.object({
          Labels: z.record(z.string(), z.string()).nullish(),
        }),
      }),
    )
    .length(1)
    .parse(
      JSON.parse(
        await protocolRead(['image', 'inspect', reference], dependencies),
      ),
    );
  const revision = revisionSchema.safeParse(
    image.Config.Labels?.['org.opencontainers.image.revision'],
  );
  requireRuntime(
    revision.success,
    'Selected image does not prove its source revision.',
  );
  return revision.data;
}

/** Stop the old writers under the held census, or verify the handoff an
 * earlier deploy recorded when new writers already exist. With `verifyOnly`
 * it never takes the lock or stops anything. */
export async function runTagAutomationCutover(
  args: {
    project: string;
    registry: string;
    deployDir: string;
    plan: TagCutoverPlan;
    release?: string;
    verifyOnly?: boolean;
  },
  dependencies: RuntimeDependencies = {},
): Promise<void> {
  const database = await tagDatabaseId(args.project, dependencies);
  requireRuntime(
    database !== null,
    'The automation writer protocol cutover cannot find the database. Nothing was stopped; check it with `tale status`, then run `tale deploy` again.',
  );
  await cutoverLegacyAutomation(
    {
      databaseId: database,
      project: args.project,
      stateDirectory: args.deployDir,
      targetRevision: args.plan.targetRevision,
      targetBackendImages: [args.plan.platformImage],
      workspace: workspaceCutoverScope(
        args.project,
        args.registry,
        args.release,
      ),
      ...(args.verifyOnly ? { verifyOnly: true } : {}),
    },
    dependencies,
  );
}
