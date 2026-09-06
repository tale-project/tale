import { getMarkers, getPalette } from '@tale/shared/tux';

import { emitJson } from '../../utils/json-output';
import { getProjectId } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import {
  type DeploymentColor,
  ROTATABLE_SERVICES,
  SIDECAR_SERVICES,
  STATEFUL_SERVICES,
} from '../compose/types';
import { containerExists } from '../docker/container-exists';
import { getContainerHealth } from '../docker/get-container-health';
import { getContainerVersion } from '../docker/get-container-version';
import { isContainerRunning } from '../docker/is-container-running';
import { listContainers } from '../docker/list-containers';
import { getDeploymentState } from '../state/get-deployment-state';
import { getLockInfo } from '../state/get-lock-info';

type ServiceStatus =
  | 'healthy'
  | 'starting'
  | 'unhealthy'
  | 'running'
  | 'stopped'
  | 'not deployed';

interface ServiceRow {
  service: string;
  status: ServiceStatus;
  version: string | null;
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
}

function getServiceStatus(
  exists: boolean,
  running: boolean,
  health: 'healthy' | 'unhealthy' | 'starting' | 'none',
): ServiceStatus {
  if (!exists) return 'not deployed';
  if (!running) return 'stopped';
  if (health === 'healthy') return 'healthy';
  if (health === 'starting') return 'starting';
  if (health === 'unhealthy') return 'unhealthy';
  return 'running';
}

async function getContainerStatus(containerName: string) {
  const [exists, running, health, version] = await Promise.all([
    containerExists(containerName),
    isContainerRunning(containerName),
    getContainerHealth(containerName),
    getContainerVersion(containerName),
  ]);
  return { exists, running, health, version };
}

async function rowsFor(
  services: readonly string[],
  suffix: (service: string) => string,
): Promise<ServiceRow[]> {
  return Promise.all(
    services.map(async (service) => {
      const info = await getContainerStatus(suffix(service));
      return {
        service,
        status: getServiceStatus(info.exists, info.running, info.health),
        version: info.version ?? null,
      };
    }),
  );
}

/** Gather the full status struct (no I/O ordering assumptions in the renderer). */
async function gatherStatus(deployDir: string): Promise<StatusReport> {
  const project = getProjectId();
  const [lock, state, stateful, blue, green, containers] = await Promise.all([
    getLockInfo(deployDir),
    getDeploymentState(deployDir),
    rowsFor(
      [...STATEFUL_SERVICES, ...SIDECAR_SERVICES],
      (s) => `${project}-${s}`,
    ),
    rowsFor(ROTATABLE_SERVICES, (s) => `${project}-${s}-blue`),
    rowsFor(ROTATABLE_SERVICES, (s) => `${project}-${s}-green`),
    listContainers(`name=${project}`),
  ]);
  return {
    lock: lock ? { pid: lock.pid, startedAt: lock.startedAt } : null,
    activeColor: state.currentColor ?? null,
    previousVersion: state.previousVersion ?? null,
    stateful,
    blue: blue.filter((r) => r.status !== 'not deployed'),
    green: green.filter((r) => r.status !== 'not deployed'),
    containers: containers.map((c) => ({ name: c.name, status: c.status })),
  };
}

const STATUS_MARKER: Record<ServiceStatus, 'done' | 'warn' | 'error' | 'info'> =
  {
    healthy: 'done',
    running: 'done',
    starting: 'warn',
    unhealthy: 'error',
    stopped: 'error',
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
  const suffix = row.version ? ` (${row.version})` : '';
  console.log(
    `  ${color}${glyph}${palette.reset} ${row.service.padEnd(14)} ${color}${row.status}${palette.reset}${suffix}`,
  );
}

function renderReport(report: StatusReport): void {
  const palette = getPalette();
  logger.header('Tale Deployment Status');
  if (report.lock) {
    logger.warn(
      `Deployment in progress (PID: ${report.lock.pid}, started: ${report.lock.startedAt})`,
    );
  }
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
      const up = container.status.startsWith('Up');
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
}

export async function status(options: StatusOptions): Promise<void> {
  const report = await gatherStatus(options.deployDir);
  if (options.json) {
    emitJson('status', report);
    return;
  }
  renderReport(report);
}
