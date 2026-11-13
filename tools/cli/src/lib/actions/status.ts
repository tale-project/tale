import { getMarkers, getPalette } from '@tale/shared/tux';

import { emitJson } from '../../utils/json-output';
import { getProjectId } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import {
  type DeploymentColor,
  SIDECAR_SERVICES,
  STATEFUL_SERVICES,
} from '../compose/types';
import {
  readJournal,
  restorePendingNotice,
} from '../runtime/incus/apply/journal';
import { IncusRuntime } from '../runtime/incus/incus-runtime';
import { selectRuntime } from '../runtime/select-runtime';
import type { HealthState, StackRuntime } from '../runtime/types';
import { getDeploymentState } from '../state/get-deployment-state';
import { getLockInfo } from '../state/get-lock-info';

type ServiceStatus =
  | 'healthy'
  | 'starting'
  | 'unhealthy'
  | 'running'
  | 'stopped'
  | 'stopped after repeated crashes'
  | 'not deployed';

/** Whether the switch sends a replica traffic (Incus, design 5.3). */
type Admission = 'admitted' | 'withdrawn' | 'waiting';

interface ServiceRow {
  service: string;
  status: ServiceStatus;
  version: string | null;
  /** A switched replica on Incus: from the journal and its health. */
  admission?: Admission;
  /** Incus, a service stopped after repeated crashes: the last console
   * lines Incus kept, under that label (design D-24). */
  crashTail?: { label: string; lines: string[] };
}

/** The full deployment status, computed once — then rendered OR emitted as JSON. */
interface StatusReport {
  lock: { pid: number; startedAt: string } | null;
  activeColor: DeploymentColor | null;
  previousVersion: string | null;
  stateful: ServiceRow[];
  blue: ServiceRow[];
  green: ServiceRow[];
  containers: { name: string; status: string }[];
  /** Incus: a restore or a colour flip that has not finished. */
  notices: string[];
}

function getServiceStatus(
  exists: boolean,
  running: boolean,
  health: HealthState,
): ServiceStatus {
  if (!exists) return 'not deployed';
  if (!running) return 'stopped';
  if (health === 'healthy') return 'healthy';
  if (health === 'starting') return 'starting';
  if (health === 'unhealthy') return 'unhealthy';
  return 'running';
}

async function getContainerStatus(
  runtime: StackRuntime,
  containerName: string,
) {
  const [exists, running, health, version, crashed, admission] =
    await Promise.all([
      runtime.exists(containerName),
      runtime.isRunning(containerName),
      healthOf(runtime, containerName),
      runtime.version(containerName),
      runtime instanceof IncusRuntime
        ? runtime.stoppedAfterCrashes(containerName)
        : false,
      runtime instanceof IncusRuntime ? runtime.admission(containerName) : null,
    ]);
  const crashTail =
    crashed && runtime instanceof IncusRuntime
      ? await crashTailOf(runtime, containerName)
      : null;
  return { exists, running, health, version, crashed, admission, crashTail };
}

/** How many console lines a crashed row shows; `tale logs` shows more. */
const CRASH_TAIL_LINES = 10;

