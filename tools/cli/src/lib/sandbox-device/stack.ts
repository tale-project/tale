import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import * as logger from '../../utils/logger';
import { type ExecResult, exec } from '../docker/exec';
import type { SandboxDeviceConfig } from './config';

/**
 * The device's containers, from the CLI's side. Laying them out is the sandbox
 * image's job (`device-apply`, which the device also runs to update itself),
 * so the CLI only starts that helper, reads state, follows logs and removes
 * what the helper created. The names below are the image's
 * (`services/sandbox/src/devices/device-config.ts`).
 */

export const DEVICE_SANDBOX_CONTAINER = 'tale-device-sandbox';
export const DEVICE_EGRESS_CONTAINER = 'tale-device-egress';
export const DEVICE_UPDATER_CONTAINER = 'tale-device-updater';
const DEVICE_APPLY_CONTAINER = 'tale-device-apply';
const DEVICE_NETWORKS = ['tale-device-net', 'tale-device-uplink'];
/** Every session container a device's spawner started. */
const DEVICE_SESSION_FILTER = 'label=tale.sandbox-instance=device';

export interface StackDeps {
  /** Run docker and collect its output. */
  docker: (args: string[]) => Promise<ExecResult>;
  /** Run docker with its output streamed to this terminal; the exit code. */
  dockerStreamed: (args: string[]) => Promise<number>;
}

export const defaultStackDeps: StackDeps = {
  docker: (args) => exec('docker', args, { silent: true }),
  dockerStreamed: async (args) => {
    const proc = Bun.spawn(['docker', ...args], {
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    });
    return proc.exited;
  },
};

/** The images a device runs at a release; explicit references win. */
export function deviceImages(
  config: SandboxDeviceConfig,
  version: string,
): { sandbox: string; runtime: string; egress: string } {
  const at = (name: string) => `${config.registry}/${name}:${version}`;
  return {
    sandbox: config.images?.sandbox ?? at('tale-sandbox'),
    runtime: config.images?.runtime ?? at('tale-sandbox-runtime'),
    egress: config.images?.egress ?? at('tale-sandbox-egress'),
  };
}

/**
 * Lay the stack out at `version` with that release's own helper. Streams the
 * helper's progress (image pulls, container starts) to the terminal.
 */
export async function applyDeviceStack(
  config: SandboxDeviceConfig,
  configPath: string,
  version: string,
  deps: StackDeps = defaultStackDeps,
): Promise<void> {
  const socket = config.dockerSocket ?? '/var/run/docker.sock';
  const image = deviceImages(config, version).sandbox;
  // A helper left behind by an interrupted run would block the name.
  await deps.docker(['rm', '--force', DEVICE_APPLY_CONTAINER]);
  const code = await deps.dockerStreamed([
    'run',
    '--rm',
    '--name',
    DEVICE_APPLY_CONTAINER,
    '--label',
    'tale.device-stack=apply',
    '--volume',
    `${socket}:/var/run/docker.sock`,
    '--volume',
    `${config.stateDir}:${config.stateDir}`,
    image,
    'device-apply',
    configPath,
    '--version',
    version,
  ]);
  if (code !== 0) {
    throw new Error(`the device setup helper exited with code ${code}`);
  }
}

export interface ContainerState {
  status: string;
  health: string | null;
  image: string;
}

async function inspectContainer(
  name: string,
  deps: StackDeps,
): Promise<ContainerState | null> {
  const res = await deps.docker([
    'container',
    'inspect',
    '--format',
    '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.Config.Image}}',
    name,
  ]);
  if (!res.success) return null;
  const [status = '', health = '', image = ''] = res.stdout.trim().split('|');
  return { status, health: health === '' ? null : health, image };
}

export interface StackState {
  sandbox: ContainerState | null;
  egress: ContainerState | null;
  updater: ContainerState | null;
  sessions: number;
}

export async function readStackState(
  deps: StackDeps = defaultStackDeps,
): Promise<StackState> {
  const [sandbox, egress, updater, sessions] = await Promise.all([
    inspectContainer(DEVICE_SANDBOX_CONTAINER, deps),
    inspectContainer(DEVICE_EGRESS_CONTAINER, deps),
    inspectContainer(DEVICE_UPDATER_CONTAINER, deps),
    deps.docker([
      'ps',
      '--quiet',
      '--filter',
      DEVICE_SESSION_FILTER,
      '--filter',
      'status=running',
    ]),
  ]);
  return {
    sandbox,
    egress,
    updater,
    sessions: sessions.success
      ? sessions.stdout.split('\n').filter((l) => l.trim() !== '').length
      : 0,
  };
}

/** What the helper recorded after its last successful layout. */
export async function readAppliedVersion(
  stateDir: string,
): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(stateDir, 'state.json'), 'utf8'),
    );
    const version =
      parsed !== null && typeof parsed === 'object'
        ? Reflect.get(parsed, 'appliedVersion')
        : undefined;
    return typeof version === 'string' ? version : null;
  } catch (err) {
    if (
      !(
        err !== null &&
        typeof err === 'object' &&
        'code' in err &&
        err.code === 'ENOENT'
      )
    ) {
      logger.warn(
        `Could not read the device state: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return null;
  }
}

/** The last automatic update attempt, as the device recorded it. */
export async function readUpdateStatus(stateDir: string): Promise<{
  state: string;
  targetVersion: string | null;
  error: string | null;
} | null> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(stateDir, 'update-status.json'), 'utf8'),
    );
    if (parsed === null || typeof parsed !== 'object') return null;
    const get = (key: string): unknown => Reflect.get(parsed, key);
    const state = get('state');
    const targetVersion = get('targetVersion');
    const error = get('error');
    return {
      state: typeof state === 'string' ? state : 'idle',
      targetVersion: typeof targetVersion === 'string' ? targetVersion : null,
      error: typeof error === 'string' ? error : null,
    };
  } catch (err) {
    if (
      !(
        err !== null &&
        typeof err === 'object' &&
        'code' in err &&
        err.code === 'ENOENT'
      )
    ) {
      logger.warn(
        `Could not read the device update status: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return null;
  }
}

/**
 * Stop and remove everything the device stack created: its spawner, egress
 * proxy, any updater, every session container, and its two networks. With
 * `purgeData`, the workspaces go too — through a root helper container, since
 * sessions write files as their own users, which this shell may not own.
 */
/** Is the Docker daemon answering? */
export async function dockerReachable(
  deps: StackDeps = defaultStackDeps,
): Promise<boolean> {
  return (await deps.docker(['info', '--format', '{{.ServerVersion}}']))
    .success;
}

export async function removeDeviceStack(
  config: SandboxDeviceConfig,
  options: { purgeData: boolean },
  deps: StackDeps = defaultStackDeps,
): Promise<{ containers: number }> {
  // The image to run the purge helper with — whichever the stack used.
  const helperImage =
    (await inspectContainer(DEVICE_SANDBOX_CONTAINER, deps))?.image ??
    config.images?.sandbox ??
    null;
  const sessions = await deps.docker([
    'ps',
    '--all',
    '--quiet',
    '--filter',
    DEVICE_SESSION_FILTER,
  ]);
  const sessionIds = sessions.success
    ? sessions.stdout.split('\n').filter((l) => l.trim() !== '')
    : [];
  const names = [
    DEVICE_UPDATER_CONTAINER,
    DEVICE_SANDBOX_CONTAINER,
    DEVICE_EGRESS_CONTAINER,
    DEVICE_APPLY_CONTAINER,
  ];
  let containers = 0;
  const stuck: string[] = [];
  for (const target of [...names, ...sessionIds]) {
    const res = await deps.docker(['rm', '--force', target]);
    if (res.success) containers++;
    // Absent is done; anything else would outlive the config it needs (the
    // containers restart with Docker).
    else if (!/no such container/i.test(res.stderr)) stuck.push(target);
  }
  if (stuck.length > 0) {
    throw new Error(
      `Could not remove ${stuck.join(', ')}; run \`tale sandbox disconnect\` again`,
    );
  }
  for (const network of DEVICE_NETWORKS) {
    await deps.docker(['network', 'rm', network]);
  }
  if (options.purgeData) {
    const sessionsDir = join(config.stateDir, 'sessions');
    if (helperImage !== null) {
      await deps.docker([
        'run',
        '--rm',
        '--volume',
        `${config.stateDir}:${config.stateDir}`,
        '--entrypoint',
        'rm',
        helperImage,
        '-rf',
        sessionsDir,
      ]);
    }
    await rm(config.stateDir, { recursive: true, force: true });
  }
  return { containers };
}

/** Show (or follow) the device spawner's log. */
export async function showDeviceLogs(
  options: { follow: boolean; tail: number },
  deps: StackDeps = defaultStackDeps,
): Promise<number> {
  return deps.dockerStreamed([
    'logs',
    ...(options.follow ? ['--follow'] : []),
    '--tail',
    String(options.tail),
    DEVICE_SANDBOX_CONTAINER,
  ]);
}