/** The console a stopped instance kept; null when it cannot be read. */
async function crashTailOf(
  runtime: IncusRuntime,
  name: string,
): Promise<{ label: string; lines: string[] } | null> {
  try {
    return await runtime.crashTail(name, CRASH_TAIL_LINES);
  } catch (error) {
    logger.warn(
      `The console of ${name} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/** The instance's health; one the runtime cannot judge (an Incus
 * instance made before it carried its healthcheck) reads `none`, so the
 * row says `running`, never fails the whole status. */
async function healthOf(
  runtime: StackRuntime,
  name: string,
): Promise<HealthState> {
  try {
    return await runtime.health(name);
  } catch (error) {
    logger.debug(
      `The health of ${name} is unknown: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 'none';
  }
}

function rowOf(
  service: string,
  info: Awaited<ReturnType<typeof getContainerStatus>>,
): ServiceRow {
  return {
    service,
    status: info.crashed
      ? 'stopped after repeated crashes'
      : getServiceStatus(info.exists, info.running, info.health),
    version: info.version ?? null,
    ...(info.admission === null ? {} : { admission: info.admission }),
    ...(info.crashTail === null ? {} : { crashTail: info.crashTail }),
  };
}

async function rowsFor(
  runtime: StackRuntime,
  services: readonly string[],
  suffix: (service: string) => string,
): Promise<ServiceRow[]> {
  return Promise.all(
    services.map(async (service) => {
      return rowOf(service, await getContainerStatus(runtime, suffix(service)));
    }),
  );
}

/**
 * One row per REPLICA of one colour, named by role and index. A colour-rolled
 * service is a replica set, so `platform` alone would answer for whichever
 * container happened to be first — the operator needs to see that two of
 * three api replicas are healthy, not an average.
 */
async function colorRows(
  runtime: StackRuntime,
  projectName: string,
): Promise<ServiceRow[]> {
  const containers = await runtime.list({ stack: projectName });
  const rows = await Promise.all(
    containers.map(async (container) => {
      const info = await getContainerStatus(runtime, container.name);
      const total = containers.filter(
        (peer) => peer.service === container.service,
      ).length;
      return rowOf(
        total > 1
          ? `${container.service} #${container.index}`
          : container.service,
        info,
      );
    }),
  );
  return rows;
}

/** Gather the full status struct (no I/O ordering assumptions in the renderer). */
async function gatherStatus(
  deployDir: string,
  runtime: StackRuntime,
): Promise<StatusReport> {
  const project = getProjectId();
  const incus = runtime instanceof IncusRuntime;
  const [lock, state, stateful, blue, green, containers] = await Promise.all([
    getLockInfo(deployDir),
    getDeploymentState(deployDir),
    rowsFor(
      runtime,
      // On Incus the stack's resolvers and its switch are singletons too.
      [
        ...STATEFUL_SERVICES,
        ...SIDECAR_SERVICES,
        ...(incus ? INCUS_SINGLETONS : []),
      ],
      (s) => `${project}-${s}`,
    ),
    colorRows(runtime, `${project}-blue`),
    colorRows(runtime, `${project}-green`),
    runtime.listByName(project),
  ]);
  return {
    lock: lock ? { pid: lock.pid, startedAt: lock.startedAt } : null,
    activeColor: state.currentColor ?? null,
    previousVersion: state.previousVersion ?? null,
    stateful,
    blue: blue.filter((r) => r.status !== 'not deployed'),
    green: green.filter((r) => r.status !== 'not deployed'),
    containers: containers.map((c) => ({ name: c.name, status: c.status })),
    notices: incus ? await incusNotices(deployDir) : [],
  };
}

/** The singletons the Incus runtime adds to the stack (design 5.3, 5.4). */
const INCUS_SINGLETONS = ['names', 'names-sessions', 'switch'] as const;

/** What the Incus journal holds unfinished: a restore (R3-22) or a flip. */
async function incusNotices(deployDir: string): Promise<string[]> {
  const journal = await readJournal(deployDir);
  const notices: string[] = [];
  const restore = restorePendingNotice(journal);
  if (restore !== null) notices.push(restore);
  const flip = journal?.flip;
  if (flip !== null && flip !== undefined)
    notices.push(
      `A colour flip onto ${flip.promoting} (${flip.version}) stopped in its ${flip.phase} phase; tale deploy resumes it.`,
    );
  return notices;
}

const STATUS_MARKER: Record<ServiceStatus, 'done' | 'warn' | 'error' | 'info'> =
  {
    healthy: 'done',
    running: 'done',
    starting: 'warn',
    unhealthy: 'error',
    stopped: 'error',
    'stopped after repeated crashes': 'error',
    'not deployed': 'info',
  };

/** Render one status row drawn from the single configured palette/markers. */
function renderRow(row: ServiceRow): void {
  const palette = getPalette();
  const markers = getMarkers();
  const kind = STATUS_MARKER[row.status];
  const color =
    kind === 'done'
      ? palette.green
      : kind === 'warn'
        ? palette.yellow
        : kind === 'error'
          ? palette.red
          : palette.dim;
  const glyph = markers[kind];
  const suffix = `${row.version ? ` (${row.version})` : ''}${row.admission === undefined ? '' : `, ${row.admission}`}`;
  console.log(
    `  ${color}${glyph}${palette.reset} ${row.service.padEnd(14)} ${color}${row.status}${palette.reset}${suffix}`,
  );
  if (row.crashTail !== undefined) {
    console.log(`      ${palette.dim}${row.crashTail.label}:${palette.reset}`);
    for (const line of row.crashTail.lines)
      console.log(`      ${palette.dim}${line}${palette.reset}`);
  }
}

function renderReport(report: StatusReport): void {
  const palette = getPalette();
  logger.header('Tale Deployment Status');
  if (report.lock) {
    logger.warn(
      `Deployment in progress (PID: ${report.lock.pid}, started: ${report.lock.startedAt})`,
    );
  }
  for (const notice of report.notices) logger.warn(notice);
  logger.info(`Active color: ${report.activeColor ?? 'none'}`);
  if (report.previousVersion) {
    logger.info(`Previous version: ${report.previousVersion}`);
  }

  logger.step('Stateful Services:');
  for (const row of report.stateful) renderRow(row);

  for (const color of ['blue', 'green'] as const) {
    const rows = report[color];
    const isActive = report.activeColor === color;
    const label = isActive ? `${color} (active)` : color;
    logger.step(`${label.charAt(0).toUpperCase() + label.slice(1)} Services:`);
    if (rows.length === 0) {
      console.log(`  ${palette.dim}(no services running)${palette.reset}`);
    } else {
      for (const row of rows) renderRow(row);
    }
  }

  if (report.containers.length > 0) {
    const markers = getMarkers();
    logger.step('All Containers:');
    for (const container of report.containers) {
      // Docker says `Up …`, Incus `Running`.
      const up =
        container.status.startsWith('Up') || container.status === 'Running';
      const color = up ? palette.green : palette.red;
      const glyph = up ? markers.done : markers.error;
      console.log(
        `  ${color}${glyph}${palette.reset} ${container.name.padEnd(24)} ${palette.dim}${container.status}${palette.reset}`,
      );
    }
  }
}

interface StatusOptions {
  deployDir: string;
  /** Emit the report as a single JSON object instead of the human table. */
  json?: boolean;
  /** The runtime to report on; selected from `tale.json` when absent. */
  runtime?: StackRuntime;
}

export async function status(options: StatusOptions): Promise<void> {
  const runtime = options.runtime ?? (await selectRuntime(options.deployDir));
  const report = await gatherStatus(options.deployDir, runtime);
  if (options.json) {
    emitJson('status', report);
    return;
  }
  renderReport(report);
}
